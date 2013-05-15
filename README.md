# grunt-html-builder [![Build Status](https://secure.travis-ci.org/aaaristo/grunt-html-builder.png?branch=master)](http://travis-ci.org/aaaristo/grunt-html-builder)

Assemble static HTML files in parallel using jquery, jsrender and *child_process* nodejs module,
all integrated in a maven like build lifecycle based on conventions against configuration.

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

Not so impressive...

**doc in progress**

Things to document:
* parallel generation / cpu detection / pages.length
* json collections
* json trasformations
* excel(xlsx) transformations
* html html
* html layouts
* html templates (jsrender)
* html blocks
* postBuild hooks (enables you to modify the generated html with jquery before html file are written to disk)
* client files (images,css,js...)
* filtering pages
* s3 / cloudfront deploy

## Release History
* 2013-05-15   v0.4.20   First documented release

## License
Copyright (c) 2013 Andrea Amerigo Aristodemo Gariboldi  
Licensed under the MIT license.
