var grunt = require('grunt'),
    fs= require('fs'),
    path= require('path'),
    helper= require('./helper');

var file= grunt.file,
    _= grunt.util._,
    fixtures= helper.fixtures;

function cleanUp(fixture) 
{
  var p= path.join(fixtures, fixture, 'node_modules','grunt-html-builder');

  if (file.exists(p))
    fs.unlinkSync(p);

  helper.cleanUp
  ([
    fixture+'/node_modules',
    fixture+'/dist'
  ]);
}

function setUp(fixture)
{
    var p= path.join(fixtures, fixture, 'node_modules','grunt-html-builder');

    cleanUp(fixture);
    fs.symlinkSync(path.join(__dirname, '../../node_modules'), path.join(fixtures, fixture, 'node_modules'));

    if (!file.exists(p))
      fs.symlinkSync(path.join(__dirname, '../../'), p);
}

exports['html'] = {
  setUp: function(done) 
  {
    helper.listFixtures().forEach(setUp);
    done();
  },
  tearDown: function(done) 
  {
    helper.listFixtures().forEach(cleanUp);
    done();
  },
  'html': function(test) 
  {
    test.expect(19);
    var done= _.after(8,test.done); 

    var cwd = path.resolve(fixtures, 'html');
    var assertWatch = helper.assertTask('html-builder', {cwd: cwd});

    assertWatch
    ([],
      function(result) 
      {
console.log(result);

          test.ok(result.indexOf('Generated page dist/index.html') !== -1, 'page index created');

          helper.$file('html/dist/index.html',function ($)
          {
              test.equals($('title').html(), 'Test site', 'page title is correct');
          },done);

          test.ok(result.indexOf('Generated page dist/new1.html') !== -1, 'page new1 created');

          helper.$file('html/dist/new1.html',function ($)
          {
              test.ok($('[data-region=header]').length==1,  'header section found');
              test.ok($('[data-region=content]').length==1, 'content section found');
              test.ok($('[data-region=footer]').length==1,  'footer section found');
          },done);

          test.ok(result.indexOf('Generated page dist/new2.html') !== -1, 'page new2 created');

          helper.$file('html/dist/new2.html',function ($)
          {
              test.equals($('[data-region=content]').html(), 'ciao!\n', 'block added to content section');
          },done);

          test.ok(result.indexOf('Generated page dist/new3.html') !== -1, 'page new3 created');

          helper.$file('html/dist/new3.html',function ($)
          {
              test.equals($('[data-region=content] ul li').eq(1).html(), 'name2', 'data collection rendered');
              test.equals($('[data-region=content] ul li').length, 4, 'data collection rendered the correct number of items');
          },done);

          test.ok(result.indexOf('Generated page dist/new4.html') !== -1, 'page new4 created');

          helper.$file('html/dist/new4.html',function ($)
          {
              test.equals($('[data-region=content] ul li').length, 1, 'data path rendered correctly');
          },done);

          test.ok(result.indexOf('Generated page dist/new5.html') !== -1, 'page new5 created');

          helper.$file('html/dist/new5.html',function ($)
          {
              test.equals($('[data-region=content] ul li').length, 3, 'data path distinct rendered correctly');
          },done);

          test.ok(result.indexOf('Generated page dist/new6.html') !== -1, 'page new6 created (page path defaults to name)');

          helper.$file('html/dist/new6.html',function ($)
          {
              test.equals($('[data-region=content] ul li').eq(0).html(), 'name2', 'data transform rendered correctly');
          },done);
      }
    );

    cwd = path.resolve(fixtures, 'html_html');
    assertWatch = helper.assertTask('html-builder', {cwd: cwd});

    assertWatch
    ([],
      function(result) 
      {
          test.ok(result.indexOf('Generated page dist/index.html') !== -1, 'cannot find index.html');

          helper.$file('html_html/dist/index.html',function ($)
          {
              test.equals($('title').html(), 'Good title', 'The title is incorrect');
          },done);
     });
  }
};

