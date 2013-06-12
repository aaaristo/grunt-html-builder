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
      rdfstore= require('./rdfstore'),
      fs= require('fs'),
      os= require('os'),
      util= require('util'),
      p= require('path'),
      xmlbuilder = require("xmlbuilder"),
      forkqueue= require('./forkqueue'),
      xlsx= require('./lib/xlsx'),
      argv = require('optimist').argv;

  var pageTypes= {},
      cache= {},
      i18n,
      pageQueue,
      store;

  var log= grunt.log,
      verbose= grunt.log.verbose,
      file= grunt.file,
      fail= grunt.fail,
      _= grunt.util._,
      async= grunt.util.async,
      mem= function ()
      {
         return util.inspect(process.memoryUsage());
      },
      _toJSONLD= function (data,context)
      {
           var ld= _.clone(context),
               transform= context['@transform'],
               prefix= context['@id_prefix'] || '';

           if (prefix in context['@context']) 
             ld['@id']= context['@context'][prefix]+data['id'];
           else
             ld['@id']= prefix+data['id'];

           var ld= _.extend(ld,data);

           delete ld['@transform'];
           delete ld['@id_prefix'];
 
           if (transform) transform(ld,data,context);

           return ld;
      },
      _store= function (cb)
      {
         if (store==null)
           rdfstore.create(function (s)
           {
              store= s;
              cb(s);
           });
         else
           cb(store);
      },
      _context= function (name)
      {
          return _cache('context.'+name,function ()
          {
              try
              {   
                  var src= p.join('src','json','context',name+'.js'),
                      js= file.read(src),
                      _ctx;

                  eval('(function (grunt,_,clone,collection,done) { '+js+' })')
                      (grunt,_,_clone,_collection,
                  function (ctx)
                  {
                      _ctx= ctx;
                  });

                  return _ctx;
              }
              catch (ex)
              {
                  fail.fatal(ex+' evaluating '+src);
              }
          });
      },
      _index= function(collection,by)
      {
          var _process= function (arr)
          {
              var idx= {};

              arr.forEach(function (elem)
              {
                  idx[elem[by]]= elem;
              });

              return (function (idx) { return function (by) { return idx[by]; } })(idx);
          };

          if (typeof collection=='string')
            return _cache('index.'+collection+'.'+by,function ()
            {
               return _process(_collection(collection),by);
            });
          else
            return _process(collection,by);
      },
      _mindex= function(collection,by)
      {
          var _process= function (arr)
          {
              var idx= {},
                  _vals= function (obj,path)
                  {
                     var r= [],
                         current= obj;

                     if (Array.isArray(current)) 
                     {
                          current.forEach(function (el)
                          {
                             r.push.apply(r,_vals(el,path.slice(i+1)));
                          });

                          return r;
                     }

                     for (var i=0;i<path.length-1;i++)
                     {
                        current= current[path[i]]= current[path[i]];
                        if (current===undefined) 
                          return [];
                        else
                        if (Array.isArray(current)) 
                          return _vals(current,path.slice(i+1));
                     }

                     var val= current[path[path.length-1]];

                     if (Array.isArray(val))
                       r.push.apply(r,val);
                     else
                       r.push(val);

                     return r;
                  },
                  _push= function (val,elem)
                  {
                      var vals;
                      if (!(vals=idx[val])) vals= idx[val]= [];
                      vals.push(elem);
                  };

              arr.forEach(function (elem)
              {
                  _vals(elem,by.split('.')).forEach(function (val)
                  {
                       _push(val,elem);
                  });
              });

              return (function (idx) { return function (by) { return idx[by] || []; } })(idx);
          };

          if (typeof collection=='string')
            return _cache('mindex.'+collection+'.'+by,function ()
            {
               return _process(_collection(collection),by);
            });
          else
            return _process(collection,by);
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
          var src= p.join('src','html','html.html');

          if (!file.exists(src))
            src= p.join('node_modules','grunt-html-builder','resources','html.html');

          return file.read(src);
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

            r.toJSONLD= function (context)
            {
                 var r= [];

                 this.forEach(function (elem,i)
                 {
                      r.push(_toJSONLD(elem,context));
                 });

                 return r;
            }

            return r;
      },
      _parseExcel= function (src)
      {
            var workbook= xlsx.decode(fs.readFileSync(src, "base64"));

            workbook.sheet= function (name)
            { 
               var worksheet;

               this.worksheets.forEach(function (s)
               {
                  if (s.name==name)
                  {
                      worksheet= s;
                      return false;
                  }
               });

               return worksheet;
            }

            workbook.worksheets.forEach(function (s)
            {
               s.toJSON= function (fields,_transformFnc)
               {
                  var r= [];

                  this.data.forEach(function (row,idx)
                  {
                      var obj= {},
                          _value= function (value)
                          {
                             if (value)
                               return value.value;
                             else
                               return '';
                          },
                          _val= function (field,value)
                          {
                             var r,
                                 path= field.split('.'),
                                 current= obj;

                             for (var i=0;i<path.length-1;i++)
                                current= current[path[i]]= current[path[i]] || {};

                             current[path[path.length-1]]= _value(value);
                          };

                      for (var i=0;i<fields.length;i++)
                         _val(fields[i],row[i]); 

                      if (_transformFnc)
                        obj= _transformFnc(obj,idx);
                      
                      if (Array.isArray(obj))
                        r.concat(obj);
                      else
                      if (obj)
                        r.push(obj);
                  });

                  return r;
               }
            });

            return workbook;
      },
      _excel= function (name)
      {
            var src= p.join('data','excel',name+'.xlsx'),
                data= true;

            if (!file.exists(src)) 
            {
              var src1= src;
              src= p.join('src','excel',name+'.xlsx');

              if (!file.exists(src)) 
                fail.fatal('Cannot find excel "'+src+'" or "'+src1+'"');

              data= false;
            }

            var r= _cache('excel.'+(data ? 'data' : 'src')+'.'+name,function ()
            {
                try
                {
                    return _parseExcel(src);
                }
                catch (ex)
                {
                    fail.fatal('parsing excel:'+ex);
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

              eval('(function (grunt,_,clone,paginate,alias,collection,excel,json,index,mindex,context,done) { '+js+' })')
                  (grunt,_,_clone,_paginate,_alias,_collection,_excel,data,_index,_mindex,_context,
              function (transformed)
              {
                  data= transformed;
              });

              return data;
          }
          catch (ex)
          {
              verbose.error(ex.stack);
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
             },
             rdfa_prefixes= function ()
             {
                 try
                 {
                    var rdf= this.data.rdf;

                    if (!rdf) return '';

                    var ctx= this.data.rdf['@context'],
                        prefixes= [];

                     Object.keys(ctx).forEach(function (key)
                     {
                         var val= ctx[key];

                         if (key.indexOf('@')==-1
                             &&typeof val=='string'
                             &&val.indexOf('http')==0) 
                         {
                           prefixes.push({ iri: val, prefix: key });
                         }
                     }); 

                     if (prefixes.length>0)
                       return ' prefix="'+_(prefixes).collect(function (p) { return p.prefix+': '+p.iri; }).join(' ')+'"';
                     else
                       return '';
                 }
                 catch (ex)
                 {
                    fail.fatal('Error generating RDFa prefixes: '+ex.message);
                 }
             },
             rdfa_about= function ()
             {
                  var rdf= this.data.rdf;

                  if (!rdf) return '';

                  var expanded= rdf['@expanded'];

                  return ' about="'+expanded['@id']+'"';
             },
             rdf_alternate= function ()
             {
                  var rdf= this.data.rdf;

                  if (!rdf) return '';

                  var expanded= rdf['@expanded']; 

                  try
                  {
                      return '<link rel="alternate" type="application/rdf+xml" title="RDF Representation" href="'+
                                expanded['http://www.w3.org/2000/01/rdf-schema#isDefinedBy'][0]['@id']+'" />';
                  }
                  catch (ex)
                  {
                    fail.fatal('Error generating RDF alternate link: '+ex.message);
                  }
             };

         jsrender.helpers({ href: href, rdfa_prefixes: rdfa_prefixes, rdfa_about: rdfa_about, rdf_alternate: rdf_alternate });

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
                       verbose.error('no translation for: '+JSON.stringify(o));
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
      _triples= function (id,cb)
      {
         store.execute("SELECT ?s ?p ?o ?bp ?bo WHERE { { <"+id+"> ?p ?o . filter(!isblank(?o)) } UNION { <"+id+"> ?p ?o . OPTIONAL { ?o ?bp ?bo } filter(isblank(?o)) }  UNION { ?s ?p <"+id+"> } }", function (success, nodes) 
         {
             if (!success)
               fail.fatal('Cannot query RDF store for id: '+id);

             cb(nodes);
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
             _resolveTemplates= function (ctx)
             {
                _traverse(ctx.data,function (key,value,object)
                {
                    if (typeof value=='object'&&value._tpl==true&&!(Array.isArray(object)&&isNaN(key)))
                      object[key]= _resolveTemplates(value); // resolve nested templates
                });
                 
                return _template(ctx.name).render(ctx.data);
             },
             _block= function (name,done)
             {
                var $content;

                if (typeof name=='string')
                    $content= _$e(_blockText(name,lang));
                else
                    $content= _$e(_resolveTemplates(name)); 

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
                       $head.append('<link rel="alternate" hreflang="'+altLang+'" href="/'+(altLang==globalConfig.languages[0] ? path.substring(path.indexOf('/')+1) : altLang+'/'+path)+'.html" />');
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
                 if (globalConfig.postBuild) globalConfig.postBuild($,lang,config);
                 grunt.file.write(dest,jquery.source(window).replace(/xscript/g,'script'));
                 (lang!==defaultLanguage ? verbose : log).ok('Generated page '+dest); 
                 free();
                 done();
             });
         });

      },
      _sitemap= function (globalConfig,pages)
      {
            var doc= xmlbuilder.create(),
                root= doc.begin('urlset')
                    .att('xmlns', 'http://www.sitemaps.org/schemas/sitemap/0.9')
                    .att('xmlns:xsi', 'http://www.w3.org/2001/XMLSchema-instance')
                    .att('xsi:schemaLocation', 'http://www.sitemaps.org/schemas/sitemap/0.9 http://www.sitemaps.org/schemas/sitemap/0.9/sitemap.xsd');
             
            _.filter(pages,function (p){ return !p.isRDF; }).forEach(function (page)
            {
                root.ele('url')
                       .ele('loc')
                         .txt(globalConfig.sitemap.urlPrefix+(page.path.match(/(^|\/)index$/) ? page.path.substring(0,page.path.length-5) : page.path+'.html'))
                       .up()
                       .ele('changefreq')
                         .txt((page.changefreq ? page.changefreq : globalConfig.sitemap.changefreq)) 
                       .up()
                       .ele('priority')
                         .txt((page.priority ? page.priority : globalConfig.sitemap.priority)) 
                       .up()
                    .up();
            });

            grunt.file.write('dist/sitemap.xml',doc.toString({ pretty: true }));
            log.ok('Generated dist/sitemap.xml');
      },
      _filterPages= function (pages)
      {
         var r= pages;

         if (argv.pageType||argv.pagePath)
           log.ok('Filtering pages...');

         if (argv.pageType)
           r= _.filter(r,function (p) { return p.config.name==argv.pageType; });

         if (argv.pagePath)
           r= _.filter(r,function (p) { return p.path.match(new RegExp(argv.pagePath)); });

         return r;
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
                     if (typeof config.href=='function')
                       config.href= config.href.toString();
                     
                     if (typeof config.postBuild=='function')
                       config.postBuild= config.postBuild.toString();

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
                      return {
                                _tpl: true,
                                name: name,
                                data: data
                             };
                  },
                  addRdf= function (config)
                  {
                      config.rdf= _toJSONLD(config.data,config.context);

                      _store(function (store)
                      {
                            store.load('application/json', config.rdf, function(success, loaded)
                            {
                                if (!success)
                                  fail.fatal('Cannot load RDF for: '+JSON.stringify(rdf));
                            });
                      });

                      pages.push({ path: config.path, config: config, isRDF: true });

                      return config.rdf;
                  };

              try
              {   
                  eval('(function (page,rdf,block,paginate,template,collection,excel,transform,chunkdata,alias,jsonpath,index,mindex,context) { '+js+' })')
                                  (addPage,addRdf,_blockText,_paginate,template,_collection,_excel,_transform,_chunkdata,_alias,jsonpath,_index,_mindex,_context);
              }
              catch (ex)
              {
                  verbose.error(ex.stack);
                  fail.fatal(ex+' evaluating '+filepath);
              }
              
         });

         if (globalConfig.languages)
           i18n= _i18n();

         var cpus= globalConfig.cpus || os.cpus().length;

         if (cpus > pages.length) cpus= pages.length;

         pageQueue= new forkqueue(cpus, __dirname+'/lib/builder.js');

         if (typeof globalConfig.postBuild=='function')
           globalConfig.postBuild= globalConfig.postBuild.toString(); 

         var init= [],
             wconf= { init: true, globalConfig: globalConfig, pageTypes: pageTypes, i18n: i18n, wait: (cpus>1 ? cpus*100 : 1) };

         _(cpus).times(function ()
         {
             init.push(wconf);
         }); 

         pages= _filterPages(pages); 

         if (pages.length)
         {
             log.ok('Launching builders...');

             pageQueue.concat(init);
             pageQueue.concat(pages);

             pageQueue.on('msg',function (message, worker)
             {
                if (message.error)
                  fail.fatal('Error from worker:'+message.ex);
                else
                if (message.triples)
                  _triples(message.id,function (triples)
                  {
                       worker.send({ id: message.id, triples: triples });
                  });
             });

             pageQueue.end(function ()
             {
                verbose.debug('Generated '+pages.length+' pages');
                if (globalConfig.sitemap) _sitemap(globalConfig,pages);
                done();
             });
         }
         else
           done();


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

     if (!config) 
     {
        done();
        return;
     }

     async.forEach(config,function (config,done)
     {
         var data= (config.collection ? _collection(config.collection) : _excel(config.excel));

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
                       JSON.stringify(_transform(data,config.transform), undefined, 2));
            log.ok('Generated JSON collection: '+dest);
         }
         else 
           _writechunk(config.dest,data);

         done();
     },
     done);
  });

};
