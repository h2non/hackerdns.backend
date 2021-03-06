var redis = require('redis');
var util = require('util');
var EventEmitter = require('events').EventEmitter;

var d = require('dtrace-provider').createDTraceProvider('hackerdns_backend');

function Server(conf, type) {
  EventEmitter.call(this);

  this.conf = conf;
  this.type = type;
  this.redis = redis.createClient(conf.get('redis:port'),
                                  conf.get('redis:host'));
  if (conf.get('redis:password')) {
    this.redis.auth(conf.get('redis:password'), function(err) {
      if (err)
        throw err;
    });
  }

  this.probes = {};
  this.initProbes();

  this.prefixes = {
    probe: conf.get('redis:prefix:probe'),
    token: conf.get('redis:prefix:token')
  };
};
util.inherits(Server, EventEmitter);
module.exports = Server;

Server.prototype.redisKey = function redisKey(prefix) {
  var prefixValue = this.prefixes[prefix] || '';
  var keys = Array.prototype.slice.call(arguments, 1).map(function(key) {
    // Sanitize
    return key.replace(/[^a-z0-9\.\-=\?\*\@:]+/ig, '-');
  });

  return [prefixValue].concat(keys).join('/');
};

Server.prototype.initProbes = function initProbes() {
  var interval = this.conf.get('probe:interval');
  var server = this.conf.get('server');

  this.conf.get('probe:names').split(/:/g).forEach(function(name) {
    var self = this;
    var probe = {
      dtrace: d.addProbe(this.type + '_' + name),
      counter: 0,
      timer: setInterval(function() {
        var delta = (interval / 1000);
        var value = probe.counter;

        // Reset
        probe.counter = 0;

        // Publish mean value to redis
        self.redis.publish(self.redisKey('probe', server, self.type, name),
                           value / delta);
      }, interval)
    };
    this.probes[name] = probe;
  }, this);

  // A bit hacky, but this way we'll get probes from both dns and api servers
  process.nextTick(function() {
    d.enable();
  });
};

Server.prototype.probe = function probe(name) {
  if (!this.probes[name])
    return console.error('Undefined probe %s', name);

  this.probes[name].counter++;
  this.probes[name].dtrace.fire(function() {
    // Just fire
  });
};
