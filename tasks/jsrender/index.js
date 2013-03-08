
// in order to keep the jsrender.js file tracking upstream
// we inject the 'window' global here before requireing the jsrender file
// the jsrender file then operates on the global object
global.window = global;
require('./lib/jsrender');

// jsrender require has populated the JsViews object
var jsrender = global.jsviews;

exports.helpers= function ()
{
     jsrender.helpers.apply(jsrender,arguments);
}

exports.converters= function ()
{
     jsrender.converters.apply(jsrender,arguments);
}

// create a new template which you can invoke directly
// template(locals);
exports.compile = function(string) {

    if (!string || typeof string !== "string") {
        throw new Error('template must be a string');
    }

    // by using null, jsrender won't cache the object
    // it will return the template compiled to us
    var templ = jsrender.templates(string );
    return {
        render: function(locals) {
            return templ.render(locals);
        }
    };
}

// express view compiler
exports.express = {
    compile: function (markup, options) {
        jsrender.views.allowCode = true;

        options = options || {};
        var name = options.filename || markup;

        delete jsrender.views.templates[name];

        jsrender.template(name, markup);

        return function render(locals) {
            return jsrender
                .render(locals, name)
                // allows for having client side templates by using {% ... %}
                .replace(/{%/g,'{{')
                .replace(/%}/g,'}}');
        };
    }
}
