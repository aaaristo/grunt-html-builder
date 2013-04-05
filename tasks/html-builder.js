/*
 * grunt-html-builder
 * https://github.com/andrea/grunt-html-builder
 *
 * Copyright (c) 2013 Andrea Amerigo Aristodemo Gariboldi
 * Licensed under the MIT license.
 */

module.exports = function(grunt) 
{
  var jquery= require('jquery-html'),
      jsonpath= require('JSONPath').eval,
      jsrender= require('./jsrender'),
      fs= require('fs'),
      util= require('util'),
      p= require('path'),
      xmlbuilder = require("xmlbuilder");

  var pageTypes= {},
      cache= {};

  var log= grunt.log,
      verbose= grunt.log.verbose,
      file= grunt.file,
      fail= grunt.fail,
      _= grunt.util._,
      async= grunt.util.async,
      i18n,
      mem= function ()
      {
         return util.inspect(process.memoryUsage());
      },
      _cache= function (cid,process)
      {
         var r,
             cids= cid.split('.'),
             current= cache;

         for (var i=0;i<cids.length-1;i++)
            current= current[cids[i]]= current[cids[i]] || {};

         var lcid= cids[cids.length-1];

         if ((r=current[lcid])===undefined)
         {
           r= process();
           current[lcid]= r;
         }

         return r;
      },
      _htmlText= function ()
      {
          return _cache('html',function ()
          { 
              var src= p.join('src','html','html.html');

              if (!file.exists(src))
                src= p.join('node_modules','grunt-html-builder','resources','html.html');

              return file.read(src);
          });
      },
      _html= function (config)
      {
          var tpl= jsrender.compile(_htmlText());
          return tpl.render(config);
      },
      _layoutText= function (name)
      {
          return _cache('layout.'+name,function ()
          {
              var src= p.join('src','html','layout',name+'.html');

              if (!file.exists(src))
               fail.fatal('Cannot find layout "'+src+'"');

              return file.read(src);
          });
      },
      _layout= function (config)
      {
          return !config.layout ? false : _layoutText(config.layout);
      },
      _writechunk= function (cdest,data,chunk,hasOthers)
      {
         var dest= p.join('dist/js/data',cdest+(chunk ? '-'+chunk : '')+'.json');
         file.write(dest,
                    JSON.stringify({ chunk: chunk, items: data, hasOthers: hasOthers }));
         log.ok('Generated JSON chunk: '+dest);
      },
      _paginate= function (arr,pageSize)
      {
         var pages= [],
             origForEach= pages.forEach;

         if (arr.length<=pageSize)
           pages.push(arr);
         else
         {
            var count= Math.ceil(arr.length/pageSize);
            for (var i=0;i<count;i++)
            {
               var start= i*pageSize,
                   end= start+pageSize;

               if (end>arr.length) end= arr.length;

               pages.push(arr.slice(start,end));
            }
         }

         pages.forEach= function (cb)
         {
             origForEach.apply(this,[function (page,idx)
             {
                 cb(page,{ current: idx+1, count: pages.length, pages: _.range(1,pages.length+1) });
             }]);
         };

         return pages;
      },
      _chunkdata= function (data,dest,chunk)
      {
           var offset= 0,
               cnt= 0;
           
           while (offset+chunk<=data.length)
           {
             _writechunk(dest,data.slice(offset,offset+chunk),cnt++,(data.length>(offset+chunk)));
             offset+= chunk;
           }

           if (offset<data.length)
             _writechunk(dest,data.slice(offset,data.length),cnt,false); 
      },
      _traverse= function (o, fn)
      {
         for (var i in o)
         {
             fn.apply(null,[i,o[i],o]);
             if (typeof (o[i])=='object')
               _traverse(o[i],fn);
         }
      },
      _clone= function (o)
      {
        return JSON.parse(JSON.stringify(o));
      },
      _alias= function (s)
      {
        return s.replace(/[^a-z0-9]/gi,'-').toLowerCase();
      },
      _collection= function (name)
      {
            var src= p.join('data','json',name+'.json'),
                data= true;

            if (!file.exists(src)) 
            {
              var src1= src;
              src= p.join('src','json',name+'.json');

              if (!file.exists(src)) 
                fail.fatal('Cannot find JSON "'+src+'" or "'+src1+'"');

              data= false;
            }

            var r= _cache('collection.'+(data ? 'data' : 'src')+'.'+name,function ()
            {
                try
                {
                    return file.readJSON(src);
                }
                catch (ex)
                {
                    fail.fatal('evaluating JSON :'+ex);
                }
            });

            return r;
      },
      _transform= function (data,transformation)
      {
          try
          {   
              var src= p.join('src','js','transform',transformation+'.js'),
                  js= file.read(src);

              eval('(function (grunt,_,clone,paginate,alias,collection,json,done) { '+js+' })')
                  (grunt,_,_clone,_paginate,_alias,_collection,data,
              function (transformed)
              {
                  data= transformed;
              });

              return data;
          }
          catch (ex)
          {
              fail.fatal(ex+' evaluating '+src);
          }
      },
      _template= function(name)
      {
         return _cache('template.'+name,function ()
         {
             var src= p.join('src','html','template',name+'.html');
             
             if (file.exists(src))
             {
               var text= file.read(src);
               if (text!=='')
                 return {
                           _tpl: jsrender.compile(text), 
                           render: function (data)
                           {
                              try
                              {
                                 return this._tpl.render(data);
                              }
                              catch (ex)
                              {
                                 fail.fatal(ex+' evaluating template "'+src+'"');
                              }
                           }
                        };
               else
                 fail.fatal('Template "'+src+'" is empty');
             }
             else 
               fail.fatal('Cannot find template "'+src+'"');
         });
      },
      _blockText= function (name,lang)
      {
         return _cache('block.'+(lang ? '_lang.'+lang+'.' : '')+name,function ()
         {
             var src= p.join('src','html','block',name+'.html');

             if (!file.exists(src)) fail.fatal('Cannot find block "'+src+'"');

             var text= file.read(src);

             return (lang ? jsrender.compile(text).render({}) : text);
         });
      },
      _i18n= function ()
      {
         return _collection('i18n');
      },
      _converters= function (lang,globalConfig)
      {
         var defaultLanguage= (globalConfig.languages ? globalConfig.languages[0] : undefined),
             href= function (pageType,data,pageNo)
             {  
                  var config= pageTypes[pageType];
                  if (config&&config.href)
                    try
                    {
                        return (lang&&lang!=defaultLanguage ? '/'+lang+'/' : '/')+
                                 config.href((data || (this.tagCtx ? this.tagCtx.view.data : {})),(pageNo ? pageNo : undefined))+'.html';
                    }
                    catch (ex)
                    {
                       fail.fatal('error in page type "'+pageType+'" href function: '+ex);
                    }
                  else
                    return (lang&&lang!=defaultLanguage ? '/'+lang+'/' : '/')+pageType+'.html';
             };

         jsrender.helpers({ href: href });

         jsrender.converters
         ({
               t: function (o)
               {
                  if (!globalConfig.languages||globalConfig.languages.length<2)
                    fail.fatal('languages not configured in grunt.js you should specify at least 2 languages');

                  if (typeof o=='object')
                  {
                     if (o[lang])
                       return o[lang]; 
                     else
                     if (o[defaultLanguage])
                       return o[defaultLanguage];
                     else
                       fail.fatal('no translation for: '+JSON.stringify(o));
                  }
                  else
                  if (typeof o=='string')
                  {
                     var tr= (i18n ? i18n[o] : {});

                     if (tr&&tr[lang])
                       return tr[lang]; 
                     else
                     {
                       if (lang!=defaultLanguage)
                         verbose.error('no translation found for "'+o+'" ('+lang+')');
                       return o;
                     }
                  }
                  else
                     fail.fatal('unknown type of: '+JSON.stringify(o));
               },
               href: href
         });

      },
      _page= function(path,lang,config,globalConfig,done)
      {   
         _converters(lang,globalConfig);

         var $,
             dest= p.join('dist',path+'.html'),
             html= _html(config),
             defaultLanguage= (globalConfig.languages ? globalConfig.languages[0] : undefined),
             _data= function ($elem)
             {
                var name= $elem.data('collection');
                
                if (name)
                {
                   var data= _collection(name),
                       chunk= $elem.data('chunk'),
                       chunkSize= $elem.data('chunk-size'),
                       path= $elem.data('path'),
                       transform= $elem.data('transform');

                   if (chunk)
                     return data.slice(chunk-1,(chunk-1)+chunkSize);                      
                   else
                   if (path)
                   {
                      var res= jsonpath(data,path),
                          distinct= $elem.data('path-distinct');

                      if (distinct)
                      {
                         var map= {};
                         res.forEach(function (r)
                         {
                            map[r]= true;
                         });
                         res= Object.keys(map);
                      } 
                     
                      return res;
                   }
                   else
                   if (transform)
                     return _transform(data,transform);
                   else
                     return data;                      
                }
                else
                  return false;
             },
             _$e= function (text)
             {
                try
                {
                   return $(text);
                }
                catch (ex)
                {
                   return text;
                }
             },
             _block= function (name,done)
             {
                var $content;

                if ($.isFunction(name))
                    $content= _$e(name()); 
                else
                    $content= _$e(_blockText(name,lang));

                if (typeof $content!='string')
                $content.find('[data-template]').andSelf().each(function ()
                {
                   var $container= $(this),
                       name= $container.data('template');

                   if (!name) return;

                   var tpl= _template(name),
                       data= _data($container);
                   
                   if (data)
                     $container.append(tpl.render(data));
                });

                done({ content: $content });
             },
             _region= function (region,done)
             {
                if (Array.isArray(region.blocks)) 
                    async.forEachSeries(region.blocks,function (block,done)
                    {
                       _block(block,function (block)
                       {
                          $('[data-region="'+region.name+'"]').append(block.content); 
                          done();
                       });
                    },done);
                else
                    _block(region.blocks,function (block)
                    {
                      $('[data-region="'+region.name+'"]').append(block.content); 
                      done();
                    });
                   
             },
             _regions= function (config,done)
             {
                 var regions= [];

                 for (var region in config.blocks)
                    regions.push({ name: region, blocks: config.blocks[region] });

                 async.forEach(regions,function (region,done)
                 {
                   _region(region,done);
                 },
                 done);
             },
             _build= function (done)
             {
                 _converters(lang,globalConfig);

                 var layout= _layout(config),
                     module= file.exists(p.join('src','client','js','module',config.name+'.js')),
                     $head= $('head'),
                     $body= $(globalConfig.body ? globalConfig.body : 'body');

                 if (layout) $body.prepend(layout);

                 $body= $('body');

                 if (lang)
                 {
                   $body 
                     .attr('data-language',lang)
                     .attr('data-default-language',globalConfig.languages[0]);

                   $('html').attr('lang',lang);

                   globalConfig.languages.forEach(function (altLang)
                   {
                     if (altLang!=lang)
                       $head.append('<link rel="alternate" hreflang="'+altLang+'" href="/'+altLang+'/'+path+'.html" />');
                   });
                 }
                 
                 if (module)
                   $body.attr('data-module',config.name);

                 async.forEachSeries([globalConfig,config],_regions,done);
             };


         jquery.create(html,function (window,jQuery,free)
         {
             verbose.debug(mem(),'Generting page '+dest);
             window.execScript= function () {}; // disables jquery script evaluation
             $= jQuery;
             _build(function ()
             {
                 if (config.postBuild) config.postBuild($,lang); 
                 grunt.file.write(dest,jquery.source(window).replace(/xscript/g,'script'));
                 (lang!==defaultLanguage ? verbose : log).ok('Generated page '+dest); 
                 free();
                 done();
             });
         });

      },
      _pages= function (config,done)
      {
         var pages= [],
             globalConfig= config;

         if (file.exists('src/js/page'))
         file.recurse('src/js/page',function (filepath,rootdir,subdir,filename)
         {
              if (!/\.js$/.exec(filename)) return;

              log.ok('Evaluating '+filename+'...');

              var js= file.read(filepath),
                  _config,
                  addPage= function (config)
                  {
                     var defaultLanguage,
                         _add= function (config,lang)
                         {
                             pages.push({ path: (lang&&lang!=defaultLanguage ? lang+'/' : '')+config.path, config: config, lang: lang });
                         };

                     config.name= filename.replace('.js','');
                     config.path= config.path || config.name;

                     if (globalConfig.languages) 
                     {
                       defaultLanguage= globalConfig.languages[0];
                       globalConfig.languages.forEach(function (lang,idx)
                       {
                          _add(config,lang);
                       });
                     }
                     else
                       _add(config);

                     pageTypes[config.name]= config;
                  },
                  template= function (name,data)
                  {
                      return function ()
                      {
                         _traverse(data,function (key,value,object)
                         {
                            if (typeof value=='function'&&!(Array.isArray(object)&&isNaN(key)))
                              object[key]= value(); // resolve nested templates
                         });
                         
                         return _template(name).render(data);
                      };
                  };

              try
              {   
                  eval('(function (page,block,paginate,template,collection,transform,chunkdata,alias,jsonpath) { '+js+' })')
                                  (addPage,_blockText,_paginate,template,_collection,_transform,_chunkdata,_alias,jsonpath);
              }
              catch (ex)
              {
                  fail.fatal(ex+' evaluating '+filepath);
              }
              
         });

         if (globalConfig.languages)
           i18n= _i18n();

         async.forEachSeries(pages,function (page,done)
         {
           _page(page.path,page.lang,page.config,config,done);
         },
         function (err)
         {
            if (err) fail.fatal(err);
            verbose.debug('Generated '+pages.length+' pages');
            done();
         });
      };

  grunt.html= {
                 collection: _collection
              };

  grunt.registerTask('html-builder', 'Assemble static HTML files', function() 
  {
     var config= grunt.config('html-builder') || {},
         time= process.hrtime(),
         done= this.async();

     async.forEach([_pages],function (fn,done)
     {
          fn(config,done);
     },
     function ()
     {
          var diff= process.hrtime(time),
              secs= Math.round((diff[0]*1e9+diff[1])/1e9);
          cache= {};
          verbose.debug('Stopping after '+secs+'secs, mem used ~'+Math.round(process.memoryUsage().rss/1024/1024)+'MB');
          done();
     });
  });

  grunt.registerTask('html-builder-json', 'Create chunks of JSON files', function() 
  {
     var config= grunt.config('html-builder').json,
         done= this.async();

     async.forEach(config,function (config,done)
     {
         var data= _collection(config.collection);

         if (config.filter)
           data= jsonpath(data,config.filter);

         if (config.slice)
           _writechunk(config.dest,data.slice.apply(data,config.slice));
         else
         if (config.chunk)
           _chunkdata(data,config.dest,config.chunk);
         else
         if (config.transform)
         {
            var dest= p.join('data/json',config.dest+'.json');

            if (file.exists(dest)) 
             file.delete(dest);

            file.write(dest,
                       JSON.stringify(_transform(data,config.transform)));
            log.ok('Generated JSON collection: '+dest);
         }
         else 
           _writechunk(config.dest,data);

         done();
     },
     done);
  });

};
