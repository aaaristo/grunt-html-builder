process.on('message', function(m) {
  process.send('ok');
});

