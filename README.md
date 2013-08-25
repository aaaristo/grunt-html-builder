# grunt-html-builder [![Build Status](https://secure.travis-ci.org/aaaristo/grunt-html-builder.png?branch=master)](http://travis-ci.org/aaaristo/grunt-html-builder)

Assemble static HTML files in parallel using jquery, jsrender and *child_process* nodejs module,
starting from json (and xlsx) files to describe data (products, people... etc),
all integrated in a maven like build lifecycle based on conventions against configuration.

Actually we build a medium complexity site of ~4500 pages in ~120secs on a quad-core iMac,
with SSD.
The same site built on an High-IO EC2 instance takes ~60secs for generation.
By default we launch a builder for each core we detect so that they can build
pages in parallel.

## Why?

Building web sites often you find your self using a CMS,
integrating it with some legacy/es, tuning web servers, application servers, databases,
and when it is not enough, go back to the code and squeeze anything you can, and put some kind 
of caching around, often more than one type, and of course
keep those caches in sync. This is a pretty full contact sport.

The thing i always noticed doing that is that all this work often is about producing
a file or memory buffer (depending on wich caching type you use) containing the content 
being actually served to the user.

So the typical runtime flow of a MISS request would be:

user request > build the buffer hocus pocus > cache > response

This is really about having users pull your pages. Why dont'we push
the site to the user?

do the hocus pocus/integrations batch > put pages on a CDN near the user < have the user acces things fast

Obviously not all sites may be done like that, but many could, saving you a lot of time.

## Getting Started
Install this grunt plugin next to your project'

Then add this line to your project's `Gruntfile.js` gruntfile:

```javascript
grunt.loadNpmTasks('grunt-html-builder');
```

[grunt]: http://gruntjs.com/

## Documentation
The simplest way to get started is:
<pre>
$ git clone git://github.com/aaaristo/html-builder-sample.git
</pre>

This will bring you a preconfigured project with most common options,
that contains 4 files:
<pre>
$ find ./ -type f
./Gruntfile.js
./package.json
./README.md
./src/js/page/home.js
</pre>

Let's skip the *Gruntfile.js* for the moment. (as usal it contains various grunt tasks configurations) 

Looking at the package.json you can see which dependencies will be installed 
to make the thing work:
```javascript
{
   ...

  "devDependencies": {
    "grunt": "~0.4.0",
    "grunt-contrib-watch": "~0.3.1",
    "grunt-contrib-clean": "~0.4.0",
    "grunt-contrib-connect": "~0.2.0",
    "grunt-html-builder": "~0.4.20",
    "grunt-contrib-copy": "~0.4.0",
    "grunt-s3": "~0.2.0-alpha.1",
    "grunt-cloudfront-clear": "0.0.1",
    "grunt-contrib-compass": "~0.2.0"
  },

   ...
}
```

Now you have to run *npm install* from the project directory to install those dependencies.

Once you get the dependencies installed you can finally run *grunt*
and you should see somenthing like:

<pre>
Running "html-builder-json" task

Running "html-builder" task
>> Evaluating home.js...
>> Launching builders...
>> builder[0]: inited
>> builder[0]: Generated page dist/index.html

Running "copy:client" (copy) task


Done, without errors.
</pre>

Nice, what happened is that html-builder found a file *home.js*
under the directory *src/js/page*, containing only this line of javascript:

```javascript
page({ path: 'index' });
```
The *page* function tells the builder to produce a page that is described 
by the object passed as parameter, actually we are telling the builder 
we want a page called index.html, and the page is created under the *dist*
directory inside of your project. So now you should have a *dist/index.html*
that look like this:

```html
<!DOCTYPE html>
<html>
   <head>
      <title>Test site</title>
   </head>
   <body>
   </body>
</html>
```

Not so impressive... This is the base html created by the builder,
and you can but you can completely adjust as you wish by creating a
file *src/html/html.html*, let's suppose with H5BP http://html5boilerplate.com/:

```html
<!DOCTYPE html>
<!--[if lt IE 7]>      <html class="no-js lt-ie9 lt-ie8 lt-ie7"> <![endif]-->
<!--[if IE 7]>         <html class="no-js lt-ie9 lt-ie8"> <![endif]-->
<!--[if IE 8]>         <html class="no-js lt-ie9"> <![endif]-->
<!--[if gt IE 8]><!--> <html class="no-js"> <!--<![endif]-->
    <head>
        <meta charset="utf-8">
        <meta http-equiv="X-UA-Compatible" content="IE=edge,chrome=1">
        <title></title>
        <meta name="description" content="">
        <meta name="viewport" content="width=device-width">

        <!-- Place favicon.ico and apple-touch-icon.png in the root directory -->

        <link rel="stylesheet" href="/css/normalize.css">
        <link rel="stylesheet" href="/css/main.css">
        <script src="/js/vendor/modernizr-2.6.2.min.js"></script>
    </head>
    <body>
        <!--[if lt IE 7]>
            <p class="chromeframe">You are using an <strong>outdated</strong> browser. Please <a href="http://browsehappy.com/">upgrade your browser</a> or <a href="http://www.google.com/chromeframe/?redirect=true">activate Google Chrome Frame</a> to improve your experience.</p>
        <![endif]-->

        <!-- Add your site or application content here -->
        <p>Hello world! This is HTML5 Boilerplate.</p>

        <script src="//ajax.googleapis.com/ajax/libs/jquery/1.9.1/jquery.min.js"></script>
        <script>window.jQuery || document.write('<script src="js/vendor/jquery-1.9.1.min.js"><\/script>')</script>
        <script src="/js/plugins.js"></script>
        <script src="/js/main.js"></script>

        <!-- Google Analytics: change UA-XXXXX-X to be your site's ID. -->
        <script>
            var _gaq=[['_setAccount','UA-XXXXX-X'],['_trackPageview']];
            (function(d,t){var g=d.createElement(t),s=d.getElementsByTagName(t)[0];
            g.src='//www.google-analytics.com/ga.js';
            s.parentNode.insertBefore(g,s)}(document,'script'));
        </script>
    </body>
</html>
```
Rerun *grunt* and try the site with *grunt listen* (grunt-contrib-connect + grunt-contrib-watch). 
Ok now we have nice html but we miss some resources, right?
So create the *src/client/* directory so that you have a root
for files that have to be accessed by the browser and place H5BP
resources in there like this:

<pre>
src/client
src/client/css
src/client/css/main.css
src/client/css/normalize.css
src/client/img
src/client/img/.gitignore
src/client/js
src/client/js/main.js
src/client/js/plugins.js
src/client/js/vendor
src/client/js/vendor/jquery-1.9.1.min.js
src/client/js/vendor/modernizr-2.6.2.min.js
</pre>

and if you don't have the *grunt listen* running give it a *grunt client*
to make grunt copy the files and directories under *src/client* to the
*dist* directory. Now once you have the *grunt listen* active the are kept
in sync by grunt (grunt-contrib-watch + grunt-contrib-copy). The same
is true for page generation... Try to edit the html.html file and see the results
on your browser by refreshing the page.

Ok, probably you have a more complex site to build than this, so lets take
a look at how the builder builds your pages:

* as seen it uses the *src/html/html.html* to start (or a default html if it is not provided)
* it goes throught all the files in *src/js/page* to understand which pages to build
* your files tell him how many pages to build by simply calling the *page* function many times,
   to experiment try to change the *home.js* file to read:
   
   ```javascript
   _(100).times(function (i)
   {
      page({ path: 'index'+i });
   });
   ```
   
   yes... it dumbly creates 100 pages. But you now know you can use underscore.js in those files
   by default, and that the path attribute tells the builder which html files to create. There is
   another thing to note: all those pages from now on are of the same type for the builder, the type
   is a machine name given by the name of the js file that asks the creation of a page, in this case
   *home* type. So yes probably the home.js in almost any site will call the page function 1 time (so 
   revert this dumb thing).

* Now lets suppose you want to create a page for every people in your company, create a 
   *src/js/page/person.js* like this:

```javascript
['John','Jane','Dave','Mike']
.forEach(function (person)
{
   page({ path: 'person/'+person.toLowerCase(), person: person });
});
```
   so ok you got it... Open html.html and replace the content of the title tag to read: 

```html
<title>{{>person}}'s page</title>
```

   almost any html is a jsrender template the html.html renders the page object by default,
   so that you can use it to store the page title / meta description, etc... But this is not
   ment to create entire pages.

 * Instead you can instruct the builder to use a *layout* for your pages so that you can benefit
   from splitting the page in many *regions*. For example lets suppose you want a *sidebar* region to
   navigate between your peoples, and a *content* region to represent a people. Now you can create this 
   *layout* by creating file *src/html/layout/sidebar.html* like this:

```html

<aside data-region="sidebar"></aside>

<section data-region="content"></section>

```

   now that you have your layout you should tell the builder to use it in people's pages so add the
   layout property to the page object:

```javascript
['John','Jane','Dave','Mike']
.forEach(function (person)
{
   page({ layout: 'sidebar', path: 'person/'+person.toLowerCase(), person: person });
});
```

   as you can see the content of the layout is prepended to the body of the page (so that you can leave
   the js at the end for instance). 

 * Now that you have regions you can use them to place *blocks* and *templates*, lets add a sample peoples block to the page: create a *src/html/block/people.html* like this:

```html

 <ul>
   <li><a href="/person/john.html">John</a></li>
   <li><a href="/person/jane.html">Jane</a></li>
 </ul>

```

  and tell the builder you want it in the sidebar region (time to indent a bit): 

```javascript
['John','Jane','Dave','Mike']
.forEach(function (person)
{
   page
   ({ 
        layout: 'sidebar', 
        blocks: { sidebar: 'peoples' },
        path: 'person/'+person.toLowerCase(),
        person: person 
   });
});
```

  the syntax is:

<pre>
    blocks: { region: 'block' }
</pre>

  or of course (to place multiple blocks in order)

<pre>
    blocks: { region1: ['block1','block2',...], region2: ... }
</pre>

 * so blocks are almost always static pieces of html that you want to reuse in various pages,
   while templates are somenthing you use to render data, lets add template rendered after the peoples
   block, create *src/html/template/person-menu.html*:

```html

    <ul>
    {{for people}}
     <li><a href="">{{>#data}}</a></li>
    {{/for}}
    </ul>

```

   and place it after the block calling the *template* function:


```javascript
var people= ['John','Jane','Dave','Mike'];

people.forEach(function (person)
{
   page
   ({ 
       layout: 'sidebar', 
       blocks: { sidebar: ['peoples', template('person-menu',{ people: people })] },
       path: 'person/'+person.toLowerCase(),
       person: person
   });
});
```

  as you see we left the href attribute blank, wouldn't it be nice to have single place where
  i create urls for a page? Yes, so:

```javascript
var people= ['John','Jane','Dave','Mike'],
    href= function (person)
    {
       return 'person/'+person.toLowerCase();
    };

people.forEach(function (person)
{
   page
   ({ 
       layout: 'sidebar', 
       blocks: { sidebar: ['peoples', template('person-menu',{ people: people })] },
       path: href(person),
       href: href, // tell the builder to use this function to build hrefs to this page type
       person: person
   });
});
```

   and now i can use the href converter in the template:


```html

    <ul>
    {{for people}}
     <li><a href="{{:~href('person',#data)}}">{{>#data}}</a></li>
    {{/for}}
    </ul>

```

  and voilà in any template that renders a person i can link it.. 


** ... doc in progress ...**

Things to document:
* lifecycle
* parallel generation / cpu detection / pages.length
* json collections
* json trasformations
* excel(xlsx) transformations
* index / mindex / cache
* html html
* html layouts / regions
* html blocks
* html templates (jsrender)
* postBuild hooks (enables you to modify the generated html with jquery before html file are written to disk)
* client files (images,css,js...)
* filtering pages
* multi language support
* s3 / cloudfront deploy
* RDF / jsonld support

## Release History
* 2013-05-15   v0.4.20   First documented BETA release

## License
Copyright (c) 2013 Andrea Amerigo Aristodemo Gariboldi  
Licensed under the MIT license.
