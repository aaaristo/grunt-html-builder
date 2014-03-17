/*
 * grunt-html-builder
 * https://github.com/andrea/grunt-html-builder
 *
 * Copyright (c) 2013 Andrea Amerigo Aristodemo Gariboldi
 * Licensed under the MIT license.
 */

module.exports = function(grunt) 
{
  var jsonpath= require('JSONPath').eval,
      jsrender= require('./jsrender'),
      msgpack= require('msgpack'),
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
                  js= file.read(src),
                  _async,
                  ctrl= { cbs: [], async: function (cb) { this.cbs.push(cb); }, trigger: function (err,data) { this.cbs.forEach(function (cb) { cb(err,data); }); } };

              eval('(function (grunt,_,clone,paginate,alias,collection,excel,json,index,mindex,context,prequire,done,async) { '+js+' })')
                  (grunt,_,_clone,_paginate,_alias,_collection,_excel,data,_index,_mindex,_context,
              function (path)
              {
                 return require(process.cwd()+'/node_modules/'+path);
              },
              function (transformed,t2)
              {
                  if (_async)
                  {
                    var ex= transformed;
                    var transformed= t2;

                    if (ex)
                    {
                      verbose.error(ex.stack);
                      fail.fatal(ex+' evaluating '+src);
                      ctrl.trigger(ex,null);
                    }
                    else
                      ctrl.trigger(null,transformed);
                  }
                  else
                    data= transformed;
              },function () { _async= true; });

              if (_async)
                return ctrl;
              else
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
      _triples= function (id,cb)
      {
         store.execute("SELECT ?s ?p ?o ?bp ?bo WHERE { { <"+id+"> ?p ?o . filter(!isblank(?o)) } UNION { <"+id+"> ?p ?o . OPTIONAL { ?o ?bp ?bo } filter(isblank(?o)) }  UNION { ?s ?p <"+id+"> } }", function (success, nodes) 
         {
             if (!success)
               fail.fatal('Cannot query RDF store for id: '+id);

             cb(nodes);
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
                       if (worker.stdin.write(msgpack.pack({ id: message.id, triples: triples })))
                         worker.send('goahead');
                  });
             });

             pageQueue.end(function ()
             {
                log.ok('Generated '+pages.length+' pages');
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
          log.ok('Stopping after '+secs+'secs, mem used ~'+Math.round(process.memoryUsage().rss/1024/1024)+'MB');
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

     async.forEachSeries(config,function (config,done)
     {
         var data= (config.collection ? _collection(config.collection) : _excel(config.excel));

         if (config.filter)
           data= jsonpath(data,config.filter);

         if (config.slice)
         {
           _writechunk(config.dest,data.slice.apply(data,config.slice));
           done();
         }
         else
         if (config.chunk)
         {
           _chunkdata(data,config.dest,config.chunk);
           done();
         }
         else
         if (config.transform)
         {
            var dest= p.join('data/json',config.dest+'.json');

            if (file.exists(dest)) 
             file.delete(dest);


            var transformed= _transform(data,config.transform);

            if (transformed.async)
              transformed.async(function (err,data)
              {
                if (!err)
                {
                    file.write(dest,
                               JSON.stringify(data, undefined, 2));
                    log.ok('Generated JSON collection: '+dest);
                }

                done();
              });
            else
            {
                file.write(dest,
                           JSON.stringify(transformed, undefined, 2));
                log.ok('Generated JSON collection: '+dest);
                done();
            }
         }
         else 
         {
           _writechunk(config.dest,data);
           done();
         }

     },
     done);
  });

};
