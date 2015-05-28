var bodyParser = require('body-parser');
var cookieParser = require('cookie-parser');
var express = require('express');
var ejs = require('ejs');
var http = require('http');
var path = require('path');
var request = require('request');

var app = express();

app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'ejs');

app.use(express.static(path.join(__dirname, 'public')));
app.use(cookieParser());
app.use(bodyParser.json());

app.get('/', function(req, res, next) {
  res.render('index');
});

app.use(function(err, req, res, next) {
  res.status(err.code || 400).json({ 'reason': err.message || '' });
});

var httpServer = http.createServer(app);
httpServer.listen(3000);

console.log('now listening on port 3000');
