var cp = require('child_process'), grunt= require('grunt');

var n = cp.fork(__dirname + '/child.js');
var time= process.hrtime();

n.on('message', function(m) {
  var diff= process.hrtime(time),
      secs= Math.round((diff[0]*1e9+diff[1])/1e9);
  console.log('elapsed secs: ',secs);
});
console.log('sending');
n.send(grunt.file.read('y'));
