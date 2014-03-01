var cheerio= require('cheerio'), grunt= require('grunt');
var html= grunt.file.read('/Users/andrea/Progetti/grunt/plurimedia/www/grunt/src/html/block/projects.html');
$= cheerio.load('<div></div>');
$html= $.load('<div id="mio">'+html+'</div>').root();

console.log($html.find('[data-template]').length);
$.root().append($html.contents());

console.log($('[data-template]').length);
console.log($.html());
