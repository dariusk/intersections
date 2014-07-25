var exec = require('child_process').exec;
var request = require('request');
var _ = require('underscore');
_.mixin( require('underscore.deferred') );
var wordfilter = require('wordfilter');
var wordnikKey = require('./permissions.js').key;
var google = require('google');
var wf = require('word-freq');
var conf = require('./config.js');
var Twitter = require('node-twitter');
var twitterRestClient = new Twitter.RestClient(
  conf.consumer_key,
  conf.consumer_secret,
  conf.access_token,
  conf.access_token_secret
);

var DEBUG = false;

var WIDTH = 800,
    HEIGHT = 800;
var Canvas = require('canvas'),
    Image = Canvas.Image,
    canvas = new Canvas(WIDTH, HEIGHT),
    ctx = canvas.getContext('2d');

ctx.circle = function(x, y, r) {
  this.arc(x, y, r, 0, Math.PI*2, true);
}

ctx.makeCircle = function(x, y, r, txt, modx, mody) {
  var modx = modx || 0;
  var mody = mody || 0;
  var hue = Math.random();
  this.beginPath();
  this.circle(x, y, r);
  this.fillStyle = hsla(hue, 1, 0.5, 0.25);
  this.fill();
  this.font = '30px Impact';
  this.fillStyle = hsla(hue, 1, 0.2, 1);
  var mt = this.measureText(txt);
  this.fillText(txt.toUpperCase(), x - mt.width/2 + WIDTH*modx, y + HEIGHT*mody);
}

Array.prototype.pick = function() {
  return this[Math.floor(Math.random()*this.length)];
};

Array.prototype.pickRemove = function() {
  var index = Math.floor(Math.random()*this.length);
  return this.splice(index,1)[0];
};

function getThreeNouns() {
  var dfd = new _.Deferred();

  var url = 'http://api.wordnik.com/v4/words.json/randomWords?minCorpusCount=5000&minDictionaryCount=5&excludePartOfSpeech=proper-noun,proper-noun-plural,proper-noun-posessive,suffix,family-name,idiom,affix&hasDictionaryDef=true&includePartOfSpeech=noun&limit=1000&maxLength=22&api_key='+wordnikKey;
  request(url, function(err, response, body) {
    var words = JSON.parse(body);
    words = _.pluck(words, 'word');
    dfd.resolve([words.pickRemove(), words.pickRemove(), words.pickRemove()]);
  });
  return dfd.promise();
}

function generate() {
  var dfd = new _.Deferred();

  getThreeNouns().done(function(res) {
    console.log(res);

    var A = res[0] || 'dog',
        B = res[1] || 'tree',
        C = res[2] || 'pavement',
        mt;

    _.when(
        intersect(A, B),
        intersect(A, C),
        intersect(C, B),
        intersect(C, B, A)
      ).done(function(AB, AC, CB, CBA) {

      ctx.fillStyle = "#ddd";
      ctx.fillRect(0, 0, WIDTH, HEIGHT);
      ctx.makeCircle(WIDTH*0.35, HEIGHT*0.65, HEIGHT*0.3, A, -0.15, 0.1);
      ctx.makeCircle(WIDTH*0.65, HEIGHT*0.65, HEIGHT*0.3, B, 0.15, 0.1);
      ctx.makeCircle(WIDTH*0.5, HEIGHT*0.35, HEIGHT*0.3, C, 0, -0.15);

      ctx.font = '30px Impact';
      ctx.fillStyle = 'black';
      mt = ctx.measureText(AB);
      ctx.fillText(AB.toUpperCase(), WIDTH/2 - mt.width/2, HEIGHT*0.75);
      mt = ctx.measureText(AC);
      ctx.fillText(AC.toUpperCase(), WIDTH*0.31 - mt.width/2, HEIGHT*0.46);
      mt = ctx.measureText(CB);
      ctx.fillText(CB.toUpperCase(), WIDTH*0.69 - mt.width/2, HEIGHT*0.46);
      mt = ctx.measureText(CBA);
      ctx.fillText(CBA.toUpperCase(), WIDTH*0.5 - mt.width/2, HEIGHT*0.55);


      makePng(canvas).done(function() {
        dfd.resolve([A, B, C, AB, AC, CB, CBA]);
      });
    });
  });

  return dfd.promise();
}

function intersect(A, B, C) {
  var dfd = new _.Deferred();
  var result = '';
  
  var search = C ? A + ' ' + B + ' ' + C : A + ' ' + B;
  console.log(search);

  if (DEBUG) {
    result = 'thing';
    console.log('debugging');
    dfd.resolve(result);
    return dfd.promise();
  }

  google.resultsPerPage = 10;
  var nextCounter = 0;

  google(search, function(err, next, links){
    if (err) console.error(err);

    for (var i = 0; i < links.length; ++i) {
      result += links[i].title + ' ' + links[i].description + ' ';
    }

    if (nextCounter < 4) {
      nextCounter += 1;
      if (next) next();
    }
    else {
      var frequency = wf.freq(result, true, false);
      var stemA = wf.stem(A)[0];
      var stemB = wf.stem(B)[0];
      var stemC = C ? wf.stem(C)[0] : '';
      C = C || '';
      //console.log(stemA, stemB);
      result = _.chain(frequency)
        .pairs()
        // Filter out all words that share a stem with the input words
        .reject(function(el) {
          var stemEl = wf.stem(el[0])[0];
          return stemEl === stemA || stemEl === stemB || stemEl === stemC ||
                  A.indexOf(stemEl.substr(0,4)) > -1 ||
                  B.indexOf(stemEl.substr(0,4)) > -1 ||
                  C.indexOf(stemEl.substr(0,4)) > -1 ||
                  el[0].length < 3
        })
        // Now we find the maximum frequency word
        .max(function(el) {
          return el[1];
        })
        .value()[0];
        console.log(result);
      dfd.resolve(result);
    }

  });
  return dfd.promise();
}

function tweet() {
  generate().then(function(myTweet) {
    console.log('we made it', myTweet);
    var allWords = myTweet.join(' ');
    console.log(allWords, wordfilter.blacklisted(allWords));
    myTweet = myTweet[0] + ', ' + myTweet[1] + ', ' + myTweet[2] + '.';
      console.log(myTweet);
    if (!wordfilter.blacklisted(allWords)) {
      twitterRestClient.statusesUpdateWithMedia({
          'status': myTweet,
          'media[]': './out.png'
        },
        function(error, result) {
          if (error) {
            console.log('Error: ' + (error.code ? error.code + ' ' + error.message : error.message));
          }
          if (result) {
            console.log(result);
          }
      });
    }
  });
}

function makePng(canvas) {
  var dfd = new _.Deferred();
  var fs = require('fs'),
      out = fs.createWriteStream(__dirname + '/out.png'),
      stream = canvas.pngStream();

  stream.on('data', function(chunk){
    out.write(chunk);
  });

  stream.on('end', function(){
    console.log('saved png');
    exec('convert out.png out.png').on('close', function() {
      dfd.resolve('done!');
    });
  });
  return dfd.promise();
}

function hsla(h, s, l, a){
  var r, g, b;
  if(s == 0){
    r = g = b = l; // achromatic
  }
  else {
    function hue2rgb(p, q, t){
      if(t < 0) t += 1;
      if(t > 1) t -= 1;
      if(t < 1/6) return p + (q - p) * 6 * t;
      if(t < 1/2) return q;
      if(t < 2/3) return p + (q - p) * (2/3 - t) * 6;
      return p;
    }
    var q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    var p = 2 * l - q;
    r = hue2rgb(p, q, h + 1/3);
    g = hue2rgb(p, q, h);
    b = hue2rgb(p, q, h - 1/3);
  }
  return 'rgba(' + Math.round(r * 255) + ', ' + Math.round(g * 255) + ', ' + Math.round(b * 255) + ', ' + a + ')';
}
// Tweet once on initialization
tweet();
