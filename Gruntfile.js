/*
 * grunt-html
 * https://github.com/aaaristo/grunt-html
 *
 * Copyright (c) 2012 Tim Branyen, contributors
 * Licensed under the MIT license.
 */

'use strict';

module.exports = function(grunt) {

  // Project configuration.
  grunt.initConfig({
    jshint: {
      all: [
        'Gruntfile.js',
        'tasks/*.js',
        '<%= nodeunit.tests %>'
      ],
      options: {
        jshintrc: '.jshintrc'
      },
    },
    watch: {
      files: ['tasks/*.js','test/**/*.js','test/**/*.html','.jshintrc'],
      tasks: ['jshint','test']
    },
    // Unit tests.
    nodeunit: {
      tests: ['test/tasks/*_test.js'],
    },
  });

  // Actually load this plugin's task(s).
  grunt.loadTasks('tasks');

  // These plugins provide necessary tasks.
  grunt.loadNpmTasks('grunt-contrib-jshint');
  grunt.loadNpmTasks('grunt-contrib-nodeunit');
  grunt.loadNpmTasks('grunt-contrib-watch');

  grunt.registerTask('test', 'nodeunit');

  // By default, lint and run all tests.
  grunt.registerTask('default', ['jshint', 'test']);
};
