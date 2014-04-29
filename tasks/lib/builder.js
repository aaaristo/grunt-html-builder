const ID= process.argv[2];

var grunt= require('grunt'),
    cheerio= require('cheerio'),
    net = require('net');
    msgpack= require('msgpack'),
    jsonpath= require('JSONPath').eval,
    jsrender= require('../jsrender'),
    xmlbuilder = require("xmlbuilder"),
    rdfstore= require('../rdfstore'),
    jsonld = require('../jsonld'),
    xlsx= require('./xlsx');
    fs= require('fs'),
    util= require('util'),
    p= require('path'),
    log= {
            ok: function (m)
            {
                grunt.log.ok('builder['+ID+']: '+m);
            } 
         },
    verbose= {
                ok: function (m)
                {
                    grunt.log.verbose.ok('builder['+ID+']: '+m);
                },
                debug: function (m)
                {
                    grunt.log.verbose.debug('builder['+ID+']: '+m);
                },
                error: function (m)
                {
                    grunt.log.verbose.error('builder['+ID+']: '+m);
                }
             },
    file= grunt.file,
    fail= {
        fatal: function (m)
        {
           var e= new Error(m);
           e.fail= true;
           throw(e);
        }
    },
    _= grunt.util._,
    async= grunt.util.async,
    mem= function ()
    {
         return util.inspect(process.memoryUsage());
    };

grunt.option('verbose',_.contains(process.argv,'--verbose'));
grunt.option('debug',_.contains(process.argv,'--debug'));
grunt.option('stack',_.contains(process.argv,'--stack'));


cheerio.prototype.odd = function() {
    var odds = [];
    this.each(function(index, item) {
        if (index % 2 == 1) {
            odds.push(item);
        }
    });

    return cheerio(odds);
};

cheerio.prototype.even = function() {
    var evens = [];
    this.each(function(index, item) {
        if (index % 2 == 0) {
            evens.push(item);
        }
    });

    return cheerio(evens);
};

cheerio.prototype.unwrap = function(){
        this.parent().each(function(){
        var $this = cheerio(this);
        $this.replaceWith($this.children());
        });
        return this;
};


cheerio.prototype.wrapAll = function(structure){
        if (this[0]) {
                cheerio(this[0]).before(structure = cheerio(structure))
                var children
                // drill down to the inmost element
                while ((children = structure.children()).length) structure = children.first()
                cheerio(structure).append(this);
        };
        return this;
};


cheerio.prototype.appendTo = function(target)
{
        target = cheerio(target);
        return target.append(this);
};

cheerio.prototype.indexOf = [].indexOf;

var likeArray = function(obj) { return typeof obj.length == 'number'; },
    slice = Array.prototype.slice;

cheerio.prototype.not = function(selector){
        var nodes=[];
        if (_.isFunction(selector) && selector.call !== undefined){
                this.each(function(idx){
                        if (!selector.call(this,idx)) nodes.push(this)
                });
        }else {
                var excludes = _.isString(selector)? this.filter(selector) :
                        (likeArray(selector) && _.isFunction(selector.item)) ? slice.call(selector) : cheerio(selector);
                this.each(function(i, el){
                        if (excludes.indexOf(el) < 0) nodes.push(el)
                })
        };
        var result = cheerio(nodes);
        return result;
};

var globalConfig,
    pageTypes,
    i18n,
    cache= {},
    store,
    queries= {};

var   _index= function(collection,by)
      {
          return _cache('index.'+collection+'.'+by,function ()
          {
              var idx= {};

              _collection(collection).forEach(function (elem)
              {
                  idx[elem[by]]= elem;
              });

              return (function (idx) { return function (by) { return idx[by]; } })(idx);
          });
      },
      _mindex= function(collection,by)
      {
          return _cache('mindex.'+collection+'.'+by,function ()
          {
              var idx= {},
                  _push= function (val,elem)
                  {
                      var vals;
                      if (!(vals=idx[val])) vals= idx[val]= [];
                      vals.push(elem);
                  };

              _collection(collection).forEach(function (elem)
              {
                  var attr= elem[by];

                  if (Array.isArray(attr))
                    attr.forEach(function (val)
                    {
                       _push(val,elem);
                    });
                  else
                    _push(attr,elem); 
              });

              return (function (idx) { return function (by) { return idx[by] || []; } })(idx);
          });
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

            return r.slice();
      },
      _parseExcel= function (src)
      {
            return xlsx.decode(fs.readFileSync(src, "base64"));
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

                  return ' about="'+expanded['@id']+'" typeof="'+expanded['http://www.w3.org/1999/02/22-rdf-syntax-ns#type'][0]['@id']+'"';
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
                       chunkSize= $elem.attr('data-chunk-size'),
                       path= $elem.data('path'),
                       transform= $elem.data('transform');

                   if (chunk)
                     return data.slice(chunk-1,(chunk-1)+chunkSize);                      
                   else
                   if (path)
                   {
                      var res= jsonpath(data,path),
                          distinct= $elem.attr('data-path-distinct');

                      if (typeof distinct!='undefined')
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
                   return $.load(text).root();
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
                    if (typeof value=='object'&&value&&value._tpl==true&&!(Array.isArray(object)&&isNaN(key)))
                      object[key]= _resolveTemplates(value); // resolve nested templates
                });
                 
                return _template(ctx.name).render(ctx.data);
             },
             _block= function (name,done)
             {
                var $content,
                    renderTemplate= function ()
                    {
                       var $container= $(this),
                           name= $container.data('template');

                       if (!name) return;

                       var tpl= _template(name),
                           data= _data($container);

                       if (data)
                         $container.append(tpl.render(data));
                    };

                if (typeof name=='string')
                    $content= _$e(_blockText(name,lang));
                else
                    $content= _$e(_resolveTemplates(name)); 

                if (typeof $content!='string')
                {
                  if (typeof $content.attr('data-template')!='undefined')
                    $content.each(renderTemplate);

                  $content.find('[data-template]').each(renderTemplate);
                }

                done({ content: $content.contents() });
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
             },
             _source= function ()
             {
                return $.html().replace(/xscript/g,'script');
             };


         $= cheerio.load(html);
         verbose.debug(mem(),'Generating page '+dest);

         _build(function ()
         {
             try
             {
                 if (config.postBuild) 
                   config.postBuild($,lang); 
             }
             catch (ex)
             {
                fail.fatal('error in page type "'+config.name+'" postBuild function: '+ex);
             }

             try
             {
                 if (globalConfig.postBuild) 
                   globalConfig.postBuild($,lang,config);
             }
             catch (ex)
             {
                fail.fatal('error in global postBuild function: '+ex);
             }
            
             try
             { 
                grunt.file.write(dest,_source());
             }
             catch (ex) // retry
             {
                grunt.file.write(dest,_source());
             }

             (lang&&lang!==defaultLanguage ? verbose : log).ok('Generated page '+dest); 
             done();
         });

      };

var evalFnc= function (str)
    {
              try
              {   
                  return eval('(function (block,collection,excel,transform,chunkdata,alias,jsonpath,index,mindex) { return '+str+'; })')
                                  (_blockText,_collection,_excel,_transform,_chunkdata,_alias,jsonpath,_index,_mindex);
              }
              catch (ex)
              {
                 console.log(ex,ex.stack);
              }
    },
    _triples= function (id,cb)
    {
         queries[id]= cb;    
         process.send({ triples: true, id: id });
    },
    _rdf= function(path,lang,config,globalConfig,done)
    {
         var dest= p.join('dist',path+'.rdf'),
             dest2= p.join('dist',path+'.jsonld'),
             _jsonld= [_clone(config.rdf)],
             context= config.rdf['@context'],
             doc= xmlbuilder.create(),
             root= doc.begin('RDF');

         jsonld.expand(config.rdf,config.context,function (err,expanded)
         {
             if (err)
               fail.fatal(err);

             config.rdf['@expanded']= expanded[0];

             var id= expanded[0]['@id'], prefixes= [];

             Object.keys(context).forEach(function (key)
             {
                 var val= context[key];

                 if (key.indexOf('@')==-1
                     &&typeof val=='string'
                     &&val.indexOf('http')==0) 
                 {
                   root.att('xmlns:'+key, val);
                   prefixes.push({ iri: val, prefix: key });
                 }
             }); 
                 
             _triples(id,function (triples)
             {
                 var nodesBySubject= {};

                 triples.forEach(function (node)
                 {
                      var _id= node.s ? node.s.value : id;

                      if (!node.s)
                        node.s= { token: 'uri', value: _id };

                      if (!node.o)
                        node.o= { token: 'uri', value: id };

                      if (!nodesBySubject[_id]) nodesBySubject[_id]= [];

                      nodesBySubject[_id].push(node);
                 });

                 var blanks= {},
                     _normalize= function(s)
                     {
                        var mx=0, idx= -1;
                       
                        prefixes.forEach(function (prefix,i)
                        {
                           if (s.indexOf(prefix.iri)>-1&&prefix.iri.length>mx)
                             idx= i;       
                        }); 

                        if (idx>-1)
                          return s.replace(prefixes[idx].iri,prefixes[idx].prefix+':'); 
                        else
                          return s;
                     },
                     _tc= [], c= function () { var a= _tc.pop(); if(a)a.up(); },
                     _predicate= function (par,node)
                     {
                        return par.ele(_normalize(node.p.value));
                     },
                     _node= function (par)
                     {
                        return function (node,done)
                        {
                                if (node.o.token=='uri')
                                  _predicate(par,node).att('rdf:resource',node.o.value).up();
                                else
                                if (node.o.token=='literal')
                                  _predicate(par,node).txt(node.o.value).up();
                                else
                                if (node.o.token=='blank')
                                  _blank(node,par,done); 

                                if (node.o.token!='blank')
                                  done(); 
                        }; 
                     },
                     _blank= function (node,par,done)
                     {
                        var f;

                        if (!(f=blanks[node.o.value]))
                        {
                           c();
                           var p= par.ele(_normalize(node.p.value));
                           blanks[node.o.value]= f= _node(p);
                           _tc.push(p);
                        }

                        f({ p: node.bp, o: node.bo },done);
                     },
                     _subject= function (id,done)
                     {
                         var desc= root.ele('rdf:Description')
                                       .att('rdf:about',id);

                         async.forEach(nodesBySubject[id],_node(desc),function ()
                         {
                            done();
                         });

                         c();
                         c();

                         desc.up();
                     };

                 var _addjsonld= function (nodes)
                 {
                    var ld= { '@id': nodes[0].s.value };

                    nodes.forEach(function (node)
                    {
                        ld[node.p.value]= node.o.value;
                        if (node.o.token=='uri')
                          ld[node.p.value]= { '@id': node.o.value };
                        else
                        if (node.o.token=='literal')
                          ld[node.p.value]= node.o.value;
                    }); 

                    _jsonld.push(ld);
                 },
                 _others= function ()
                 {
                         async.forEach(Object.keys(nodesBySubject),function (id,done)
                         {
                             _addjsonld(nodesBySubject[id]);
                             _subject(id,done);
                         },
                         function ()
                         {
                             if (config.postBuild) config.postBuild(doc); 
                             if (globalConfig.postRDFBuild) globalConfig.postRDFBuild(doc,config); 

                             grunt.file.write(dest,doc.toString({ pretty: true }));
                             log.ok('Generated RDF '+dest); 

                             grunt.file.write(dest2,JSON.stringify(_jsonld,null,2));
                             log.ok('Generated JSON-LD '+dest2); 

                             done();
                         });
                 }

                 if (nodesBySubject[id])
                   _subject(id,function ()
                   {
                         delete nodesBySubject[id]; 
                         _others();
                   });
                 else
                   _others();
             });

         });
    },
    methods= {
                   init: function (message,done)
                   {
                        globalConfig= message.globalConfig; 
                        pageTypes= message.pageTypes; 
                        i18n= message.i18n; 

                        if (globalConfig.postBuild)
                          globalConfig.postBuild= eval('('+globalConfig.postBuild+')');

                        _(pageTypes).forEach(function (pt)
                        {
                            if (pt.href)
                              pt.href= evalFnc(pt.href);
                        });

                        setTimeout(function ()
                        {
                            log.ok('inited');
                            done();
                        },message.wait);
                   },
                   page: function (p,done)
                   {
                      if (p.config.postBuild)
                        p.config.postBuild= evalFnc(p.config.postBuild);

                      if (p.config.href)
                        p.config.href= evalFnc(p.config.href);

                      if (p.config.rdf)
                         jsonld.expand(p.config.rdf,{ '@context': p.config['@context'] },function (err,expanded)
                         {
                             if (err)
                               fail.fatal(err);

                             p.config.rdf['@expanded']= expanded[0];

                             _page(p.path,p.lang,p.config,globalConfig,function ()
                             {
                                   done();
                             });

                         });
                      else
                          _page(p.path,p.lang,p.config,globalConfig,function ()
                          {
                               done();
                          });
                   },
                   rdf: function (p,done)
                   {
                      if (p.config.postBuild)
                        p.config.postBuild= evalFnc(p.config.postBuild);

                      if (p.config.href)
                        p.config.href= evalFnc(p.config.href);

                      _rdf(p.path,p.lang,p.config,globalConfig,function ()
                      {
                           done();
                      });
                   },
                   triples: function (message)
                   {
                       queries[message.id](message.triples);
                   }
             };

var _json= [], receive= function (message)
{
    var next= function (err, message)
    {
        process.send((err ? err : (message ? message : { ok: true })));
        process.send('next');
    };

    try
    {
       if (message.init)
         methods.init(message,next);
       else
       if (message.isRDF)
         methods.rdf(message,next);
       else
       if (message.triples)
         methods.triples(message);
       else
         methods.page(message,next);
    }
    catch (ex)
    {
        process.send({ error: true, ex: ex+'' });
    }
};
 

process.stdin.on('data',function (chunk)
{
    _json.push(chunk);  
});

process.stdin.resume();

process.on('message',function (message)
{
     (function _try()
     {
             try
             {
                 if (m= msgpack.unpack(Buffer.concat(_json)))
                 {
                     receive(m);
                     _json=[];
                 }
                 else
                     setTimeout(_try,10);
             }
             catch (ex)
             {
                 setTimeout(_try,10);
             }
     })();
});


process.send('next');
