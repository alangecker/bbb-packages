(function () {

/* Imports */
var Meteor = Package.meteor.Meteor;
var global = Package.meteor.global;
var meteorEnv = Package.meteor.meteorEnv;
var check = Package.check.check;
var Match = Package.check.Match;
var Random = Package.random.Random;
var EJSON = Package.ejson.EJSON;
var _ = Package.underscore._;
var Retry = Package.retry.Retry;
var MongoID = Package['mongo-id'].MongoID;
var DiffSequence = Package['diff-sequence'].DiffSequence;
var ECMAScript = Package.ecmascript.ECMAScript;
var DDPCommon = Package['ddp-common'].DDPCommon;
var DDP = Package['ddp-client'].DDP;
var WebApp = Package.webapp.WebApp;
var WebAppInternals = Package.webapp.WebAppInternals;
var main = Package.webapp.main;
var RoutePolicy = Package.routepolicy.RoutePolicy;
var Hook = Package['callback-hook'].Hook;
var meteorInstall = Package.modules.meteorInstall;
var Promise = Package.promise.Promise;

/* Package-scope variables */
var StreamServer, DDPServer, Server;

var require = meteorInstall({"node_modules":{"meteor":{"ddp-server":{"stream_server.js":function module(require){

////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
//                                                                                                                    //
// packages/ddp-server/stream_server.js                                                                               //
//                                                                                                                    //
////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
                                                                                                                      //
// By default, we use the permessage-deflate extension with default
// configuration. If $SERVER_WEBSOCKET_COMPRESSION is set, then it must be valid
// JSON. If it represents a falsey value, then we do not use permessage-deflate
// at all; otherwise, the JSON value is used as an argument to deflate's
// configure method; see
// https://github.com/faye/permessage-deflate-node/blob/master/README.md
//
// (We do this in an _.once instead of at startup, because we don't want to
// crash the tool during isopacket load if your JSON doesn't parse. This is only
// a problem because the tool has to load the DDP server code just in order to
// be a DDP client; see https://github.com/meteor/meteor/issues/3452 .)
var websocketExtensions = _.once(function () {
  var extensions = [];
  var websocketCompressionConfig = process.env.SERVER_WEBSOCKET_COMPRESSION ? JSON.parse(process.env.SERVER_WEBSOCKET_COMPRESSION) : {};

  if (websocketCompressionConfig) {
    extensions.push(Npm.require('permessage-deflate').configure(websocketCompressionConfig));
  }

  return extensions;
});

var pathPrefix = __meteor_runtime_config__.ROOT_URL_PATH_PREFIX || "";

StreamServer = function () {
  var self = this;
  self.registration_callbacks = [];
  self.open_sockets = []; // Because we are installing directly onto WebApp.httpServer instead of using
  // WebApp.app, we have to process the path prefix ourselves.

  self.prefix = pathPrefix + '/sockjs';
  RoutePolicy.declare(self.prefix + '/', 'network'); // set up sockjs

  var sockjs = Npm.require('sockjs');

  var serverOptions = {
    prefix: self.prefix,
    log: function () {},
    // this is the default, but we code it explicitly because we depend
    // on it in stream_client:HEARTBEAT_TIMEOUT
    heartbeat_delay: 45000,
    // The default disconnect_delay is 5 seconds, but if the server ends up CPU
    // bound for that much time, SockJS might not notice that the user has
    // reconnected because the timer (of disconnect_delay ms) can fire before
    // SockJS processes the new connection. Eventually we'll fix this by not
    // combining CPU-heavy processing with SockJS termination (eg a proxy which
    // converts to Unix sockets) but for now, raise the delay.
    disconnect_delay: 60 * 1000,
    // Set the USE_JSESSIONID environment variable to enable setting the
    // JSESSIONID cookie. This is useful for setting up proxies with
    // session affinity.
    jsessionid: !!process.env.USE_JSESSIONID
  }; // If you know your server environment (eg, proxies) will prevent websockets
  // from ever working, set $DISABLE_WEBSOCKETS and SockJS clients (ie,
  // browsers) will not waste time attempting to use them.
  // (Your server will still have a /websocket endpoint.)

  if (process.env.DISABLE_WEBSOCKETS) {
    serverOptions.websocket = false;
  } else {
    serverOptions.faye_server_options = {
      extensions: websocketExtensions()
    };
  }

  self.server = sockjs.createServer(serverOptions); // Install the sockjs handlers, but we want to keep around our own particular
  // request handler that adjusts idle timeouts while we have an outstanding
  // request.  This compensates for the fact that sockjs removes all listeners
  // for "request" to add its own.

  WebApp.httpServer.removeListener('request', WebApp._timeoutAdjustmentRequestCallback);
  self.server.installHandlers(WebApp.httpServer);
  WebApp.httpServer.addListener('request', WebApp._timeoutAdjustmentRequestCallback); // Support the /websocket endpoint

  self._redirectWebsocketEndpoint();

  self.server.on('connection', function (socket) {
    // sockjs sometimes passes us null instead of a socket object
    // so we need to guard against that. see:
    // https://github.com/sockjs/sockjs-node/issues/121
    // https://github.com/meteor/meteor/issues/10468
    if (!socket) return; // We want to make sure that if a client connects to us and does the initial
    // Websocket handshake but never gets to the DDP handshake, that we
    // eventually kill the socket.  Once the DDP handshake happens, DDP
    // heartbeating will work. And before the Websocket handshake, the timeouts
    // we set at the server level in webapp_server.js will work. But
    // faye-websocket calls setTimeout(0) on any socket it takes over, so there
    // is an "in between" state where this doesn't happen.  We work around this
    // by explicitly setting the socket timeout to a relatively large time here,
    // and setting it back to zero when we set up the heartbeat in
    // livedata_server.js.

    socket.setWebsocketTimeout = function (timeout) {
      if ((socket.protocol === 'websocket' || socket.protocol === 'websocket-raw') && socket._session.recv) {
        socket._session.recv.connection.setTimeout(timeout);
      }
    };

    socket.setWebsocketTimeout(45 * 1000);

    socket.send = function (data) {
      socket.write(data);
    };

    socket.on('close', function () {
      self.open_sockets = _.without(self.open_sockets, socket);
    });
    self.open_sockets.push(socket); // only to send a message after connection on tests, useful for
    // socket-stream-client/server-tests.js

    if (process.env.TEST_METADATA && process.env.TEST_METADATA !== "{}") {
      socket.send(JSON.stringify({
        testMessageOnConnect: true
      }));
    } // call all our callbacks when we get a new socket. they will do the
    // work of setting up handlers and such for specific messages.


    _.each(self.registration_callbacks, function (callback) {
      callback(socket);
    });
  });
};

Object.assign(StreamServer.prototype, {
  // call my callback when a new socket connects.
  // also call it for all current connections.
  register: function (callback) {
    var self = this;
    self.registration_callbacks.push(callback);

    _.each(self.all_sockets(), function (socket) {
      callback(socket);
    });
  },
  // get a list of all sockets
  all_sockets: function () {
    var self = this;
    return _.values(self.open_sockets);
  },
  // Redirect /websocket to /sockjs/websocket in order to not expose
  // sockjs to clients that want to use raw websockets
  _redirectWebsocketEndpoint: function () {
    var self = this; // Unfortunately we can't use a connect middleware here since
    // sockjs installs itself prior to all existing listeners
    // (meaning prior to any connect middlewares) so we need to take
    // an approach similar to overshadowListeners in
    // https://github.com/sockjs/sockjs-node/blob/cf820c55af6a9953e16558555a31decea554f70e/src/utils.coffee

    ['request', 'upgrade'].forEach(event => {
      var httpServer = WebApp.httpServer;
      var oldHttpServerListeners = httpServer.listeners(event).slice(0);
      httpServer.removeAllListeners(event); // request and upgrade have different arguments passed but
      // we only care about the first one which is always request

      var newListener = function (request
      /*, moreArguments */
      ) {
        // Store arguments for use within the closure below
        var args = arguments; // TODO replace with url package

        var url = Npm.require('url'); // Rewrite /websocket and /websocket/ urls to /sockjs/websocket while
        // preserving query string.


        var parsedUrl = url.parse(request.url);

        if (parsedUrl.pathname === pathPrefix + '/websocket' || parsedUrl.pathname === pathPrefix + '/websocket/') {
          parsedUrl.pathname = self.prefix + '/websocket';
          request.url = url.format(parsedUrl);
        }

        _.each(oldHttpServerListeners, function (oldListener) {
          oldListener.apply(httpServer, args);
        });
      };

      httpServer.addListener(event, newListener);
    });
  }
});
////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

},"livedata_server.js":function module(require){

////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
//                                                                                                                    //
// packages/ddp-server/livedata_server.js                                                                             //
//                                                                                                                    //
////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
                                                                                                                      //
DDPServer = {};

var Fiber = Npm.require('fibers'); // This file contains classes:
// * Session - The server's connection to a single DDP client
// * Subscription - A single subscription for a single client
// * Server - An entire server that may talk to > 1 client. A DDP endpoint.
//
// Session and Subscription are file scope. For now, until we freeze
// the interface, Server is package scope (in the future it should be
// exported.)
// Represents a single document in a SessionCollectionView


var SessionDocumentView = function () {
  var self = this;
  self.existsIn = new Set(); // set of subscriptionHandle

  self.dataByKey = new Map(); // key-> [ {subscriptionHandle, value} by precedence]
};

DDPServer._SessionDocumentView = SessionDocumentView;

_.extend(SessionDocumentView.prototype, {
  getFields: function () {
    var self = this;
    var ret = {};
    self.dataByKey.forEach(function (precedenceList, key) {
      ret[key] = precedenceList[0].value;
    });
    return ret;
  },
  clearField: function (subscriptionHandle, key, changeCollector) {
    var self = this; // Publish API ignores _id if present in fields

    if (key === "_id") return;
    var precedenceList = self.dataByKey.get(key); // It's okay to clear fields that didn't exist. No need to throw
    // an error.

    if (!precedenceList) return;
    var removedValue = undefined;

    for (var i = 0; i < precedenceList.length; i++) {
      var precedence = precedenceList[i];

      if (precedence.subscriptionHandle === subscriptionHandle) {
        // The view's value can only change if this subscription is the one that
        // used to have precedence.
        if (i === 0) removedValue = precedence.value;
        precedenceList.splice(i, 1);
        break;
      }
    }

    if (precedenceList.length === 0) {
      self.dataByKey.delete(key);
      changeCollector[key] = undefined;
    } else if (removedValue !== undefined && !EJSON.equals(removedValue, precedenceList[0].value)) {
      changeCollector[key] = precedenceList[0].value;
    }
  },
  changeField: function (subscriptionHandle, key, value, changeCollector, isAdd) {
    var self = this; // Publish API ignores _id if present in fields

    if (key === "_id") return; // Don't share state with the data passed in by the user.

    value = EJSON.clone(value);

    if (!self.dataByKey.has(key)) {
      self.dataByKey.set(key, [{
        subscriptionHandle: subscriptionHandle,
        value: value
      }]);
      changeCollector[key] = value;
      return;
    }

    var precedenceList = self.dataByKey.get(key);
    var elt;

    if (!isAdd) {
      elt = precedenceList.find(function (precedence) {
        return precedence.subscriptionHandle === subscriptionHandle;
      });
    }

    if (elt) {
      if (elt === precedenceList[0] && !EJSON.equals(value, elt.value)) {
        // this subscription is changing the value of this field.
        changeCollector[key] = value;
      }

      elt.value = value;
    } else {
      // this subscription is newly caring about this field
      precedenceList.push({
        subscriptionHandle: subscriptionHandle,
        value: value
      });
    }
  }
});
/**
 * Represents a client's view of a single collection
 * @param {String} collectionName Name of the collection it represents
 * @param {Object.<String, Function>} sessionCallbacks The callbacks for added, changed, removed
 * @class SessionCollectionView
 */


var SessionCollectionView = function (collectionName, sessionCallbacks) {
  var self = this;
  self.collectionName = collectionName;
  self.documents = new Map();
  self.callbacks = sessionCallbacks;
};

DDPServer._SessionCollectionView = SessionCollectionView;
Object.assign(SessionCollectionView.prototype, {
  isEmpty: function () {
    var self = this;
    return self.documents.size === 0;
  },
  diff: function (previous) {
    var self = this;
    DiffSequence.diffMaps(previous.documents, self.documents, {
      both: _.bind(self.diffDocument, self),
      rightOnly: function (id, nowDV) {
        self.callbacks.added(self.collectionName, id, nowDV.getFields());
      },
      leftOnly: function (id, prevDV) {
        self.callbacks.removed(self.collectionName, id);
      }
    });
  },
  diffDocument: function (id, prevDV, nowDV) {
    var self = this;
    var fields = {};
    DiffSequence.diffObjects(prevDV.getFields(), nowDV.getFields(), {
      both: function (key, prev, now) {
        if (!EJSON.equals(prev, now)) fields[key] = now;
      },
      rightOnly: function (key, now) {
        fields[key] = now;
      },
      leftOnly: function (key, prev) {
        fields[key] = undefined;
      }
    });
    self.callbacks.changed(self.collectionName, id, fields);
  },
  added: function (subscriptionHandle, id, fields) {
    var self = this;
    var docView = self.documents.get(id);
    var added = false;

    if (!docView) {
      added = true;
      docView = new SessionDocumentView();
      self.documents.set(id, docView);
    }

    docView.existsIn.add(subscriptionHandle);
    var changeCollector = {};

    _.each(fields, function (value, key) {
      docView.changeField(subscriptionHandle, key, value, changeCollector, true);
    });

    if (added) self.callbacks.added(self.collectionName, id, changeCollector);else self.callbacks.changed(self.collectionName, id, changeCollector);
  },
  changed: function (subscriptionHandle, id, changed) {
    var self = this;
    var changedResult = {};
    var docView = self.documents.get(id);
    if (!docView) throw new Error("Could not find element with id " + id + " to change");

    _.each(changed, function (value, key) {
      if (value === undefined) docView.clearField(subscriptionHandle, key, changedResult);else docView.changeField(subscriptionHandle, key, value, changedResult);
    });

    self.callbacks.changed(self.collectionName, id, changedResult);
  },
  removed: function (subscriptionHandle, id) {
    var self = this;
    var docView = self.documents.get(id);

    if (!docView) {
      var err = new Error("Removed nonexistent document " + id);
      throw err;
    }

    docView.existsIn.delete(subscriptionHandle);

    if (docView.existsIn.size === 0) {
      // it is gone from everyone
      self.callbacks.removed(self.collectionName, id);
      self.documents.delete(id);
    } else {
      var changed = {}; // remove this subscription from every precedence list
      // and record the changes

      docView.dataByKey.forEach(function (precedenceList, key) {
        docView.clearField(subscriptionHandle, key, changed);
      });
      self.callbacks.changed(self.collectionName, id, changed);
    }
  }
});
/******************************************************************************/

/* Session                                                                    */

/******************************************************************************/

var Session = function (server, version, socket, options) {
  var self = this;
  self.id = Random.id();
  self.server = server;
  self.version = version;
  self.initialized = false;
  self.socket = socket; // set to null when the session is destroyed. multiple places below
  // use this to determine if the session is alive or not.

  self.inQueue = new Meteor._DoubleEndedQueue();
  self.blocked = false;
  self.workerRunning = false;
  self.cachedUnblock = null; // Sub objects for active subscriptions

  self._namedSubs = new Map();
  self._universalSubs = [];
  self.userId = null;
  self.collectionViews = new Map(); // Set this to false to not send messages when collectionViews are
  // modified. This is done when rerunning subs in _setUserId and those messages
  // are calculated via a diff instead.

  self._isSending = true; // If this is true, don't start a newly-created universal publisher on this
  // session. The session will take care of starting it when appropriate.

  self._dontStartNewUniversalSubs = false; // when we are rerunning subscriptions, any ready messages
  // we want to buffer up for when we are done rerunning subscriptions

  self._pendingReady = []; // List of callbacks to call when this connection is closed.

  self._closeCallbacks = []; // XXX HACK: If a sockjs connection, save off the URL. This is
  // temporary and will go away in the near future.

  self._socketUrl = socket.url; // Allow tests to disable responding to pings.

  self._respondToPings = options.respondToPings; // This object is the public interface to the session. In the public
  // API, it is called the `connection` object.  Internally we call it
  // a `connectionHandle` to avoid ambiguity.

  self.connectionHandle = {
    id: self.id,
    close: function () {
      self.close();
    },
    onClose: function (fn) {
      var cb = Meteor.bindEnvironment(fn, "connection onClose callback");

      if (self.inQueue) {
        self._closeCallbacks.push(cb);
      } else {
        // if we're already closed, call the callback.
        Meteor.defer(cb);
      }
    },
    clientAddress: self._clientAddress(),
    httpHeaders: self.socket.headers
  };
  self.send({
    msg: 'connected',
    session: self.id
  }); // On initial connect, spin up all the universal publishers.

  Fiber(function () {
    self.startUniversalSubs();
  }).run();

  if (version !== 'pre1' && options.heartbeatInterval !== 0) {
    // We no longer need the low level timeout because we have heartbeating.
    socket.setWebsocketTimeout(0);
    self.heartbeat = new DDPCommon.Heartbeat({
      heartbeatInterval: options.heartbeatInterval,
      heartbeatTimeout: options.heartbeatTimeout,
      onTimeout: function () {
        self.close();
      },
      sendPing: function () {
        self.send({
          msg: 'ping'
        });
      }
    });
    self.heartbeat.start();
  }

  Package['facts-base'] && Package['facts-base'].Facts.incrementServerFact("livedata", "sessions", 1);
};

Object.assign(Session.prototype, {
  sendReady: function (subscriptionIds) {
    var self = this;
    if (self._isSending) self.send({
      msg: "ready",
      subs: subscriptionIds
    });else {
      _.each(subscriptionIds, function (subscriptionId) {
        self._pendingReady.push(subscriptionId);
      });
    }
  },
  sendAdded: function (collectionName, id, fields) {
    var self = this;
    if (self._isSending) self.send({
      msg: "added",
      collection: collectionName,
      id: id,
      fields: fields
    });
  },
  sendChanged: function (collectionName, id, fields) {
    var self = this;
    if (_.isEmpty(fields)) return;

    if (self._isSending) {
      self.send({
        msg: "changed",
        collection: collectionName,
        id: id,
        fields: fields
      });
    }
  },
  sendRemoved: function (collectionName, id) {
    var self = this;
    if (self._isSending) self.send({
      msg: "removed",
      collection: collectionName,
      id: id
    });
  },
  getSendCallbacks: function () {
    var self = this;
    return {
      added: _.bind(self.sendAdded, self),
      changed: _.bind(self.sendChanged, self),
      removed: _.bind(self.sendRemoved, self)
    };
  },
  getCollectionView: function (collectionName) {
    var self = this;
    var ret = self.collectionViews.get(collectionName);

    if (!ret) {
      ret = new SessionCollectionView(collectionName, self.getSendCallbacks());
      self.collectionViews.set(collectionName, ret);
    }

    return ret;
  },
  added: function (subscriptionHandle, collectionName, id, fields) {
    var self = this;
    var view = self.getCollectionView(collectionName);
    view.added(subscriptionHandle, id, fields);
  },
  removed: function (subscriptionHandle, collectionName, id) {
    var self = this;
    var view = self.getCollectionView(collectionName);
    view.removed(subscriptionHandle, id);

    if (view.isEmpty()) {
      self.collectionViews.delete(collectionName);
    }
  },
  changed: function (subscriptionHandle, collectionName, id, fields) {
    var self = this;
    var view = self.getCollectionView(collectionName);
    view.changed(subscriptionHandle, id, fields);
  },
  startUniversalSubs: function () {
    var self = this; // Make a shallow copy of the set of universal handlers and start them. If
    // additional universal publishers start while we're running them (due to
    // yielding), they will run separately as part of Server.publish.

    var handlers = _.clone(self.server.universal_publish_handlers);

    _.each(handlers, function (handler) {
      self._startSubscription(handler);
    });
  },
  // Destroy this session and unregister it at the server.
  close: function () {
    var self = this; // Destroy this session, even if it's not registered at the
    // server. Stop all processing and tear everything down. If a socket
    // was attached, close it.
    // Already destroyed.

    if (!self.inQueue) return; // Drop the merge box data immediately.

    self.inQueue = null;
    self.collectionViews = new Map();

    if (self.heartbeat) {
      self.heartbeat.stop();
      self.heartbeat = null;
    }

    if (self.socket) {
      self.socket.close();
      self.socket._meteorSession = null;
    }

    Package['facts-base'] && Package['facts-base'].Facts.incrementServerFact("livedata", "sessions", -1);
    Meteor.defer(function () {
      // stop callbacks can yield, so we defer this on close.
      // sub._isDeactivated() detects that we set inQueue to null and
      // treats it as semi-deactivated (it will ignore incoming callbacks, etc).
      self._deactivateAllSubscriptions(); // Defer calling the close callbacks, so that the caller closing
      // the session isn't waiting for all the callbacks to complete.


      _.each(self._closeCallbacks, function (callback) {
        callback();
      });
    }); // Unregister the session.

    self.server._removeSession(self);
  },
  // Send a message (doing nothing if no socket is connected right now.)
  // It should be a JSON object (it will be stringified.)
  send: function (msg) {
    var self = this;

    if (self.socket) {
      if (Meteor._printSentDDP) Meteor._debug("Sent DDP", DDPCommon.stringifyDDP(msg));
      self.socket.send(DDPCommon.stringifyDDP(msg));
    }
  },
  // Send a connection error.
  sendError: function (reason, offendingMessage) {
    var self = this;
    var msg = {
      msg: 'error',
      reason: reason
    };
    if (offendingMessage) msg.offendingMessage = offendingMessage;
    self.send(msg);
  },
  // Process 'msg' as an incoming message. (But as a guard against
  // race conditions during reconnection, ignore the message if
  // 'socket' is not the currently connected socket.)
  //
  // We run the messages from the client one at a time, in the order
  // given by the client. The message handler is passed an idempotent
  // function 'unblock' which it may call to allow other messages to
  // begin running in parallel in another fiber (for example, a method
  // that wants to yield.) Otherwise, it is automatically unblocked
  // when it returns.
  //
  // Actually, we don't have to 'totally order' the messages in this
  // way, but it's the easiest thing that's correct. (unsub needs to
  // be ordered against sub, methods need to be ordered against each
  // other.)
  processMessage: function (msg_in) {
    var self = this;
    if (!self.inQueue) // we have been destroyed.
      return; // Respond to ping and pong messages immediately without queuing.
    // If the negotiated DDP version is "pre1" which didn't support
    // pings, preserve the "pre1" behavior of responding with a "bad
    // request" for the unknown messages.
    //
    // Fibers are needed because heartbeat uses Meteor.setTimeout, which
    // needs a Fiber. We could actually use regular setTimeout and avoid
    // these new fibers, but it is easier to just make everything use
    // Meteor.setTimeout and not think too hard.
    //
    // Any message counts as receiving a pong, as it demonstrates that
    // the client is still alive.

    if (self.heartbeat) {
      Fiber(function () {
        self.heartbeat.messageReceived();
      }).run();
    }

    if (self.version !== 'pre1' && msg_in.msg === 'ping') {
      if (self._respondToPings) self.send({
        msg: "pong",
        id: msg_in.id
      });
      return;
    }

    if (self.version !== 'pre1' && msg_in.msg === 'pong') {
      // Since everything is a pong, nothing to do
      return;
    }

    self.inQueue.push(msg_in);
    if (self.workerRunning) return;
    self.workerRunning = true;

    var processNext = function () {
      var msg = self.inQueue && self.inQueue.shift();

      if (!msg) {
        self.workerRunning = false;
        return;
      }

      Fiber(function () {
        var blocked = true;

        var unblock = function () {
          if (!blocked) return; // idempotent

          blocked = false;
          processNext();
        };

        self.server.onMessageHook.each(function (callback) {
          callback(msg, self);
          return true;
        });
        if (_.has(self.protocol_handlers, msg.msg)) self.protocol_handlers[msg.msg].call(self, msg, unblock);else self.sendError('Bad request', msg);
        unblock(); // in case the handler didn't already do it
      }).run();
    };

    processNext();
  },
  protocol_handlers: {
    sub: function (msg, unblock) {
      var self = this; // cacheUnblock temporarly, so we can capture it later
      // we will use unblock in current eventLoop, so this is safe

      self.cachedUnblock = unblock; // reject malformed messages

      if (typeof msg.id !== "string" || typeof msg.name !== "string" || 'params' in msg && !(msg.params instanceof Array)) {
        self.sendError("Malformed subscription", msg);
        return;
      }

      if (!self.server.publish_handlers[msg.name]) {
        self.send({
          msg: 'nosub',
          id: msg.id,
          error: new Meteor.Error(404, "Subscription '".concat(msg.name, "' not found"))
        });
        return;
      }

      if (self._namedSubs.has(msg.id)) // subs are idempotent, or rather, they are ignored if a sub
        // with that id already exists. this is important during
        // reconnect.
        return; // XXX It'd be much better if we had generic hooks where any package can
      // hook into subscription handling, but in the mean while we special case
      // ddp-rate-limiter package. This is also done for weak requirements to
      // add the ddp-rate-limiter package in case we don't have Accounts. A
      // user trying to use the ddp-rate-limiter must explicitly require it.

      if (Package['ddp-rate-limiter']) {
        var DDPRateLimiter = Package['ddp-rate-limiter'].DDPRateLimiter;
        var rateLimiterInput = {
          userId: self.userId,
          clientAddress: self.connectionHandle.clientAddress,
          type: "subscription",
          name: msg.name,
          connectionId: self.id
        };

        DDPRateLimiter._increment(rateLimiterInput);

        var rateLimitResult = DDPRateLimiter._check(rateLimiterInput);

        if (!rateLimitResult.allowed) {
          self.send({
            msg: 'nosub',
            id: msg.id,
            error: new Meteor.Error('too-many-requests', DDPRateLimiter.getErrorMessage(rateLimitResult), {
              timeToReset: rateLimitResult.timeToReset
            })
          });
          return;
        }
      }

      var handler = self.server.publish_handlers[msg.name];

      self._startSubscription(handler, msg.id, msg.params, msg.name); // cleaning cached unblock


      self.cachedUnblock = null;
    },
    unsub: function (msg) {
      var self = this;

      self._stopSubscription(msg.id);
    },
    method: function (msg, unblock) {
      var self = this; // reject malformed messages
      // For now, we silently ignore unknown attributes,
      // for forwards compatibility.

      if (typeof msg.id !== "string" || typeof msg.method !== "string" || 'params' in msg && !(msg.params instanceof Array) || 'randomSeed' in msg && typeof msg.randomSeed !== "string") {
        self.sendError("Malformed method invocation", msg);
        return;
      }

      var randomSeed = msg.randomSeed || null; // set up to mark the method as satisfied once all observers
      // (and subscriptions) have reacted to any writes that were
      // done.

      var fence = new DDPServer._WriteFence();
      fence.onAllCommitted(function () {
        // Retire the fence so that future writes are allowed.
        // This means that callbacks like timers are free to use
        // the fence, and if they fire before it's armed (for
        // example, because the method waits for them) their
        // writes will be included in the fence.
        fence.retire();
        self.send({
          msg: 'updated',
          methods: [msg.id]
        });
      }); // find the handler

      var handler = self.server.method_handlers[msg.method];

      if (!handler) {
        self.send({
          msg: 'result',
          id: msg.id,
          error: new Meteor.Error(404, "Method '".concat(msg.method, "' not found"))
        });
        fence.arm();
        return;
      }

      var setUserId = function (userId) {
        self._setUserId(userId);
      };

      var invocation = new DDPCommon.MethodInvocation({
        isSimulation: false,
        userId: self.userId,
        setUserId: setUserId,
        unblock: unblock,
        connection: self.connectionHandle,
        randomSeed: randomSeed
      });
      const promise = new Promise((resolve, reject) => {
        // XXX It'd be better if we could hook into method handlers better but
        // for now, we need to check if the ddp-rate-limiter exists since we
        // have a weak requirement for the ddp-rate-limiter package to be added
        // to our application.
        if (Package['ddp-rate-limiter']) {
          var DDPRateLimiter = Package['ddp-rate-limiter'].DDPRateLimiter;
          var rateLimiterInput = {
            userId: self.userId,
            clientAddress: self.connectionHandle.clientAddress,
            type: "method",
            name: msg.method,
            connectionId: self.id
          };

          DDPRateLimiter._increment(rateLimiterInput);

          var rateLimitResult = DDPRateLimiter._check(rateLimiterInput);

          if (!rateLimitResult.allowed) {
            reject(new Meteor.Error("too-many-requests", DDPRateLimiter.getErrorMessage(rateLimitResult), {
              timeToReset: rateLimitResult.timeToReset
            }));
            return;
          }
        }

        resolve(DDPServer._CurrentWriteFence.withValue(fence, () => DDP._CurrentMethodInvocation.withValue(invocation, () => maybeAuditArgumentChecks(handler, invocation, msg.params, "call to '" + msg.method + "'"))));
      });

      function finish() {
        fence.arm();
        unblock();
      }

      const payload = {
        msg: "result",
        id: msg.id
      };
      promise.then(result => {
        finish();

        if (result !== undefined) {
          payload.result = result;
        }

        self.send(payload);
      }, exception => {
        finish();
        payload.error = wrapInternalException(exception, "while invoking method '".concat(msg.method, "'"));
        self.send(payload);
      });
    }
  },
  _eachSub: function (f) {
    var self = this;

    self._namedSubs.forEach(f);

    self._universalSubs.forEach(f);
  },
  _diffCollectionViews: function (beforeCVs) {
    var self = this;
    DiffSequence.diffMaps(beforeCVs, self.collectionViews, {
      both: function (collectionName, leftValue, rightValue) {
        rightValue.diff(leftValue);
      },
      rightOnly: function (collectionName, rightValue) {
        rightValue.documents.forEach(function (docView, id) {
          self.sendAdded(collectionName, id, docView.getFields());
        });
      },
      leftOnly: function (collectionName, leftValue) {
        leftValue.documents.forEach(function (doc, id) {
          self.sendRemoved(collectionName, id);
        });
      }
    });
  },
  // Sets the current user id in all appropriate contexts and reruns
  // all subscriptions
  _setUserId: function (userId) {
    var self = this;
    if (userId !== null && typeof userId !== "string") throw new Error("setUserId must be called on string or null, not " + typeof userId); // Prevent newly-created universal subscriptions from being added to our
    // session; they will be found below when we call startUniversalSubs.
    //
    // (We don't have to worry about named subscriptions, because we only add
    // them when we process a 'sub' message. We are currently processing a
    // 'method' message, and the method did not unblock, because it is illegal
    // to call setUserId after unblock. Thus we cannot be concurrently adding a
    // new named subscription.)

    self._dontStartNewUniversalSubs = true; // Prevent current subs from updating our collectionViews and call their
    // stop callbacks. This may yield.

    self._eachSub(function (sub) {
      sub._deactivate();
    }); // All subs should now be deactivated. Stop sending messages to the client,
    // save the state of the published collections, reset to an empty view, and
    // update the userId.


    self._isSending = false;
    var beforeCVs = self.collectionViews;
    self.collectionViews = new Map();
    self.userId = userId; // _setUserId is normally called from a Meteor method with
    // DDP._CurrentMethodInvocation set. But DDP._CurrentMethodInvocation is not
    // expected to be set inside a publish function, so we temporary unset it.
    // Inside a publish function DDP._CurrentPublicationInvocation is set.

    DDP._CurrentMethodInvocation.withValue(undefined, function () {
      // Save the old named subs, and reset to having no subscriptions.
      var oldNamedSubs = self._namedSubs;
      self._namedSubs = new Map();
      self._universalSubs = [];
      oldNamedSubs.forEach(function (sub, subscriptionId) {
        var newSub = sub._recreate();

        self._namedSubs.set(subscriptionId, newSub); // nb: if the handler throws or calls this.error(), it will in fact
        // immediately send its 'nosub'. This is OK, though.


        newSub._runHandler();
      }); // Allow newly-created universal subs to be started on our connection in
      // parallel with the ones we're spinning up here, and spin up universal
      // subs.

      self._dontStartNewUniversalSubs = false;
      self.startUniversalSubs();
    }); // Start sending messages again, beginning with the diff from the previous
    // state of the world to the current state. No yields are allowed during
    // this diff, so that other changes cannot interleave.


    Meteor._noYieldsAllowed(function () {
      self._isSending = true;

      self._diffCollectionViews(beforeCVs);

      if (!_.isEmpty(self._pendingReady)) {
        self.sendReady(self._pendingReady);
        self._pendingReady = [];
      }
    });
  },
  _startSubscription: function (handler, subId, params, name) {
    var self = this;
    var sub = new Subscription(self, handler, subId, params, name);
    let unblockHander = self.cachedUnblock; // _startSubscription may call from a lot places
    // so cachedUnblock might be null in somecases
    // assign the cachedUnblock

    sub.unblock = unblockHander || (() => {});

    if (subId) self._namedSubs.set(subId, sub);else self._universalSubs.push(sub);

    sub._runHandler();
  },
  // tear down specified subscription
  _stopSubscription: function (subId, error) {
    var self = this;
    var subName = null;

    if (subId) {
      var maybeSub = self._namedSubs.get(subId);

      if (maybeSub) {
        subName = maybeSub._name;

        maybeSub._removeAllDocuments();

        maybeSub._deactivate();

        self._namedSubs.delete(subId);
      }
    }

    var response = {
      msg: 'nosub',
      id: subId
    };

    if (error) {
      response.error = wrapInternalException(error, subName ? "from sub " + subName + " id " + subId : "from sub id " + subId);
    }

    self.send(response);
  },
  // tear down all subscriptions. Note that this does NOT send removed or nosub
  // messages, since we assume the client is gone.
  _deactivateAllSubscriptions: function () {
    var self = this;

    self._namedSubs.forEach(function (sub, id) {
      sub._deactivate();
    });

    self._namedSubs = new Map();

    self._universalSubs.forEach(function (sub) {
      sub._deactivate();
    });

    self._universalSubs = [];
  },
  // Determine the remote client's IP address, based on the
  // HTTP_FORWARDED_COUNT environment variable representing how many
  // proxies the server is behind.
  _clientAddress: function () {
    var self = this; // For the reported client address for a connection to be correct,
    // the developer must set the HTTP_FORWARDED_COUNT environment
    // variable to an integer representing the number of hops they
    // expect in the `x-forwarded-for` header. E.g., set to "1" if the
    // server is behind one proxy.
    //
    // This could be computed once at startup instead of every time.

    var httpForwardedCount = parseInt(process.env['HTTP_FORWARDED_COUNT']) || 0;
    if (httpForwardedCount === 0) return self.socket.remoteAddress;
    var forwardedFor = self.socket.headers["x-forwarded-for"];
    if (!_.isString(forwardedFor)) return null;
    forwardedFor = forwardedFor.trim().split(/\s*,\s*/); // Typically the first value in the `x-forwarded-for` header is
    // the original IP address of the client connecting to the first
    // proxy.  However, the end user can easily spoof the header, in
    // which case the first value(s) will be the fake IP address from
    // the user pretending to be a proxy reporting the original IP
    // address value.  By counting HTTP_FORWARDED_COUNT back from the
    // end of the list, we ensure that we get the IP address being
    // reported by *our* first proxy.

    if (httpForwardedCount < 0 || httpForwardedCount > forwardedFor.length) return null;
    return forwardedFor[forwardedFor.length - httpForwardedCount];
  }
});
/******************************************************************************/

/* Subscription                                                               */

/******************************************************************************/
// ctor for a sub handle: the input to each publish function
// Instance name is this because it's usually referred to as this inside a
// publish

/**
 * @summary The server's side of a subscription
 * @class Subscription
 * @instanceName this
 * @showInstanceName true
 */

var Subscription = function (session, handler, subscriptionId, params, name) {
  var self = this;
  self._session = session; // type is Session

  /**
   * @summary Access inside the publish function. The incoming [connection](#meteor_onconnection) for this subscription.
   * @locus Server
   * @name  connection
   * @memberOf Subscription
   * @instance
   */

  self.connection = session.connectionHandle; // public API object

  self._handler = handler; // my subscription ID (generated by client, undefined for universal subs).

  self._subscriptionId = subscriptionId; // undefined for universal subs

  self._name = name;
  self._params = params || []; // Only named subscriptions have IDs, but we need some sort of string
  // internally to keep track of all subscriptions inside
  // SessionDocumentViews. We use this subscriptionHandle for that.

  if (self._subscriptionId) {
    self._subscriptionHandle = 'N' + self._subscriptionId;
  } else {
    self._subscriptionHandle = 'U' + Random.id();
  } // has _deactivate been called?


  self._deactivated = false; // stop callbacks to g/c this sub.  called w/ zero arguments.

  self._stopCallbacks = []; // the set of (collection, documentid) that this subscription has
  // an opinion about

  self._documents = new Map(); // remember if we are ready.

  self._ready = false; // Part of the public API: the user of this sub.

  /**
   * @summary Access inside the publish function. The id of the logged-in user, or `null` if no user is logged in.
   * @locus Server
   * @memberOf Subscription
   * @name  userId
   * @instance
   */

  self.userId = session.userId; // For now, the id filter is going to default to
  // the to/from DDP methods on MongoID, to
  // specifically deal with mongo/minimongo ObjectIds.
  // Later, you will be able to make this be "raw"
  // if you want to publish a collection that you know
  // just has strings for keys and no funny business, to
  // a ddp consumer that isn't minimongo

  self._idFilter = {
    idStringify: MongoID.idStringify,
    idParse: MongoID.idParse
  };
  Package['facts-base'] && Package['facts-base'].Facts.incrementServerFact("livedata", "subscriptions", 1);
};

Object.assign(Subscription.prototype, {
  _runHandler: function () {
    // XXX should we unblock() here? Either before running the publish
    // function, or before running _publishCursor.
    //
    // Right now, each publish function blocks all future publishes and
    // methods waiting on data from Mongo (or whatever else the function
    // blocks on). This probably slows page load in common cases.
    if (!this.unblock) {
      this.unblock = () => {};
    }

    const self = this;
    let resultOrThenable = null;

    try {
      resultOrThenable = DDP._CurrentPublicationInvocation.withValue(self, () => maybeAuditArgumentChecks(self._handler, self, EJSON.clone(self._params), // It's OK that this would look weird for universal subscriptions,
      // because they have no arguments so there can never be an
      // audit-argument-checks failure.
      "publisher '" + self._name + "'"));
    } catch (e) {
      self.error(e);
      return;
    } // Did the handler call this.error or this.stop?


    if (self._isDeactivated()) return; // Both conventional and async publish handler functions are supported.
    // If an object is returned with a then() function, it is either a promise
    // or thenable and will be resolved asynchronously.

    const isThenable = resultOrThenable && typeof resultOrThenable.then === 'function';

    if (isThenable) {
      Promise.resolve(resultOrThenable).then(function () {
        return self._publishHandlerResult.bind(self)(...arguments);
      }, e => self.error(e));
    } else {
      self._publishHandlerResult(resultOrThenable);
    }
  },
  _publishHandlerResult: function (res) {
    // SPECIAL CASE: Instead of writing their own callbacks that invoke
    // this.added/changed/ready/etc, the user can just return a collection
    // cursor or array of cursors from the publish function; we call their
    // _publishCursor method which starts observing the cursor and publishes the
    // results. Note that _publishCursor does NOT call ready().
    //
    // XXX This uses an undocumented interface which only the Mongo cursor
    // interface publishes. Should we make this interface public and encourage
    // users to implement it themselves? Arguably, it's unnecessary; users can
    // already write their own functions like
    //   var publishMyReactiveThingy = function (name, handler) {
    //     Meteor.publish(name, function () {
    //       var reactiveThingy = handler();
    //       reactiveThingy.publishMe();
    //     });
    //   };
    var self = this;

    var isCursor = function (c) {
      return c && c._publishCursor;
    };

    if (isCursor(res)) {
      try {
        res._publishCursor(self);
      } catch (e) {
        self.error(e);
        return;
      } // _publishCursor only returns after the initial added callbacks have run.
      // mark subscription as ready.


      self.ready();
    } else if (_.isArray(res)) {
      // check all the elements are cursors
      if (!_.all(res, isCursor)) {
        self.error(new Error("Publish function returned an array of non-Cursors"));
        return;
      } // find duplicate collection names
      // XXX we should support overlapping cursors, but that would require the
      // merge box to allow overlap within a subscription


      var collectionNames = {};

      for (var i = 0; i < res.length; ++i) {
        var collectionName = res[i]._getCollectionName();

        if (_.has(collectionNames, collectionName)) {
          self.error(new Error("Publish function returned multiple cursors for collection " + collectionName));
          return;
        }

        collectionNames[collectionName] = true;
      }

      ;

      try {
        _.each(res, function (cur) {
          cur._publishCursor(self);
        });
      } catch (e) {
        self.error(e);
        return;
      }

      self.ready();
    } else if (res) {
      // truthy values other than cursors or arrays are probably a
      // user mistake (possible returning a Mongo document via, say,
      // `coll.findOne()`).
      self.error(new Error("Publish function can only return a Cursor or " + "an array of Cursors"));
    }
  },
  // This calls all stop callbacks and prevents the handler from updating any
  // SessionCollectionViews further. It's used when the user unsubscribes or
  // disconnects, as well as during setUserId re-runs. It does *NOT* send
  // removed messages for the published objects; if that is necessary, call
  // _removeAllDocuments first.
  _deactivate: function () {
    var self = this;
    if (self._deactivated) return;
    self._deactivated = true;

    self._callStopCallbacks();

    Package['facts-base'] && Package['facts-base'].Facts.incrementServerFact("livedata", "subscriptions", -1);
  },
  _callStopCallbacks: function () {
    var self = this; // tell listeners, so they can clean up

    var callbacks = self._stopCallbacks;
    self._stopCallbacks = [];

    _.each(callbacks, function (callback) {
      callback();
    });
  },
  // Send remove messages for every document.
  _removeAllDocuments: function () {
    var self = this;

    Meteor._noYieldsAllowed(function () {
      self._documents.forEach(function (collectionDocs, collectionName) {
        collectionDocs.forEach(function (strId) {
          self.removed(collectionName, self._idFilter.idParse(strId));
        });
      });
    });
  },
  // Returns a new Subscription for the same session with the same
  // initial creation parameters. This isn't a clone: it doesn't have
  // the same _documents cache, stopped state or callbacks; may have a
  // different _subscriptionHandle, and gets its userId from the
  // session, not from this object.
  _recreate: function () {
    var self = this;
    return new Subscription(self._session, self._handler, self._subscriptionId, self._params, self._name);
  },

  /**
   * @summary Call inside the publish function.  Stops this client's subscription, triggering a call on the client to the `onStop` callback passed to [`Meteor.subscribe`](#meteor_subscribe), if any. If `error` is not a [`Meteor.Error`](#meteor_error), it will be [sanitized](#meteor_error).
   * @locus Server
   * @param {Error} error The error to pass to the client.
   * @instance
   * @memberOf Subscription
   */
  error: function (error) {
    var self = this;
    if (self._isDeactivated()) return;

    self._session._stopSubscription(self._subscriptionId, error);
  },
  // Note that while our DDP client will notice that you've called stop() on the
  // server (and clean up its _subscriptions table) we don't actually provide a
  // mechanism for an app to notice this (the subscribe onError callback only
  // triggers if there is an error).

  /**
   * @summary Call inside the publish function.  Stops this client's subscription and invokes the client's `onStop` callback with no error.
   * @locus Server
   * @instance
   * @memberOf Subscription
   */
  stop: function () {
    var self = this;
    if (self._isDeactivated()) return;

    self._session._stopSubscription(self._subscriptionId);
  },

  /**
   * @summary Call inside the publish function.  Registers a callback function to run when the subscription is stopped.
   * @locus Server
   * @memberOf Subscription
   * @instance
   * @param {Function} func The callback function
   */
  onStop: function (callback) {
    var self = this;
    callback = Meteor.bindEnvironment(callback, 'onStop callback', self);
    if (self._isDeactivated()) callback();else self._stopCallbacks.push(callback);
  },
  // This returns true if the sub has been deactivated, *OR* if the session was
  // destroyed but the deferred call to _deactivateAllSubscriptions hasn't
  // happened yet.
  _isDeactivated: function () {
    var self = this;
    return self._deactivated || self._session.inQueue === null;
  },

  /**
   * @summary Call inside the publish function.  Informs the subscriber that a document has been added to the record set.
   * @locus Server
   * @memberOf Subscription
   * @instance
   * @param {String} collection The name of the collection that contains the new document.
   * @param {String} id The new document's ID.
   * @param {Object} fields The fields in the new document.  If `_id` is present it is ignored.
   */
  added: function (collectionName, id, fields) {
    var self = this;
    if (self._isDeactivated()) return;
    id = self._idFilter.idStringify(id);

    let ids = self._documents.get(collectionName);

    if (ids == null) {
      ids = new Set();

      self._documents.set(collectionName, ids);
    }

    ids.add(id);

    self._session.added(self._subscriptionHandle, collectionName, id, fields);
  },

  /**
   * @summary Call inside the publish function.  Informs the subscriber that a document in the record set has been modified.
   * @locus Server
   * @memberOf Subscription
   * @instance
   * @param {String} collection The name of the collection that contains the changed document.
   * @param {String} id The changed document's ID.
   * @param {Object} fields The fields in the document that have changed, together with their new values.  If a field is not present in `fields` it was left unchanged; if it is present in `fields` and has a value of `undefined` it was removed from the document.  If `_id` is present it is ignored.
   */
  changed: function (collectionName, id, fields) {
    var self = this;
    if (self._isDeactivated()) return;
    id = self._idFilter.idStringify(id);

    self._session.changed(self._subscriptionHandle, collectionName, id, fields);
  },

  /**
   * @summary Call inside the publish function.  Informs the subscriber that a document has been removed from the record set.
   * @locus Server
   * @memberOf Subscription
   * @instance
   * @param {String} collection The name of the collection that the document has been removed from.
   * @param {String} id The ID of the document that has been removed.
   */
  removed: function (collectionName, id) {
    var self = this;
    if (self._isDeactivated()) return;
    id = self._idFilter.idStringify(id); // We don't bother to delete sets of things in a collection if the
    // collection is empty.  It could break _removeAllDocuments.

    self._documents.get(collectionName).delete(id);

    self._session.removed(self._subscriptionHandle, collectionName, id);
  },

  /**
   * @summary Call inside the publish function.  Informs the subscriber that an initial, complete snapshot of the record set has been sent.  This will trigger a call on the client to the `onReady` callback passed to  [`Meteor.subscribe`](#meteor_subscribe), if any.
   * @locus Server
   * @memberOf Subscription
   * @instance
   */
  ready: function () {
    var self = this;
    if (self._isDeactivated()) return;
    if (!self._subscriptionId) return; // unnecessary but ignored for universal sub

    if (!self._ready) {
      self._session.sendReady([self._subscriptionId]);

      self._ready = true;
    }
  }
});
/******************************************************************************/

/* Server                                                                     */

/******************************************************************************/

Server = function (options) {
  var self = this; // The default heartbeat interval is 30 seconds on the server and 35
  // seconds on the client.  Since the client doesn't need to send a
  // ping as long as it is receiving pings, this means that pings
  // normally go from the server to the client.
  //
  // Note: Troposphere depends on the ability to mutate
  // Meteor.server.options.heartbeatTimeout! This is a hack, but it's life.

  self.options = _.defaults(options || {}, {
    heartbeatInterval: 15000,
    heartbeatTimeout: 15000,
    // For testing, allow responding to pings to be disabled.
    respondToPings: true
  }); // Map of callbacks to call when a new connection comes in to the
  // server and completes DDP version negotiation. Use an object instead
  // of an array so we can safely remove one from the list while
  // iterating over it.

  self.onConnectionHook = new Hook({
    debugPrintExceptions: "onConnection callback"
  }); // Map of callbacks to call when a new message comes in.

  self.onMessageHook = new Hook({
    debugPrintExceptions: "onMessage callback"
  });
  self.publish_handlers = {};
  self.universal_publish_handlers = [];
  self.method_handlers = {};
  self.sessions = new Map(); // map from id to session

  self.stream_server = new StreamServer();
  self.stream_server.register(function (socket) {
    // socket implements the SockJSConnection interface
    socket._meteorSession = null;

    var sendError = function (reason, offendingMessage) {
      var msg = {
        msg: 'error',
        reason: reason
      };
      if (offendingMessage) msg.offendingMessage = offendingMessage;
      socket.send(DDPCommon.stringifyDDP(msg));
    };

    socket.on('data', function (raw_msg) {
      if (Meteor._printReceivedDDP) {
        Meteor._debug("Received DDP", raw_msg);
      }

      try {
        try {
          var msg = DDPCommon.parseDDP(raw_msg);
        } catch (err) {
          sendError('Parse error');
          return;
        }

        if (msg === null || !msg.msg) {
          sendError('Bad request', msg);
          return;
        }

        if (msg.msg === 'connect') {
          if (socket._meteorSession) {
            sendError("Already connected", msg);
            return;
          }

          Fiber(function () {
            self._handleConnect(socket, msg);
          }).run();
          return;
        }

        if (!socket._meteorSession) {
          sendError('Must connect first', msg);
          return;
        }

        socket._meteorSession.processMessage(msg);
      } catch (e) {
        // XXX print stack nicely
        Meteor._debug("Internal exception while processing message", msg, e);
      }
    });
    socket.on('close', function () {
      if (socket._meteorSession) {
        Fiber(function () {
          socket._meteorSession.close();
        }).run();
      }
    });
  });
};

Object.assign(Server.prototype, {
  /**
   * @summary Register a callback to be called when a new DDP connection is made to the server.
   * @locus Server
   * @param {function} callback The function to call when a new DDP connection is established.
   * @memberOf Meteor
   * @importFromPackage meteor
   */
  onConnection: function (fn) {
    var self = this;
    return self.onConnectionHook.register(fn);
  },

  /**
   * @summary Register a callback to be called when a new DDP message is received.
   * @locus Server
   * @param {function} callback The function to call when a new DDP message is received.
   * @memberOf Meteor
   * @importFromPackage meteor
   */
  onMessage: function (fn) {
    var self = this;
    return self.onMessageHook.register(fn);
  },
  _handleConnect: function (socket, msg) {
    var self = this; // The connect message must specify a version and an array of supported
    // versions, and it must claim to support what it is proposing.

    if (!(typeof msg.version === 'string' && _.isArray(msg.support) && _.all(msg.support, _.isString) && _.contains(msg.support, msg.version))) {
      socket.send(DDPCommon.stringifyDDP({
        msg: 'failed',
        version: DDPCommon.SUPPORTED_DDP_VERSIONS[0]
      }));
      socket.close();
      return;
    } // In the future, handle session resumption: something like:
    //  socket._meteorSession = self.sessions[msg.session]


    var version = calculateVersion(msg.support, DDPCommon.SUPPORTED_DDP_VERSIONS);

    if (msg.version !== version) {
      // The best version to use (according to the client's stated preferences)
      // is not the one the client is trying to use. Inform them about the best
      // version to use.
      socket.send(DDPCommon.stringifyDDP({
        msg: 'failed',
        version: version
      }));
      socket.close();
      return;
    } // Yay, version matches! Create a new session.
    // Note: Troposphere depends on the ability to mutate
    // Meteor.server.options.heartbeatTimeout! This is a hack, but it's life.


    socket._meteorSession = new Session(self, version, socket, self.options);
    self.sessions.set(socket._meteorSession.id, socket._meteorSession);
    self.onConnectionHook.each(function (callback) {
      if (socket._meteorSession) callback(socket._meteorSession.connectionHandle);
      return true;
    });
  },

  /**
   * Register a publish handler function.
   *
   * @param name {String} identifier for query
   * @param handler {Function} publish handler
   * @param options {Object}
   *
   * Server will call handler function on each new subscription,
   * either when receiving DDP sub message for a named subscription, or on
   * DDP connect for a universal subscription.
   *
   * If name is null, this will be a subscription that is
   * automatically established and permanently on for all connected
   * client, instead of a subscription that can be turned on and off
   * with subscribe().
   *
   * options to contain:
   *  - (mostly internal) is_auto: true if generated automatically
   *    from an autopublish hook. this is for cosmetic purposes only
   *    (it lets us determine whether to print a warning suggesting
   *    that you turn off autopublish.)
   */

  /**
   * @summary Publish a record set.
   * @memberOf Meteor
   * @importFromPackage meteor
   * @locus Server
   * @param {String|Object} name If String, name of the record set.  If Object, publications Dictionary of publish functions by name.  If `null`, the set has no name, and the record set is automatically sent to all connected clients.
   * @param {Function} func Function called on the server each time a client subscribes.  Inside the function, `this` is the publish handler object, described below.  If the client passed arguments to `subscribe`, the function is called with the same arguments.
   */
  publish: function (name, handler, options) {
    var self = this;

    if (!_.isObject(name)) {
      options = options || {};

      if (name && name in self.publish_handlers) {
        Meteor._debug("Ignoring duplicate publish named '" + name + "'");

        return;
      }

      if (Package.autopublish && !options.is_auto) {
        // They have autopublish on, yet they're trying to manually
        // picking stuff to publish. They probably should turn off
        // autopublish. (This check isn't perfect -- if you create a
        // publish before you turn on autopublish, it won't catch
        // it. But this will definitely handle the simple case where
        // you've added the autopublish package to your app, and are
        // calling publish from your app code.)
        if (!self.warned_about_autopublish) {
          self.warned_about_autopublish = true;

          Meteor._debug("** You've set up some data subscriptions with Meteor.publish(), but\n" + "** you still have autopublish turned on. Because autopublish is still\n" + "** on, your Meteor.publish() calls won't have much effect. All data\n" + "** will still be sent to all clients.\n" + "**\n" + "** Turn off autopublish by removing the autopublish package:\n" + "**\n" + "**   $ meteor remove autopublish\n" + "**\n" + "** .. and make sure you have Meteor.publish() and Meteor.subscribe() calls\n" + "** for each collection that you want clients to see.\n");
        }
      }

      if (name) self.publish_handlers[name] = handler;else {
        self.universal_publish_handlers.push(handler); // Spin up the new publisher on any existing session too. Run each
        // session's subscription in a new Fiber, so that there's no change for
        // self.sessions to change while we're running this loop.

        self.sessions.forEach(function (session) {
          if (!session._dontStartNewUniversalSubs) {
            Fiber(function () {
              session._startSubscription(handler);
            }).run();
          }
        });
      }
    } else {
      _.each(name, function (value, key) {
        self.publish(key, value, {});
      });
    }
  },
  _removeSession: function (session) {
    var self = this;
    self.sessions.delete(session.id);
  },

  /**
   * @summary Defines functions that can be invoked over the network by clients.
   * @locus Anywhere
   * @param {Object} methods Dictionary whose keys are method names and values are functions.
   * @memberOf Meteor
   * @importFromPackage meteor
   */
  methods: function (methods) {
    var self = this;

    _.each(methods, function (func, name) {
      if (typeof func !== 'function') throw new Error("Method '" + name + "' must be a function");
      if (self.method_handlers[name]) throw new Error("A method named '" + name + "' is already defined");
      self.method_handlers[name] = func;
    });
  },
  call: function (name) {
    for (var _len = arguments.length, args = new Array(_len > 1 ? _len - 1 : 0), _key = 1; _key < _len; _key++) {
      args[_key - 1] = arguments[_key];
    }

    if (args.length && typeof args[args.length - 1] === "function") {
      // If it's a function, the last argument is the result callback, not
      // a parameter to the remote method.
      var callback = args.pop();
    }

    return this.apply(name, args, callback);
  },
  // A version of the call method that always returns a Promise.
  callAsync: function (name) {
    for (var _len2 = arguments.length, args = new Array(_len2 > 1 ? _len2 - 1 : 0), _key2 = 1; _key2 < _len2; _key2++) {
      args[_key2 - 1] = arguments[_key2];
    }

    return this.applyAsync(name, args);
  },
  apply: function (name, args, options, callback) {
    // We were passed 3 arguments. They may be either (name, args, options)
    // or (name, args, callback)
    if (!callback && typeof options === 'function') {
      callback = options;
      options = {};
    } else {
      options = options || {};
    }

    const promise = this.applyAsync(name, args, options); // Return the result in whichever way the caller asked for it. Note that we
    // do NOT block on the write fence in an analogous way to how the client
    // blocks on the relevant data being visible, so you are NOT guaranteed that
    // cursor observe callbacks have fired when your callback is invoked. (We
    // can change this if there's a real use case.)

    if (callback) {
      promise.then(result => callback(undefined, result), exception => callback(exception));
    } else {
      return promise.await();
    }
  },
  // @param options {Optional Object}
  applyAsync: function (name, args, options) {
    // Run the handler
    var handler = this.method_handlers[name];

    if (!handler) {
      return Promise.reject(new Meteor.Error(404, "Method '".concat(name, "' not found")));
    } // If this is a method call from within another method or publish function,
    // get the user state from the outer method or publish function, otherwise
    // don't allow setUserId to be called


    var userId = null;

    var setUserId = function () {
      throw new Error("Can't call setUserId on a server initiated method call");
    };

    var connection = null;

    var currentMethodInvocation = DDP._CurrentMethodInvocation.get();

    var currentPublicationInvocation = DDP._CurrentPublicationInvocation.get();

    var randomSeed = null;

    if (currentMethodInvocation) {
      userId = currentMethodInvocation.userId;

      setUserId = function (userId) {
        currentMethodInvocation.setUserId(userId);
      };

      connection = currentMethodInvocation.connection;
      randomSeed = DDPCommon.makeRpcSeed(currentMethodInvocation, name);
    } else if (currentPublicationInvocation) {
      userId = currentPublicationInvocation.userId;

      setUserId = function (userId) {
        currentPublicationInvocation._session._setUserId(userId);
      };

      connection = currentPublicationInvocation.connection;
    }

    var invocation = new DDPCommon.MethodInvocation({
      isSimulation: false,
      userId,
      setUserId,
      connection,
      randomSeed
    });
    return new Promise(resolve => resolve(DDP._CurrentMethodInvocation.withValue(invocation, () => maybeAuditArgumentChecks(handler, invocation, EJSON.clone(args), "internal call to '" + name + "'")))).then(EJSON.clone);
  },
  _urlForSession: function (sessionId) {
    var self = this;
    var session = self.sessions.get(sessionId);
    if (session) return session._socketUrl;else return null;
  }
});

var calculateVersion = function (clientSupportedVersions, serverSupportedVersions) {
  var correctVersion = _.find(clientSupportedVersions, function (version) {
    return _.contains(serverSupportedVersions, version);
  });

  if (!correctVersion) {
    correctVersion = serverSupportedVersions[0];
  }

  return correctVersion;
};

DDPServer._calculateVersion = calculateVersion; // "blind" exceptions other than those that were deliberately thrown to signal
// errors to the client

var wrapInternalException = function (exception, context) {
  if (!exception) return exception; // To allow packages to throw errors intended for the client but not have to
  // depend on the Meteor.Error class, `isClientSafe` can be set to true on any
  // error before it is thrown.

  if (exception.isClientSafe) {
    if (!(exception instanceof Meteor.Error)) {
      const originalMessage = exception.message;
      exception = new Meteor.Error(exception.error, exception.reason, exception.details);
      exception.message = originalMessage;
    }

    return exception;
  } // Tests can set the '_expectedByTest' flag on an exception so it won't go to
  // the server log.


  if (!exception._expectedByTest) {
    Meteor._debug("Exception " + context, exception.stack);

    if (exception.sanitizedError) {
      Meteor._debug("Sanitized and reported to the client as:", exception.sanitizedError);

      Meteor._debug();
    }
  } // Did the error contain more details that could have been useful if caught in
  // server code (or if thrown from non-client-originated code), but also
  // provided a "sanitized" version with more context than 500 Internal server
  // error? Use that.


  if (exception.sanitizedError) {
    if (exception.sanitizedError.isClientSafe) return exception.sanitizedError;

    Meteor._debug("Exception " + context + " provides a sanitizedError that " + "does not have isClientSafe property set; ignoring");
  }

  return new Meteor.Error(500, "Internal server error");
}; // Audit argument checks, if the audit-argument-checks package exists (it is a
// weak dependency of this package).


var maybeAuditArgumentChecks = function (f, context, args, description) {
  args = args || [];

  if (Package['audit-argument-checks']) {
    return Match._failIfArgumentsAreNotAllChecked(f, context, args, description);
  }

  return f.apply(context, args);
};
////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

},"writefence.js":function module(require){

////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
//                                                                                                                    //
// packages/ddp-server/writefence.js                                                                                  //
//                                                                                                                    //
////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
                                                                                                                      //
var Future = Npm.require('fibers/future'); // A write fence collects a group of writes, and provides a callback
// when all of the writes are fully committed and propagated (all
// observers have been notified of the write and acknowledged it.)
//


DDPServer._WriteFence = function () {
  var self = this;
  self.armed = false;
  self.fired = false;
  self.retired = false;
  self.outstanding_writes = 0;
  self.before_fire_callbacks = [];
  self.completion_callbacks = [];
}; // The current write fence. When there is a current write fence, code
// that writes to databases should register their writes with it using
// beginWrite().
//


DDPServer._CurrentWriteFence = new Meteor.EnvironmentVariable();

_.extend(DDPServer._WriteFence.prototype, {
  // Start tracking a write, and return an object to represent it. The
  // object has a single method, committed(). This method should be
  // called when the write is fully committed and propagated. You can
  // continue to add writes to the WriteFence up until it is triggered
  // (calls its callbacks because all writes have committed.)
  beginWrite: function () {
    var self = this;
    if (self.retired) return {
      committed: function () {}
    };
    if (self.fired) throw new Error("fence has already activated -- too late to add writes");
    self.outstanding_writes++;
    var committed = false;
    return {
      committed: function () {
        if (committed) throw new Error("committed called twice on the same write");
        committed = true;
        self.outstanding_writes--;

        self._maybeFire();
      }
    };
  },
  // Arm the fence. Once the fence is armed, and there are no more
  // uncommitted writes, it will activate.
  arm: function () {
    var self = this;
    if (self === DDPServer._CurrentWriteFence.get()) throw Error("Can't arm the current fence");
    self.armed = true;

    self._maybeFire();
  },
  // Register a function to be called once before firing the fence.
  // Callback function can add new writes to the fence, in which case
  // it won't fire until those writes are done as well.
  onBeforeFire: function (func) {
    var self = this;
    if (self.fired) throw new Error("fence has already activated -- too late to " + "add a callback");
    self.before_fire_callbacks.push(func);
  },
  // Register a function to be called when the fence fires.
  onAllCommitted: function (func) {
    var self = this;
    if (self.fired) throw new Error("fence has already activated -- too late to " + "add a callback");
    self.completion_callbacks.push(func);
  },
  // Convenience function. Arms the fence, then blocks until it fires.
  armAndWait: function () {
    var self = this;
    var future = new Future();
    self.onAllCommitted(function () {
      future['return']();
    });
    self.arm();
    future.wait();
  },
  _maybeFire: function () {
    var self = this;
    if (self.fired) throw new Error("write fence already activated?");

    if (self.armed && !self.outstanding_writes) {
      function invokeCallback(func) {
        try {
          func(self);
        } catch (err) {
          Meteor._debug("exception in write fence callback", err);
        }
      }

      self.outstanding_writes++;

      while (self.before_fire_callbacks.length > 0) {
        var callbacks = self.before_fire_callbacks;
        self.before_fire_callbacks = [];

        _.each(callbacks, invokeCallback);
      }

      self.outstanding_writes--;

      if (!self.outstanding_writes) {
        self.fired = true;
        var callbacks = self.completion_callbacks;
        self.completion_callbacks = [];

        _.each(callbacks, invokeCallback);
      }
    }
  },
  // Deactivate this fence so that adding more writes has no effect.
  // The fence must have already fired.
  retire: function () {
    var self = this;
    if (!self.fired) throw new Error("Can't retire a fence that hasn't fired.");
    self.retired = true;
  }
});
////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

},"crossbar.js":function module(){

////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
//                                                                                                                    //
// packages/ddp-server/crossbar.js                                                                                    //
//                                                                                                                    //
////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
                                                                                                                      //
// A "crossbar" is a class that provides structured notification registration.
// See _match for the definition of how a notification matches a trigger.
// All notifications and triggers must have a string key named 'collection'.
DDPServer._Crossbar = function (options) {
  var self = this;
  options = options || {};
  self.nextId = 1; // map from collection name (string) -> listener id -> object. each object has
  // keys 'trigger', 'callback'.  As a hack, the empty string means "no
  // collection".

  self.listenersByCollection = {};
  self.listenersByCollectionCount = {};
  self.factPackage = options.factPackage || "livedata";
  self.factName = options.factName || null;
};

_.extend(DDPServer._Crossbar.prototype, {
  // msg is a trigger or a notification
  _collectionForMessage: function (msg) {
    var self = this;

    if (!_.has(msg, 'collection')) {
      return '';
    } else if (typeof msg.collection === 'string') {
      if (msg.collection === '') throw Error("Message has empty collection!");
      return msg.collection;
    } else {
      throw Error("Message has non-string collection!");
    }
  },
  // Listen for notification that match 'trigger'. A notification
  // matches if it has the key-value pairs in trigger as a
  // subset. When a notification matches, call 'callback', passing
  // the actual notification.
  //
  // Returns a listen handle, which is an object with a method
  // stop(). Call stop() to stop listening.
  //
  // XXX It should be legal to call fire() from inside a listen()
  // callback?
  listen: function (trigger, callback) {
    var self = this;
    var id = self.nextId++;

    var collection = self._collectionForMessage(trigger);

    var record = {
      trigger: EJSON.clone(trigger),
      callback: callback
    };

    if (!_.has(self.listenersByCollection, collection)) {
      self.listenersByCollection[collection] = {};
      self.listenersByCollectionCount[collection] = 0;
    }

    self.listenersByCollection[collection][id] = record;
    self.listenersByCollectionCount[collection]++;

    if (self.factName && Package['facts-base']) {
      Package['facts-base'].Facts.incrementServerFact(self.factPackage, self.factName, 1);
    }

    return {
      stop: function () {
        if (self.factName && Package['facts-base']) {
          Package['facts-base'].Facts.incrementServerFact(self.factPackage, self.factName, -1);
        }

        delete self.listenersByCollection[collection][id];
        self.listenersByCollectionCount[collection]--;

        if (self.listenersByCollectionCount[collection] === 0) {
          delete self.listenersByCollection[collection];
          delete self.listenersByCollectionCount[collection];
        }
      }
    };
  },
  // Fire the provided 'notification' (an object whose attribute
  // values are all JSON-compatibile) -- inform all matching listeners
  // (registered with listen()).
  //
  // If fire() is called inside a write fence, then each of the
  // listener callbacks will be called inside the write fence as well.
  //
  // The listeners may be invoked in parallel, rather than serially.
  fire: function (notification) {
    var self = this;

    var collection = self._collectionForMessage(notification);

    if (!_.has(self.listenersByCollection, collection)) {
      return;
    }

    var listenersForCollection = self.listenersByCollection[collection];
    var callbackIds = [];

    _.each(listenersForCollection, function (l, id) {
      if (self._matches(notification, l.trigger)) {
        callbackIds.push(id);
      }
    }); // Listener callbacks can yield, so we need to first find all the ones that
    // match in a single iteration over self.listenersByCollection (which can't
    // be mutated during this iteration), and then invoke the matching
    // callbacks, checking before each call to ensure they haven't stopped.
    // Note that we don't have to check that
    // self.listenersByCollection[collection] still === listenersForCollection,
    // because the only way that stops being true is if listenersForCollection
    // first gets reduced down to the empty object (and then never gets
    // increased again).


    _.each(callbackIds, function (id) {
      if (_.has(listenersForCollection, id)) {
        listenersForCollection[id].callback(notification);
      }
    });
  },
  // A notification matches a trigger if all keys that exist in both are equal.
  //
  // Examples:
  //  N:{collection: "C"} matches T:{collection: "C"}
  //    (a non-targeted write to a collection matches a
  //     non-targeted query)
  //  N:{collection: "C", id: "X"} matches T:{collection: "C"}
  //    (a targeted write to a collection matches a non-targeted query)
  //  N:{collection: "C"} matches T:{collection: "C", id: "X"}
  //    (a non-targeted write to a collection matches a
  //     targeted query)
  //  N:{collection: "C", id: "X"} matches T:{collection: "C", id: "X"}
  //    (a targeted write to a collection matches a targeted query targeted
  //     at the same document)
  //  N:{collection: "C", id: "X"} does not match T:{collection: "C", id: "Y"}
  //    (a targeted write to a collection does not match a targeted query
  //     targeted at a different document)
  _matches: function (notification, trigger) {
    // Most notifications that use the crossbar have a string `collection` and
    // maybe an `id` that is a string or ObjectID. We're already dividing up
    // triggers by collection, but let's fast-track "nope, different ID" (and
    // avoid the overly generic EJSON.equals). This makes a noticeable
    // performance difference; see https://github.com/meteor/meteor/pull/3697
    if (typeof notification.id === 'string' && typeof trigger.id === 'string' && notification.id !== trigger.id) {
      return false;
    }

    if (notification.id instanceof MongoID.ObjectID && trigger.id instanceof MongoID.ObjectID && !notification.id.equals(trigger.id)) {
      return false;
    }

    return _.all(trigger, function (triggerValue, key) {
      return !_.has(notification, key) || EJSON.equals(triggerValue, notification[key]);
    });
  }
}); // The "invalidation crossbar" is a specific instance used by the DDP server to
// implement write fence notifications. Listener callbacks on this crossbar
// should call beginWrite on the current write fence before they return, if they
// want to delay the write fence from firing (ie, the DDP method-data-updated
// message from being sent).


DDPServer._InvalidationCrossbar = new DDPServer._Crossbar({
  factName: "invalidation-crossbar-listeners"
});
////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

},"server_convenience.js":function module(){

////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
//                                                                                                                    //
// packages/ddp-server/server_convenience.js                                                                          //
//                                                                                                                    //
////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
                                                                                                                      //
if (process.env.DDP_DEFAULT_CONNECTION_URL) {
  __meteor_runtime_config__.DDP_DEFAULT_CONNECTION_URL = process.env.DDP_DEFAULT_CONNECTION_URL;
}

Meteor.server = new Server();

Meteor.refresh = function (notification) {
  DDPServer._InvalidationCrossbar.fire(notification);
}; // Proxy the public methods of Meteor.server so they can
// be called directly on Meteor.


_.each(['publish', 'methods', 'call', 'apply', 'onConnection', 'onMessage'], function (name) {
  Meteor[name] = _.bind(Meteor.server[name], Meteor.server);
});
////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

}}}}},{
  "extensions": [
    ".js",
    ".json"
  ]
});

require("/node_modules/meteor/ddp-server/stream_server.js");
require("/node_modules/meteor/ddp-server/livedata_server.js");
require("/node_modules/meteor/ddp-server/writefence.js");
require("/node_modules/meteor/ddp-server/crossbar.js");
require("/node_modules/meteor/ddp-server/server_convenience.js");

/* Exports */
Package._define("ddp-server", {
  DDPServer: DDPServer
});

})();

//# sourceURL=meteor://💻app/packages/ddp-server.js
//# sourceMappingURL=data:application/json;charset=utf8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIm1ldGVvcjovL/CfkrthcHAvcGFja2FnZXMvZGRwLXNlcnZlci9zdHJlYW1fc2VydmVyLmpzIiwibWV0ZW9yOi8v8J+Su2FwcC9wYWNrYWdlcy9kZHAtc2VydmVyL2xpdmVkYXRhX3NlcnZlci5qcyIsIm1ldGVvcjovL/CfkrthcHAvcGFja2FnZXMvZGRwLXNlcnZlci93cml0ZWZlbmNlLmpzIiwibWV0ZW9yOi8v8J+Su2FwcC9wYWNrYWdlcy9kZHAtc2VydmVyL2Nyb3NzYmFyLmpzIiwibWV0ZW9yOi8v8J+Su2FwcC9wYWNrYWdlcy9kZHAtc2VydmVyL3NlcnZlcl9jb252ZW5pZW5jZS5qcyJdLCJuYW1lcyI6WyJ3ZWJzb2NrZXRFeHRlbnNpb25zIiwiXyIsIm9uY2UiLCJleHRlbnNpb25zIiwid2Vic29ja2V0Q29tcHJlc3Npb25Db25maWciLCJwcm9jZXNzIiwiZW52IiwiU0VSVkVSX1dFQlNPQ0tFVF9DT01QUkVTU0lPTiIsIkpTT04iLCJwYXJzZSIsInB1c2giLCJOcG0iLCJyZXF1aXJlIiwiY29uZmlndXJlIiwicGF0aFByZWZpeCIsIl9fbWV0ZW9yX3J1bnRpbWVfY29uZmlnX18iLCJST09UX1VSTF9QQVRIX1BSRUZJWCIsIlN0cmVhbVNlcnZlciIsInNlbGYiLCJyZWdpc3RyYXRpb25fY2FsbGJhY2tzIiwib3Blbl9zb2NrZXRzIiwicHJlZml4IiwiUm91dGVQb2xpY3kiLCJkZWNsYXJlIiwic29ja2pzIiwic2VydmVyT3B0aW9ucyIsImxvZyIsImhlYXJ0YmVhdF9kZWxheSIsImRpc2Nvbm5lY3RfZGVsYXkiLCJqc2Vzc2lvbmlkIiwiVVNFX0pTRVNTSU9OSUQiLCJESVNBQkxFX1dFQlNPQ0tFVFMiLCJ3ZWJzb2NrZXQiLCJmYXllX3NlcnZlcl9vcHRpb25zIiwic2VydmVyIiwiY3JlYXRlU2VydmVyIiwiV2ViQXBwIiwiaHR0cFNlcnZlciIsInJlbW92ZUxpc3RlbmVyIiwiX3RpbWVvdXRBZGp1c3RtZW50UmVxdWVzdENhbGxiYWNrIiwiaW5zdGFsbEhhbmRsZXJzIiwiYWRkTGlzdGVuZXIiLCJfcmVkaXJlY3RXZWJzb2NrZXRFbmRwb2ludCIsIm9uIiwic29ja2V0Iiwic2V0V2Vic29ja2V0VGltZW91dCIsInRpbWVvdXQiLCJwcm90b2NvbCIsIl9zZXNzaW9uIiwicmVjdiIsImNvbm5lY3Rpb24iLCJzZXRUaW1lb3V0Iiwic2VuZCIsImRhdGEiLCJ3cml0ZSIsIndpdGhvdXQiLCJURVNUX01FVEFEQVRBIiwic3RyaW5naWZ5IiwidGVzdE1lc3NhZ2VPbkNvbm5lY3QiLCJlYWNoIiwiY2FsbGJhY2siLCJPYmplY3QiLCJhc3NpZ24iLCJwcm90b3R5cGUiLCJyZWdpc3RlciIsImFsbF9zb2NrZXRzIiwidmFsdWVzIiwiZm9yRWFjaCIsImV2ZW50Iiwib2xkSHR0cFNlcnZlckxpc3RlbmVycyIsImxpc3RlbmVycyIsInNsaWNlIiwicmVtb3ZlQWxsTGlzdGVuZXJzIiwibmV3TGlzdGVuZXIiLCJyZXF1ZXN0IiwiYXJncyIsImFyZ3VtZW50cyIsInVybCIsInBhcnNlZFVybCIsInBhdGhuYW1lIiwiZm9ybWF0Iiwib2xkTGlzdGVuZXIiLCJhcHBseSIsIkREUFNlcnZlciIsIkZpYmVyIiwiU2Vzc2lvbkRvY3VtZW50VmlldyIsImV4aXN0c0luIiwiU2V0IiwiZGF0YUJ5S2V5IiwiTWFwIiwiX1Nlc3Npb25Eb2N1bWVudFZpZXciLCJleHRlbmQiLCJnZXRGaWVsZHMiLCJyZXQiLCJwcmVjZWRlbmNlTGlzdCIsImtleSIsInZhbHVlIiwiY2xlYXJGaWVsZCIsInN1YnNjcmlwdGlvbkhhbmRsZSIsImNoYW5nZUNvbGxlY3RvciIsImdldCIsInJlbW92ZWRWYWx1ZSIsInVuZGVmaW5lZCIsImkiLCJsZW5ndGgiLCJwcmVjZWRlbmNlIiwic3BsaWNlIiwiZGVsZXRlIiwiRUpTT04iLCJlcXVhbHMiLCJjaGFuZ2VGaWVsZCIsImlzQWRkIiwiY2xvbmUiLCJoYXMiLCJzZXQiLCJlbHQiLCJmaW5kIiwiU2Vzc2lvbkNvbGxlY3Rpb25WaWV3IiwiY29sbGVjdGlvbk5hbWUiLCJzZXNzaW9uQ2FsbGJhY2tzIiwiZG9jdW1lbnRzIiwiY2FsbGJhY2tzIiwiX1Nlc3Npb25Db2xsZWN0aW9uVmlldyIsImlzRW1wdHkiLCJzaXplIiwiZGlmZiIsInByZXZpb3VzIiwiRGlmZlNlcXVlbmNlIiwiZGlmZk1hcHMiLCJib3RoIiwiYmluZCIsImRpZmZEb2N1bWVudCIsInJpZ2h0T25seSIsImlkIiwibm93RFYiLCJhZGRlZCIsImxlZnRPbmx5IiwicHJldkRWIiwicmVtb3ZlZCIsImZpZWxkcyIsImRpZmZPYmplY3RzIiwicHJldiIsIm5vdyIsImNoYW5nZWQiLCJkb2NWaWV3IiwiYWRkIiwiY2hhbmdlZFJlc3VsdCIsIkVycm9yIiwiZXJyIiwiU2Vzc2lvbiIsInZlcnNpb24iLCJvcHRpb25zIiwiUmFuZG9tIiwiaW5pdGlhbGl6ZWQiLCJpblF1ZXVlIiwiTWV0ZW9yIiwiX0RvdWJsZUVuZGVkUXVldWUiLCJibG9ja2VkIiwid29ya2VyUnVubmluZyIsImNhY2hlZFVuYmxvY2siLCJfbmFtZWRTdWJzIiwiX3VuaXZlcnNhbFN1YnMiLCJ1c2VySWQiLCJjb2xsZWN0aW9uVmlld3MiLCJfaXNTZW5kaW5nIiwiX2RvbnRTdGFydE5ld1VuaXZlcnNhbFN1YnMiLCJfcGVuZGluZ1JlYWR5IiwiX2Nsb3NlQ2FsbGJhY2tzIiwiX3NvY2tldFVybCIsIl9yZXNwb25kVG9QaW5ncyIsInJlc3BvbmRUb1BpbmdzIiwiY29ubmVjdGlvbkhhbmRsZSIsImNsb3NlIiwib25DbG9zZSIsImZuIiwiY2IiLCJiaW5kRW52aXJvbm1lbnQiLCJkZWZlciIsImNsaWVudEFkZHJlc3MiLCJfY2xpZW50QWRkcmVzcyIsImh0dHBIZWFkZXJzIiwiaGVhZGVycyIsIm1zZyIsInNlc3Npb24iLCJzdGFydFVuaXZlcnNhbFN1YnMiLCJydW4iLCJoZWFydGJlYXRJbnRlcnZhbCIsImhlYXJ0YmVhdCIsIkREUENvbW1vbiIsIkhlYXJ0YmVhdCIsImhlYXJ0YmVhdFRpbWVvdXQiLCJvblRpbWVvdXQiLCJzZW5kUGluZyIsInN0YXJ0IiwiUGFja2FnZSIsIkZhY3RzIiwiaW5jcmVtZW50U2VydmVyRmFjdCIsInNlbmRSZWFkeSIsInN1YnNjcmlwdGlvbklkcyIsInN1YnMiLCJzdWJzY3JpcHRpb25JZCIsInNlbmRBZGRlZCIsImNvbGxlY3Rpb24iLCJzZW5kQ2hhbmdlZCIsInNlbmRSZW1vdmVkIiwiZ2V0U2VuZENhbGxiYWNrcyIsImdldENvbGxlY3Rpb25WaWV3IiwidmlldyIsImhhbmRsZXJzIiwidW5pdmVyc2FsX3B1Ymxpc2hfaGFuZGxlcnMiLCJoYW5kbGVyIiwiX3N0YXJ0U3Vic2NyaXB0aW9uIiwic3RvcCIsIl9tZXRlb3JTZXNzaW9uIiwiX2RlYWN0aXZhdGVBbGxTdWJzY3JpcHRpb25zIiwiX3JlbW92ZVNlc3Npb24iLCJfcHJpbnRTZW50RERQIiwiX2RlYnVnIiwic3RyaW5naWZ5RERQIiwic2VuZEVycm9yIiwicmVhc29uIiwib2ZmZW5kaW5nTWVzc2FnZSIsInByb2Nlc3NNZXNzYWdlIiwibXNnX2luIiwibWVzc2FnZVJlY2VpdmVkIiwicHJvY2Vzc05leHQiLCJzaGlmdCIsInVuYmxvY2siLCJvbk1lc3NhZ2VIb29rIiwicHJvdG9jb2xfaGFuZGxlcnMiLCJjYWxsIiwic3ViIiwibmFtZSIsInBhcmFtcyIsIkFycmF5IiwicHVibGlzaF9oYW5kbGVycyIsImVycm9yIiwiRERQUmF0ZUxpbWl0ZXIiLCJyYXRlTGltaXRlcklucHV0IiwidHlwZSIsImNvbm5lY3Rpb25JZCIsIl9pbmNyZW1lbnQiLCJyYXRlTGltaXRSZXN1bHQiLCJfY2hlY2siLCJhbGxvd2VkIiwiZ2V0RXJyb3JNZXNzYWdlIiwidGltZVRvUmVzZXQiLCJ1bnN1YiIsIl9zdG9wU3Vic2NyaXB0aW9uIiwibWV0aG9kIiwicmFuZG9tU2VlZCIsImZlbmNlIiwiX1dyaXRlRmVuY2UiLCJvbkFsbENvbW1pdHRlZCIsInJldGlyZSIsIm1ldGhvZHMiLCJtZXRob2RfaGFuZGxlcnMiLCJhcm0iLCJzZXRVc2VySWQiLCJfc2V0VXNlcklkIiwiaW52b2NhdGlvbiIsIk1ldGhvZEludm9jYXRpb24iLCJpc1NpbXVsYXRpb24iLCJwcm9taXNlIiwiUHJvbWlzZSIsInJlc29sdmUiLCJyZWplY3QiLCJfQ3VycmVudFdyaXRlRmVuY2UiLCJ3aXRoVmFsdWUiLCJERFAiLCJfQ3VycmVudE1ldGhvZEludm9jYXRpb24iLCJtYXliZUF1ZGl0QXJndW1lbnRDaGVja3MiLCJmaW5pc2giLCJwYXlsb2FkIiwidGhlbiIsInJlc3VsdCIsImV4Y2VwdGlvbiIsIndyYXBJbnRlcm5hbEV4Y2VwdGlvbiIsIl9lYWNoU3ViIiwiZiIsIl9kaWZmQ29sbGVjdGlvblZpZXdzIiwiYmVmb3JlQ1ZzIiwibGVmdFZhbHVlIiwicmlnaHRWYWx1ZSIsImRvYyIsIl9kZWFjdGl2YXRlIiwib2xkTmFtZWRTdWJzIiwibmV3U3ViIiwiX3JlY3JlYXRlIiwiX3J1bkhhbmRsZXIiLCJfbm9ZaWVsZHNBbGxvd2VkIiwic3ViSWQiLCJTdWJzY3JpcHRpb24iLCJ1bmJsb2NrSGFuZGVyIiwic3ViTmFtZSIsIm1heWJlU3ViIiwiX25hbWUiLCJfcmVtb3ZlQWxsRG9jdW1lbnRzIiwicmVzcG9uc2UiLCJodHRwRm9yd2FyZGVkQ291bnQiLCJwYXJzZUludCIsInJlbW90ZUFkZHJlc3MiLCJmb3J3YXJkZWRGb3IiLCJpc1N0cmluZyIsInRyaW0iLCJzcGxpdCIsIl9oYW5kbGVyIiwiX3N1YnNjcmlwdGlvbklkIiwiX3BhcmFtcyIsIl9zdWJzY3JpcHRpb25IYW5kbGUiLCJfZGVhY3RpdmF0ZWQiLCJfc3RvcENhbGxiYWNrcyIsIl9kb2N1bWVudHMiLCJfcmVhZHkiLCJfaWRGaWx0ZXIiLCJpZFN0cmluZ2lmeSIsIk1vbmdvSUQiLCJpZFBhcnNlIiwicmVzdWx0T3JUaGVuYWJsZSIsIl9DdXJyZW50UHVibGljYXRpb25JbnZvY2F0aW9uIiwiZSIsIl9pc0RlYWN0aXZhdGVkIiwiaXNUaGVuYWJsZSIsIl9wdWJsaXNoSGFuZGxlclJlc3VsdCIsInJlcyIsImlzQ3Vyc29yIiwiYyIsIl9wdWJsaXNoQ3Vyc29yIiwicmVhZHkiLCJpc0FycmF5IiwiYWxsIiwiY29sbGVjdGlvbk5hbWVzIiwiX2dldENvbGxlY3Rpb25OYW1lIiwiY3VyIiwiX2NhbGxTdG9wQ2FsbGJhY2tzIiwiY29sbGVjdGlvbkRvY3MiLCJzdHJJZCIsIm9uU3RvcCIsImlkcyIsIlNlcnZlciIsImRlZmF1bHRzIiwib25Db25uZWN0aW9uSG9vayIsIkhvb2siLCJkZWJ1Z1ByaW50RXhjZXB0aW9ucyIsInNlc3Npb25zIiwic3RyZWFtX3NlcnZlciIsInJhd19tc2ciLCJfcHJpbnRSZWNlaXZlZEREUCIsInBhcnNlRERQIiwiX2hhbmRsZUNvbm5lY3QiLCJvbkNvbm5lY3Rpb24iLCJvbk1lc3NhZ2UiLCJzdXBwb3J0IiwiY29udGFpbnMiLCJTVVBQT1JURURfRERQX1ZFUlNJT05TIiwiY2FsY3VsYXRlVmVyc2lvbiIsInB1Ymxpc2giLCJpc09iamVjdCIsImF1dG9wdWJsaXNoIiwiaXNfYXV0byIsIndhcm5lZF9hYm91dF9hdXRvcHVibGlzaCIsImZ1bmMiLCJwb3AiLCJjYWxsQXN5bmMiLCJhcHBseUFzeW5jIiwiYXdhaXQiLCJjdXJyZW50TWV0aG9kSW52b2NhdGlvbiIsImN1cnJlbnRQdWJsaWNhdGlvbkludm9jYXRpb24iLCJtYWtlUnBjU2VlZCIsIl91cmxGb3JTZXNzaW9uIiwic2Vzc2lvbklkIiwiY2xpZW50U3VwcG9ydGVkVmVyc2lvbnMiLCJzZXJ2ZXJTdXBwb3J0ZWRWZXJzaW9ucyIsImNvcnJlY3RWZXJzaW9uIiwiX2NhbGN1bGF0ZVZlcnNpb24iLCJjb250ZXh0IiwiaXNDbGllbnRTYWZlIiwib3JpZ2luYWxNZXNzYWdlIiwibWVzc2FnZSIsImRldGFpbHMiLCJfZXhwZWN0ZWRCeVRlc3QiLCJzdGFjayIsInNhbml0aXplZEVycm9yIiwiZGVzY3JpcHRpb24iLCJNYXRjaCIsIl9mYWlsSWZBcmd1bWVudHNBcmVOb3RBbGxDaGVja2VkIiwiRnV0dXJlIiwiYXJtZWQiLCJmaXJlZCIsInJldGlyZWQiLCJvdXRzdGFuZGluZ193cml0ZXMiLCJiZWZvcmVfZmlyZV9jYWxsYmFja3MiLCJjb21wbGV0aW9uX2NhbGxiYWNrcyIsIkVudmlyb25tZW50VmFyaWFibGUiLCJiZWdpbldyaXRlIiwiY29tbWl0dGVkIiwiX21heWJlRmlyZSIsIm9uQmVmb3JlRmlyZSIsImFybUFuZFdhaXQiLCJmdXR1cmUiLCJ3YWl0IiwiaW52b2tlQ2FsbGJhY2siLCJfQ3Jvc3NiYXIiLCJuZXh0SWQiLCJsaXN0ZW5lcnNCeUNvbGxlY3Rpb24iLCJsaXN0ZW5lcnNCeUNvbGxlY3Rpb25Db3VudCIsImZhY3RQYWNrYWdlIiwiZmFjdE5hbWUiLCJfY29sbGVjdGlvbkZvck1lc3NhZ2UiLCJsaXN0ZW4iLCJ0cmlnZ2VyIiwicmVjb3JkIiwiZmlyZSIsIm5vdGlmaWNhdGlvbiIsImxpc3RlbmVyc0ZvckNvbGxlY3Rpb24iLCJjYWxsYmFja0lkcyIsImwiLCJfbWF0Y2hlcyIsIk9iamVjdElEIiwidHJpZ2dlclZhbHVlIiwiX0ludmFsaWRhdGlvbkNyb3NzYmFyIiwiRERQX0RFRkFVTFRfQ09OTkVDVElPTl9VUkwiLCJyZWZyZXNoIl0sIm1hcHBpbmdzIjoiOzs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7QUFBQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0EsSUFBSUEsbUJBQW1CLEdBQUdDLENBQUMsQ0FBQ0MsSUFBRixDQUFPLFlBQVk7QUFDM0MsTUFBSUMsVUFBVSxHQUFHLEVBQWpCO0FBRUEsTUFBSUMsMEJBQTBCLEdBQUdDLE9BQU8sQ0FBQ0MsR0FBUixDQUFZQyw0QkFBWixHQUN6QkMsSUFBSSxDQUFDQyxLQUFMLENBQVdKLE9BQU8sQ0FBQ0MsR0FBUixDQUFZQyw0QkFBdkIsQ0FEeUIsR0FDOEIsRUFEL0Q7O0FBRUEsTUFBSUgsMEJBQUosRUFBZ0M7QUFDOUJELGNBQVUsQ0FBQ08sSUFBWCxDQUFnQkMsR0FBRyxDQUFDQyxPQUFKLENBQVksb0JBQVosRUFBa0ND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LmpzIiwic291cmNlc0NvbnRlbnQiOlsiLy8gQnkgZGVmYXVsdCwgd2UgdXNlIHRoZSBwZXJtZXNzYWdlLWRlZmxhdGUgZXh0ZW5zaW9uIHdpdGggZGVmYXVsdFxuLy8gY29uZmlndXJhdGlvbi4gSWYgJFNFUlZFUl9XRUJTT0NLRVRfQ09NUFJFU1NJT04gaXMgc2V0LCB0aGVuIGl0IG11c3QgYmUgdmFsaWRcbi8vIEpTT04uIElmIGl0IHJlcHJlc2VudHMgYSBmYWxzZXkgdmFsdWUsIHRoZW4gd2UgZG8gbm90IHVzZSBwZXJtZXNzYWdlLWRlZmxhdGVcbi8vIGF0IGFsbDsgb3RoZXJ3aXNlLCB0aGUgSlNPTiB2YWx1ZSBpcyB1c2VkIGFzIGFuIGFyZ3VtZW50IHRvIGRlZmxhdGUnc1xuLy8gY29uZmlndXJlIG1ldGhvZDsgc2VlXG4vLyBodHRwczovL2dpdGh1Yi5jb20vZmF5ZS9wZXJtZXNzYWdlLWRlZmxhdGUtbm9kZS9ibG9iL21hc3Rlci9SRUFETUUubWRcbi8vXG4vLyAoV2UgZG8gdGhpcyBpbiBhbiBfLm9uY2UgaW5zdGVhZCBvZiBhdCBzdGFydHVwLCBiZWNhdXNlIHdlIGRvbid0IHdhbnQgdG9cbi8vIGNyYXNoIHRoZSB0b29sIGR1cmluZyBpc29wYWNrZXQgbG9hZCBpZiB5b3VyIEpTT04gZG9lc24ndCBwYXJzZS4gVGhpcyBpcyBvbmx5XG4vLyBhIHByb2JsZW0gYmVjYXVzZSB0aGUgdG9vbCBoYXMgdG8gbG9hZCB0aGUgRERQIHNlcnZlciBjb2RlIGp1c3QgaW4gb3JkZXIgdG9cbi8vIGJlIGEgRERQIGNsaWVudDsgc2VlIGh0dHBzOi8vZ2l0aHViLmNvbS9tZXRlb3IvbWV0ZW9yL2lzc3Vlcy8zNDUyIC4pXG52YXIgd2Vic29ja2V0RXh0ZW5zaW9ucyA9IF8ub25jZShmdW5jdGlvbiAoKSB7XG4gIHZhciBleHRlbnNpb25zID0gW107XG5cbiAgdmFyIHdlYnNvY2tldENvbXByZXNzaW9uQ29uZmlnID0gcHJvY2Vzcy5lbnYuU0VSVkVSX1dFQlNPQ0tFVF9DT01QUkVTU0lPTlxuICAgICAgICA/IEpTT04ucGFyc2UocHJvY2Vzcy5lbnYuU0VSVkVSX1dFQlNPQ0tFVF9DT01QUkVTU0lPTikgOiB7fTtcbiAgaWYgKHdlYnNvY2tldENvbXByZXNzaW9uQ29uZmlnKSB7XG4gICAgZXh0ZW5zaW9ucy5wdXNoKE5wbS5yZXF1aXJlKCdwZXJtZXNzYWdlLWRlZmxhdGUnKS5jb25maWd1cmUoXG4gICAgICB3ZWJzb2NrZXRDb21wcmVzc2lvbkNvbmZpZ1xuICAgICkpO1xuICB9XG5cbiAgcmV0dXJuIGV4dGVuc2lvbnM7XG59KTtcblxudmFyIHBhdGhQcmVmaXggPSBfX21ldGVvcl9ydW50aW1lX2NvbmZpZ19fLlJPT1RfVVJMX1BBVEhfUFJFRklYIHx8ICBcIlwiO1xuXG5TdHJlYW1TZXJ2ZXIgPSBmdW5jdGlvbiAoKSB7XG4gIHZhciBzZWxmID0gdGhpcztcbiAgc2VsZi5yZWdpc3RyYXRpb25fY2FsbGJhY2tzID0gW107XG4gIHNlbGYub3Blbl9zb2NrZXRzID0gW107XG5cbiAgLy8gQmVjYXVzZSB3ZSBhcmUgaW5zdGFsbGluZyBkaXJlY3RseSBvbnRvIFdlYkFwcC5odHRwU2VydmVyIGluc3RlYWQgb2YgdXNpbmdcbiAgLy8gV2ViQXBwLmFwcCwgd2UgaGF2ZSB0byBwcm9jZXNzIHRoZSBwYXRoIHByZWZpeCBvdXJzZWx2ZXMuXG4gIHNlbGYucHJlZml4ID0gcGF0aFByZWZpeCArICcvc29ja2pzJztcbiAgUm91dGVQb2xpY3kuZGVjbGFyZShzZWxmLnByZWZpeCArICcvJywgJ25ldHdvcmsnKTtcblxuICAvLyBzZXQgdXAgc29ja2pzXG4gIHZhciBzb2NranMgPSBOcG0ucmVxdWlyZSgnc29ja2pzJyk7XG4gIHZhciBzZXJ2ZXJPcHRpb25zID0ge1xuICAgIHByZWZpeDogc2VsZi5wcmVmaXgsXG4gICAgbG9nOiBmdW5jdGlvbigpIHt9LFxuICAgIC8vIHRoaXMgaXMgdGhlIGRlZmF1bHQsIGJ1dCB3ZSBjb2RlIGl0IGV4cGxpY2l0bHkgYmVjYXVzZSB3ZSBkZXBlbmRcbiAgICAvLyBvbiBpdCBpbiBzdHJlYW1fY2xpZW50OkhFQVJUQkVBVF9USU1FT1VUXG4gICAgaGVhcnRiZWF0X2RlbGF5OiA0NTAwMCxcbiAgICAvLyBUaGUgZGVmYXVsdCBkaXNjb25uZWN0X2RlbGF5IGlzIDUgc2Vjb25kcywgYnV0IGlmIHRoZSBzZXJ2ZXIgZW5kcyB1cCBDUFVcbiAgICAvLyBib3VuZCBmb3IgdGhhdCBtdWNoIHRpbWUsIFNvY2tKUyBtaWdodCBub3Qgbm90aWNlIHRoYXQgdGhlIHVzZXIgaGFzXG4gICAgLy8gcmVjb25uZWN0ZWQgYmVjYXVzZSB0aGUgdGltZXIgKG9mIGRpc2Nvbm5lY3RfZGVsYXkgbXMpIGNhbiBmaXJlIGJlZm9yZVxuICAgIC8vIFNvY2tKUyBwcm9jZXNzZXMgdGhlIG5ldyBjb25uZWN0aW9uLiBFdmVudHVhbGx5IHdlJ2xsIGZpeCB0aGlzIGJ5IG5vdFxuICAgIC8vIGNvbWJpbmluZyBDUFUtaGVhdnkgcHJvY2Vzc2luZyB3aXRoIFNvY2tKUyB0ZXJtaW5hdGlvbiAoZWcgYSBwcm94eSB3aGljaFxuICAgIC8vIGNvbnZlcnRzIHRvIFVuaXggc29ja2V0cykgYnV0IGZvciBub3csIHJhaXNlIHRoZSBkZWxheS5cbiAgICBkaXNjb25uZWN0X2RlbGF5OiA2MCAqIDEwMDAsXG4gICAgLy8gU2V0IHRoZSBVU0VfSlNFU1NJT05JRCBlbnZpcm9ubWVudCB2YXJpYWJsZSB0byBlbmFibGUgc2V0dGluZyB0aGVcbiAgICAvLyBKU0VTU0lPTklEIGNvb2tpZS4gVGhpcyBpcyB1c2VmdWwgZm9yIHNldHRpbmcgdXAgcHJveGllcyB3aXRoXG4gICAgLy8gc2Vzc2lvbiBhZmZpbml0eS5cbiAgICBqc2Vzc2lvbmlkOiAhIXByb2Nlc3MuZW52LlVTRV9KU0VTU0lPTklEXG4gIH07XG5cbiAgLy8gSWYgeW91IGtub3cgeW91ciBzZXJ2ZXIgZW52aXJvbm1lbnQgKGVnLCBwcm94aWVzKSB3aWxsIHByZXZlbnQgd2Vic29ja2V0c1xuICAvLyBmcm9tIGV2ZXIgd29ya2luZywgc2V0ICRESVNBQkxFX1dFQlNPQ0tFVFMgYW5kIFNvY2tKUyBjbGllbnRzIChpZSxcbiAgLy8gYnJvd3NlcnMpIHdpbGwgbm90IHdhc3RlIHRpbWUgYXR0ZW1wdGluZyB0byB1c2UgdGhlbS5cbiAgLy8gKFlvdXIgc2VydmVyIHdpbGwgc3RpbGwgaGF2ZSBhIC93ZWJzb2NrZXQgZW5kcG9pbnQuKVxuICBpZiAocHJvY2Vzcy5lbnYuRElTQUJMRV9XRUJTT0NLRVRTKSB7XG4gICAgc2VydmVyT3B0aW9ucy53ZWJzb2NrZXQgPSBmYWxzZTtcbiAgfSBlbHNlIHtcbiAgICBzZXJ2ZXJPcHRpb25zLmZheWVfc2VydmVyX29wdGlvbnMgPSB7XG4gICAgICBleHRlbnNpb25zOiB3ZWJzb2NrZXRFeHRlbnNpb25zKClcbiAgICB9O1xuICB9XG5cbiAgc2VsZi5zZXJ2ZXIgPSBzb2NranMuY3JlYXRlU2VydmVyKHNlcnZlck9wdGlvbnMpO1xuXG4gIC8vIEluc3RhbGwgdGhlIHNvY2tqcyBoYW5kbGVycywgYnV0IHdlIHdhbnQgdG8ga2VlcCBhcm91bmQgb3VyIG93biBwYXJ0aWN1bGFyXG4gIC8vIHJlcXVlc3QgaGFuZGxlciB0aGF0IGFkanVzdHMgaWRsZSB0aW1lb3V0cyB3aGlsZSB3ZSBoYXZlIGFuIG91dHN0YW5kaW5nXG4gIC8vIHJlcXVlc3QuICBUaGlzIGNvbXBlbnNhdGVzIGZvciB0aGUgZmFjdCB0aGF0IHNvY2tqcyByZW1vdmVzIGFsbCBsaXN0ZW5lcnNcbiAgLy8gZm9yIFwicmVxdWVzdFwiIHRvIGFkZCBpdHMgb3duLlxuICBXZWJBcHAuaHR0cFNlcnZlci5yZW1vdmVMaXN0ZW5lcihcbiAgICAncmVxdWVzdCcsIFdlYkFwcC5fdGltZW91dEFkanVzdG1lbnRSZXF1ZXN0Q2FsbGJhY2spO1xuICBzZWxmLnNlcnZlci5pbnN0YWxsSGFuZGxlcnMoV2ViQXBwLmh0dHBTZXJ2ZXIpO1xuICBXZWJBcHAuaHR0cFNlcnZlci5hZGRMaXN0ZW5lcihcbiAgICAncmVxdWVzdCcsIFdlYkFwcC5fdGltZW91dEFkanVzdG1lbnRSZXF1ZXN0Q2FsbGJhY2spO1xuXG4gIC8vIFN1cHBvcnQgdGhlIC93ZWJzb2NrZXQgZW5kcG9pbnRcbiAgc2VsZi5fcmVkaXJlY3RXZWJzb2NrZXRFbmRwb2ludCgpO1xuXG4gIHNlbGYuc2VydmVyLm9uKCdjb25uZWN0aW9uJywgZnVuY3Rpb24gKHNvY2tldCkge1xuICAgIC8vIHNvY2tqcyBzb21ldGltZXMgcGFzc2VzIHVzIG51bGwgaW5zdGVhZCBvZiBhIHNvY2tldCBvYmplY3RcbiAgICAvLyBzbyB3ZSBuZWVkIHRvIGd1YXJkIGFnYWluc3QgdGhhdC4gc2VlOlxuICAgIC8vIGh0dHBzOi8vZ2l0aHViLmNvbS9zb2NranMvc29ja2pzLW5vZGUvaXNzdWVzLzEyMVxuICAgIC8vIGh0dHBzOi8vZ2l0aHViLmNvbS9tZXRlb3IvbWV0ZW9yL2lzc3Vlcy8xMDQ2OFxuICAgIGlmICghc29ja2V0KSByZXR1cm47XG5cbiAgICAvLyBXZSB3YW50IHRvIG1ha2Ugc3VyZSB0aGF0IGlmIGEgY2xpZW50IGNvbm5lY3RzIHRvIHVzIGFuZCBkb2VzIHRoZSBpbml0aWFsXG4gICAgLy8gV2Vic29ja2V0IGhhbmRzaGFrZSBidXQgbmV2ZXIgZ2V0cyB0byB0aGUgRERQIGhhbmRzaGFrZSwgdGhhdCB3ZVxuICAgIC8vIGV2ZW50dWFsbHkga2lsbCB0aGUgc29ja2V0LiAgT25jZSB0aGUgRERQIGhhbmRzaGFrZSBoYXBwZW5zLCBERFBcbiAgICAvLyBoZWFydGJlYXRpbmcgd2lsbCB3b3JrLiBBbmQgYmVmb3JlIHRoZSBXZWJzb2NrZXQgaGFuZHNoYWtlLCB0aGUgdGltZW91dHNcbiAgICAvLyB3ZSBzZXQgYXQgdGhlIHNlcnZlciBsZXZlbCBpbiB3ZWJhcHBfc2VydmVyLmpzIHdpbGwgd29yay4gQnV0XG4gICAgLy8gZmF5ZS13ZWJzb2NrZXQgY2FsbHMgc2V0VGltZW91dCgwKSBvbiBhbnkgc29ja2V0IGl0IHRha2VzIG92ZXIsIHNvIHRoZXJlXG4gICAgLy8gaXMgYW4gXCJpbiBiZXR3ZWVuXCIgc3RhdGUgd2hlcmUgdGhpcyBkb2Vzbid0IGhhcHBlbi4gIFdlIHdvcmsgYXJvdW5kIHRoaXNcbiAgICAvLyBieSBleHBsaWNpdGx5IHNldHRpbmcgdGhlIHNvY2tldCB0aW1lb3V0IHRvIGEgcmVsYXRpdmVseSBsYXJnZSB0aW1lIGhlcmUsXG4gICAgLy8gYW5kIHNldHRpbmcgaXQgYmFjayB0byB6ZXJvIHdoZW4gd2Ugc2V0IHVwIHRoZSBoZWFydGJlYXQgaW5cbiAgICAvLyBsaXZlZGF0YV9zZXJ2ZXIuanMuXG4gICAgc29ja2V0LnNldFdlYnNvY2tldFRpbWVvdXQgPSBmdW5jdGlvbiAodGltZW91dCkge1xuICAgICAgaWYgKChzb2NrZXQucHJvdG9jb2wgPT09ICd3ZWJzb2NrZXQnIHx8XG4gICAgICAgICAgIHNvY2tldC5wcm90b2NvbCA9PT0gJ3dlYnNvY2tldC1yYXcnKVxuICAgICAgICAgICYmIHNvY2tldC5fc2Vzc2lvbi5yZWN2KSB7XG4gICAgICAgIHNvY2tldC5fc2Vzc2lvbi5yZWN2LmNvbm5lY3Rpb24uc2V0VGltZW91dCh0aW1lb3V0KTtcbiAgICAgIH1cbiAgICB9O1xuICAgIHNvY2tldC5zZXRXZWJzb2NrZXRUaW1lb3V0KDQ1ICogMTAwMCk7XG5cbiAgICBzb2NrZXQuc2VuZCA9IGZ1bmN0aW9uIChkYXRhKSB7XG4gICAgICBzb2NrZXQud3JpdGUoZGF0YSk7XG4gICAgfTtcbiAgICBzb2NrZXQub24oJ2Nsb3NlJywgZnVuY3Rpb24gKCkge1xuICAgICAgc2VsZi5vcGVuX3NvY2tldHMgPSBfLndpdGhvdXQoc2VsZi5vcGVuX3NvY2tldHMsIHNvY2tldCk7XG4gICAgfSk7XG4gICAgc2VsZi5vcGVuX3NvY2tldHMucHVzaChzb2NrZXQpO1xuXG4gICAgLy8gb25seSB0byBzZW5kIGEgbWVzc2FnZSBhZnRlciBjb25uZWN0aW9uIG9uIHRlc3RzLCB1c2VmdWwgZm9yXG4gICAgLy8gc29ja2V0LXN0cmVhbS1jbGllbnQvc2VydmVyLXRlc3RzLmpzXG4gICAgaWYgKHByb2Nlc3MuZW52LlRFU1RfTUVUQURBVEEgJiYgcHJvY2Vzcy5lbnYuVEVTVF9NRVRBREFUQSAhPT0gXCJ7fVwiKSB7XG4gICAgICBzb2NrZXQuc2VuZChKU09OLnN0cmluZ2lmeSh7IHRlc3RNZXNzYWdlT25Db25uZWN0OiB0cnVlIH0pKTtcbiAgICB9XG5cbiAgICAvLyBjYWxsIGFsbCBvdXIgY2FsbGJhY2tzIHdoZW4gd2UgZ2V0IGEgbmV3IHNvY2tldC4gdGhleSB3aWxsIGRvIHRoZVxuICAgIC8vIHdvcmsgb2Ygc2V0dGluZyB1cCBoYW5kbGVycyBhbmQgc3VjaCBmb3Igc3BlY2lmaWMgbWVzc2FnZXMuXG4gICAgXy5lYWNoKHNlbGYucmVnaXN0cmF0aW9uX2NhbGxiYWNrcywgZnVuY3Rpb24gKGNhbGxiYWNrKSB7XG4gICAgICBjYWxsYmFjayhzb2NrZXQpO1xuICAgIH0pO1xuICB9KTtcblxufTtcblxuT2JqZWN0LmFzc2lnbihTdHJlYW1TZXJ2ZXIucHJvdG90eXBlLCB7XG4gIC8vIGNhbGwgbXkgY2FsbGJhY2sgd2hlbiBhIG5ldyBzb2NrZXQgY29ubmVjdHMuXG4gIC8vIGFsc28gY2FsbCBpdCBmb3IgYWxsIGN1cnJlbnQgY29ubmVjdGlvbnMuXG4gIHJlZ2lzdGVyOiBmdW5jdGlvbiAoY2FsbGJhY2spIHtcbiAgICB2YXIgc2VsZiA9IHRoaXM7XG4gICAgc2VsZi5yZWdpc3RyYXRpb25fY2FsbGJhY2tzLnB1c2goY2FsbGJhY2spO1xuICAgIF8uZWFjaChzZWxmLmFsbF9zb2NrZXRzKCksIGZ1bmN0aW9uIChzb2NrZXQpIHtcbiAgICAgIGNhbGxiYWNrKHNvY2tldCk7XG4gICAgfSk7XG4gIH0sXG5cbiAgLy8gZ2V0IGEgbGlzdCBvZiBhbGwgc29ja2V0c1xuICBhbGxfc29ja2V0czogZnVuY3Rpb24gKCkge1xuICAgIHZhciBzZWxmID0gdGhpcztcbiAgICByZXR1cm4gXy52YWx1ZXMoc2VsZi5vcGVuX3NvY2tldHMpO1xuICB9LFxuXG4gIC8vIFJlZGlyZWN0IC93ZWJzb2NrZXQgdG8gL3NvY2tqcy93ZWJzb2NrZXQgaW4gb3JkZXIgdG8gbm90IGV4cG9zZVxuICAvLyBzb2NranMgdG8gY2xpZW50cyB0aGF0IHdhbnQgdG8gdXNlIHJhdyB3ZWJzb2NrZXRzXG4gIF9yZWRpcmVjdFdlYnNvY2tldEVuZHBvaW50OiBmdW5jdGlvbigpIHtcbiAgICB2YXIgc2VsZiA9IHRoaXM7XG4gICAgLy8gVW5mb3J0dW5hdGVseSB3ZSBjYW4ndCB1c2UgYSBjb25uZWN0IG1pZGRsZXdhcmUgaGVyZSBzaW5jZVxuICAgIC8vIHNvY2tqcyBpbnN0YWxscyBpdHNlbGYgcHJpb3IgdG8gYWxsIGV4aXN0aW5nIGxpc3RlbmVyc1xuICAgIC8vIChtZWFuaW5nIHByaW9yIHRvIGFueSBjb25uZWN0IG1pZGRsZXdhcmVzKSBzbyB3ZSBuZWVkIHRvIHRha2VcbiAgICAvLyBhbiBhcHByb2FjaCBzaW1pbGFyIHRvIG92ZXJzaGFkb3dMaXN0ZW5lcnMgaW5cbiAgICAvLyBodHRwczovL2dpdGh1Yi5jb20vc29ja2pzL3NvY2tqcy1ub2RlL2Jsb2IvY2Y4MjBjNTVhZjZhOTk1M2UxNjU1ODU1NWEzMWRlY2VhNTU0ZjcwZS9zcmMvdXRpbHMuY29mZmVlXG4gICAgWydyZXF1ZXN0JywgJ3VwZ3JhZGUnXS5mb3JFYWNoKChldmVudCkgPT4ge1xuICAgICAgdmFyIGh0dHBTZXJ2ZXIgPSBXZWJBcHAuaHR0cFNlcnZlcjtcbiAgICAgIHZhciBvbGRIdHRwU2VydmVyTGlzdGVuZXJzID0gaHR0cFNlcnZlci5saXN0ZW5lcnMoZXZlbnQpLnNsaWNlKDApO1xuICAgICAgaHR0cFNlcnZlci5yZW1vdmVBbGxMaXN0ZW5lcnMoZXZlbnQpO1xuXG4gICAgICAvLyByZXF1ZXN0IGFuZCB1cGdyYWRlIGhhdmUgZGlmZmVyZW50IGFyZ3VtZW50cyBwYXNzZWQgYnV0XG4gICAgICAvLyB3ZSBvbmx5IGNhcmUgYWJvdXQgdGhlIGZpcnN0IG9uZSB3aGljaCBpcyBhbHdheXMgcmVxdWVzdFxuICAgICAgdmFyIG5ld0xpc3RlbmVyID0gZnVuY3Rpb24ocmVxdWVzdCAvKiwgbW9yZUFyZ3VtZW50cyAqLykge1xuICAgICAgICAvLyBTdG9yZSBhcmd1bWVudHMgZm9yIHVzZSB3aXRoaW4gdGhlIGNsb3N1cmUgYmVsb3dcbiAgICAgICAgdmFyIGFyZ3MgPSBhcmd1bWVudHM7XG5cbiAgICAgICAgLy8gVE9ETyByZXBsYWNlIHdpdGggdXJsIHBhY2thZ2VcbiAgICAgICAgdmFyIHVybCA9IE5wbS5yZXF1aXJlKCd1cmwnKTtcblxuICAgICAgICAvLyBSZXdyaXRlIC93ZWJzb2NrZXQgYW5kIC93ZWJzb2NrZXQvIHVybHMgdG8gL3NvY2tqcy93ZWJzb2NrZXQgd2hpbGVcbiAgICAgICAgLy8gcHJlc2VydmluZyBxdWVyeSBzdHJpbmcuXG4gICAgICAgIHZhciBwYXJzZWRVcmwgPSB1cmwucGFyc2UocmVxdWVzdC51cmwpO1xuICAgICAgICBpZiAocGFyc2VkVXJsLnBhdGhuYW1lID09PSBwYXRoUHJlZml4ICsgJy93ZWJzb2NrZXQnIHx8XG4gICAgICAgICAgICBwYXJzZWRVcmwucGF0aG5hbWUgPT09IHBhdGhQcmVmaXggKyAnL3dlYnNvY2tldC8nKSB7XG4gICAgICAgICAgcGFyc2VkVXJsLnBhdGhuYW1lID0gc2VsZi5wcmVmaXggKyAnL3dlYnNvY2tldCc7XG4gICAgICAgICAgcmVxdWVzdC51cmwgPSB1cmwuZm9ybWF0KHBhcnNlZFVybCk7XG4gICAgICAgIH1cbiAgICAgICAgXy5lYWNoKG9sZEh0dHBTZXJ2ZXJMaXN0ZW5lcnMsIGZ1bmN0aW9uKG9sZExpc3RlbmVyKSB7XG4gICAgICAgICAgb2xkTGlzdGVuZXIuYXBwbHkoaHR0cFNlcnZlciwgYXJncyk7XG4gICAgICAgIH0pO1xuICAgICAgfTtcbiAgICAgIGh0dHBTZXJ2ZXIuYWRkTGlzdGVuZXIoZXZlbnQsIG5ld0xpc3RlbmVyKTtcbiAgICB9KTtcbiAgfVxufSk7XG4iLCJERFBTZXJ2ZXIgPSB7fTtcblxudmFyIEZpYmVyID0gTnBtLnJlcXVpcmUoJ2ZpYmVycycpO1xuXG4vLyBUaGlzIGZpbGUgY29udGFpbnMgY2xhc3Nlczpcbi8vICogU2Vzc2lvbiAtIFRoZSBzZXJ2ZXIncyBjb25uZWN0aW9uIHRvIGEgc2luZ2xlIEREUCBjbGllbnRcbi8vICogU3Vic2NyaXB0aW9uIC0gQSBzaW5nbGUgc3Vic2NyaXB0aW9uIGZvciBhIHNpbmdsZSBjbGllbnRcbi8vICogU2VydmVyIC0gQW4gZW50aXJlIHNlcnZlciB0aGF0IG1heSB0YWxrIHRvID4gMSBjbGllbnQuIEEgRERQIGVuZHBvaW50LlxuLy9cbi8vIFNlc3Npb24gYW5kIFN1YnNjcmlwdGlvbiBhcmUgZmlsZSBzY29wZS4gRm9yIG5vdywgdW50aWwgd2UgZnJlZXplXG4vLyB0aGUgaW50ZXJmYWNlLCBTZXJ2ZXIgaXMgcGFja2FnZSBzY29wZSAoaW4gdGhlIGZ1dHVyZSBpdCBzaG91bGQgYmVcbi8vIGV4cG9ydGVkLilcblxuLy8gUmVwcmVzZW50cyBhIHNpbmdsZSBkb2N1bWVudCBpbiBhIFNlc3Npb25Db2xsZWN0aW9uVmlld1xudmFyIFNlc3Npb25Eb2N1bWVudFZpZXcgPSBmdW5jdGlvbiAoKSB7XG4gIHZhciBzZWxmID0gdGhpcztcbiAgc2VsZi5leGlzdHNJbiA9IG5ldyBTZXQoKTsgLy8gc2V0IG9mIHN1YnNjcmlwdGlvbkhhbmRsZVxuICBzZWxmLmRhdGFCeUtleSA9IG5ldyBNYXAoKTsgLy8ga2V5LT4gWyB7c3Vic2NyaXB0aW9uSGFuZGxlLCB2YWx1ZX0gYnkgcHJlY2VkZW5jZV1cbn07XG5cbkREUFNlcnZlci5fU2Vzc2lvbkRvY3VtZW50VmlldyA9IFNlc3Npb25Eb2N1bWVudFZpZXc7XG5cblxuXy5leHRlbmQoU2Vzc2lvbkRvY3VtZW50Vmlldy5wcm90b3R5cGUsIHtcblxuICBnZXRGaWVsZHM6IGZ1bmN0aW9uICgpIHtcbiAgICB2YXIgc2VsZiA9IHRoaXM7XG4gICAgdmFyIHJldCA9IHt9O1xuICAgIHNlbGYuZGF0YUJ5S2V5LmZvckVhY2goZnVuY3Rpb24gKHByZWNlZGVuY2VMaXN0LCBrZXkpIHtcbiAgICAgIHJldFtrZXldID0gcHJlY2VkZW5jZUxpc3RbMF0udmFsdWU7XG4gICAgfSk7XG4gICAgcmV0dXJuIHJldDtcbiAgfSxcblxuICBjbGVhckZpZWxkOiBmdW5jdGlvbiAoc3Vic2NyaXB0aW9uSGFuZGxlLCBrZXksIGNoYW5nZUNvbGxlY3Rvcikge1xuICAgIHZhciBzZWxmID0gdGhpcztcbiAgICAvLyBQdWJsaXNoIEFQSSBpZ25vcmVzIF9pZCBpZiBwcmVzZW50IGluIGZpZWxkc1xuICAgIGlmIChrZXkgPT09IFwiX2lkXCIpXG4gICAgICByZXR1cm47XG4gICAgdmFyIHByZWNlZGVuY2VMaXN0ID0gc2VsZi5kYXRhQnlLZXkuZ2V0KGtleSk7XG5cbiAgICAvLyBJdCdzIG9rYXkgdG8gY2xlYXIgZmllbGRzIHRoYXQgZGlkbid0IGV4aXN0LiBObyBuZWVkIHRvIHRocm93XG4gICAgLy8gYW4gZXJyb3IuXG4gICAgaWYgKCFwcmVjZWRlbmNlTGlzdClcbiAgICAgIHJldHVybjtcblxuICAgIHZhciByZW1vdmVkVmFsdWUgPSB1bmRlZmluZWQ7XG4gICAgZm9yICh2YXIgaSA9IDA7IGkgPCBwcmVjZWRlbmNlTGlzdC5sZW5ndGg7IGkrKykge1xuICAgICAgdmFyIHByZWNlZGVuY2UgPSBwcmVjZWRlbmNlTGlzdFtpXTtcbiAgICAgIGlmIChwcmVjZWRlbmNlLnN1YnNjcmlwdGlvbkhhbmRsZSA9PT0gc3Vic2NyaXB0aW9uSGFuZGxlKSB7XG4gICAgICAgIC8vIFRoZSB2aWV3J3MgdmFsdWUgY2FuIG9ubHkgY2hhbmdlIGlmIHRoaXMgc3Vic2NyaXB0aW9uIGlzIHRoZSBvbmUgdGhhdFxuICAgICAgICAvLyB1c2VkIHRvIGhhdmUgcHJlY2VkZW5jZS5cbiAgICAgICAgaWYgKGkgPT09IDApXG4gICAgICAgICAgcmVtb3ZlZFZhbHVlID0gcHJlY2VkZW5jZS52YWx1ZTtcbiAgICAgICAgcHJlY2VkZW5jZUxpc3Quc3BsaWNlKGksIDEpO1xuICAgICAgICBicmVhaztcbiAgICAgIH1cbiAgICB9XG4gICAgaWYgKHByZWNlZGVuY2VMaXN0Lmxlbmd0aCA9PT0gMCkge1xuICAgICAgc2VsZi5kYXRhQnlLZXkuZGVsZXRlKGtleSk7XG4gICAgICBjaGFuZ2VDb2xsZWN0b3Jba2V5XSA9IHVuZGVmaW5lZDtcbiAgICB9IGVsc2UgaWYgKHJlbW92ZWRWYWx1ZSAhPT0gdW5kZWZpbmVkICYmXG4gICAgICAgICAgICAgICAhRUpTT04uZXF1YWxzKHJlbW92ZWRWYWx1ZSwgcHJlY2VkZW5jZUxpc3RbMF0udmFsdWUpKSB7XG4gICAgICBjaGFuZ2VDb2xsZWN0b3Jba2V5XSA9IHByZWNlZGVuY2VMaXN0WzBdLnZhbHVlO1xuICAgIH1cbiAgfSxcblxuICBjaGFuZ2VGaWVsZDogZnVuY3Rpb24gKHN1YnNjcmlwdGlvbkhhbmRsZSwga2V5LCB2YWx1ZSxcbiAgICAgICAgICAgICAgICAgICAgICAgICBjaGFuZ2VDb2xsZWN0b3IsIGlzQWRkKSB7XG4gICAgdmFyIHNlbGYgPSB0aGlzO1xuICAgIC8vIFB1Ymxpc2ggQVBJIGlnbm9yZXMgX2lkIGlmIHByZXNlbnQgaW4gZmllbGRzXG4gICAgaWYgKGtleSA9PT0gXCJfaWRcIilcbiAgICAgIHJldHVybjtcblxuICAgIC8vIERvbid0IHNoYXJlIHN0YXRlIHdpdGggdGhlIGRhdGEgcGFzc2VkIGluIGJ5IHRoZSB1c2VyLlxuICAgIHZhbHVlID0gRUpTT04uY2xvbmUodmFsdWUpO1xuXG4gICAgaWYgKCFzZWxmLmRhdGFCeUtleS5oYXMoa2V5KSkge1xuICAgICAgc2VsZi5kYXRhQnlLZXkuc2V0KGtleSwgW3tzdWJzY3JpcHRpb25IYW5kbGU6IHN1YnNjcmlwdGlvbkhhbmRsZSxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgdmFsdWU6IHZhbHVlfV0pO1xuICAgICAgY2hhbmdlQ29sbGVjdG9yW2tleV0gPSB2YWx1ZTtcbiAgICAgIHJldHVybjtcbiAgICB9XG4gICAgdmFyIHByZWNlZGVuY2VMaXN0ID0gc2VsZi5kYXRhQnlLZXkuZ2V0KGtleSk7XG4gICAgdmFyIGVsdDtcbiAgICBpZiAoIWlzQWRkKSB7XG4gICAgICBlbHQgPSBwcmVjZWRlbmNlTGlzdC5maW5kKGZ1bmN0aW9uIChwcmVjZWRlbmNlKSB7XG4gICAgICAgICAgcmV0dXJuIHByZWNlZGVuY2Uuc3Vic2NyaXB0aW9uSGFuZGxlID09PSBzdWJzY3JpcHRpb25IYW5kbGU7XG4gICAgICB9KTtcbiAgICB9XG5cbiAgICBpZiAoZWx0KSB7XG4gICAgICBpZiAoZWx0ID09PSBwcmVjZWRlbmNlTGlzdFswXSAmJiAhRUpTT04uZXF1YWxzKHZhbHVlLCBlbHQudmFsdWUpKSB7XG4gICAgICAgIC8vIHRoaXMgc3Vic2NyaXB0aW9uIGlzIGNoYW5naW5nIHRoZSB2YWx1ZSBvZiB0aGlzIGZpZWxkLlxuICAgICAgICBjaGFuZ2VDb2xsZWN0b3Jba2V5XSA9IHZhbHVlO1xuICAgICAgfVxuICAgICAgZWx0LnZhbHVlID0gdmFsdWU7XG4gICAgfSBlbHNlIHtcbiAgICAgIC8vIHRoaXMgc3Vic2NyaXB0aW9uIGlzIG5ld2x5IGNhcmluZyBhYm91dCB0aGlzIGZpZWxkXG4gICAgICBwcmVjZWRlbmNlTGlzdC5wdXNoKHtzdWJzY3JpcHRpb25IYW5kbGU6IHN1YnNjcmlwdGlvbkhhbmRsZSwgdmFsdWU6IHZhbHVlfSk7XG4gICAgfVxuXG4gIH1cbn0pO1xuXG4vKipcbiAqIFJlcHJlc2VudHMgYSBjbGllbnQncyB2aWV3IG9mIGEgc2luZ2xlIGNvbGxlY3Rpb25cbiAqIEBwYXJhbSB7U3RyaW5nfSBjb2xsZWN0aW9uTmFtZSBOYW1lIG9mIHRoZSBjb2xsZWN0aW9uIGl0IHJlcHJlc2VudHNcbiAqIEBwYXJhbSB7T2JqZWN0LjxTdHJpbmcsIEZ1bmN0aW9uPn0gc2Vzc2lvbkNhbGxiYWNrcyBUaGUgY2FsbGJhY2tzIGZvciBhZGRlZCwgY2hhbmdlZCwgcmVtb3ZlZFxuICogQGNsYXNzIFNlc3Npb25Db2xsZWN0aW9uVmlld1xuICovXG52YXIgU2Vzc2lvbkNvbGxlY3Rpb25WaWV3ID0gZnVuY3Rpb24gKGNvbGxlY3Rpb25OYW1lLCBzZXNzaW9uQ2FsbGJhY2tzKSB7XG4gIHZhciBzZWxmID0gdGhpcztcbiAgc2VsZi5jb2xsZWN0aW9uTmFtZSA9IGNvbGxlY3Rpb25OYW1lO1xuICBzZWxmLmRvY3VtZW50cyA9IG5ldyBNYXAoKTtcbiAgc2VsZi5jYWxsYmFja3MgPSBzZXNzaW9uQ2FsbGJhY2tzO1xufTtcblxuRERQU2VydmVyLl9TZXNzaW9uQ29sbGVjdGlvblZpZXcgPSBTZXNzaW9uQ29sbGVjdGlvblZpZXc7XG5cblxuT2JqZWN0LmFzc2lnbihTZXNzaW9uQ29sbGVjdGlvblZpZXcucHJvdG90eXBlLCB7XG5cbiAgaXNFbXB0eTogZnVuY3Rpb24gKCkge1xuICAgIHZhciBzZWxmID0gdGhpcztcbiAgICByZXR1cm4gc2VsZi5kb2N1bWVudHMuc2l6ZSA9PT0gMDtcbiAgfSxcblxuICBkaWZmOiBmdW5jdGlvbiAocHJldmlvdXMpIHtcbiAgICB2YXIgc2VsZiA9IHRoaXM7XG4gICAgRGlmZlNlcXVlbmNlLmRpZmZNYXBzKHByZXZpb3VzLmRvY3VtZW50cywgc2VsZi5kb2N1bWVudHMsIHtcbiAgICAgIGJvdGg6IF8uYmluZChzZWxmLmRpZmZEb2N1bWVudCwgc2VsZiksXG5cbiAgICAgIHJpZ2h0T25seTogZnVuY3Rpb24gKGlkLCBub3dEVikge1xuICAgICAgICBzZWxmLmNhbGxiYWNrcy5hZGRlZChzZWxmLmNvbGxlY3Rpb25OYW1lLCBpZCwgbm93RFYuZ2V0RmllbGRzKCkpO1xuICAgICAgfSxcblxuICAgICAgbGVmdE9ubHk6IGZ1bmN0aW9uIChpZCwgcHJldkRWKSB7XG4gICAgICAgIHNlbGYuY2FsbGJhY2tzLnJlbW92ZWQoc2VsZi5jb2xsZWN0aW9uTmFtZSwgaWQpO1xuICAgICAgfVxuICAgIH0pO1xuICB9LFxuXG4gIGRpZmZEb2N1bWVudDogZnVuY3Rpb24gKGlkLCBwcmV2RFYsIG5vd0RWKSB7XG4gICAgdmFyIHNlbGYgPSB0aGlzO1xuICAgIHZhciBmaWVsZHMgPSB7fTtcbiAgICBEaWZmU2VxdWVuY2UuZGlmZk9iamVjdHMocHJldkRWLmdldEZpZWxkcygpLCBub3dEVi5nZXRGaWVsZHMoKSwge1xuICAgICAgYm90aDogZnVuY3Rpb24gKGtleSwgcHJldiwgbm93KSB7XG4gICAgICAgIGlmICghRUpTT04uZXF1YWxzKHByZXYsIG5vdykpXG4gICAgICAgICAgZmllbGRzW2tleV0gPSBub3c7XG4gICAgICB9LFxuICAgICAgcmlnaHRPbmx5OiBmdW5jdGlvbiAoa2V5LCBub3cpIHtcbiAgICAgICAgZmllbGRzW2tleV0gPSBub3c7XG4gICAgICB9LFxuICAgICAgbGVmdE9ubHk6IGZ1bmN0aW9uKGtleSwgcHJldikge1xuICAgICAgICBmaWVsZHNba2V5XSA9IHVuZGVmaW5lZDtcbiAgICAgIH1cbiAgICB9KTtcbiAgICBzZWxmLmNhbGxiYWNrcy5jaGFuZ2VkKHNlbGYuY29sbGVjdGlvbk5hbWUsIGlkLCBmaWVsZHMpO1xuICB9LFxuXG4gIGFkZGVkOiBmdW5jdGlvbiAoc3Vic2NyaXB0aW9uSGFuZGxlLCBpZCwgZmllbGRzKSB7XG4gICAgdmFyIHNlbGYgPSB0aGlzO1xuICAgIHZhciBkb2NWaWV3ID0gc2VsZi5kb2N1bWVudHMuZ2V0KGlkKTtcbiAgICB2YXIgYWRkZWQgPSBmYWxzZTtcbiAgICBpZiAoIWRvY1ZpZXcpIHtcbiAgICAgIGFkZGVkID0gdHJ1ZTtcbiAgICAgIGRvY1ZpZXcgPSBuZXcgU2Vzc2lvbkRvY3VtZW50VmlldygpO1xuICAgICAgc2VsZi5kb2N1bWVudHMuc2V0KGlkLCBkb2NWaWV3KTtcbiAgICB9XG4gICAgZG9jVmlldy5leGlzdHNJbi5hZGQoc3Vic2NyaXB0aW9uSGFuZGxlKTtcbiAgICB2YXIgY2hhbmdlQ29sbGVjdG9yID0ge307XG4gICAgXy5lYWNoKGZpZWxkcywgZnVuY3Rpb24gKHZhbHVlLCBrZXkpIHtcbiAgICAgIGRvY1ZpZXcuY2hhbmdlRmllbGQoXG4gICAgICAgIHN1YnNjcmlwdGlvbkhhbmRsZSwga2V5LCB2YWx1ZSwgY2hhbmdlQ29sbGVjdG9yLCB0cnVlKTtcbiAgICB9KTtcbiAgICBpZiAoYWRkZWQpXG4gICAgICBzZWxmLmNhbGxiYWNrcy5hZGRlZChzZWxmLmNvbGxlY3Rpb25OYW1lLCBpZCwgY2hhbmdlQ29sbGVjdG9yKTtcbiAgICBlbHNlXG4gICAgICBzZWxmLmNhbGxiYWNrcy5jaGFuZ2VkKHNlbGYuY29sbGVjdGlvbk5hbWUsIGlkLCBjaGFuZ2VDb2xsZWN0b3IpO1xuICB9LFxuXG4gIGNoYW5nZWQ6IGZ1bmN0aW9uIChzdWJzY3JpcHRpb25IYW5kbGUsIGlkLCBjaGFuZ2VkKSB7XG4gICAgdmFyIHNlbGYgPSB0aGlzO1xuICAgIHZhciBjaGFuZ2VkUmVzdWx0ID0ge307XG4gICAgdmFyIGRvY1ZpZXcgPSBzZWxmLmRvY3VtZW50cy5nZXQoaWQpO1xuICAgIGlmICghZG9jVmlldylcbiAgICAgIHRocm93IG5ldyBFcnJvcihcIkNvdWxkIG5vdCBmaW5kIGVsZW1lbnQgd2l0aCBpZCBcIiArIGlkICsgXCIgdG8gY2hhbmdlXCIpO1xuICAgIF8uZWFjaChjaGFuZ2VkLCBmdW5jdGlvbiAodmFsdWUsIGtleSkge1xuICAgICAgaWYgKHZhbHVlID09PSB1bmRlZmluZWQpXG4gICAgICAgIGRvY1ZpZXcuY2xlYXJGaWVsZChzdWJzY3JpcHRpb25IYW5kbGUsIGtleSwgY2hhbmdlZFJlc3VsdCk7XG4gICAgICBlbHNlXG4gICAgICAgIGRvY1ZpZXcuY2hhbmdlRmllbGQoc3Vic2NyaXB0aW9uSGFuZGxlLCBrZXksIHZhbHVlLCBjaGFuZ2VkUmVzdWx0KTtcbiAgICB9KTtcbiAgICBzZWxmLmNhbGxiYWNrcy5jaGFuZ2VkKHNlbGYuY29sbGVjdGlvbk5hbWUsIGlkLCBjaGFuZ2VkUmVzdWx0KTtcbiAgfSxcblxuICByZW1vdmVkOiBmdW5jdGlvbiAoc3Vic2NyaXB0aW9uSGFuZGxlLCBpZCkge1xuICAgIHZhciBzZWxmID0gdGhpcztcbiAgICB2YXIgZG9jVmlldyA9IHNlbGYuZG9jdW1lbnRzLmdldChpZCk7XG4gICAgaWYgKCFkb2NWaWV3KSB7XG4gICAgICB2YXIgZXJyID0gbmV3IEVycm9yKFwiUmVtb3ZlZCBub25leGlzdGVudCBkb2N1bWVudCBcIiArIGlkKTtcbiAgICAgIHRocm93IGVycjtcbiAgICB9XG4gICAgZG9jVmlldy5leGlzdHNJbi5kZWxldGUoc3Vic2NyaXB0aW9uSGFuZGxlKTtcbiAgICBpZiAoZG9jVmlldy5leGlzdHNJbi5zaXplID09PSAwKSB7XG4gICAgICAvLyBpdCBpcyBnb25lIGZyb20gZXZlcnlvbmVcbiAgICAgIHNlbGYuY2FsbGJhY2tzLnJlbW92ZWQoc2VsZi5jb2xsZWN0aW9uTmFtZSwgaWQpO1xuICAgICAgc2VsZi5kb2N1bWVudHMuZGVsZXRlKGlkKTtcbiAgICB9IGVsc2Uge1xuICAgICAgdmFyIGNoYW5nZWQgPSB7fTtcbiAgICAgIC8vIHJlbW92ZSB0aGlzIHN1YnNjcmlwdGlvbiBmcm9tIGV2ZXJ5IHByZWNlZGVuY2UgbGlzdFxuICAgICAgLy8gYW5kIHJlY29yZCB0aGUgY2hhbmdlc1xuICAgICAgZG9jVmlldy5kYXRhQnlLZXkuZm9yRWFjaChmdW5jdGlvbiAocHJlY2VkZW5jZUxpc3QsIGtleSkge1xuICAgICAgICBkb2NWaWV3LmNsZWFyRmllbGQoc3Vic2NyaXB0aW9uSGFuZGxlLCBrZXksIGNoYW5nZWQpO1xuICAgICAgfSk7XG5cbiAgICAgIHNlbGYuY2FsbGJhY2tzLmNoYW5nZWQoc2VsZi5jb2xsZWN0aW9uTmFtZSwgaWQsIGNoYW5nZWQpO1xuICAgIH1cbiAgfVxufSk7XG5cbi8qKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKiovXG4vKiBTZXNzaW9uICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAqL1xuLyoqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKi9cblxudmFyIFNlc3Npb24gPSBmdW5jdGlvbiAoc2VydmVyLCB2ZXJzaW9uLCBzb2NrZXQsIG9wdGlvbnMpIHtcbiAgdmFyIHNlbGYgPSB0aGlzO1xuICBzZWxmLmlkID0gUmFuZG9tLmlkKCk7XG5cbiAgc2VsZi5zZXJ2ZXIgPSBzZXJ2ZXI7XG4gIHNlbGYudmVyc2lvbiA9IHZlcnNpb247XG5cbiAgc2VsZi5pbml0aWFsaXplZCA9IGZhbHNlO1xuICBzZWxmLnNvY2tldCA9IHNvY2tldDtcblxuICAvLyBzZXQgdG8gbnVsbCB3aGVuIHRoZSBzZXNzaW9uIGlzIGRlc3Ryb3llZC4gbXVsdGlwbGUgcGxhY2VzIGJlbG93XG4gIC8vIHVzZSB0aGlzIHRvIGRldGVybWluZSBpZiB0aGUgc2Vzc2lvbiBpcyBhbGl2ZSBvciBub3QuXG4gIHNlbGYuaW5RdWV1ZSA9IG5ldyBNZXRlb3IuX0RvdWJsZUVuZGVkUXVldWUoKTtcblxuICBzZWxmLmJsb2NrZWQgPSBmYWxzZTtcbiAgc2VsZi53b3JrZXJSdW5uaW5nID0gZmFsc2U7XG5cbiAgc2VsZi5jYWNoZWRVbmJsb2NrID0gbnVsbDtcblxuICAvLyBTdWIgb2JqZWN0cyBmb3IgYWN0aXZlIHN1YnNjcmlwdGlvbnNcbiAgc2VsZi5fbmFtZWRTdWJzID0gbmV3IE1hcCgpO1xuICBzZWxmLl91bml2ZXJzYWxTdWJzID0gW107XG5cbiAgc2VsZi51c2VySWQgPSBudWxsO1xuXG4gIHNlbGYuY29sbGVjdGlvblZpZXdzID0gbmV3IE1hcCgpO1xuXG4gIC8vIFNldCB0aGlzIHRvIGZhbHNlIHRvIG5vdCBzZW5kIG1lc3NhZ2VzIHdoZW4gY29sbGVjdGlvblZpZXdzIGFyZVxuICAvLyBtb2RpZmllZC4gVGhpcyBpcyBkb25lIHdoZW4gcmVydW5uaW5nIHN1YnMgaW4gX3NldFVzZXJJZCBhbmQgdGhvc2UgbWVzc2FnZXNcbiAgLy8gYXJlIGNhbGN1bGF0ZWQgdmlhIGEgZGlmZiBpbnN0ZWFkLlxuICBzZWxmLl9pc1NlbmRpbmcgPSB0cnVlO1xuXG4gIC8vIElmIHRoaXMgaXMgdHJ1ZSwgZG9uJ3Qgc3RhcnQgYSBuZXdseS1jcmVhdGVkIHVuaXZlcnNhbCBwdWJsaXNoZXIgb24gdGhpc1xuICAvLyBzZXNzaW9uLiBUaGUgc2Vzc2lvbiB3aWxsIHRha2UgY2FyZSBvZiBzdGFydGluZyBpdCB3aGVuIGFwcHJvcHJpYXRlLlxuICBzZWxmLl9kb250U3RhcnROZXdVbml2ZXJzYWxTdWJzID0gZmFsc2U7XG5cbiAgLy8gd2hlbiB3ZSBhcmUgcmVydW5uaW5nIHN1YnNjcmlwdGlvbnMsIGFueSByZWFkeSBtZXNzYWdlc1xuICAvLyB3ZSB3YW50IHRvIGJ1ZmZlciB1cCBmb3Igd2hlbiB3ZSBhcmUgZG9uZSByZXJ1bm5pbmcgc3Vic2NyaXB0aW9uc1xuICBzZWxmLl9wZW5kaW5nUmVhZHkgPSBbXTtcblxuICAvLyBMaXN0IG9mIGNhbGxiYWNrcyB0byBjYWxsIHdoZW4gdGhpcyBjb25uZWN0aW9uIGlzIGNsb3NlZC5cbiAgc2VsZi5fY2xvc2VDYWxsYmFja3MgPSBbXTtcblxuXG4gIC8vIFhYWCBIQUNLOiBJZiBhIHNvY2tqcyBjb25uZWN0aW9uLCBzYXZlIG9mZiB0aGUgVVJMLiBUaGlzIGlzXG4gIC8vIHRlbXBvcmFyeSBhbmQgd2lsbCBnbyBhd2F5IGluIHRoZSBuZWFyIGZ1dHVyZS5cbiAgc2VsZi5fc29ja2V0VXJsID0gc29ja2V0LnVybDtcblxuICAvLyBBbGxvdyB0ZXN0cyB0byBkaXNhYmxlIHJlc3BvbmRpbmcgdG8gcGluZ3MuXG4gIHNlbGYuX3Jlc3BvbmRUb1BpbmdzID0gb3B0aW9ucy5yZXNwb25kVG9QaW5ncztcblxuICAvLyBUaGlzIG9iamVjdCBpcyB0aGUgcHVibGljIGludGVyZmFjZSB0byB0aGUgc2Vzc2lvbi4gSW4gdGhlIHB1YmxpY1xuICAvLyBBUEksIGl0IGlzIGNhbGxlZCB0aGUgYGNvbm5lY3Rpb25gIG9iamVjdC4gIEludGVybmFsbHkgd2UgY2FsbCBpdFxuICAvLyBhIGBjb25uZWN0aW9uSGFuZGxlYCB0byBhdm9pZCBhbWJpZ3VpdHkuXG4gIHNlbGYuY29ubmVjdGlvbkhhbmRsZSA9IHtcbiAgICBpZDogc2VsZi5pZCxcbiAgICBjbG9zZTogZnVuY3Rpb24gKCkge1xuICAgICAgc2VsZi5jbG9zZSgpO1xuICAgIH0sXG4gICAgb25DbG9zZTogZnVuY3Rpb24gKGZuKSB7XG4gICAgICB2YXIgY2IgPSBNZXRlb3IuYmluZEVudmlyb25tZW50KGZuLCBcImNvbm5lY3Rpb24gb25DbG9zZSBjYWxsYmFja1wiKTtcbiAgICAgIGlmIChzZWxmLmluUXVldWUpIHtcbiAgICAgICAgc2VsZi5fY2xvc2VDYWxsYmFja3MucHVzaChjYik7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICAvLyBpZiB3ZSdyZSBhbHJlYWR5IGNsb3NlZCwgY2FsbCB0aGUgY2FsbGJhY2suXG4gICAgICAgIE1ldGVvci5kZWZlcihjYik7XG4gICAgICB9XG4gICAgfSxcbiAgICBjbGllbnRBZGRyZXNzOiBzZWxmLl9jbGllbnRBZGRyZXNzKCksXG4gICAgaHR0cEhlYWRlcnM6IHNlbGYuc29ja2V0LmhlYWRlcnNcbiAgfTtcblxuICBzZWxmLnNlbmQoeyBtc2c6ICdjb25uZWN0ZWQnLCBzZXNzaW9uOiBzZWxmLmlkIH0pO1xuXG4gIC8vIE9uIGluaXRpYWwgY29ubmVjdCwgc3BpbiB1cCBhbGwgdGhlIHVuaXZlcnNhbCBwdWJsaXNoZXJzLlxuICBGaWJlcihmdW5jdGlvbiAoKSB7XG4gICAgc2VsZi5zdGFydFVuaXZlcnNhbFN1YnMoKTtcbiAgfSkucnVuKCk7XG5cbiAgaWYgKHZlcnNpb24gIT09ICdwcmUxJyAmJiBvcHRpb25zLmhlYXJ0YmVhdEludGVydmFsICE9PSAwKSB7XG4gICAgLy8gV2Ugbm8gbG9uZ2VyIG5lZWQgdGhlIGxvdyBsZXZlbCB0aW1lb3V0IGJlY2F1c2Ugd2UgaGF2ZSBoZWFydGJlYXRpbmcuXG4gICAgc29ja2V0LnNldFdlYnNvY2tldFRpbWVvdXQoMCk7XG5cbiAgICBzZWxmLmhlYXJ0YmVhdCA9IG5ldyBERFBDb21tb24uSGVhcnRiZWF0KHtcbiAgICAgIGhlYXJ0YmVhdEludGVydmFsOiBvcHRpb25zLmhlYXJ0YmVhdEludGVydmFsLFxuICAgICAgaGVhcnRiZWF0VGltZW91dDogb3B0aW9ucy5oZWFydGJlYXRUaW1lb3V0LFxuICAgICAgb25UaW1lb3V0OiBmdW5jdGlvbiAoKSB7XG4gICAgICAgIHNlbGYuY2xvc2UoKTtcbiAgICAgIH0sXG4gICAgICBzZW5kUGluZzogZnVuY3Rpb24gKCkge1xuICAgICAgICBzZWxmLnNlbmQoe21zZzogJ3BpbmcnfSk7XG4gICAgICB9XG4gICAgfSk7XG4gICAgc2VsZi5oZWFydGJlYXQuc3RhcnQoKTtcbiAgfVxuXG4gIFBhY2thZ2VbJ2ZhY3RzLWJhc2UnXSAmJiBQYWNrYWdlWydmYWN0cy1iYXNlJ10uRmFjdHMuaW5jcmVtZW50U2VydmVyRmFjdChcbiAgICBcImxpdmVkYXRhXCIsIFwic2Vzc2lvbnNcIiwgMSk7XG59O1xuXG5PYmplY3QuYXNzaWduKFNlc3Npb24ucHJvdG90eXBlLCB7XG5cbiAgc2VuZFJlYWR5OiBmdW5jdGlvbiAoc3Vic2NyaXB0aW9uSWRzKSB7XG4gICAgdmFyIHNlbGYgPSB0aGlzO1xuICAgIGlmIChzZWxmLl9pc1NlbmRpbmcpXG4gICAgICBzZWxmLnNlbmQoe21zZzogXCJyZWFkeVwiLCBzdWJzOiBzdWJzY3JpcHRpb25JZHN9KTtcbiAgICBlbHNlIHtcbiAgICAgIF8uZWFjaChzdWJzY3JpcHRpb25JZHMsIGZ1bmN0aW9uIChzdWJzY3JpcHRpb25JZCkge1xuICAgICAgICBzZWxmLl9wZW5kaW5nUmVhZHkucHVzaChzdWJzY3JpcHRpb25JZCk7XG4gICAgICB9KTtcbiAgICB9XG4gIH0sXG5cbiAgc2VuZEFkZGVkOiBmdW5jdGlvbiAoY29sbGVjdGlvbk5hbWUsIGlkLCBmaWVsZHMpIHtcbiAgICB2YXIgc2VsZiA9IHRoaXM7XG4gICAgaWYgKHNlbGYuX2lzU2VuZGluZylcbiAgICAgIHNlbGYuc2VuZCh7bXNnOiBcImFkZGVkXCIsIGNvbGxlY3Rpb246IGNvbGxlY3Rpb25OYW1lLCBpZDogaWQsIGZpZWxkczogZmllbGRzfSk7XG4gIH0sXG5cbiAgc2VuZENoYW5nZWQ6IGZ1bmN0aW9uIChjb2xsZWN0aW9uTmFtZSwgaWQsIGZpZWxkcykge1xuICAgIHZhciBzZWxmID0gdGhpcztcbiAgICBpZiAoXy5pc0VtcHR5KGZpZWxkcykpXG4gICAgICByZXR1cm47XG5cbiAgICBpZiAoc2VsZi5faXNTZW5kaW5nKSB7XG4gICAgICBzZWxmLnNlbmQoe1xuICAgICAgICBtc2c6IFwiY2hhbmdlZFwiLFxuICAgICAgICBjb2xsZWN0aW9uOiBjb2xsZWN0aW9uTmFtZSxcbiAgICAgICAgaWQ6IGlkLFxuICAgICAgICBmaWVsZHM6IGZpZWxkc1xuICAgICAgfSk7XG4gICAgfVxuICB9LFxuXG4gIHNlbmRSZW1vdmVkOiBmdW5jdGlvbiAoY29sbGVjdGlvbk5hbWUsIGlkKSB7XG4gICAgdmFyIHNlbGYgPSB0aGlzO1xuICAgIGlmIChzZWxmLl9pc1NlbmRpbmcpXG4gICAgICBzZWxmLnNlbmQoe21zZzogXCJyZW1vdmVkXCIsIGNvbGxlY3Rpb246IGNvbGxlY3Rpb25OYW1lLCBpZDogaWR9KTtcbiAgfSxcblxuICBnZXRTZW5kQ2FsbGJhY2tzOiBmdW5jdGlvbiAoKSB7XG4gICAgdmFyIHNlbGYgPSB0aGlzO1xuICAgIHJldHVybiB7XG4gICAgICBhZGRlZDogXy5iaW5kKHNlbGYuc2VuZEFkZGVkLCBzZWxmKSxcbiAgICAgIGNoYW5nZWQ6IF8uYmluZChzZWxmLnNlbmRDaGFuZ2VkLCBzZWxmKSxcbiAgICAgIHJlbW92ZWQ6IF8uYmluZChzZWxmLnNlbmRSZW1vdmVkLCBzZWxmKVxuICAgIH07XG4gIH0sXG5cbiAgZ2V0Q29sbGVjdGlvblZpZXc6IGZ1bmN0aW9uIChjb2xsZWN0aW9uTmFtZSkge1xuICAgIHZhciBzZWxmID0gdGhpcztcbiAgICB2YXIgcmV0ID0gc2VsZi5jb2xsZWN0aW9uVmlld3MuZ2V0KGNvbGxlY3Rpb25OYW1lKTtcbiAgICBpZiAoIXJldCkge1xuICAgICAgcmV0ID0gbmV3IFNlc3Npb25Db2xsZWN0aW9uVmlldyhjb2xsZWN0aW9uTmFtZSxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBzZWxmLmdldFNlbmRDYWxsYmFja3MoKSk7XG4gICAgICBzZWxmLmNvbGxlY3Rpb25WaWV3cy5zZXQoY29sbGVjdGlvbk5hbWUsIHJldCk7XG4gICAgfVxuICAgIHJldHVybiByZXQ7XG4gIH0sXG5cbiAgYWRkZWQ6IGZ1bmN0aW9uIChzdWJzY3JpcHRpb25IYW5kbGUsIGNvbGxlY3Rpb25OYW1lLCBpZCwgZmllbGRzKSB7XG4gICAgdmFyIHNlbGYgPSB0aGlzO1xuICAgIHZhciB2aWV3ID0gc2VsZi5nZXRDb2xsZWN0aW9uVmlldyhjb2xsZWN0aW9uTmFtZSk7XG4gICAgdmlldy5hZGRlZChzdWJzY3JpcHRpb25IYW5kbGUsIGlkLCBmaWVsZHMpO1xuICB9LFxuXG4gIHJlbW92ZWQ6IGZ1bmN0aW9uIChzdWJzY3JpcHRpb25IYW5kbGUsIGNvbGxlY3Rpb25OYW1lLCBpZCkge1xuICAgIHZhciBzZWxmID0gdGhpcztcbiAgICB2YXIgdmlldyA9IHNlbGYuZ2V0Q29sbGVjdGlvblZpZXcoY29sbGVjdGlvbk5hbWUpO1xuICAgIHZpZXcucmVtb3ZlZChzdWJzY3JpcHRpb25IYW5kbGUsIGlkKTtcbiAgICBpZiAodmlldy5pc0VtcHR5KCkpIHtcbiAgICAgICBzZWxmLmNvbGxlY3Rpb25WaWV3cy5kZWxldGUoY29sbGVjdGlvbk5hbWUpO1xuICAgIH1cbiAgfSxcblxuICBjaGFuZ2VkOiBmdW5jdGlvbiAoc3Vic2NyaXB0aW9uSGFuZGxlLCBjb2xsZWN0aW9uTmFtZSwgaWQsIGZpZWxkcykge1xuICAgIHZhciBzZWxmID0gdGhpcztcbiAgICB2YXIgdmlldyA9IHNlbGYuZ2V0Q29sbGVjdGlvblZpZXcoY29sbGVjdGlvbk5hbWUpO1xuICAgIHZpZXcuY2hhbmdlZChzdWJzY3JpcHRpb25IYW5kbGUsIGlkLCBmaWVsZHMpO1xuICB9LFxuXG4gIHN0YXJ0VW5pdmVyc2FsU3ViczogZnVuY3Rpb24gKCkge1xuICAgIHZhciBzZWxmID0gdGhpcztcbiAgICAvLyBNYWtlIGEgc2hhbGxvdyBjb3B5IG9mIHRoZSBzZXQgb2YgdW5pdmVyc2FsIGhhbmRsZXJzIGFuZCBzdGFydCB0aGVtLiBJZlxuICAgIC8vIGFkZGl0aW9uYWwgdW5pdmVyc2FsIHB1Ymxpc2hlcnMgc3RhcnQgd2hpbGUgd2UncmUgcnVubmluZyB0aGVtIChkdWUgdG9cbiAgICAvLyB5aWVsZGluZyksIHRoZXkgd2lsbCBydW4gc2VwYXJhdGVseSBhcyBwYXJ0IG9mIFNlcnZlci5wdWJsaXNoLlxuICAgIHZhciBoYW5kbGVycyA9IF8uY2xvbmUoc2VsZi5zZXJ2ZXIudW5pdmVyc2FsX3B1Ymxpc2hfaGFuZGxlcnMpO1xuICAgIF8uZWFjaChoYW5kbGVycywgZnVuY3Rpb24gKGhhbmRsZXIpIHtcbiAgICAgIHNlbGYuX3N0YXJ0U3Vic2NyaXB0aW9uKGhhbmRsZXIpO1xuICAgIH0pO1xuICB9LFxuXG4gIC8vIERlc3Ryb3kgdGhpcyBzZXNzaW9uIGFuZCB1bnJlZ2lzdGVyIGl0IGF0IHRoZSBzZXJ2ZXIuXG4gIGNsb3NlOiBmdW5jdGlvbiAoKSB7XG4gICAgdmFyIHNlbGYgPSB0aGlzO1xuXG4gICAgLy8gRGVzdHJveSB0aGlzIHNlc3Npb24sIGV2ZW4gaWYgaXQncyBub3QgcmVnaXN0ZXJlZCBhdCB0aGVcbiAgICAvLyBzZXJ2ZXIuIFN0b3AgYWxsIHByb2Nlc3NpbmcgYW5kIHRlYXIgZXZlcnl0aGluZyBkb3duLiBJZiBhIHNvY2tldFxuICAgIC8vIHdhcyBhdHRhY2hlZCwgY2xvc2UgaXQuXG5cbiAgICAvLyBBbHJlYWR5IGRlc3Ryb3llZC5cbiAgICBpZiAoISBzZWxmLmluUXVldWUpXG4gICAgICByZXR1cm47XG5cbiAgICAvLyBEcm9wIHRoZSBtZXJnZSBib3ggZGF0YSBpbW1lZGlhdGVseS5cbiAgICBzZWxmLmluUXVldWUgPSBudWxsO1xuICAgIHNlbGYuY29sbGVjdGlvblZpZXdzID0gbmV3IE1hcCgpO1xuXG4gICAgaWYgKHNlbGYuaGVhcnRiZWF0KSB7XG4gICAgICBzZWxmLmhlYXJ0YmVhdC5zdG9wKCk7XG4gICAgICBzZWxmLmhlYXJ0YmVhdCA9IG51bGw7XG4gICAgfVxuXG4gICAgaWYgKHNlbGYuc29ja2V0KSB7XG4gICAgICBzZWxmLnNvY2tldC5jbG9zZSgpO1xuICAgICAgc2VsZi5zb2NrZXQuX21ldGVvclNlc3Npb24gPSBudWxsO1xuICAgIH1cblxuICAgIFBhY2thZ2VbJ2ZhY3RzLWJhc2UnXSAmJiBQYWNrYWdlWydmYWN0cy1iYXNlJ10uRmFjdHMuaW5jcmVtZW50U2VydmVyRmFjdChcbiAgICAgIFwibGl2ZWRhdGFcIiwgXCJzZXNzaW9uc1wiLCAtMSk7XG5cbiAgICBNZXRlb3IuZGVmZXIoZnVuY3Rpb24gKCkge1xuICAgICAgLy8gc3RvcCBjYWxsYmFja3MgY2FuIHlpZWxkLCBzbyB3ZSBkZWZlciB0aGlzIG9uIGNsb3NlLlxuICAgICAgLy8gc3ViLl9pc0RlYWN0aXZhdGVkKCkgZGV0ZWN0cyB0aGF0IHdlIHNldCBpblF1ZXVlIHRvIG51bGwgYW5kXG4gICAgICAvLyB0cmVhdHMgaXQgYXMgc2VtaS1kZWFjdGl2YXRlZCAoaXQgd2lsbCBpZ25vcmUgaW5jb21pbmcgY2FsbGJhY2tzLCBldGMpLlxuICAgICAgc2VsZi5fZGVhY3RpdmF0ZUFsbFN1YnNjcmlwdGlvbnMoKTtcblxuICAgICAgLy8gRGVmZXIgY2FsbGluZyB0aGUgY2xvc2UgY2FsbGJhY2tzLCBzbyB0aGF0IHRoZSBjYWxsZXIgY2xvc2luZ1xuICAgICAgLy8gdGhlIHNlc3Npb24gaXNuJ3Qgd2FpdGluZyBmb3IgYWxsIHRoZSBjYWxsYmFja3MgdG8gY29tcGxldGUuXG4gICAgICBfLmVhY2goc2VsZi5fY2xvc2VDYWxsYmFja3MsIGZ1bmN0aW9uIChjYWxsYmFjaykge1xuICAgICAgICBjYWxsYmFjaygpO1xuICAgICAgfSk7XG4gICAgfSk7XG5cbiAgICAvLyBVbnJlZ2lzdGVyIHRoZSBzZXNzaW9uLlxuICAgIHNlbGYuc2VydmVyLl9yZW1vdmVTZXNzaW9uKHNlbGYpO1xuICB9LFxuXG4gIC8vIFNlbmQgYSBtZXNzYWdlIChkb2luZyBub3RoaW5nIGlmIG5vIHNvY2tldCBpcyBjb25uZWN0ZWQgcmlnaHQgbm93LilcbiAgLy8gSXQgc2hvdWxkIGJlIGEgSlNPTiBvYmplY3QgKGl0IHdpbGwgYmUgc3RyaW5naWZpZWQuKVxuICBzZW5kOiBmdW5jdGlvbiAobXNnKSB7XG4gICAgdmFyIHNlbGYgPSB0aGlzO1xuICAgIGlmIChzZWxmLnNvY2tldCkge1xuICAgICAgaWYgKE1ldGVvci5fcHJpbnRTZW50RERQKVxuICAgICAgICBNZXRlb3IuX2RlYnVnKFwiU2VudCBERFBcIiwgRERQQ29tbW9uLnN0cmluZ2lmeUREUChtc2cpKTtcbiAgICAgIHNlbGYuc29ja2V0LnNlbmQoRERQQ29tbW9uLnN0cmluZ2lmeUREUChtc2cpKTtcbiAgICB9XG4gIH0sXG5cbiAgLy8gU2VuZCBhIGNvbm5lY3Rpb24gZXJyb3IuXG4gIHNlbmRFcnJvcjogZnVuY3Rpb24gKHJlYXNvbiwgb2ZmZW5kaW5nTWVzc2FnZSkge1xuICAgIHZhciBzZWxmID0gdGhpcztcbiAgICB2YXIgbXNnID0ge21zZzogJ2Vycm9yJywgcmVhc29uOiByZWFzb259O1xuICAgIGlmIChvZmZlbmRpbmdNZXNzYWdlKVxuICAgICAgbXNnLm9mZmVuZGluZ01lc3NhZ2UgPSBvZmZlbmRpbmdNZXNzYWdlO1xuICAgIHNlbGYuc2VuZChtc2cpO1xuICB9LFxuXG4gIC8vIFByb2Nlc3MgJ21zZycgYXMgYW4gaW5jb21pbmcgbWVzc2FnZS4gKEJ1dCBhcyBhIGd1YXJkIGFnYWluc3RcbiAgLy8gcmFjZSBjb25kaXRpb25zIGR1cmluZyByZWNvbm5lY3Rpb24sIGlnbm9yZSB0aGUgbWVzc2FnZSBpZlxuICAvLyAnc29ja2V0JyBpcyBub3QgdGhlIGN1cnJlbnRseSBjb25uZWN0ZWQgc29ja2V0LilcbiAgLy9cbiAgLy8gV2UgcnVuIHRoZSBtZXNzYWdlcyBmcm9tIHRoZSBjbGllbnQgb25lIGF0IGEgdGltZSwgaW4gdGhlIG9yZGVyXG4gIC8vIGdpdmVuIGJ5IHRoZSBjbGllbnQuIFRoZSBtZXNzYWdlIGhhbmRsZXIgaXMgcGFzc2VkIGFuIGlkZW1wb3RlbnRcbiAgLy8gZnVuY3Rpb24gJ3VuYmxvY2snIHdoaWNoIGl0IG1heSBjYWxsIHRvIGFsbG93IG90aGVyIG1lc3NhZ2VzIHRvXG4gIC8vIGJlZ2luIHJ1bm5pbmcgaW4gcGFyYWxsZWwgaW4gYW5vdGhlciBmaWJlciAoZm9yIGV4YW1wbGUsIGEgbWV0aG9kXG4gIC8vIHRoYXQgd2FudHMgdG8geWllbGQuKSBPdGhlcndpc2UsIGl0IGlzIGF1dG9tYXRpY2FsbHkgdW5ibG9ja2VkXG4gIC8vIHdoZW4gaXQgcmV0dXJucy5cbiAgLy9cbiAgLy8gQWN0dWFsbHksIHdlIGRvbid0IGhhdmUgdG8gJ3RvdGFsbHkgb3JkZXInIHRoZSBtZXNzYWdlcyBpbiB0aGlzXG4gIC8vIHdheSwgYnV0IGl0J3MgdGhlIGVhc2llc3QgdGhpbmcgdGhhdCdzIGNvcnJlY3QuICh1bnN1YiBuZWVkcyB0b1xuICAvLyBiZSBvcmRlcmVkIGFnYWluc3Qgc3ViLCBtZXRob2RzIG5lZWQgdG8gYmUgb3JkZXJlZCBhZ2FpbnN0IGVhY2hcbiAgLy8gb3RoZXIuKVxuICBwcm9jZXNzTWVzc2FnZTogZnVuY3Rpb24gKG1zZ19pbikge1xuICAgIHZhciBzZWxmID0gdGhpcztcbiAgICBpZiAoIXNlbGYuaW5RdWV1ZSkgLy8gd2UgaGF2ZSBiZWVuIGRlc3Ryb3llZC5cbiAgICAgIHJldHVybjtcblxuICAgIC8vIFJlc3BvbmQgdG8gcGluZyBhbmQgcG9uZyBtZXNzYWdlcyBpbW1lZGlhdGVseSB3aXRob3V0IHF1ZXVpbmcuXG4gICAgLy8gSWYgdGhlIG5lZ290aWF0ZWQgRERQIHZlcnNpb24gaXMgXCJwcmUxXCIgd2hpY2ggZGlkbid0IHN1cHBvcnRcbiAgICAvLyBwaW5ncywgcHJlc2VydmUgdGhlIFwicHJlMVwiIGJlaGF2aW9yIG9mIHJlc3BvbmRpbmcgd2l0aCBhIFwiYmFkXG4gICAgLy8gcmVxdWVzdFwiIGZvciB0aGUgdW5rbm93biBtZXNzYWdlcy5cbiAgICAvL1xuICAgIC8vIEZpYmVycyBhcmUgbmVlZGVkIGJlY2F1c2UgaGVhcnRiZWF0IHVzZXMgTWV0ZW9yLnNldFRpbWVvdXQsIHdoaWNoXG4gICAgLy8gbmVlZHMgYSBGaWJlci4gV2UgY291bGQgYWN0dWFsbHkgdXNlIHJlZ3VsYXIgc2V0VGltZW91dCBhbmQgYXZvaWRcbiAgICAvLyB0aGVzZSBuZXcgZmliZXJzLCBidXQgaXQgaXMgZWFzaWVyIHRvIGp1c3QgbWFrZSBldmVyeXRoaW5nIHVzZVxuICAgIC8vIE1ldGVvci5zZXRUaW1lb3V0IGFuZCBub3QgdGhpbmsgdG9vIGhhcmQuXG4gICAgLy9cbiAgICAvLyBBbnkgbWVzc2FnZSBjb3VudHMgYXMgcmVjZWl2aW5nIGEgcG9uZywgYXMgaXQgZGVtb25zdHJhdGVzIHRoYXRcbiAgICAvLyB0aGUgY2xpZW50IGlzIHN0aWxsIGFsaXZlLlxuICAgIGlmIChzZWxmLmhlYXJ0YmVhdCkge1xuICAgICAgRmliZXIoZnVuY3Rpb24gKCkge1xuICAgICAgICBzZWxmLmhlYXJ0YmVhdC5tZXNzYWdlUmVjZWl2ZWQoKTtcbiAgICAgIH0pLnJ1bigpO1xuICAgIH1cblxuICAgIGlmIChzZWxmLnZlcnNpb24gIT09ICdwcmUxJyAmJiBtc2dfaW4ubXNnID09PSAncGluZycpIHtcbiAgICAgIGlmIChzZWxmLl9yZXNwb25kVG9QaW5ncylcbiAgICAgICAgc2VsZi5zZW5kKHttc2c6IFwicG9uZ1wiLCBpZDogbXNnX2luLmlkfSk7XG4gICAgICByZXR1cm47XG4gICAgfVxuICAgIGlmIChzZWxmLnZlcnNpb24gIT09ICdwcmUxJyAmJiBtc2dfaW4ubXNnID09PSAncG9uZycpIHtcbiAgICAgIC8vIFNpbmNlIGV2ZXJ5dGhpbmcgaXMgYSBwb25nLCBub3RoaW5nIHRvIGRvXG4gICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgc2VsZi5pblF1ZXVlLnB1c2gobXNnX2luKTtcbiAgICBpZiAoc2VsZi53b3JrZXJSdW5uaW5nKVxuICAgICAgcmV0dXJuO1xuICAgIHNlbGYud29ya2VyUnVubmluZyA9IHRydWU7XG5cbiAgICB2YXIgcHJvY2Vzc05leHQgPSBmdW5jdGlvbiAoKSB7XG4gICAgICB2YXIgbXNnID0gc2VsZi5pblF1ZXVlICYmIHNlbGYuaW5RdWV1ZS5zaGlmdCgpO1xuICAgICAgaWYgKCFtc2cpIHtcbiAgICAgICAgc2VsZi53b3JrZXJSdW5uaW5nID0gZmFsc2U7XG4gICAgICAgIHJldHVybjtcbiAgICAgIH1cblxuICAgICAgRmliZXIoZnVuY3Rpb24gKCkge1xuICAgICAgICB2YXIgYmxvY2tlZCA9IHRydWU7XG5cbiAgICAgICAgdmFyIHVuYmxvY2sgPSBmdW5jdGlvbiAoKSB7XG4gICAgICAgICAgaWYgKCFibG9ja2VkKVxuICAgICAgICAgICAgcmV0dXJuOyAvLyBpZGVtcG90ZW50XG4gICAgICAgICAgYmxvY2tlZCA9IGZhbHNlO1xuICAgICAgICAgIHByb2Nlc3NOZXh0KCk7XG4gICAgICAgIH07XG5cbiAgICAgICAgc2VsZi5zZXJ2ZXIub25NZXNzYWdlSG9vay5lYWNoKGZ1bmN0aW9uIChjYWxsYmFjaykge1xuICAgICAgICAgIGNhbGxiYWNrKG1zZywgc2VsZik7XG4gICAgICAgICAgcmV0dXJuIHRydWU7XG4gICAgICAgIH0pO1xuXG4gICAgICAgIGlmIChfLmhhcyhzZWxmLnByb3RvY29sX2hhbmRsZXJzLCBtc2cubXNnKSlcbiAgICAgICAgICBzZWxmLnByb3RvY29sX2hhbmRsZXJzW21zZy5tc2ddLmNhbGwoc2VsZiwgbXNnLCB1bmJsb2NrKTtcbiAgICAgICAgZWxzZVxuICAgICAgICAgIHNlbGYuc2VuZEVycm9yKCdCYWQgcmVxdWVzdCcsIG1zZyk7XG4gICAgICAgIHVuYmxvY2soKTsgLy8gaW4gY2FzZSB0aGUgaGFuZGxlciBkaWRuJ3QgYWxyZWFkeSBkbyBpdFxuICAgICAgfSkucnVuKCk7XG4gICAgfTtcblxuICAgIHByb2Nlc3NOZXh0KCk7XG4gIH0sXG5cbiAgcHJvdG9jb2xfaGFuZGxlcnM6IHtcbiAgICBzdWI6IGZ1bmN0aW9uIChtc2csIHVuYmxvY2spIHtcbiAgICAgIHZhciBzZWxmID0gdGhpcztcblxuICAgICAgLy8gY2FjaGVVbmJsb2NrIHRlbXBvcmFybHksIHNvIHdlIGNhbiBjYXB0dXJlIGl0IGxhdGVyXG4gICAgICAvLyB3ZSB3aWxsIHVzZSB1bmJsb2NrIGluIGN1cnJlbnQgZXZlbnRMb29wLCBzbyB0aGlzIGlzIHNhZmVcbiAgICAgIHNlbGYuY2FjaGVkVW5ibG9jayA9IHVuYmxvY2s7XG5cbiAgICAgIC8vIHJlamVjdCBtYWxmb3JtZWQgbWVzc2FnZXNcbiAgICAgIGlmICh0eXBlb2YgKG1zZy5pZCkgIT09IFwic3RyaW5nXCIgfHxcbiAgICAgICAgICB0eXBlb2YgKG1zZy5uYW1lKSAhPT0gXCJzdHJpbmdcIiB8fFxuICAgICAgICAgICgoJ3BhcmFtcycgaW4gbXNnKSAmJiAhKG1zZy5wYXJhbXMgaW5zdGFuY2VvZiBBcnJheSkpKSB7XG4gICAgICAgIHNlbGYuc2VuZEVycm9yKFwiTWFsZm9ybWVkIHN1YnNjcmlwdGlvblwiLCBtc2cpO1xuICAgICAgICByZXR1cm47XG4gICAgICB9XG5cbiAgICAgIGlmICghc2VsZi5zZXJ2ZXIucHVibGlzaF9oYW5kbGVyc1ttc2cubmFtZV0pIHtcbiAgICAgICAgc2VsZi5zZW5kKHtcbiAgICAgICAgICBtc2c6ICdub3N1YicsIGlkOiBtc2cuaWQsXG4gICAgICAgICAgZXJyb3I6IG5ldyBNZXRlb3IuRXJyb3IoNDA0LCBgU3Vic2NyaXB0aW9uICcke21zZy5uYW1lfScgbm90IGZvdW5kYCl9KTtcbiAgICAgICAgcmV0dXJuO1xuICAgICAgfVxuXG4gICAgICBpZiAoc2VsZi5fbmFtZWRTdWJzLmhhcyhtc2cuaWQpKVxuICAgICAgICAvLyBzdWJzIGFyZSBpZGVtcG90ZW50LCBvciByYXRoZXIsIHRoZXkgYXJlIGlnbm9yZWQgaWYgYSBzdWJcbiAgICAgICAgLy8gd2l0aCB0aGF0IGlkIGFscmVhZHkgZXhpc3RzLiB0aGlzIGlzIGltcG9ydGFudCBkdXJpbmdcbiAgICAgICAgLy8gcmVjb25uZWN0LlxuICAgICAgICByZXR1cm47XG5cbiAgICAgIC8vIFhYWCBJdCdkIGJlIG11Y2ggYmV0dGVyIGlmIHdlIGhhZCBnZW5lcmljIGhvb2tzIHdoZXJlIGFueSBwYWNrYWdlIGNhblxuICAgICAgLy8gaG9vayBpbnRvIHN1YnNjcmlwdGlvbiBoYW5kbGluZywgYnV0IGluIHRoZSBtZWFuIHdoaWxlIHdlIHNwZWNpYWwgY2FzZVxuICAgICAgLy8gZGRwLXJhdGUtbGltaXRlciBwYWNrYWdlLiBUaGlzIGlzIGFsc28gZG9uZSBmb3Igd2VhayByZXF1aXJlbWVudHMgdG9cbiAgICAgIC8vIGFkZCB0aGUgZGRwLXJhdGUtbGltaXRlciBwYWNrYWdlIGluIGNhc2Ugd2UgZG9uJ3QgaGF2ZSBBY2NvdW50cy4gQVxuICAgICAgLy8gdXNlciB0cnlpbmcgdG8gdXNlIHRoZSBkZHAtcmF0ZS1saW1pdGVyIG11c3QgZXhwbGljaXRseSByZXF1aXJlIGl0LlxuICAgICAgaWYgKFBhY2thZ2VbJ2RkcC1yYXRlLWxpbWl0ZXInXSkge1xuICAgICAgICB2YXIgRERQUmF0ZUxpbWl0ZXIgPSBQYWNrYWdlWydkZHAtcmF0ZS1saW1pdGVyJ10uRERQUmF0ZUxpbWl0ZXI7XG4gICAgICAgIHZhciByYXRlTGltaXRlcklucHV0ID0ge1xuICAgICAgICAgIHVzZXJJZDogc2VsZi51c2VySWQsXG4gICAgICAgICAgY2xpZW50QWRkcmVzczogc2VsZi5jb25uZWN0aW9uSGFuZGxlLmNsaWVudEFkZHJlc3MsXG4gICAgICAgICAgdHlwZTogXCJzdWJzY3JpcHRpb25cIixcbiAgICAgICAgICBuYW1lOiBtc2cubmFtZSxcbiAgICAgICAgICBjb25uZWN0aW9uSWQ6IHNlbGYuaWRcbiAgICAgICAgfTtcblxuICAgICAgICBERFBSYXRlTGltaXRlci5faW5jcmVtZW50KHJhdGVMaW1pdGVySW5wdXQpO1xuICAgICAgICB2YXIgcmF0ZUxpbWl0UmVzdWx0ID0gRERQUmF0ZUxpbWl0ZXIuX2NoZWNrKHJhdGVMaW1pdGVySW5wdXQpO1xuICAgICAgICBpZiAoIXJhdGVMaW1pdFJlc3VsdC5hbGxvd2VkKSB7XG4gICAgICAgICAgc2VsZi5zZW5kKHtcbiAgICAgICAgICAgIG1zZzogJ25vc3ViJywgaWQ6IG1zZy5pZCxcbiAgICAgICAgICAgIGVycm9yOiBuZXcgTWV0ZW9yLkVycm9yKFxuICAgICAgICAgICAgICAndG9vLW1hbnktcmVxdWVzdHMnLFxuICAgICAgICAgICAgICBERFBSYXRlTGltaXRlci5nZXRFcnJvck1lc3NhZ2UocmF0ZUxpbWl0UmVzdWx0KSxcbiAgICAgICAgICAgICAge3RpbWVUb1Jlc2V0OiByYXRlTGltaXRSZXN1bHQudGltZVRvUmVzZXR9KVxuICAgICAgICAgIH0pO1xuICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuICAgICAgfVxuXG4gICAgICB2YXIgaGFuZGxlciA9IHNlbGYuc2VydmVyLnB1Ymxpc2hfaGFuZGxlcnNbbXNnLm5hbWVdO1xuXG4gICAgICBzZWxmLl9zdGFydFN1YnNjcmlwdGlvbihoYW5kbGVyLCBtc2cuaWQsIG1zZy5wYXJhbXMsIG1zZy5uYW1lKTtcblxuICAgICAgLy8gY2xlYW5pbmcgY2FjaGVkIHVuYmxvY2tcbiAgICAgIHNlbGYuY2FjaGVkVW5ibG9jayA9IG51bGw7XG4gICAgfSxcblxuICAgIHVuc3ViOiBmdW5jdGlvbiAobXNnKSB7XG4gICAgICB2YXIgc2VsZiA9IHRoaXM7XG5cbiAgICAgIHNlbGYuX3N0b3BTdWJzY3JpcHRpb24obXNnLmlkKTtcbiAgICB9LFxuXG4gICAgbWV0aG9kOiBmdW5jdGlvbiAobXNnLCB1bmJsb2NrKSB7XG4gICAgICB2YXIgc2VsZiA9IHRoaXM7XG5cbiAgICAgIC8vIHJlamVjdCBtYWxmb3JtZWQgbWVzc2FnZXNcbiAgICAgIC8vIEZvciBub3csIHdlIHNpbGVudGx5IGlnbm9yZSB1bmtub3duIGF0dHJpYnV0ZXMsXG4gICAgICAvLyBmb3IgZm9yd2FyZHMgY29tcGF0aWJpbGl0eS5cbiAgICAgIGlmICh0eXBlb2YgKG1zZy5pZCkgIT09IFwic3RyaW5nXCIgfHxcbiAgICAgICAgICB0eXBlb2YgKG1zZy5tZXRob2QpICE9PSBcInN0cmluZ1wiIHx8XG4gICAgICAgICAgKCgncGFyYW1zJyBpbiBtc2cpICYmICEobXNnLnBhcmFtcyBpbnN0YW5jZW9mIEFycmF5KSkgfHxcbiAgICAgICAgICAoKCdyYW5kb21TZWVkJyBpbiBtc2cpICYmICh0eXBlb2YgbXNnLnJhbmRvbVNlZWQgIT09IFwic3RyaW5nXCIpKSkge1xuICAgICAgICBzZWxmLnNlbmRFcnJvcihcIk1hbGZvcm1lZCBtZXRob2QgaW52b2NhdGlvblwiLCBtc2cpO1xuICAgICAgICByZXR1cm47XG4gICAgICB9XG5cbiAgICAgIHZhciByYW5kb21TZWVkID0gbXNnLnJhbmRvbVNlZWQgfHwgbnVsbDtcblxuICAgICAgLy8gc2V0IHVwIHRvIG1hcmsgdGhlIG1ldGhvZCBhcyBzYXRpc2ZpZWQgb25jZSBhbGwgb2JzZXJ2ZXJzXG4gICAgICAvLyAoYW5kIHN1YnNjcmlwdGlvbnMpIGhhdmUgcmVhY3RlZCB0byBhbnkgd3JpdGVzIHRoYXQgd2VyZVxuICAgICAgLy8gZG9uZS5cbiAgICAgIHZhciBmZW5jZSA9IG5ldyBERFBTZXJ2ZXIuX1dyaXRlRmVuY2U7XG4gICAgICBmZW5jZS5vbkFsbENvbW1pdHRlZChmdW5jdGlvbiAoKSB7XG4gICAgICAgIC8vIFJldGlyZSB0aGUgZmVuY2Ugc28gdGhhdCBmdXR1cmUgd3JpdGVzIGFyZSBhbGxvd2VkLlxuICAgICAgICAvLyBUaGlzIG1lYW5zIHRoYXQgY2FsbGJhY2tzIGxpa2UgdGltZXJzIGFyZSBmcmVlIHRvIHVzZVxuICAgICAgICAvLyB0aGUgZmVuY2UsIGFuZCBpZiB0aGV5IGZpcmUgYmVmb3JlIGl0J3MgYXJtZWQgKGZvclxuICAgICAgICAvLyBleGFtcGxlLCBiZWNhdXNlIHRoZSBtZXRob2Qgd2FpdHMgZm9yIHRoZW0pIHRoZWlyXG4gICAgICAgIC8vIHdyaXRlcyB3aWxsIGJlIGluY2x1ZGVkIGluIHRoZSBmZW5jZS5cbiAgICAgICAgZmVuY2UucmV0aXJlKCk7XG4gICAgICAgIHNlbGYuc2VuZCh7XG4gICAgICAgICAgbXNnOiAndXBkYXRlZCcsIG1ldGhvZHM6IFttc2cuaWRdfSk7XG4gICAgICB9KTtcblxuICAgICAgLy8gZmluZCB0aGUgaGFuZGxlclxuICAgICAgdmFyIGhhbmRsZXIgPSBzZWxmLnNlcnZlci5tZXRob2RfaGFuZGxlcnNbbXNnLm1ldGhvZF07XG4gICAgICBpZiAoIWhhbmRsZXIpIHtcbiAgICAgICAgc2VsZi5zZW5kKHtcbiAgICAgICAgICBtc2c6ICdyZXN1bHQnLCBpZDogbXNnLmlkLFxuICAgICAgICAgIGVycm9yOiBuZXcgTWV0ZW9yLkVycm9yKDQwNCwgYE1ldGhvZCAnJHttc2cubWV0aG9kfScgbm90IGZvdW5kYCl9KTtcbiAgICAgICAgZmVuY2UuYXJtKCk7XG4gICAgICAgIHJldHVybjtcbiAgICAgIH1cblxuICAgICAgdmFyIHNldFVzZXJJZCA9IGZ1bmN0aW9uKHVzZXJJZCkge1xuICAgICAgICBzZWxmLl9zZXRVc2VySWQodXNlcklkKTtcbiAgICAgIH07XG5cbiAgICAgIHZhciBpbnZvY2F0aW9uID0gbmV3IEREUENvbW1vbi5NZXRob2RJbnZvY2F0aW9uKHtcbiAgICAgICAgaXNTaW11bGF0aW9uOiBmYWxzZSxcbiAgICAgICAgdXNlcklkOiBzZWxmLnVzZXJJZCxcbiAgICAgICAgc2V0VXNlcklkOiBzZXRVc2VySWQsXG4gICAgICAgIHVuYmxvY2s6IHVuYmxvY2ssXG4gICAgICAgIGNvbm5lY3Rpb246IHNlbGYuY29ubmVjdGlvbkhhbmRsZSxcbiAgICAgICAgcmFuZG9tU2VlZDogcmFuZG9tU2VlZFxuICAgICAgfSk7XG5cbiAgICAgIGNvbnN0IHByb21pc2UgPSBuZXcgUHJvbWlzZSgocmVzb2x2ZSwgcmVqZWN0KSA9PiB7XG4gICAgICAgIC8vIFhYWCBJdCdkIGJlIGJldHRlciBpZiB3ZSBjb3VsZCBob29rIGludG8gbWV0aG9kIGhhbmRsZXJzIGJldHRlciBidXRcbiAgICAgICAgLy8gZm9yIG5vdywgd2UgbmVlZCB0byBjaGVjayBpZiB0aGUgZGRwLXJhdGUtbGltaXRlciBleGlzdHMgc2luY2Ugd2VcbiAgICAgICAgLy8gaGF2ZSBhIHdlYWsgcmVxdWlyZW1lbnQgZm9yIHRoZSBkZHAtcmF0ZS1saW1pdGVyIHBhY2thZ2UgdG8gYmUgYWRkZWRcbiAgICAgICAgLy8gdG8gb3VyIGFwcGxpY2F0aW9uLlxuICAgICAgICBpZiAoUGFja2FnZVsnZGRwLXJhdGUtbGltaXRlciddKSB7XG4gICAgICAgICAgdmFyIEREUFJhdGVMaW1pdGVyID0gUGFja2FnZVsnZGRwLXJhdGUtbGltaXRlciddLkREUFJhdGVMaW1pdGVyO1xuICAgICAgICAgIHZhciByYXRlTGltaXRlcklucHV0ID0ge1xuICAgICAgICAgICAgdXNlcklkOiBzZWxmLnVzZXJJZCxcbiAgICAgICAgICAgIGNsaWVudEFkZHJlc3M6IHNlbGYuY29ubmVjdGlvbkhhbmRsZS5jbGllbnRBZGRyZXNzLFxuICAgICAgICAgICAgdHlwZTogXCJtZXRob2RcIixcbiAgICAgICAgICAgIG5hbWU6IG1zZy5tZXRob2QsXG4gICAgICAgICAgICBjb25uZWN0aW9uSWQ6IHNlbGYuaWRcbiAgICAgICAgICB9O1xuICAgICAgICAgIEREUFJhdGVMaW1pdGVyLl9pbmNyZW1lbnQocmF0ZUxpbWl0ZXJJbnB1dCk7XG4gICAgICAgICAgdmFyIHJhdGVMaW1pdFJlc3VsdCA9IEREUFJhdGVMaW1pdGVyLl9jaGVjayhyYXRlTGltaXRlcklucHV0KVxuICAgICAgICAgIGlmICghcmF0ZUxpbWl0UmVzdWx0LmFsbG93ZWQpIHtcbiAgICAgICAgICAgIHJlamVjdChuZXcgTWV0ZW9yLkVycm9yKFxuICAgICAgICAgICAgICBcInRvby1tYW55LXJlcXVlc3RzXCIsXG4gICAgICAgICAgICAgIEREUFJhdGVMaW1pdGVyLmdldEVycm9yTWVzc2FnZShyYXRlTGltaXRSZXN1bHQpLFxuICAgICAgICAgICAgICB7dGltZVRvUmVzZXQ6IHJhdGVMaW1pdFJlc3VsdC50aW1lVG9SZXNldH1cbiAgICAgICAgICAgICkpO1xuICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICAgIH1cbiAgICAgICAgfVxuXG4gICAgICAgIHJlc29sdmUoRERQU2VydmVyLl9DdXJyZW50V3JpdGVGZW5jZS53aXRoVmFsdWUoXG4gICAgICAgICAgZmVuY2UsXG4gICAgICAgICAgKCkgPT4gRERQLl9DdXJyZW50TWV0aG9kSW52b2NhdGlvbi53aXRoVmFsdWUoXG4gICAgICAgICAgICBpbnZvY2F0aW9uLFxuICAgICAgICAgICAgKCkgPT4gbWF5YmVBdWRpdEFyZ3VtZW50Q2hlY2tzKFxuICAgICAgICAgICAgICBoYW5kbGVyLCBpbnZvY2F0aW9uLCBtc2cucGFyYW1zLFxuICAgICAgICAgICAgICBcImNhbGwgdG8gJ1wiICsgbXNnLm1ldGhvZCArIFwiJ1wiXG4gICAgICAgICAgICApXG4gICAgICAgICAgKVxuICAgICAgICApKTtcbiAgICAgIH0pO1xuXG4gICAgICBmdW5jdGlvbiBmaW5pc2goKSB7XG4gICAgICAgIGZlbmNlLmFybSgpO1xuICAgICAgICB1bmJsb2NrKCk7XG4gICAgICB9XG5cbiAgICAgIGNvbnN0IHBheWxvYWQgPSB7XG4gICAgICAgIG1zZzogXCJyZXN1bHRcIixcbiAgICAgICAgaWQ6IG1zZy5pZFxuICAgICAgfTtcblxuICAgICAgcHJvbWlzZS50aGVuKChyZXN1bHQpID0+IHtcbiAgICAgICAgZmluaXNoKCk7XG4gICAgICAgIGlmIChyZXN1bHQgIT09IHVuZGVmaW5lZCkge1xuICAgICAgICAgIHBheWxvYWQucmVzdWx0ID0gcmVzdWx0O1xuICAgICAgICB9XG4gICAgICAgIHNlbGYuc2VuZChwYXlsb2FkKTtcbiAgICAgIH0sIChleGNlcHRpb24pID0+IHtcbiAgICAgICAgZmluaXNoKCk7XG4gICAgICAgIHBheWxvYWQuZXJyb3IgPSB3cmFwSW50ZXJuYWxFeGNlcHRpb24oXG4gICAgICAgICAgZXhjZXB0aW9uLFxuICAgICAgICAgIGB3aGlsZSBpbnZva2luZyBtZXRob2QgJyR7bXNnLm1ldGhvZH0nYFxuICAgICAgICApO1xuICAgICAgICBzZWxmLnNlbmQocGF5bG9hZCk7XG4gICAgICB9KTtcbiAgICB9XG4gIH0sXG5cbiAgX2VhY2hTdWI6IGZ1bmN0aW9uIChmKSB7XG4gICAgdmFyIHNlbGYgPSB0aGlzO1xuICAgIHNlbGYuX25hbWVkU3Vicy5mb3JFYWNoKGYpO1xuICAgIHNlbGYuX3VuaXZlcnNhbFN1YnMuZm9yRWFjaChmKTtcbiAgfSxcblxuICBfZGlmZkNvbGxlY3Rpb25WaWV3czogZnVuY3Rpb24gKGJlZm9yZUNWcykge1xuICAgIHZhciBzZWxmID0gdGhpcztcbiAgICBEaWZmU2VxdWVuY2UuZGlmZk1hcHMoYmVmb3JlQ1ZzLCBzZWxmLmNvbGxlY3Rpb25WaWV3cywge1xuICAgICAgYm90aDogZnVuY3Rpb24gKGNvbGxlY3Rpb25OYW1lLCBsZWZ0VmFsdWUsIHJpZ2h0VmFsdWUpIHtcbiAgICAgICAgcmlnaHRWYWx1ZS5kaWZmKGxlZnRWYWx1ZSk7XG4gICAgICB9LFxuICAgICAgcmlnaHRPbmx5OiBmdW5jdGlvbiAoY29sbGVjdGlvbk5hbWUsIHJpZ2h0VmFsdWUpIHtcbiAgICAgICAgcmlnaHRWYWx1ZS5kb2N1bWVudHMuZm9yRWFjaChmdW5jdGlvbiAoZG9jVmlldywgaWQpIHtcbiAgICAgICAgICBzZWxmLnNlbmRBZGRlZChjb2xsZWN0aW9uTmFtZSwgaWQsIGRvY1ZpZXcuZ2V0RmllbGRzKCkpO1xuICAgICAgICB9KTtcbiAgICAgIH0sXG4gICAgICBsZWZ0T25seTogZnVuY3Rpb24gKGNvbGxlY3Rpb25OYW1lLCBsZWZ0VmFsdWUpIHtcbiAgICAgICAgbGVmdFZhbHVlLmRvY3VtZW50cy5mb3JFYWNoKGZ1bmN0aW9uIChkb2MsIGlkKSB7XG4gICAgICAgICAgc2VsZi5zZW5kUmVtb3ZlZChjb2xsZWN0aW9uTmFtZSwgaWQpO1xuICAgICAgICB9KTtcbiAgICAgIH1cbiAgICB9KTtcbiAgfSxcblxuICAvLyBTZXRzIHRoZSBjdXJyZW50IHVzZXIgaWQgaW4gYWxsIGFwcHJvcHJpYXRlIGNvbnRleHRzIGFuZCByZXJ1bnNcbiAgLy8gYWxsIHN1YnNjcmlwdGlvbnNcbiAgX3NldFVzZXJJZDogZnVuY3Rpb24odXNlcklkKSB7XG4gICAgdmFyIHNlbGYgPSB0aGlzO1xuXG4gICAgaWYgKHVzZXJJZCAhPT0gbnVsbCAmJiB0eXBlb2YgdXNlcklkICE9PSBcInN0cmluZ1wiKVxuICAgICAgdGhyb3cgbmV3IEVycm9yKFwic2V0VXNlcklkIG11c3QgYmUgY2FsbGVkIG9uIHN0cmluZyBvciBudWxsLCBub3QgXCIgK1xuICAgICAgICAgICAgICAgICAgICAgIHR5cGVvZiB1c2VySWQpO1xuXG4gICAgLy8gUHJldmVudCBuZXdseS1jcmVhdGVkIHVuaXZlcnNhbCBzdWJzY3JpcHRpb25zIGZyb20gYmVpbmcgYWRkZWQgdG8gb3VyXG4gICAgLy8gc2Vzc2lvbjsgdGhleSB3aWxsIGJlIGZvdW5kIGJlbG93IHdoZW4gd2UgY2FsbCBzdGFydFVuaXZlcnNhbFN1YnMuXG4gICAgLy9cbiAgICAvLyAoV2UgZG9uJ3QgaGF2ZSB0byB3b3JyeSBhYm91dCBuYW1lZCBzdWJzY3JpcHRpb25zLCBiZWNhdXNlIHdlIG9ubHkgYWRkXG4gICAgLy8gdGhlbSB3aGVuIHdlIHByb2Nlc3MgYSAnc3ViJyBtZXNzYWdlLiBXZSBhcmUgY3VycmVudGx5IHByb2Nlc3NpbmcgYVxuICAgIC8vICdtZXRob2QnIG1lc3NhZ2UsIGFuZCB0aGUgbWV0aG9kIGRpZCBub3QgdW5ibG9jaywgYmVjYXVzZSBpdCBpcyBpbGxlZ2FsXG4gICAgLy8gdG8gY2FsbCBzZXRVc2VySWQgYWZ0ZXIgdW5ibG9jay4gVGh1cyB3ZSBjYW5ub3QgYmUgY29uY3VycmVudGx5IGFkZGluZyBhXG4gICAgLy8gbmV3IG5hbWVkIHN1YnNjcmlwdGlvbi4pXG4gICAgc2VsZi5fZG9udFN0YXJ0TmV3VW5pdmVyc2FsU3VicyA9IHRydWU7XG5cbiAgICAvLyBQcmV2ZW50IGN1cnJlbnQgc3VicyBmcm9tIHVwZGF0aW5nIG91ciBjb2xsZWN0aW9uVmlld3MgYW5kIGNhbGwgdGhlaXJcbiAgICAvLyBzdG9wIGNhbGxiYWNrcy4gVGhpcyBtYXkgeWllbGQuXG4gICAgc2VsZi5fZWFjaFN1YihmdW5jdGlvbiAoc3ViKSB7XG4gICAgICBzdWIuX2RlYWN0aXZhdGUoKTtcbiAgICB9KTtcblxuICAgIC8vIEFsbCBzdWJzIHNob3VsZCBub3cgYmUgZGVhY3RpdmF0ZWQuIFN0b3Agc2VuZGluZyBtZXNzYWdlcyB0byB0aGUgY2xpZW50LFxuICAgIC8vIHNhdmUgdGhlIHN0YXRlIG9mIHRoZSBwdWJsaXNoZWQgY29sbGVjdGlvbnMsIHJlc2V0IHRvIGFuIGVtcHR5IHZpZXcsIGFuZFxuICAgIC8vIHVwZGF0ZSB0aGUgdXNlcklkLlxuICAgIHNlbGYuX2lzU2VuZGluZyA9IGZhbHNlO1xuICAgIHZhciBiZWZvcmVDVnMgPSBzZWxmLmNvbGxlY3Rpb25WaWV3cztcbiAgICBzZWxmLmNvbGxlY3Rpb25WaWV3cyA9IG5ldyBNYXAoKTtcbiAgICBzZWxmLnVzZXJJZCA9IHVzZXJJZDtcblxuICAgIC8vIF9zZXRVc2VySWQgaXMgbm9ybWFsbHkgY2FsbGVkIGZyb20gYSBNZXRlb3IgbWV0aG9kIHdpdGhcbiAgICAvLyBERFAuX0N1cnJlbnRNZXRob2RJbnZvY2F0aW9uIHNldC4gQnV0IEREUC5fQ3VycmVudE1ldGhvZEludm9jYXRpb24gaXMgbm90XG4gICAgLy8gZXhwZWN0ZWQgdG8gYmUgc2V0IGluc2lkZSBhIHB1Ymxpc2ggZnVuY3Rpb24sIHNvIHdlIHRlbXBvcmFyeSB1bnNldCBpdC5cbiAgICAvLyBJbnNpZGUgYSBwdWJsaXNoIGZ1bmN0aW9uIEREUC5fQ3VycmVudFB1YmxpY2F0aW9uSW52b2NhdGlvbiBpcyBzZXQuXG4gICAgRERQLl9DdXJyZW50TWV0aG9kSW52b2NhdGlvbi53aXRoVmFsdWUodW5kZWZpbmVkLCBmdW5jdGlvbiAoKSB7XG4gICAgICAvLyBTYXZlIHRoZSBvbGQgbmFtZWQgc3VicywgYW5kIHJlc2V0IHRvIGhhdmluZyBubyBzdWJzY3JpcHRpb25zLlxuICAgICAgdmFyIG9sZE5hbWVkU3VicyA9IHNlbGYuX25hbWVkU3VicztcbiAgICAgIHNlbGYuX25hbWVkU3VicyA9IG5ldyBNYXAoKTtcbiAgICAgIHNlbGYuX3VuaXZlcnNhbFN1YnMgPSBbXTtcblxuICAgICAgb2xkTmFtZWRTdWJzLmZvckVhY2goZnVuY3Rpb24gKHN1Yiwgc3Vic2NyaXB0aW9uSWQpIHtcbiAgICAgICAgdmFyIG5ld1N1YiA9IHN1Yi5fcmVjcmVhdGUoKTtcbiAgICAgICAgc2VsZi5fbmFtZWRTdWJzLnNldChzdWJzY3JpcHRpb25JZCwgbmV3U3ViKTtcbiAgICAgICAgLy8gbmI6IGlmIHRoZSBoYW5kbGVyIHRocm93cyBvciBjYWxscyB0aGlzLmVycm9yKCksIGl0IHdpbGwgaW4gZmFjdFxuICAgICAgICAvLyBpbW1lZGlhdGVseSBzZW5kIGl0cyAnbm9zdWInLiBUaGlzIGlzIE9LLCB0aG91Z2guXG4gICAgICAgIG5ld1N1Yi5fcnVuSGFuZGxlcigpO1xuICAgICAgfSk7XG5cbiAgICAgIC8vIEFsbG93IG5ld2x5LWNyZWF0ZWQgdW5pdmVyc2FsIHN1YnMgdG8gYmUgc3RhcnRlZCBvbiBvdXIgY29ubmVjdGlvbiBpblxuICAgICAgLy8gcGFyYWxsZWwgd2l0aCB0aGUgb25lcyB3ZSdyZSBzcGlubmluZyB1cCBoZXJlLCBhbmQgc3BpbiB1cCB1bml2ZXJzYWxcbiAgICAgIC8vIHN1YnMuXG4gICAgICBzZWxmLl9kb250U3RhcnROZXdVbml2ZXJzYWxTdWJzID0gZmFsc2U7XG4gICAgICBzZWxmLnN0YXJ0VW5pdmVyc2FsU3VicygpO1xuICAgIH0pO1xuXG4gICAgLy8gU3RhcnQgc2VuZGluZyBtZXNzYWdlcyBhZ2FpbiwgYmVnaW5uaW5nIHdpdGggdGhlIGRpZmYgZnJvbSB0aGUgcHJldmlvdXNcbiAgICAvLyBzdGF0ZSBvZiB0aGUgd29ybGQgdG8gdGhlIGN1cnJlbnQgc3RhdGUuIE5vIHlpZWxkcyBhcmUgYWxsb3dlZCBkdXJpbmdcbiAgICAvLyB0aGlzIGRpZmYsIHNvIHRoYXQgb3RoZXIgY2hhbmdlcyBjYW5ub3QgaW50ZXJsZWF2ZS5cbiAgICBNZXRlb3IuX25vWWllbGRzQWxsb3dlZChmdW5jdGlvbiAoKSB7XG4gICAgICBzZWxmLl9pc1NlbmRpbmcgPSB0cnVlO1xuICAgICAgc2VsZi5fZGlmZkNvbGxlY3Rpb25WaWV3cyhiZWZvcmVDVnMpO1xuICAgICAgaWYgKCFfLmlzRW1wdHkoc2VsZi5fcGVuZGluZ1JlYWR5KSkge1xuICAgICAgICBzZWxmLnNlbmRSZWFkeShzZWxmLl9wZW5kaW5nUmVhZHkpO1xuICAgICAgICBzZWxmLl9wZW5kaW5nUmVhZHkgPSBbXTtcbiAgICAgIH1cbiAgICB9KTtcbiAgfSxcblxuICBfc3RhcnRTdWJzY3JpcHRpb246IGZ1bmN0aW9uIChoYW5kbGVyLCBzdWJJZCwgcGFyYW1zLCBuYW1lKSB7XG4gICAgdmFyIHNlbGYgPSB0aGlzO1xuXG4gICAgdmFyIHN1YiA9IG5ldyBTdWJzY3JpcHRpb24oXG4gICAgICBzZWxmLCBoYW5kbGVyLCBzdWJJZCwgcGFyYW1zLCBuYW1lKTtcblxuICAgIGxldCB1bmJsb2NrSGFuZGVyID0gc2VsZi5jYWNoZWRVbmJsb2NrO1xuICAgIC8vIF9zdGFydFN1YnNjcmlwdGlvbiBtYXkgY2FsbCBmcm9tIGEgbG90IHBsYWNlc1xuICAgIC8vIHNvIGNhY2hlZFVuYmxvY2sgbWlnaHQgYmUgbnVsbCBpbiBzb21lY2FzZXNcbiAgICAvLyBhc3NpZ24gdGhlIGNhY2hlZFVuYmxvY2tcbiAgICBzdWIudW5ibG9jayA9IHVuYmxvY2tIYW5kZXIgfHwgKCgpID0+IHt9KTtcblxuICAgIGlmIChzdWJJZClcbiAgICAgIHNlbGYuX25hbWVkU3Vicy5zZXQoc3ViSWQsIHN1Yik7XG4gICAgZWxzZVxuICAgICAgc2VsZi5fdW5pdmVyc2FsU3Vicy5wdXNoKHN1Yik7XG5cbiAgICBzdWIuX3J1bkhhbmRsZXIoKTtcbiAgfSxcblxuICAvLyB0ZWFyIGRvd24gc3BlY2lmaWVkIHN1YnNjcmlwdGlvblxuICBfc3RvcFN1YnNjcmlwdGlvbjogZnVuY3Rpb24gKHN1YklkLCBlcnJvcikge1xuICAgIHZhciBzZWxmID0gdGhpcztcblxuICAgIHZhciBzdWJOYW1lID0gbnVsbDtcbiAgICBpZiAoc3ViSWQpIHtcbiAgICAgIHZhciBtYXliZVN1YiA9IHNlbGYuX25hbWVkU3Vicy5nZXQoc3ViSWQpO1xuICAgICAgaWYgKG1heWJlU3ViKSB7XG4gICAgICAgIHN1Yk5hbWUgPSBtYXliZVN1Yi5fbmFtZTtcbiAgICAgICAgbWF5YmVTdWIuX3JlbW92ZUFsbERvY3VtZW50cygpO1xuICAgICAgICBtYXliZVN1Yi5fZGVhY3RpdmF0ZSgpO1xuICAgICAgICBzZWxmLl9uYW1lZFN1YnMuZGVsZXRlKHN1YklkKTtcbiAgICAgIH1cbiAgICB9XG5cbiAgICB2YXIgcmVzcG9uc2UgPSB7bXNnOiAnbm9zdWInLCBpZDogc3ViSWR9O1xuXG4gICAgaWYgKGVycm9yKSB7XG4gICAgICByZXNwb25zZS5lcnJvciA9IHdyYXBJbnRlcm5hbEV4Y2VwdGlvbihcbiAgICAgICAgZXJyb3IsXG4gICAgICAgIHN1Yk5hbWUgPyAoXCJmcm9tIHN1YiBcIiArIHN1Yk5hbWUgKyBcIiBpZCBcIiArIHN1YklkKVxuICAgICAgICAgIDogKFwiZnJvbSBzdWIgaWQgXCIgKyBzdWJJZCkpO1xuICAgIH1cblxuICAgIHNlbGYuc2VuZChyZXNwb25zZSk7XG4gIH0sXG5cbiAgLy8gdGVhciBkb3duIGFsbCBzdWJzY3JpcHRpb25zLiBOb3RlIHRoYXQgdGhpcyBkb2VzIE5PVCBzZW5kIHJlbW92ZWQgb3Igbm9zdWJcbiAgLy8gbWVzc2FnZXMsIHNpbmNlIHdlIGFzc3VtZSB0aGUgY2xpZW50IGlzIGdvbmUuXG4gIF9kZWFjdGl2YXRlQWxsU3Vic2NyaXB0aW9uczogZnVuY3Rpb24gKCkge1xuICAgIHZhciBzZWxmID0gdGhpcztcblxuICAgIHNlbGYuX25hbWVkU3Vicy5mb3JFYWNoKGZ1bmN0aW9uIChzdWIsIGlkKSB7XG4gICAgICBzdWIuX2RlYWN0aXZhdGUoKTtcbiAgICB9KTtcbiAgICBzZWxmLl9uYW1lZFN1YnMgPSBuZXcgTWFwKCk7XG5cbiAgICBzZWxmLl91bml2ZXJzYWxTdWJzLmZvckVhY2goZnVuY3Rpb24gKHN1Yikge1xuICAgICAgc3ViLl9kZWFjdGl2YXRlKCk7XG4gICAgfSk7XG4gICAgc2VsZi5fdW5pdmVyc2FsU3VicyA9IFtdO1xuICB9LFxuXG4gIC8vIERldGVybWluZSB0aGUgcmVtb3RlIGNsaWVudCdzIElQIGFkZHJlc3MsIGJhc2VkIG9uIHRoZVxuICAvLyBIVFRQX0ZPUldBUkRFRF9DT1VOVCBlbnZpcm9ubWVudCB2YXJpYWJsZSByZXByZXNlbnRpbmcgaG93IG1hbnlcbiAgLy8gcHJveGllcyB0aGUgc2VydmVyIGlzIGJlaGluZC5cbiAgX2NsaWVudEFkZHJlc3M6IGZ1bmN0aW9uICgpIHtcbiAgICB2YXIgc2VsZiA9IHRoaXM7XG5cbiAgICAvLyBGb3IgdGhlIHJlcG9ydGVkIGNsaWVudCBhZGRyZXNzIGZvciBhIGNvbm5lY3Rpb24gdG8gYmUgY29ycmVjdCxcbiAgICAvLyB0aGUgZGV2ZWxvcGVyIG11c3Qgc2V0IHRoZSBIVFRQX0ZPUldBUkRFRF9DT1VOVCBlbnZpcm9ubWVudFxuICAgIC8vIHZhcmlhYmxlIHRvIGFuIGludGVnZXIgcmVwcmVzZW50aW5nIHRoZSBudW1iZXIgb2YgaG9wcyB0aGV5XG4gICAgLy8gZXhwZWN0IGluIHRoZSBgeC1mb3J3YXJkZWQtZm9yYCBoZWFkZXIuIEUuZy4sIHNldCB0byBcIjFcIiBpZiB0aGVcbiAgICAvLyBzZXJ2ZXIgaXMgYmVoaW5kIG9uZSBwcm94eS5cbiAgICAvL1xuICAgIC8vIFRoaXMgY291bGQgYmUgY29tcHV0ZWQgb25jZSBhdCBzdGFydHVwIGluc3RlYWQgb2YgZXZlcnkgdGltZS5cbiAgICB2YXIgaHR0cEZvcndhcmRlZENvdW50ID0gcGFyc2VJbnQocHJvY2Vzcy5lbnZbJ0hUVFBfRk9SV0FSREVEX0NPVU5UJ10pIHx8IDA7XG5cbiAgICBpZiAoaHR0cEZvcndhcmRlZENvdW50ID09PSAwKVxuICAgICAgcmV0dXJuIHNlbGYuc29ja2V0LnJlbW90ZUFkZHJlc3M7XG5cbiAgICB2YXIgZm9yd2FyZGVkRm9yID0gc2VsZi5zb2NrZXQuaGVhZGVyc1tcIngtZm9yd2FyZGVkLWZvclwiXTtcbiAgICBpZiAoISBfLmlzU3RyaW5nKGZvcndhcmRlZEZvcikpXG4gICAgICByZXR1cm4gbnVsbDtcbiAgICBmb3J3YXJkZWRGb3IgPSBmb3J3YXJkZWRGb3IudHJpbSgpLnNwbGl0KC9cXHMqLFxccyovKTtcblxuICAgIC8vIFR5cGljYWxseSB0aGUgZmlyc3QgdmFsdWUgaW4gdGhlIGB4LWZvcndhcmRlZC1mb3JgIGhlYWRlciBpc1xuICAgIC8vIHRoZSBvcmlnaW5hbCBJUCBhZGRyZXNzIG9mIHRoZSBjbGllbnQgY29ubmVjdGluZyB0byB0aGUgZmlyc3RcbiAgICAvLyBwcm94eS4gIEhvd2V2ZXIsIHRoZSBlbmQgdXNlciBjYW4gZWFzaWx5IHNwb29mIHRoZSBoZWFkZXIsIGluXG4gICAgLy8gd2hpY2ggY2FzZSB0aGUgZmlyc3QgdmFsdWUocykgd2lsbCBiZSB0aGUgZmFrZSBJUCBhZGRyZXNzIGZyb21cbiAgICAvLyB0aGUgdXNlciBwcmV0ZW5kaW5nIHRvIGJlIGEgcHJveHkgcmVwb3J0aW5nIHRoZSBvcmlnaW5hbCBJUFxuICAgIC8vIGFkZHJlc3MgdmFsdWUuICBCeSBjb3VudGluZyBIVFRQX0ZPUldBUkRFRF9DT1VOVCBiYWNrIGZyb20gdGhlXG4gICAgLy8gZW5kIG9mIHRoZSBsaXN0LCB3ZSBlbnN1cmUgdGhhdCB3ZSBnZXQgdGhlIElQIGFkZHJlc3MgYmVpbmdcbiAgICAvLyByZXBvcnRlZCBieSAqb3VyKiBmaXJzdCBwcm94eS5cblxuICAgIGlmIChodHRwRm9yd2FyZGVkQ291bnQgPCAwIHx8IGh0dHBGb3J3YXJkZWRDb3VudCA+IGZvcndhcmRlZEZvci5sZW5ndGgpXG4gICAgICByZXR1cm4gbnVsbDtcblxuICAgIHJldHVybiBmb3J3YXJkZWRGb3JbZm9yd2FyZGVkRm9yLmxlbmd0aCAtIGh0dHBGb3J3YXJkZWRDb3VudF07XG4gIH1cbn0pO1xuXG4vKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqL1xuLyogU3Vic2NyaXB0aW9uICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgKi9cbi8qKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKiovXG5cbi8vIGN0b3IgZm9yIGEgc3ViIGhhbmRsZTogdGhlIGlucHV0IHRvIGVhY2ggcHVibGlzaCBmdW5jdGlvblxuXG4vLyBJbnN0YW5jZSBuYW1lIGlzIHRoaXMgYmVjYXVzZSBpdCdzIHVzdWFsbHkgcmVmZXJyZWQgdG8gYXMgdGhpcyBpbnNpZGUgYVxuLy8gcHVibGlzaFxuLyoqXG4gKiBAc3VtbWFyeSBUaGUgc2VydmVyJ3Mgc2lkZSBvZiBhIHN1YnNjcmlwdGlvblxuICogQGNsYXNzIFN1YnNjcmlwdGlvblxuICogQGluc3RhbmNlTmFtZSB0aGlzXG4gKiBAc2hvd0luc3RhbmNlTmFtZSB0cnVlXG4gKi9cbnZhciBTdWJzY3JpcHRpb24gPSBmdW5jdGlvbiAoXG4gICAgc2Vzc2lvbiwgaGFuZGxlciwgc3Vic2NyaXB0aW9uSWQsIHBhcmFtcywgbmFtZSkge1xuICB2YXIgc2VsZiA9IHRoaXM7XG4gIHNlbGYuX3Nlc3Npb24gPSBzZXNzaW9uOyAvLyB0eXBlIGlzIFNlc3Npb25cblxuICAvKipcbiAgICogQHN1bW1hcnkgQWNjZXNzIGluc2lkZSB0aGUgcHVibGlzaCBmdW5jdGlvbi4gVGhlIGluY29taW5nIFtjb25uZWN0aW9uXSgjbWV0ZW9yX29uY29ubmVjdGlvbikgZm9yIHRoaXMgc3Vic2NyaXB0aW9uLlxuICAgKiBAbG9jdXMgU2VydmVyXG4gICAqIEBuYW1lICBjb25uZWN0aW9uXG4gICAqIEBtZW1iZXJPZiBTdWJzY3JpcHRpb25cbiAgICogQGluc3RhbmNlXG4gICAqL1xuICBzZWxmLmNvbm5lY3Rpb24gPSBzZXNzaW9uLmNvbm5lY3Rpb25IYW5kbGU7IC8vIHB1YmxpYyBBUEkgb2JqZWN0XG5cbiAgc2VsZi5faGFuZGxlciA9IGhhbmRsZXI7XG5cbiAgLy8gbXkgc3Vic2NyaXB0aW9uIElEIChnZW5lcmF0ZWQgYnkgY2xpZW50LCB1bmRlZmluZWQgZm9yIHVuaXZlcnNhbCBzdWJzKS5cbiAgc2VsZi5fc3Vic2NyaXB0aW9uSWQgPSBzdWJzY3JpcHRpb25JZDtcbiAgLy8gdW5kZWZpbmVkIGZvciB1bml2ZXJzYWwgc3Vic1xuICBzZWxmLl9uYW1lID0gbmFtZTtcblxuICBzZWxmLl9wYXJhbXMgPSBwYXJhbXMgfHwgW107XG5cbiAgLy8gT25seSBuYW1lZCBzdWJzY3JpcHRpb25zIGhhdmUgSURzLCBidXQgd2UgbmVlZCBzb21lIHNvcnQgb2Ygc3RyaW5nXG4gIC8vIGludGVybmFsbHkgdG8ga2VlcCB0cmFjayBvZiBhbGwgc3Vic2NyaXB0aW9ucyBpbnNpZGVcbiAgLy8gU2Vzc2lvbkRvY3VtZW50Vmlld3MuIFdlIHVzZSB0aGlzIHN1YnNjcmlwdGlvbkhhbmRsZSBmb3IgdGhhdC5cbiAgaWYgKHNlbGYuX3N1YnNjcmlwdGlvbklkKSB7XG4gICAgc2VsZi5fc3Vic2NyaXB0aW9uSGFuZGxlID0gJ04nICsgc2VsZi5fc3Vic2NyaXB0aW9uSWQ7XG4gIH0gZWxzZSB7XG4gICAgc2VsZi5fc3Vic2NyaXB0aW9uSGFuZGxlID0gJ1UnICsgUmFuZG9tLmlkKCk7XG4gIH1cblxuICAvLyBoYXMgX2RlYWN0aXZhdGUgYmVlbiBjYWxsZWQ/XG4gIHNlbGYuX2RlYWN0aXZhdGVkID0gZmFsc2U7XG5cbiAgLy8gc3RvcCBjYWxsYmFja3MgdG8gZy9jIHRoaXMgc3ViLiAgY2FsbGVkIHcvIHplcm8gYXJndW1lbnRzLlxuICBzZWxmLl9zdG9wQ2FsbGJhY2tzID0gW107XG5cbiAgLy8gdGhlIHNldCBvZiAoY29sbGVjdGlvbiwgZG9jdW1lbnRpZCkgdGhhdCB0aGlzIHN1YnNjcmlwdGlvbiBoYXNcbiAgLy8gYW4gb3BpbmlvbiBhYm91dFxuICBzZWxmLl9kb2N1bWVudHMgPSBuZXcgTWFwKCk7XG5cbiAgLy8gcmVtZW1iZXIgaWYgd2UgYXJlIHJlYWR5LlxuICBzZWxmLl9yZWFkeSA9IGZhbHNlO1xuXG4gIC8vIFBhcnQgb2YgdGhlIHB1YmxpYyBBUEk6IHRoZSB1c2VyIG9mIHRoaXMgc3ViLlxuXG4gIC8qKlxuICAgKiBAc3VtbWFyeSBBY2Nlc3MgaW5zaWRlIHRoZSBwdWJsaXNoIGZ1bmN0aW9uLiBUaGUgaWQgb2YgdGhlIGxvZ2dlZC1pbiB1c2VyLCBvciBgbnVsbGAgaWYgbm8gdXNlciBpcyBsb2dnZWQgaW4uXG4gICAqIEBsb2N1cyBTZXJ2ZXJcbiAgICogQG1lbWJlck9mIFN1YnNjcmlwdGlvblxuICAgKiBAbmFtZSAgdXNlcklkXG4gICAqIEBpbnN0YW5jZVxuICAgKi9cbiAgc2VsZi51c2VySWQgPSBzZXNzaW9uLnVzZXJJZDtcblxuICAvLyBGb3Igbm93LCB0aGUgaWQgZmlsdGVyIGlzIGdvaW5nIHRvIGRlZmF1bHQgdG9cbiAgLy8gdGhlIHRvL2Zyb20gRERQIG1ldGhvZHMgb24gTW9uZ29JRCwgdG9cbiAgLy8gc3BlY2lmaWNhbGx5IGRlYWwgd2l0aCBtb25nby9taW5pbW9uZ28gT2JqZWN0SWRzLlxuXG4gIC8vIExhdGVyLCB5b3Ugd2lsbCBiZSBhYmxlIHRvIG1ha2UgdGhpcyBiZSBcInJhd1wiXG4gIC8vIGlmIHlvdSB3YW50IHRvIHB1Ymxpc2ggYSBjb2xsZWN0aW9uIHRoYXQgeW91IGtub3dcbiAgLy8ganVzdCBoYXMgc3RyaW5ncyBmb3Iga2V5cyBhbmQgbm8gZnVubnkgYnVzaW5lc3MsIHRvXG4gIC8vIGEgZGRwIGNvbnN1bWVyIHRoYXQgaXNuJ3QgbWluaW1vbmdvXG5cbiAgc2VsZi5faWRGaWx0ZXIgPSB7XG4gICAgaWRTdHJpbmdpZnk6IE1vbmdvSUQuaWRTdHJpbmdpZnksXG4gICAgaWRQYXJzZTogTW9uZ29JRC5pZFBhcnNlXG4gIH07XG5cbiAgUGFja2FnZVsnZmFjdHMtYmFzZSddICYmIFBhY2thZ2VbJ2ZhY3RzLWJhc2UnXS5GYWN0cy5pbmNyZW1lbnRTZXJ2ZXJGYWN0KFxuICAgIFwibGl2ZWRhdGFcIiwgXCJzdWJzY3JpcHRpb25zXCIsIDEpO1xufTtcblxuT2JqZWN0LmFzc2lnbihTdWJzY3JpcHRpb24ucHJvdG90eXBlLCB7XG4gIF9ydW5IYW5kbGVyOiBmdW5jdGlvbigpIHtcbiAgICAvLyBYWFggc2hvdWxkIHdlIHVuYmxvY2soKSBoZXJlPyBFaXRoZXIgYmVmb3JlIHJ1bm5pbmcgdGhlIHB1Ymxpc2hcbiAgICAvLyBmdW5jdGlvbiwgb3IgYmVmb3JlIHJ1bm5pbmcgX3B1Ymxpc2hDdXJzb3IuXG4gICAgLy9cbiAgICAvLyBSaWdodCBub3csIGVhY2ggcHVibGlzaCBmdW5jdGlvbiBibG9ja3MgYWxsIGZ1dHVyZSBwdWJsaXNoZXMgYW5kXG4gICAgLy8gbWV0aG9kcyB3YWl0aW5nIG9uIGRhdGEgZnJvbSBNb25nbyAob3Igd2hhdGV2ZXIgZWxzZSB0aGUgZnVuY3Rpb25cbiAgICAvLyBibG9ja3Mgb24pLiBUaGlzIHByb2JhYmx5IHNsb3dzIHBhZ2UgbG9hZCBpbiBjb21tb24gY2FzZXMuXG5cbiAgICBpZiAoIXRoaXMudW5ibG9jaykge1xuICAgICAgdGhpcy51bmJsb2NrID0gKCkgPT4ge307XG4gICAgfVxuXG4gICAgY29uc3Qgc2VsZiA9IHRoaXM7XG4gICAgbGV0IHJlc3VsdE9yVGhlbmFibGUgPSBudWxsO1xuICAgIHRyeSB7XG4gICAgICByZXN1bHRPclRoZW5hYmxlID0gRERQLl9DdXJyZW50UHVibGljYXRpb25JbnZvY2F0aW9uLndpdGhWYWx1ZShzZWxmLCAoKSA9PlxuICAgICAgICBtYXliZUF1ZGl0QXJndW1lbnRDaGVja3MoXG4gICAgICAgICAgc2VsZi5faGFuZGxlcixcbiAgICAgICAgICBzZWxmLFxuICAgICAgICAgIEVKU09OLmNsb25lKHNlbGYuX3BhcmFtcyksXG4gICAgICAgICAgLy8gSXQncyBPSyB0aGF0IHRoaXMgd291bGQgbG9vayB3ZWlyZCBmb3IgdW5pdmVyc2FsIHN1YnNjcmlwdGlvbnMsXG4gICAgICAgICAgLy8gYmVjYXVzZSB0aGV5IGhhdmUgbm8gYXJndW1lbnRzIHNvIHRoZXJlIGNhbiBuZXZlciBiZSBhblxuICAgICAgICAgIC8vIGF1ZGl0LWFyZ3VtZW50LWNoZWNrcyBmYWlsdXJlLlxuICAgICAgICAgIFwicHVibGlzaGVyICdcIiArIHNlbGYuX25hbWUgKyBcIidcIlxuICAgICAgICApXG4gICAgICApO1xuICAgIH0gY2F0Y2ggKGUpIHtcbiAgICAgIHNlbGYuZXJyb3IoZSk7XG4gICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgLy8gRGlkIHRoZSBoYW5kbGVyIGNhbGwgdGhpcy5lcnJvciBvciB0aGlzLnN0b3A/XG4gICAgaWYgKHNlbGYuX2lzRGVhY3RpdmF0ZWQoKSkgcmV0dXJuO1xuXG4gICAgLy8gQm90aCBjb252ZW50aW9uYWwgYW5kIGFzeW5jIHB1Ymxpc2ggaGFuZGxlciBmdW5jdGlvbnMgYXJlIHN1cHBvcnRlZC5cbiAgICAvLyBJZiBhbiBvYmplY3QgaXMgcmV0dXJuZWQgd2l0aCBhIHRoZW4oKSBmdW5jdGlvbiwgaXQgaXMgZWl0aGVyIGEgcHJvbWlzZVxuICAgIC8vIG9yIHRoZW5hYmxlIGFuZCB3aWxsIGJlIHJlc29sdmVkIGFzeW5jaHJvbm91c2x5LlxuICAgIGNvbnN0IGlzVGhlbmFibGUgPVxuICAgICAgcmVzdWx0T3JUaGVuYWJsZSAmJiB0eXBlb2YgcmVzdWx0T3JUaGVuYWJsZS50aGVuID09PSAnZnVuY3Rpb24nO1xuICAgIGlmIChpc1RoZW5hYmxlKSB7XG4gICAgICBQcm9taXNlLnJlc29sdmUocmVzdWx0T3JUaGVuYWJsZSkudGhlbihcbiAgICAgICAgKC4uLmFyZ3MpID0+IHNlbGYuX3B1Ymxpc2hIYW5kbGVyUmVzdWx0LmJpbmQoc2VsZikoLi4uYXJncyksXG4gICAgICAgIGUgPT4gc2VsZi5lcnJvcihlKVxuICAgICAgKTtcbiAgICB9IGVsc2Uge1xuICAgICAgc2VsZi5fcHVibGlzaEhhbmRsZXJSZXN1bHQocmVzdWx0T3JUaGVuYWJsZSk7XG4gICAgfVxuICB9LFxuXG4gIF9wdWJsaXNoSGFuZGxlclJlc3VsdDogZnVuY3Rpb24gKHJlcykge1xuICAgIC8vIFNQRUNJQUwgQ0FTRTogSW5zdGVhZCBvZiB3cml0aW5nIHRoZWlyIG93biBjYWxsYmFja3MgdGhhdCBpbnZva2VcbiAgICAvLyB0aGlzLmFkZGVkL2NoYW5nZWQvcmVhZHkvZXRjLCB0aGUgdXNlciBjYW4ganVzdCByZXR1cm4gYSBjb2xsZWN0aW9uXG4gICAgLy8gY3Vyc29yIG9yIGFycmF5IG9mIGN1cnNvcnMgZnJvbSB0aGUgcHVibGlzaCBmdW5jdGlvbjsgd2UgY2FsbCB0aGVpclxuICAgIC8vIF9wdWJsaXNoQ3Vyc29yIG1ldGhvZCB3aGljaCBzdGFydHMgb2JzZXJ2aW5nIHRoZSBjdXJzb3IgYW5kIHB1Ymxpc2hlcyB0aGVcbiAgICAvLyByZXN1bHRzLiBOb3RlIHRoYXQgX3B1Ymxpc2hDdXJzb3IgZG9lcyBOT1QgY2FsbCByZWFkeSgpLlxuICAgIC8vXG4gICAgLy8gWFhYIFRoaXMgdXNlcyBhbiB1bmRvY3VtZW50ZWQgaW50ZXJmYWNlIHdoaWNoIG9ubHkgdGhlIE1vbmdvIGN1cnNvclxuICAgIC8vIGludGVyZmFjZSBwdWJsaXNoZXMuIFNob3VsZCB3ZSBtYWtlIHRoaXMgaW50ZXJmYWNlIHB1YmxpYyBhbmQgZW5jb3VyYWdlXG4gICAgLy8gdXNlcnMgdG8gaW1wbGVtZW50IGl0IHRoZW1zZWx2ZXM/IEFyZ3VhYmx5LCBpdCdzIHVubmVjZXNzYXJ5OyB1c2VycyBjYW5cbiAgICAvLyBhbHJlYWR5IHdyaXRlIHRoZWlyIG93biBmdW5jdGlvbnMgbGlrZVxuICAgIC8vICAgdmFyIHB1Ymxpc2hNeVJlYWN0aXZlVGhpbmd5ID0gZnVuY3Rpb24gKG5hbWUsIGhhbmRsZXIpIHtcbiAgICAvLyAgICAgTWV0ZW9yLnB1Ymxpc2gobmFtZSwgZnVuY3Rpb24gKCkge1xuICAgIC8vICAgICAgIHZhciByZWFjdGl2ZVRoaW5neSA9IGhhbmRsZXIoKTtcbiAgICAvLyAgICAgICByZWFjdGl2ZVRoaW5neS5wdWJsaXNoTWUoKTtcbiAgICAvLyAgICAgfSk7XG4gICAgLy8gICB9O1xuXG4gICAgdmFyIHNlbGYgPSB0aGlzO1xuICAgIHZhciBpc0N1cnNvciA9IGZ1bmN0aW9uIChjKSB7XG4gICAgICByZXR1cm4gYyAmJiBjLl9wdWJsaXNoQ3Vyc29yO1xuICAgIH07XG4gICAgaWYgKGlzQ3Vyc29yKHJlcykpIHtcbiAgICAgIHRyeSB7XG4gICAgICAgIHJlcy5fcHVibGlzaEN1cnNvcihzZWxmKTtcbiAgICAgIH0gY2F0Y2ggKGUpIHtcbiAgICAgICAgc2VsZi5lcnJvcihlKTtcbiAgICAgICAgcmV0dXJuO1xuICAgICAgfVxuICAgICAgLy8gX3B1Ymxpc2hDdXJzb3Igb25seSByZXR1cm5zIGFmdGVyIHRoZSBpbml0aWFsIGFkZGVkIGNhbGxiYWNrcyBoYXZlIHJ1bi5cbiAgICAgIC8vIG1hcmsgc3Vic2NyaXB0aW9uIGFzIHJlYWR5LlxuICAgICAgc2VsZi5yZWFkeSgpO1xuICAgIH0gZWxzZSBpZiAoXy5pc0FycmF5KHJlcykpIHtcbiAgICAgIC8vIGNoZWNrIGFsbCB0aGUgZWxlbWVudHMgYXJlIGN1cnNvcnNcbiAgICAgIGlmICghIF8uYWxsKHJlcywgaXNDdXJzb3IpKSB7XG4gICAgICAgIHNlbGYuZXJyb3IobmV3IEVycm9yKFwiUHVibGlzaCBmdW5jdGlvbiByZXR1cm5lZCBhbiBhcnJheSBvZiBub24tQ3Vyc29yc1wiKSk7XG4gICAgICAgIHJldHVybjtcbiAgICAgIH1cbiAgICAgIC8vIGZpbmQgZHVwbGljYXRlIGNvbGxlY3Rpb24gbmFtZXNcbiAgICAgIC8vIFhYWCB3ZSBzaG91bGQgc3VwcG9ydCBvdmVybGFwcGluZyBjdXJzb3JzLCBidXQgdGhhdCB3b3VsZCByZXF1aXJlIHRoZVxuICAgICAgLy8gbWVyZ2UgYm94IHRvIGFsbG93IG92ZXJsYXAgd2l0aGluIGEgc3Vic2NyaXB0aW9uXG4gICAgICB2YXIgY29sbGVjdGlvbk5hbWVzID0ge307XG4gICAgICBmb3IgKHZhciBpID0gMDsgaSA8IHJlcy5sZW5ndGg7ICsraSkge1xuICAgICAgICB2YXIgY29sbGVjdGlvbk5hbWUgPSByZXNbaV0uX2dldENvbGxlY3Rpb25OYW1lKCk7XG4gICAgICAgIGlmIChfLmhhcyhjb2xsZWN0aW9uTmFtZXMsIGNvbGxlY3Rpb25OYW1lKSkge1xuICAgICAgICAgIHNlbGYuZXJyb3IobmV3IEVycm9yKFxuICAgICAgICAgICAgXCJQdWJsaXNoIGZ1bmN0aW9uIHJldHVybmVkIG11bHRpcGxlIGN1cnNvcnMgZm9yIGNvbGxlY3Rpb24gXCIgK1xuICAgICAgICAgICAgICBjb2xsZWN0aW9uTmFtZSkpO1xuICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuICAgICAgICBjb2xsZWN0aW9uTmFtZXNbY29sbGVjdGlvbk5hbWVdID0gdHJ1ZTtcbiAgICAgIH07XG5cbiAgICAgIHRyeSB7XG4gICAgICAgIF8uZWFjaChyZXMsIGZ1bmN0aW9uIChjdXIpIHtcbiAgICAgICAgICBjdXIuX3B1Ymxpc2hDdXJzb3Ioc2VsZik7XG4gICAgICAgIH0pO1xuICAgICAgfSBjYXRjaCAoZSkge1xuICAgICAgICBzZWxmLmVycm9yKGUpO1xuICAgICAgICByZXR1cm47XG4gICAgICB9XG4gICAgICBzZWxmLnJlYWR5KCk7XG4gICAgfSBlbHNlIGlmIChyZXMpIHtcbiAgICAgIC8vIHRydXRoeSB2YWx1ZXMgb3RoZXIgdGhhbiBjdXJzb3JzIG9yIGFycmF5cyBhcmUgcHJvYmFibHkgYVxuICAgICAgLy8gdXNlciBtaXN0YWtlIChwb3NzaWJsZSByZXR1cm5pbmcgYSBNb25nbyBkb2N1bWVudCB2aWEsIHNheSxcbiAgICAgIC8vIGBjb2xsLmZpbmRPbmUoKWApLlxuICAgICAgc2VsZi5lcnJvcihuZXcgRXJyb3IoXCJQdWJsaXNoIGZ1bmN0aW9uIGNhbiBvbmx5IHJldHVybiBhIEN1cnNvciBvciBcIlxuICAgICAgICAgICAgICAgICAgICAgICAgICAgKyBcImFuIGFycmF5IG9mIEN1cnNvcnNcIikpO1xuICAgIH1cbiAgfSxcblxuICAvLyBUaGlzIGNhbGxzIGFsbCBzdG9wIGNhbGxiYWNrcyBhbmQgcHJldmVudHMgdGhlIGhhbmRsZXIgZnJvbSB1cGRhdGluZyBhbnlcbiAgLy8gU2Vzc2lvbkNvbGxlY3Rpb25WaWV3cyBmdXJ0aGVyLiBJdCdzIHVzZWQgd2hlbiB0aGUgdXNlciB1bnN1YnNjcmliZXMgb3JcbiAgLy8gZGlzY29ubmVjdHMsIGFzIHdlbGwgYXMgZHVyaW5nIHNldFVzZXJJZCByZS1ydW5zLiBJdCBkb2VzICpOT1QqIHNlbmRcbiAgLy8gcmVtb3ZlZCBtZXNzYWdlcyBmb3IgdGhlIHB1Ymxpc2hlZCBvYmplY3RzOyBpZiB0aGF0IGlzIG5lY2Vzc2FyeSwgY2FsbFxuICAvLyBfcmVtb3ZlQWxsRG9jdW1lbnRzIGZpcnN0LlxuICBfZGVhY3RpdmF0ZTogZnVuY3Rpb24oKSB7XG4gICAgdmFyIHNlbGYgPSB0aGlzO1xuICAgIGlmIChzZWxmLl9kZWFjdGl2YXRlZClcbiAgICAgIHJldHVybjtcbiAgICBzZWxmLl9kZWFjdGl2YXRlZCA9IHRydWU7XG4gICAgc2VsZi5fY2FsbFN0b3BDYWxsYmFja3MoKTtcbiAgICBQYWNrYWdlWydmYWN0cy1iYXNlJ10gJiYgUGFja2FnZVsnZmFjdHMtYmFzZSddLkZhY3RzLmluY3JlbWVudFNlcnZlckZhY3QoXG4gICAgICBcImxpdmVkYXRhXCIsIFwic3Vic2NyaXB0aW9uc1wiLCAtMSk7XG4gIH0sXG5cbiAgX2NhbGxTdG9wQ2FsbGJhY2tzOiBmdW5jdGlvbiAoKSB7XG4gICAgdmFyIHNlbGYgPSB0aGlzO1xuICAgIC8vIHRlbGwgbGlzdGVuZXJzLCBzbyB0aGV5IGNhbiBjbGVhbiB1cFxuICAgIHZhciBjYWxsYmFja3MgPSBzZWxmLl9zdG9wQ2FsbGJhY2tzO1xuICAgIHNlbGYuX3N0b3BDYWxsYmFja3MgPSBbXTtcbiAgICBfLmVhY2goY2FsbGJhY2tzLCBmdW5jdGlvbiAoY2FsbGJhY2spIHtcbiAgICAgIGNhbGxiYWNrKCk7XG4gICAgfSk7XG4gIH0sXG5cbiAgLy8gU2VuZCByZW1vdmUgbWVzc2FnZXMgZm9yIGV2ZXJ5IGRvY3VtZW50LlxuICBfcmVtb3ZlQWxsRG9jdW1lbnRzOiBmdW5jdGlvbiAoKSB7XG4gICAgdmFyIHNlbGYgPSB0aGlzO1xuICAgIE1ldGVvci5fbm9ZaWVsZHNBbGxvd2VkKGZ1bmN0aW9uICgpIHtcbiAgICAgIHNlbGYuX2RvY3VtZW50cy5mb3JFYWNoKGZ1bmN0aW9uIChjb2xsZWN0aW9uRG9jcywgY29sbGVjdGlvbk5hbWUpIHtcbiAgICAgICAgY29sbGVjdGlvbkRvY3MuZm9yRWFjaChmdW5jdGlvbiAoc3RySWQpIHtcbiAgICAgICAgICBzZWxmLnJlbW92ZWQoY29sbGVjdGlvbk5hbWUsIHNlbGYuX2lkRmlsdGVyLmlkUGFyc2Uoc3RySWQpKTtcbiAgICAgICAgfSk7XG4gICAgICB9KTtcbiAgICB9KTtcbiAgfSxcblxuICAvLyBSZXR1cm5zIGEgbmV3IFN1YnNjcmlwdGlvbiBmb3IgdGhlIHNhbWUgc2Vzc2lvbiB3aXRoIHRoZSBzYW1lXG4gIC8vIGluaXRpYWwgY3JlYXRpb24gcGFyYW1ldGVycy4gVGhpcyBpc24ndCBhIGNsb25lOiBpdCBkb2Vzbid0IGhhdmVcbiAgLy8gdGhlIHNhbWUgX2RvY3VtZW50cyBjYWNoZSwgc3RvcHBlZCBzdGF0ZSBvciBjYWxsYmFja3M7IG1heSBoYXZlIGFcbiAgLy8gZGlmZmVyZW50IF9zdWJzY3JpcHRpb25IYW5kbGUsIGFuZCBnZXRzIGl0cyB1c2VySWQgZnJvbSB0aGVcbiAgLy8gc2Vzc2lvbiwgbm90IGZyb20gdGhpcyBvYmplY3QuXG4gIF9yZWNyZWF0ZTogZnVuY3Rpb24gKCkge1xuICAgIHZhciBzZWxmID0gdGhpcztcbiAgICByZXR1cm4gbmV3IFN1YnNjcmlwdGlvbihcbiAgICAgIHNlbGYuX3Nlc3Npb24sIHNlbGYuX2hhbmRsZXIsIHNlbGYuX3N1YnNjcmlwdGlvbklkLCBzZWxmLl9wYXJhbXMsXG4gICAgICBzZWxmLl9uYW1lKTtcbiAgfSxcblxuICAvKipcbiAgICogQHN1bW1hcnkgQ2FsbCBpbnNpZGUgdGhlIHB1Ymxpc2ggZnVuY3Rpb24uICBTdG9wcyB0aGlzIGNsaWVudCdzIHN1YnNjcmlwdGlvbiwgdHJpZ2dlcmluZyBhIGNhbGwgb24gdGhlIGNsaWVudCB0byB0aGUgYG9uU3RvcGAgY2FsbGJhY2sgcGFzc2VkIHRvIFtgTWV0ZW9yLnN1YnNjcmliZWBdKCNtZXRlb3Jfc3Vic2NyaWJlKSwgaWYgYW55LiBJZiBgZXJyb3JgIGlzIG5vdCBhIFtgTWV0ZW9yLkVycm9yYF0oI21ldGVvcl9lcnJvciksIGl0IHdpbGwgYmUgW3Nhbml0aXplZF0oI21ldGVvcl9lcnJvcikuXG4gICAqIEBsb2N1cyBTZXJ2ZXJcbiAgICogQHBhcmFtIHtFcnJvcn0gZXJyb3IgVGhlIGVycm9yIHRvIHBhc3MgdG8gdGhlIGNsaWVudC5cbiAgICogQGluc3RhbmNlXG4gICAqIEBtZW1iZXJPZiBTdWJzY3JpcHRpb25cbiAgICovXG4gIGVycm9yOiBmdW5jdGlvbiAoZXJyb3IpIHtcbiAgICB2YXIgc2VsZiA9IHRoaXM7XG4gICAgaWYgKHNlbGYuX2lzRGVhY3RpdmF0ZWQoKSlcbiAgICAgIHJldHVybjtcbiAgICBzZWxmLl9zZXNzaW9uLl9zdG9wU3Vic2NyaXB0aW9uKHNlbGYuX3N1YnNjcmlwdGlvbklkLCBlcnJvcik7XG4gIH0sXG5cbiAgLy8gTm90ZSB0aGF0IHdoaWxlIG91ciBERFAgY2xpZW50IHdpbGwgbm90aWNlIHRoYXQgeW91J3ZlIGNhbGxlZCBzdG9wKCkgb24gdGhlXG4gIC8vIHNlcnZlciAoYW5kIGNsZWFuIHVwIGl0cyBfc3Vic2NyaXB0aW9ucyB0YWJsZSkgd2UgZG9uJ3QgYWN0dWFsbHkgcHJvdmlkZSBhXG4gIC8vIG1lY2hhbmlzbSBmb3IgYW4gYXBwIHRvIG5vdGljZSB0aGlzICh0aGUgc3Vic2NyaWJlIG9uRXJyb3IgY2FsbGJhY2sgb25seVxuICAvLyB0cmlnZ2VycyBpZiB0aGVyZSBpcyBhbiBlcnJvcikuXG5cbiAgLyoqXG4gICAqIEBzdW1tYXJ5IENhbGwgaW5zaWRlIHRoZSBwdWJsaXNoIGZ1bmN0aW9uLiAgU3RvcHMgdGhpcyBjbGllbnQncyBzdWJzY3JpcHRpb24gYW5kIGludm9rZXMgdGhlIGNsaWVudCdzIGBvblN0b3BgIGNhbGxiYWNrIHdpdGggbm8gZXJyb3IuXG4gICAqIEBsb2N1cyBTZXJ2ZXJcbiAgICogQGluc3RhbmNlXG4gICAqIEBtZW1iZXJPZiBTdWJzY3JpcHRpb25cbiAgICovXG4gIHN0b3A6IGZ1bmN0aW9uICgpIHtcbiAgICB2YXIgc2VsZiA9IHRoaXM7XG4gICAgaWYgKHNlbGYuX2lzRGVhY3RpdmF0ZWQoKSlcbiAgICAgIHJldHVybjtcbiAgICBzZWxmLl9zZXNzaW9uLl9zdG9wU3Vic2NyaXB0aW9uKHNlbGYuX3N1YnNjcmlwdGlvbklkKTtcbiAgfSxcblxuICAvKipcbiAgICogQHN1bW1hcnkgQ2FsbCBpbnNpZGUgdGhlIHB1Ymxpc2ggZnVuY3Rpb24uICBSZWdpc3RlcnMgYSBjYWxsYmFjayBmdW5jdGlvbiB0byBydW4gd2hlbiB0aGUgc3Vic2NyaXB0aW9uIGlzIHN0b3BwZWQuXG4gICAqIEBsb2N1cyBTZXJ2ZXJcbiAgICogQG1lbWJlck9mIFN1YnNjcmlwdGlvblxuICAgKiBAaW5zdGFuY2VcbiAgICogQHBhcmFtIHtGdW5jdGlvbn0gZnVuYyBUaGUgY2FsbGJhY2sgZnVuY3Rpb25cbiAgICovXG4gIG9uU3RvcDogZnVuY3Rpb24gKGNhbGxiYWNrKSB7XG4gICAgdmFyIHNlbGYgPSB0aGlzO1xuICAgIGNhbGxiYWNrID0gTWV0ZW9yLmJpbmRFbnZpcm9ubWVudChjYWxsYmFjaywgJ29uU3RvcCBjYWxsYmFjaycsIHNlbGYpO1xuICAgIGlmIChzZWxmLl9pc0RlYWN0aXZhdGVkKCkpXG4gICAgICBjYWxsYmFjaygpO1xuICAgIGVsc2VcbiAgICAgIHNlbGYuX3N0b3BDYWxsYmFja3MucHVzaChjYWxsYmFjayk7XG4gIH0sXG5cbiAgLy8gVGhpcyByZXR1cm5zIHRydWUgaWYgdGhlIHN1YiBoYXMgYmVlbiBkZWFjdGl2YXRlZCwgKk9SKiBpZiB0aGUgc2Vzc2lvbiB3YXNcbiAgLy8gZGVzdHJveWVkIGJ1dCB0aGUgZGVmZXJyZWQgY2FsbCB0byBfZGVhY3RpdmF0ZUFsbFN1YnNjcmlwdGlvbnMgaGFzbid0XG4gIC8vIGhhcHBlbmVkIHlldC5cbiAgX2lzRGVhY3RpdmF0ZWQ6IGZ1bmN0aW9uICgpIHtcbiAgICB2YXIgc2VsZiA9IHRoaXM7XG4gICAgcmV0dXJuIHNlbGYuX2RlYWN0aXZhdGVkIHx8IHNlbGYuX3Nlc3Npb24uaW5RdWV1ZSA9PT0gbnVsbDtcbiAgfSxcblxuICAvKipcbiAgICogQHN1bW1hcnkgQ2FsbCBpbnNpZGUgdGhlIHB1Ymxpc2ggZnVuY3Rpb24uICBJbmZvcm1zIHRoZSBzdWJzY3JpYmVyIHRoYXQgYSBkb2N1bWVudCBoYXMgYmVlbiBhZGRlZCB0byB0aGUgcmVjb3JkIHNldC5cbiAgICogQGxvY3VzIFNlcnZlclxuICAgKiBAbWVtYmVyT2YgU3Vic2NyaXB0aW9uXG4gICAqIEBpbnN0YW5jZVxuICAgKiBAcGFyYW0ge1N0cmluZ30gY29sbGVjdGlvbiBUaGUgbmFtZSBvZiB0aGUgY29sbGVjdGlvbiB0aGF0IGNvbnRhaW5zIHRoZSBuZXcgZG9jdW1lbnQuXG4gICAqIEBwYXJhbSB7U3RyaW5nfSBpZCBUaGUgbmV3IGRvY3VtZW50J3MgSUQuXG4gICAqIEBwYXJhbSB7T2JqZWN0fSBmaWVsZHMgVGhlIGZpZWxkcyBpbiB0aGUgbmV3IGRvY3VtZW50LiAgSWYgYF9pZGAgaXMgcHJlc2VudCBpdCBpcyBpZ25vcmVkLlxuICAgKi9cbiAgYWRkZWQ6IGZ1bmN0aW9uIChjb2xsZWN0aW9uTmFtZSwgaWQsIGZpZWxkcykge1xuICAgIHZhciBzZWxmID0gdGhpcztcbiAgICBpZiAoc2VsZi5faXNEZWFjdGl2YXRlZCgpKVxuICAgICAgcmV0dXJuO1xuICAgIGlkID0gc2VsZi5faWRGaWx0ZXIuaWRTdHJpbmdpZnkoaWQpO1xuICAgIGxldCBpZHMgPSBzZWxmLl9kb2N1bWVudHMuZ2V0KGNvbGxlY3Rpb25OYW1lKTtcbiAgICBpZiAoaWRzID09IG51bGwpIHtcbiAgICAgIGlkcyA9IG5ldyBTZXQoKTtcbiAgICAgIHNlbGYuX2RvY3VtZW50cy5zZXQoY29sbGVjdGlvbk5hbWUsIGlkcyk7XG4gICAgfVxuICAgIGlkcy5hZGQoaWQpO1xuICAgIHNlbGYuX3Nlc3Npb24uYWRkZWQoc2VsZi5fc3Vic2NyaXB0aW9uSGFuZGxlLCBjb2xsZWN0aW9uTmFtZSwgaWQsIGZpZWxkcyk7XG4gIH0sXG5cbiAgLyoqXG4gICAqIEBzdW1tYXJ5IENhbGwgaW5zaWRlIHRoZSBwdWJsaXNoIGZ1bmN0aW9uLiAgSW5mb3JtcyB0aGUgc3Vic2NyaWJlciB0aGF0IGEgZG9jdW1lbnQgaW4gdGhlIHJlY29yZCBzZXQgaGFzIGJlZW4gbW9kaWZpZWQuXG4gICAqIEBsb2N1cyBTZXJ2ZXJcbiAgICogQG1lbWJlck9mIFN1YnNjcmlwdGlvblxuICAgKiBAaW5zdGFuY2VcbiAgICogQHBhcmFtIHtTdHJpbmd9IGNvbGxlY3Rpb24gVGhlIG5hbWUgb2YgdGhlIGNvbGxlY3Rpb24gdGhhdCBjb250YWlucyB0aGUgY2hhbmdlZCBkb2N1bWVudC5cbiAgICogQHBhcmFtIHtTdHJpbmd9IGlkIFRoZSBjaGFuZ2VkIGRvY3VtZW50J3MgSUQuXG4gICAqIEBwYXJhbSB7T2JqZWN0fSBmaWVsZHMgVGhlIGZpZWxkcyBpbiB0aGUgZG9jdW1lbnQgdGhhdCBoYXZlIGNoYW5nZWQsIHRvZ2V0aGVyIHdpdGggdGhlaXIgbmV3IHZhbHVlcy4gIElmIGEgZmllbGQgaXMgbm90IHByZXNlbnQgaW4gYGZpZWxkc2AgaXQgd2FzIGxlZnQgdW5jaGFuZ2VkOyBpZiBpdCBpcyBwcmVzZW50IGluIGBmaWVsZHNgIGFuZCBoYXMgYSB2YWx1ZSBvZiBgdW5kZWZpbmVkYCBpdCB3YXMgcmVtb3ZlZCBmcm9tIHRoZSBkb2N1bWVudC4gIElmIGBfaWRgIGlzIHByZXNlbnQgaXQgaXMgaWdub3JlZC5cbiAgICovXG4gIGNoYW5nZWQ6IGZ1bmN0aW9uIChjb2xsZWN0aW9uTmFtZSwgaWQsIGZpZWxkcykge1xuICAgIHZhciBzZWxmID0gdGhpcztcbiAgICBpZiAoc2VsZi5faXNEZWFjdGl2YXRlZCgpKVxuICAgICAgcmV0dXJuO1xuICAgIGlkID0gc2VsZi5faWRGaWx0ZXIuaWRTdHJpbmdpZnkoaWQpO1xuICAgIHNlbGYuX3Nlc3Npb24uY2hhbmdlZChzZWxmLl9zdWJzY3JpcHRpb25IYW5kbGUsIGNvbGxlY3Rpb25OYW1lLCBpZCwgZmllbGRzKTtcbiAgfSxcblxuICAvKipcbiAgICogQHN1bW1hcnkgQ2FsbCBpbnNpZGUgdGhlIHB1Ymxpc2ggZnVuY3Rpb24uICBJbmZvcm1zIHRoZSBzdWJzY3JpYmVyIHRoYXQgYSBkb2N1bWVudCBoYXMgYmVlbiByZW1vdmVkIGZyb20gdGhlIHJlY29yZCBzZXQuXG4gICAqIEBsb2N1cyBTZXJ2ZXJcbiAgICogQG1lbWJlck9mIFN1YnNjcmlwdGlvblxuICAgKiBAaW5zdGFuY2VcbiAgICogQHBhcmFtIHtTdHJpbmd9IGNvbGxlY3Rpb24gVGhlIG5hbWUgb2YgdGhlIGNvbGxlY3Rpb24gdGhhdCB0aGUgZG9jdW1lbnQgaGFzIGJlZW4gcmVtb3ZlZCBmcm9tLlxuICAgKiBAcGFyYW0ge1N0cmluZ30gaWQgVGhlIElEIG9mIHRoZSBkb2N1bWVudCB0aGF0IGhhcyBiZWVuIHJlbW92ZWQuXG4gICAqL1xuICByZW1vdmVkOiBmdW5jdGlvbiAoY29sbGVjdGlvbk5hbWUsIGlkKSB7XG4gICAgdmFyIHNlbGYgPSB0aGlzO1xuICAgIGlmIChzZWxmLl9pc0RlYWN0aXZhdGVkKCkpXG4gICAgICByZXR1cm47XG4gICAgaWQgPSBzZWxmLl9pZEZpbHRlci5pZFN0cmluZ2lmeShpZCk7XG4gICAgLy8gV2UgZG9uJ3QgYm90aGVyIHRvIGRlbGV0ZSBzZXRzIG9mIHRoaW5ncyBpbiBhIGNvbGxlY3Rpb24gaWYgdGhlXG4gICAgLy8gY29sbGVjdGlvbiBpcyBlbXB0eS4gIEl0IGNvdWxkIGJyZWFrIF9yZW1vdmVBbGxEb2N1bWVudHMuXG4gICAgc2VsZi5fZG9jdW1lbnRzLmdldChjb2xsZWN0aW9uTmFtZSkuZGVsZXRlKGlkKTtcbiAgICBzZWxmLl9zZXNzaW9uLnJlbW92ZWQoc2VsZi5fc3Vic2NyaXB0aW9uSGFuZGxlLCBjb2xsZWN0aW9uTmFtZSwgaWQpO1xuICB9LFxuXG4gIC8qKlxuICAgKiBAc3VtbWFyeSBDYWxsIGluc2lkZSB0aGUgcHVibGlzaCBmdW5jdGlvbi4gIEluZm9ybXMgdGhlIHN1YnNjcmliZXIgdGhhdCBhbiBpbml0aWFsLCBjb21wbGV0ZSBzbmFwc2hvdCBvZiB0aGUgcmVjb3JkIHNldCBoYXMgYmVlbiBzZW50LiAgVGhpcyB3aWxsIHRyaWdnZXIgYSBjYWxsIG9uIHRoZSBjbGllbnQgdG8gdGhlIGBvblJlYWR5YCBjYWxsYmFjayBwYXNzZWQgdG8gIFtgTWV0ZW9yLnN1YnNjcmliZWBdKCNtZXRlb3Jfc3Vic2NyaWJlKSwgaWYgYW55LlxuICAgKiBAbG9jdXMgU2VydmVyXG4gICAqIEBtZW1iZXJPZiBTdWJzY3JpcHRpb25cbiAgICogQGluc3RhbmNlXG4gICAqL1xuICByZWFkeTogZnVuY3Rpb24gKCkge1xuICAgIHZhciBzZWxmID0gdGhpcztcbiAgICBpZiAoc2VsZi5faXNEZWFjdGl2YXRlZCgpKVxuICAgICAgcmV0dXJuO1xuICAgIGlmICghc2VsZi5fc3Vic2NyaXB0aW9uSWQpXG4gICAgICByZXR1cm47ICAvLyB1bm5lY2Vzc2FyeSBidXQgaWdub3JlZCBmb3IgdW5pdmVyc2FsIHN1YlxuICAgIGlmICghc2VsZi5fcmVhZHkpIHtcbiAgICAgIHNlbGYuX3Nlc3Npb24uc2VuZFJlYWR5KFtzZWxmLl9zdWJzY3JpcHRpb25JZF0pO1xuICAgICAgc2VsZi5fcmVhZHkgPSB0cnVlO1xuICAgIH1cbiAgfVxufSk7XG5cbi8qKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKiovXG4vKiBTZXJ2ZXIgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAqL1xuLyoqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKi9cblxuU2VydmVyID0gZnVuY3Rpb24gKG9wdGlvbnMpIHtcbiAgdmFyIHNlbGYgPSB0aGlzO1xuXG4gIC8vIFRoZSBkZWZhdWx0IGhlYXJ0YmVhdCBpbnRlcnZhbCBpcyAzMCBzZWNvbmRzIG9uIHRoZSBzZXJ2ZXIgYW5kIDM1XG4gIC8vIHNlY29uZHMgb24gdGhlIGNsaWVudC4gIFNpbmNlIHRoZSBjbGllbnQgZG9lc24ndCBuZWVkIHRvIHNlbmQgYVxuICAvLyBwaW5nIGFzIGxvbmcgYXMgaXQgaXMgcmVjZWl2aW5nIHBpbmdzLCB0aGlzIG1lYW5zIHRoYXQgcGluZ3NcbiAgLy8gbm9ybWFsbHkgZ28gZnJvbSB0aGUgc2VydmVyIHRvIHRoZSBjbGllbnQuXG4gIC8vXG4gIC8vIE5vdGU6IFRyb3Bvc3BoZXJlIGRlcGVuZHMgb24gdGhlIGFiaWxpdHkgdG8gbXV0YXRlXG4gIC8vIE1ldGVvci5zZXJ2ZXIub3B0aW9ucy5oZWFydGJlYXRUaW1lb3V0ISBUaGlzIGlzIGEgaGFjaywgYnV0IGl0J3MgbGlmZS5cbiAgc2VsZi5vcHRpb25zID0gXy5kZWZhdWx0cyhvcHRpb25zIHx8IHt9LCB7XG4gICAgaGVhcnRiZWF0SW50ZXJ2YWw6IDE1MDAwLFxuICAgIGhlYXJ0YmVhdFRpbWVvdXQ6IDE1MDAwLFxuICAgIC8vIEZvciB0ZXN0aW5nLCBhbGxvdyByZXNwb25kaW5nIHRvIHBpbmdzIHRvIGJlIGRpc2FibGVkLlxuICAgIHJlc3BvbmRUb1BpbmdzOiB0cnVlXG4gIH0pO1xuXG4gIC8vIE1hcCBvZiBjYWxsYmFja3MgdG8gY2FsbCB3aGVuIGEgbmV3IGNvbm5lY3Rpb24gY29tZXMgaW4gdG8gdGhlXG4gIC8vIHNlcnZlciBhbmQgY29tcGxldGVzIEREUCB2ZXJzaW9uIG5lZ290aWF0aW9uLiBVc2UgYW4gb2JqZWN0IGluc3RlYWRcbiAgLy8gb2YgYW4gYXJyYXkgc28gd2UgY2FuIHNhZmVseSByZW1vdmUgb25lIGZyb20gdGhlIGxpc3Qgd2hpbGVcbiAgLy8gaXRlcmF0aW5nIG92ZXIgaXQuXG4gIHNlbGYub25Db25uZWN0aW9uSG9vayA9IG5ldyBIb29rKHtcbiAgICBkZWJ1Z1ByaW50RXhjZXB0aW9uczogXCJvbkNvbm5lY3Rpb24gY2FsbGJhY2tcIlxuICB9KTtcblxuICAvLyBNYXAgb2YgY2FsbGJhY2tzIHRvIGNhbGwgd2hlbiBhIG5ldyBtZXNzYWdlIGNvbWVzIGluLlxuICBzZWxmLm9uTWVzc2FnZUhvb2sgPSBuZXcgSG9vayh7XG4gICAgZGVidWdQcmludEV4Y2VwdGlvbnM6IFwib25NZXNzYWdlIGNhbGxiYWNrXCJcbiAgfSk7XG5cbiAgc2VsZi5wdWJsaXNoX2hhbmRsZXJzID0ge307XG4gIHNlbGYudW5pdmVyc2FsX3B1Ymxpc2hfaGFuZGxlcnMgPSBbXTtcblxuICBzZWxmLm1ldGhvZF9oYW5kbGVycyA9IHt9O1xuXG4gIHNlbGYuc2Vzc2lvbnMgPSBuZXcgTWFwKCk7IC8vIG1hcCBmcm9tIGlkIHRvIHNlc3Npb25cblxuICBzZWxmLnN0cmVhbV9zZXJ2ZXIgPSBuZXcgU3RyZWFtU2VydmVyO1xuXG4gIHNlbGYuc3RyZWFtX3NlcnZlci5yZWdpc3RlcihmdW5jdGlvbiAoc29ja2V0KSB7XG4gICAgLy8gc29ja2V0IGltcGxlbWVudHMgdGhlIFNvY2tKU0Nvbm5lY3Rpb24gaW50ZXJmYWNlXG4gICAgc29ja2V0Ll9tZXRlb3JTZXNzaW9uID0gbnVsbDtcblxuICAgIHZhciBzZW5kRXJyb3IgPSBmdW5jdGlvbiAocmVhc29uLCBvZmZlbmRpbmdNZXNzYWdlKSB7XG4gICAgICB2YXIgbXNnID0ge21zZzogJ2Vycm9yJywgcmVhc29uOiByZWFzb259O1xuICAgICAgaWYgKG9mZmVuZGluZ01lc3NhZ2UpXG4gICAgICAgIG1zZy5vZmZlbmRpbmdNZXNzYWdlID0gb2ZmZW5kaW5nTWVzc2FnZTtcbiAgICAgIHNvY2tldC5zZW5kKEREUENvbW1vbi5zdHJpbmdpZnlERFAobXNnKSk7XG4gICAgfTtcblxuICAgIHNvY2tldC5vbignZGF0YScsIGZ1bmN0aW9uIChyYXdfbXNnKSB7XG4gICAgICBpZiAoTWV0ZW9yLl9wcmludFJlY2VpdmVkRERQKSB7XG4gICAgICAgIE1ldGVvci5fZGVidWcoXCJSZWNlaXZlZCBERFBcIiwgcmF3X21zZyk7XG4gICAgICB9XG4gICAgICB0cnkge1xuICAgICAgICB0cnkge1xuICAgICAgICAgIHZhciBtc2cgPSBERFBDb21tb24ucGFyc2VERFAocmF3X21zZyk7XG4gICAgICAgIH0gY2F0Y2ggKGVycikge1xuICAgICAgICAgIHNlbmRFcnJvcignUGFyc2UgZXJyb3InKTtcbiAgICAgICAgICByZXR1cm47XG4gICAgICAgIH1cbiAgICAgICAgaWYgKG1zZyA9PT0gbnVsbCB8fCAhbXNnLm1zZykge1xuICAgICAgICAgIHNlbmRFcnJvcignQmFkIHJlcXVlc3QnLCBtc2cpO1xuICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuXG4gICAgICAgIGlmIChtc2cubXNnID09PSAnY29ubmVjdCcpIHtcbiAgICAgICAgICBpZiAoc29ja2V0Ll9tZXRlb3JTZXNzaW9uKSB7XG4gICAgICAgICAgICBzZW5kRXJyb3IoXCJBbHJlYWR5IGNvbm5lY3RlZFwiLCBtc2cpO1xuICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICAgIH1cbiAgICAgICAgICBGaWJlcihmdW5jdGlvbiAoKSB7XG4gICAgICAgICAgICBzZWxmLl9oYW5kbGVDb25uZWN0KHNvY2tldCwgbXNnKTtcbiAgICAgICAgICB9KS5ydW4oKTtcbiAgICAgICAgICByZXR1cm47XG4gICAgICAgIH1cblxuICAgICAgICBpZiAoIXNvY2tldC5fbWV0ZW9yU2Vzc2lvbikge1xuICAgICAgICAgIHNlbmRFcnJvcignTXVzdCBjb25uZWN0IGZpcnN0JywgbXNnKTtcbiAgICAgICAgICByZXR1cm47XG4gICAgICAgIH1cbiAgICAgICAgc29ja2V0Ll9tZXRlb3JTZXNzaW9uLnByb2Nlc3NNZXNzYWdlKG1zZyk7XG4gICAgICB9IGNhdGNoIChlKSB7XG4gICAgICAgIC8vIFhYWCBwcmludCBzdGFjayBuaWNlbHlcbiAgICAgICAgTWV0ZW9yLl9kZWJ1ZyhcIkludGVybmFsIGV4Y2VwdGlvbiB3aGlsZSBwcm9jZXNzaW5nIG1lc3NhZ2VcIiwgbXNnLCBlKTtcbiAgICAgIH1cbiAgICB9KTtcblxuICAgIHNvY2tldC5vbignY2xvc2UnLCBmdW5jdGlvbiAoKSB7XG4gICAgICBpZiAoc29ja2V0Ll9tZXRlb3JTZXNzaW9uKSB7XG4gICAgICAgIEZpYmVyKGZ1bmN0aW9uICgpIHtcbiAgICAgICAgICBzb2NrZXQuX21ldGVvclNlc3Npb24uY2xvc2UoKTtcbiAgICAgICAgfSkucnVuKCk7XG4gICAgICB9XG4gICAgfSk7XG4gIH0pO1xufTtcblxuT2JqZWN0LmFzc2lnbihTZXJ2ZXIucHJvdG90eXBlLCB7XG5cbiAgLyoqXG4gICAqIEBzdW1tYXJ5IFJlZ2lzdGVyIGEgY2FsbGJhY2sgdG8gYmUgY2FsbGVkIHdoZW4gYSBuZXcgRERQIGNvbm5lY3Rpb24gaXMgbWFkZSB0byB0aGUgc2VydmVyLlxuICAgKiBAbG9jdXMgU2VydmVyXG4gICAqIEBwYXJhbSB7ZnVuY3Rpb259IGNhbGxiYWNrIFRoZSBmdW5jdGlvbiB0byBjYWxsIHdoZW4gYSBuZXcgRERQIGNvbm5lY3Rpb24gaXMgZXN0YWJsaXNoZWQuXG4gICAqIEBtZW1iZXJPZiBNZXRlb3JcbiAgICogQGltcG9ydEZyb21QYWNrYWdlIG1ldGVvclxuICAgKi9cbiAgb25Db25uZWN0aW9uOiBmdW5jdGlvbiAoZm4pIHtcbiAgICB2YXIgc2VsZiA9IHRoaXM7XG4gICAgcmV0dXJuIHNlbGYub25Db25uZWN0aW9uSG9vay5yZWdpc3Rlcihmbik7XG4gIH0sXG5cbiAgLyoqXG4gICAqIEBzdW1tYXJ5IFJlZ2lzdGVyIGEgY2FsbGJhY2sgdG8gYmUgY2FsbGVkIHdoZW4gYSBuZXcgRERQIG1lc3NhZ2UgaXMgcmVjZWl2ZWQuXG4gICAqIEBsb2N1cyBTZXJ2ZXJcbiAgICogQHBhcmFtIHtmdW5jdGlvbn0gY2FsbGJhY2sgVGhlIGZ1bmN0aW9uIHRvIGNhbGwgd2hlbiBhIG5ldyBERFAgbWVzc2FnZSBpcyByZWNlaXZlZC5cbiAgICogQG1lbWJlck9mIE1ldGVvclxuICAgKiBAaW1wb3J0RnJvbVBhY2thZ2UgbWV0ZW9yXG4gICAqL1xuICBvbk1lc3NhZ2U6IGZ1bmN0aW9uIChmbikge1xuICAgIHZhciBzZWxmID0gdGhpcztcbiAgICByZXR1cm4gc2VsZi5vbk1lc3NhZ2VIb29rLnJlZ2lzdGVyKGZuKTtcbiAgfSxcblxuICBfaGFuZGxlQ29ubmVjdDogZnVuY3Rpb24gKHNvY2tldCwgbXNnKSB7XG4gICAgdmFyIHNlbGYgPSB0aGlzO1xuXG4gICAgLy8gVGhlIGNvbm5lY3QgbWVzc2FnZSBtdXN0IHNwZWNpZnkgYSB2ZXJzaW9uIGFuZCBhbiBhcnJheSBvZiBzdXBwb3J0ZWRcbiAgICAvLyB2ZXJzaW9ucywgYW5kIGl0IG11c3QgY2xhaW0gdG8gc3VwcG9ydCB3aGF0IGl0IGlzIHByb3Bvc2luZy5cbiAgICBpZiAoISh0eXBlb2YgKG1zZy52ZXJzaW9uKSA9PT0gJ3N0cmluZycgJiZcbiAgICAgICAgICBfLmlzQXJyYXkobXNnLnN1cHBvcnQpICYmXG4gICAgICAgICAgXy5hbGwobXNnLnN1cHBvcnQsIF8uaXNTdHJpbmcpICYmXG4gICAgICAgICAgXy5jb250YWlucyhtc2cuc3VwcG9ydCwgbXNnLnZlcnNpb24pKSkge1xuICAgICAgc29ja2V0LnNlbmQoRERQQ29tbW9uLnN0cmluZ2lmeUREUCh7bXNnOiAnZmFpbGVkJyxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgdmVyc2lvbjogRERQQ29tbW9uLlNVUFBPUlRFRF9ERFBfVkVSU0lPTlNbMF19KSk7XG4gICAgICBzb2NrZXQuY2xvc2UoKTtcbiAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICAvLyBJbiB0aGUgZnV0dXJlLCBoYW5kbGUgc2Vzc2lvbiByZXN1bXB0aW9uOiBzb21ldGhpbmcgbGlrZTpcbiAgICAvLyAgc29ja2V0Ll9tZXRlb3JTZXNzaW9uID0gc2VsZi5zZXNzaW9uc1ttc2cuc2Vzc2lvbl1cbiAgICB2YXIgdmVyc2lvbiA9IGNhbGN1bGF0ZVZlcnNpb24obXNnLnN1cHBvcnQsIEREUENvbW1vbi5TVVBQT1JURURfRERQX1ZFUlNJT05TKTtcblxuICAgIGlmIChtc2cudmVyc2lvbiAhPT0gdmVyc2lvbikge1xuICAgICAgLy8gVGhlIGJlc3QgdmVyc2lvbiB0byB1c2UgKGFjY29yZGluZyB0byB0aGUgY2xpZW50J3Mgc3RhdGVkIHByZWZlcmVuY2VzKVxuICAgICAgLy8gaXMgbm90IHRoZSBvbmUgdGhlIGNsaWVudCBpcyB0cnlpbmcgdG8gdXNlLiBJbmZvcm0gdGhlbSBhYm91dCB0aGUgYmVzdFxuICAgICAgLy8gdmVyc2lvbiB0byB1c2UuXG4gICAgICBzb2NrZXQuc2VuZChERFBDb21tb24uc3RyaW5naWZ5RERQKHttc2c6ICdmYWlsZWQnLCB2ZXJzaW9uOiB2ZXJzaW9ufSkpO1xuICAgICAgc29ja2V0LmNsb3NlKCk7XG4gICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgLy8gWWF5LCB2ZXJzaW9uIG1hdGNoZXMhIENyZWF0ZSBhIG5ldyBzZXNzaW9uLlxuICAgIC8vIE5vdGU6IFRyb3Bvc3BoZXJlIGRlcGVuZHMgb24gdGhlIGFiaWxpdHkgdG8gbXV0YXRlXG4gICAgLy8gTWV0ZW9yLnNlcnZlci5vcHRpb25zLmhlYXJ0YmVhdFRpbWVvdXQhIFRoaXMgaXMgYSBoYWNrLCBidXQgaXQncyBsaWZlLlxuICAgIHNvY2tldC5fbWV0ZW9yU2Vzc2lvbiA9IG5ldyBTZXNzaW9uKHNlbGYsIHZlcnNpb24sIHNvY2tldCwgc2VsZi5vcHRpb25zKTtcbiAgICBzZWxmLnNlc3Npb25zLnNldChzb2NrZXQuX21ldGVvclNlc3Npb24uaWQsIHNvY2tldC5fbWV0ZW9yU2Vzc2lvbik7XG4gICAgc2VsZi5vbkNvbm5lY3Rpb25Ib29rLmVhY2goZnVuY3Rpb24gKGNhbGxiYWNrKSB7XG4gICAgICBpZiAoc29ja2V0Ll9tZXRlb3JTZXNzaW9uKVxuICAgICAgICBjYWxsYmFjayhzb2NrZXQuX21ldGVvclNlc3Npb24uY29ubmVjdGlvbkhhbmRsZSk7XG4gICAgICByZXR1cm4gdHJ1ZTtcbiAgICB9KTtcbiAgfSxcbiAgLyoqXG4gICAqIFJlZ2lzdGVyIGEgcHVibGlzaCBoYW5kbGVyIGZ1bmN0aW9uLlxuICAgKlxuICAgKiBAcGFyYW0gbmFtZSB7U3RyaW5nfSBpZGVudGlmaWVyIGZvciBxdWVyeVxuICAgKiBAcGFyYW0gaGFuZGxlciB7RnVuY3Rpb259IHB1Ymxpc2ggaGFuZGxlclxuICAgKiBAcGFyYW0gb3B0aW9ucyB7T2JqZWN0fVxuICAgKlxuICAgKiBTZXJ2ZXIgd2lsbCBjYWxsIGhhbmRsZXIgZnVuY3Rpb24gb24gZWFjaCBuZXcgc3Vic2NyaXB0aW9uLFxuICAgKiBlaXRoZXIgd2hlbiByZWNlaXZpbmcgRERQIHN1YiBtZXNzYWdlIGZvciBhIG5hbWVkIHN1YnNjcmlwdGlvbiwgb3Igb25cbiAgICogRERQIGNvbm5lY3QgZm9yIGEgdW5pdmVyc2FsIHN1YnNjcmlwdGlvbi5cbiAgICpcbiAgICogSWYgbmFtZSBpcyBudWxsLCB0aGlzIHdpbGwgYmUgYSBzdWJzY3JpcHRpb24gdGhhdCBpc1xuICAgKiBhdXRvbWF0aWNhbGx5IGVzdGFibGlzaGVkIGFuZCBwZXJtYW5lbnRseSBvbiBmb3IgYWxsIGNvbm5lY3RlZFxuICAgKiBjbGllbnQsIGluc3RlYWQgb2YgYSBzdWJzY3JpcHRpb24gdGhhdCBjYW4gYmUgdHVybmVkIG9uIGFuZCBvZmZcbiAgICogd2l0aCBzdWJzY3JpYmUoKS5cbiAgICpcbiAgICogb3B0aW9ucyB0byBjb250YWluOlxuICAgKiAgLSAobW9zdGx5IGludGVybmFsKSBpc19hdXRvOiB0cnVlIGlmIGdlbmVyYXRlZCBhdXRvbWF0aWNhbGx5XG4gICAqICAgIGZyb20gYW4gYXV0b3B1Ymxpc2ggaG9vay4gdGhpcyBpcyBmb3IgY29zbWV0aWMgcHVycG9zZXMgb25seVxuICAgKiAgICAoaXQgbGV0cyB1cyBkZXRlcm1pbmUgd2hldGhlciB0byBwcmludCBhIHdhcm5pbmcgc3VnZ2VzdGluZ1xuICAgKiAgICB0aGF0IHlvdSB0dXJuIG9mZiBhdXRvcHVibGlzaC4pXG4gICAqL1xuXG4gIC8qKlxuICAgKiBAc3VtbWFyeSBQdWJsaXNoIGEgcmVjb3JkIHNldC5cbiAgICogQG1lbWJlck9mIE1ldGVvclxuICAgKiBAaW1wb3J0RnJvbVBhY2thZ2UgbWV0ZW9yXG4gICAqIEBsb2N1cyBTZXJ2ZXJcbiAgICogQHBhcmFtIHtTdHJpbmd8T2JqZWN0fSBuYW1lIElmIFN0cmluZywgbmFtZSBvZiB0aGUgcmVjb3JkIHNldC4gIElmIE9iamVjdCwgcHVibGljYXRpb25zIERpY3Rpb25hcnkgb2YgcHVibGlzaCBmdW5jdGlvbnMgYnkgbmFtZS4gIElmIGBudWxsYCwgdGhlIHNldCBoYXMgbm8gbmFtZSwgYW5kIHRoZSByZWNvcmQgc2V0IGlzIGF1dG9tYXRpY2FsbHkgc2VudCB0byBhbGwgY29ubmVjdGVkIGNsaWVudHMuXG4gICAqIEBwYXJhbSB7RnVuY3Rpb259IGZ1bmMgRnVuY3Rpb24gY2FsbGVkIG9uIHRoZSBzZXJ2ZXIgZWFjaCB0aW1lIGEgY2xpZW50IHN1YnNjcmliZXMuICBJbnNpZGUgdGhlIGZ1bmN0aW9uLCBgdGhpc2AgaXMgdGhlIHB1Ymxpc2ggaGFuZGxlciBvYmplY3QsIGRlc2NyaWJlZCBiZWxvdy4gIElmIHRoZSBjbGllbnQgcGFzc2VkIGFyZ3VtZW50cyB0byBgc3Vic2NyaWJlYCwgdGhlIGZ1bmN0aW9uIGlzIGNhbGxlZCB3aXRoIHRoZSBzYW1lIGFyZ3VtZW50cy5cbiAgICovXG4gIHB1Ymxpc2g6IGZ1bmN0aW9uIChuYW1lLCBoYW5kbGVyLCBvcHRpb25zKSB7XG4gICAgdmFyIHNlbGYgPSB0aGlzO1xuXG4gICAgaWYgKCEgXy5pc09iamVjdChuYW1lKSkge1xuICAgICAgb3B0aW9ucyA9IG9wdGlvbnMgfHwge307XG5cbiAgICAgIGlmIChuYW1lICYmIG5hbWUgaW4gc2VsZi5wdWJsaXNoX2hhbmRsZXJzKSB7XG4gICAgICAgIE1ldGVvci5fZGVidWcoXCJJZ25vcmluZyBkdXBsaWNhdGUgcHVibGlzaCBuYW1lZCAnXCIgKyBuYW1lICsgXCInXCIpO1xuICAgICAgICByZXR1cm47XG4gICAgICB9XG5cbiAgICAgIGlmIChQYWNrYWdlLmF1dG9wdWJsaXNoICYmICFvcHRpb25zLmlzX2F1dG8pIHtcbiAgICAgICAgLy8gVGhleSBoYXZlIGF1dG9wdWJsaXNoIG9uLCB5ZXQgdGhleSdyZSB0cnlpbmcgdG8gbWFudWFsbHlcbiAgICAgICAgLy8gcGlja2luZyBzdHVmZiB0byBwdWJsaXNoLiBUaGV5IHByb2JhYmx5IHNob3VsZCB0dXJuIG9mZlxuICAgICAgICAvLyBhdXRvcHVibGlzaC4gKFRoaXMgY2hlY2sgaXNuJ3QgcGVyZmVjdCAtLSBpZiB5b3UgY3JlYXRlIGFcbiAgICAgICAgLy8gcHVibGlzaCBiZWZvcmUgeW91IHR1cm4gb24gYXV0b3B1Ymxpc2gsIGl0IHdvbid0IGNhdGNoXG4gICAgICAgIC8vIGl0LiBCdXQgdGhpcyB3aWxsIGRlZmluaXRlbHkgaGFuZGxlIHRoZSBzaW1wbGUgY2FzZSB3aGVyZVxuICAgICAgICAvLyB5b3UndmUgYWRkZWQgdGhlIGF1dG9wdWJsaXNoIHBhY2thZ2UgdG8geW91ciBhcHAsIGFuZCBhcmVcbiAgICAgICAgLy8gY2FsbGluZyBwdWJsaXNoIGZyb20geW91ciBhcHAgY29kZS4pXG4gICAgICAgIGlmICghc2VsZi53YXJuZWRfYWJvdXRfYXV0b3B1Ymxpc2gpIHtcbiAgICAgICAgICBzZWxmLndhcm5lZF9hYm91dF9hdXRvcHVibGlzaCA9IHRydWU7XG4gICAgICAgICAgTWV0ZW9yLl9kZWJ1ZyhcbiAgICBcIioqIFlvdSd2ZSBzZXQgdXAgc29tZSBkYXRhIHN1YnNjcmlwdGlvbnMgd2l0aCBNZXRlb3IucHVibGlzaCgpLCBidXRcXG5cIiArXG4gICAgXCIqKiB5b3Ugc3RpbGwgaGF2ZSBhdXRvcHVibGlzaCB0dXJuZWQgb24uIEJlY2F1c2UgYXV0b3B1Ymxpc2ggaXMgc3RpbGxcXG5cIiArXG4gICAgXCIqKiBvbiwgeW91ciBNZXRlb3IucHVibGlzaCgpIGNhbGxzIHdvbid0IGhhdmUgbXVjaCBlZmZlY3QuIEFsbCBkYXRhXFxuXCIgK1xuICAgIFwiKiogd2lsbCBzdGlsbCBiZSBzZW50IHRvIGFsbCBjbGllbnRzLlxcblwiICtcbiAgICBcIioqXFxuXCIgK1xuICAgIFwiKiogVHVybiBvZmYgYXV0b3B1Ymxpc2ggYnkgcmVtb3ZpbmcgdGhlIGF1dG9wdWJsaXNoIHBhY2thZ2U6XFxuXCIgK1xuICAgIFwiKipcXG5cIiArXG4gICAgXCIqKiAgICQgbWV0ZW9yIHJlbW92ZSBhdXRvcHVibGlzaFxcblwiICtcbiAgICBcIioqXFxuXCIgK1xuICAgIFwiKiogLi4gYW5kIG1ha2Ugc3VyZSB5b3UgaGF2ZSBNZXRlb3IucHVibGlzaCgpIGFuZCBNZXRlb3Iuc3Vic2NyaWJlKCkgY2FsbHNcXG5cIiArXG4gICAgXCIqKiBmb3IgZWFjaCBjb2xsZWN0aW9uIHRoYXQgeW91IHdhbnQgY2xpZW50cyB0byBzZWUuXFxuXCIpO1xuICAgICAgICB9XG4gICAgICB9XG5cbiAgICAgIGlmIChuYW1lKVxuICAgICAgICBzZWxmLnB1Ymxpc2hfaGFuZGxlcnNbbmFtZV0gPSBoYW5kbGVyO1xuICAgICAgZWxzZSB7XG4gICAgICAgIHNlbGYudW5pdmVyc2FsX3B1Ymxpc2hfaGFuZGxlcnMucHVzaChoYW5kbGVyKTtcbiAgICAgICAgLy8gU3BpbiB1cCB0aGUgbmV3IHB1Ymxpc2hlciBvbiBhbnkgZXhpc3Rpbmcgc2Vzc2lvbiB0b28uIFJ1biBlYWNoXG4gICAgICAgIC8vIHNlc3Npb24ncyBzdWJzY3JpcHRpb24gaW4gYSBuZXcgRmliZXIsIHNvIHRoYXQgdGhlcmUncyBubyBjaGFuZ2UgZm9yXG4gICAgICAgIC8vIHNlbGYuc2Vzc2lvbnMgdG8gY2hhbmdlIHdoaWxlIHdlJ3JlIHJ1bm5pbmcgdGhpcyBsb29wLlxuICAgICAgICBzZWxmLnNlc3Npb25zLmZvckVhY2goZnVuY3Rpb24gKHNlc3Npb24pIHtcbiAgICAgICAgICBpZiAoIXNlc3Npb24uX2RvbnRTdGFydE5ld1VuaXZlcnNhbFN1YnMpIHtcbiAgICAgICAgICAgIEZpYmVyKGZ1bmN0aW9uKCkge1xuICAgICAgICAgICAgICBzZXNzaW9uLl9zdGFydFN1YnNjcmlwdGlvbihoYW5kbGVyKTtcbiAgICAgICAgICAgIH0pLnJ1bigpO1xuICAgICAgICAgIH1cbiAgICAgICAgfSk7XG4gICAgICB9XG4gICAgfVxuICAgIGVsc2V7XG4gICAgICBfLmVhY2gobmFtZSwgZnVuY3Rpb24odmFsdWUsIGtleSkge1xuICAgICAgICBzZWxmLnB1Ymxpc2goa2V5LCB2YWx1ZSwge30pO1xuICAgICAgfSk7XG4gICAgfVxuICB9LFxuXG4gIF9yZW1vdmVTZXNzaW9uOiBmdW5jdGlvbiAoc2Vzc2lvbikge1xuICAgIHZhciBzZWxmID0gdGhpcztcbiAgICBzZWxmLnNlc3Npb25zLmRlbGV0ZShzZXNzaW9uLmlkKTtcbiAgfSxcblxuICAvKipcbiAgICogQHN1bW1hcnkgRGVmaW5lcyBmdW5jdGlvbnMgdGhhdCBjYW4gYmUgaW52b2tlZCBvdmVyIHRoZSBuZXR3b3JrIGJ5IGNsaWVudHMuXG4gICAqIEBsb2N1cyBBbnl3aGVyZVxuICAgKiBAcGFyYW0ge09iamVjdH0gbWV0aG9kcyBEaWN0aW9uYXJ5IHdob3NlIGtleXMgYXJlIG1ldGhvZCBuYW1lcyBhbmQgdmFsdWVzIGFyZSBmdW5jdGlvbnMuXG4gICAqIEBtZW1iZXJPZiBNZXRlb3JcbiAgICogQGltcG9ydEZyb21QYWNrYWdlIG1ldGVvclxuICAgKi9cbiAgbWV0aG9kczogZnVuY3Rpb24gKG1ldGhvZHMpIHtcbiAgICB2YXIgc2VsZiA9IHRoaXM7XG4gICAgXy5lYWNoKG1ldGhvZHMsIGZ1bmN0aW9uIChmdW5jLCBuYW1lKSB7XG4gICAgICBpZiAodHlwZW9mIGZ1bmMgIT09ICdmdW5jdGlvbicpXG4gICAgICAgIHRocm93IG5ldyBFcnJvcihcIk1ldGhvZCAnXCIgKyBuYW1lICsgXCInIG11c3QgYmUgYSBmdW5jdGlvblwiKTtcbiAgICAgIGlmIChzZWxmLm1ldGhvZF9oYW5kbGVyc1tuYW1lXSlcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKFwiQSBtZXRob2QgbmFtZWQgJ1wiICsgbmFtZSArIFwiJyBpcyBhbHJlYWR5IGRlZmluZWRcIik7XG4gICAgICBzZWxmLm1ldGhvZF9oYW5kbGVyc1tuYW1lXSA9IGZ1bmM7XG4gICAgfSk7XG4gIH0sXG5cbiAgY2FsbDogZnVuY3Rpb24gKG5hbWUsIC4uLmFyZ3MpIHtcbiAgICBpZiAoYXJncy5sZW5ndGggJiYgdHlwZW9mIGFyZ3NbYXJncy5sZW5ndGggLSAxXSA9PT0gXCJmdW5jdGlvblwiKSB7XG4gICAgICAvLyBJZiBpdCdzIGEgZnVuY3Rpb24sIHRoZSBsYXN0IGFyZ3VtZW50IGlzIHRoZSByZXN1bHQgY2FsbGJhY2ssIG5vdFxuICAgICAgLy8gYSBwYXJhbWV0ZXIgdG8gdGhlIHJlbW90ZSBtZXRob2QuXG4gICAgICB2YXIgY2FsbGJhY2sgPSBhcmdzLnBvcCgpO1xuICAgIH1cblxuICAgIHJldHVybiB0aGlzLmFwcGx5KG5hbWUsIGFyZ3MsIGNhbGxiYWNrKTtcbiAgfSxcblxuICAvLyBBIHZlcnNpb24gb2YgdGhlIGNhbGwgbWV0aG9kIHRoYXQgYWx3YXlzIHJldHVybnMgYSBQcm9taXNlLlxuICBjYWxsQXN5bmM6IGZ1bmN0aW9uIChuYW1lLCAuLi5hcmdzKSB7XG4gICAgcmV0dXJuIHRoaXMuYXBwbHlBc3luYyhuYW1lLCBhcmdzKTtcbiAgfSxcblxuICBhcHBseTogZnVuY3Rpb24gKG5hbWUsIGFyZ3MsIG9wdGlvbnMsIGNhbGxiYWNrKSB7XG4gICAgLy8gV2Ugd2VyZSBwYXNzZWQgMyBhcmd1bWVudHMuIFRoZXkgbWF5IGJlIGVpdGhlciAobmFtZSwgYXJncywgb3B0aW9ucylcbiAgICAvLyBvciAobmFtZSwgYXJncywgY2FsbGJhY2spXG4gICAgaWYgKCEgY2FsbGJhY2sgJiYgdHlwZW9mIG9wdGlvbnMgPT09ICdmdW5jdGlvbicpIHtcbiAgICAgIGNhbGxiYWNrID0gb3B0aW9ucztcbiAgICAgIG9wdGlvbnMgPSB7fTtcbiAgICB9IGVsc2Uge1xuICAgICAgb3B0aW9ucyA9IG9wdGlvbnMgfHwge307XG4gICAgfVxuXG4gICAgY29uc3QgcHJvbWlzZSA9IHRoaXMuYXBwbHlBc3luYyhuYW1lLCBhcmdzLCBvcHRpb25zKTtcblxuICAgIC8vIFJldHVybiB0aGUgcmVzdWx0IGluIHdoaWNoZXZlciB3YXkgdGhlIGNhbGxlciBhc2tlZCBmb3IgaXQuIE5vdGUgdGhhdCB3ZVxuICAgIC8vIGRvIE5PVCBibG9jayBvbiB0aGUgd3JpdGUgZmVuY2UgaW4gYW4gYW5hbG9nb3VzIHdheSB0byBob3cgdGhlIGNsaWVudFxuICAgIC8vIGJsb2NrcyBvbiB0aGUgcmVsZXZhbnQgZGF0YSBiZWluZyB2aXNpYmxlLCBzbyB5b3UgYXJlIE5PVCBndWFyYW50ZWVkIHRoYXRcbiAgICAvLyBjdXJzb3Igb2JzZXJ2ZSBjYWxsYmFja3MgaGF2ZSBmaXJlZCB3aGVuIHlvdXIgY2FsbGJhY2sgaXMgaW52b2tlZC4gKFdlXG4gICAgLy8gY2FuIGNoYW5nZSB0aGlzIGlmIHRoZXJlJ3MgYSByZWFsIHVzZSBjYXNlLilcbiAgICBpZiAoY2FsbGJhY2spIHtcbiAgICAgIHByb21pc2UudGhlbihcbiAgICAgICAgcmVzdWx0ID0+IGNhbGxiYWNrKHVuZGVmaW5lZCwgcmVzdWx0KSxcbiAgICAgICAgZXhjZXB0aW9uID0+IGNhbGxiYWNrKGV4Y2VwdGlvbilcbiAgICAgICk7XG4gICAgfSBlbHNlIHtcbiAgICAgIHJldHVybiBwcm9taXNlLmF3YWl0KCk7XG4gICAgfVxuICB9LFxuXG4gIC8vIEBwYXJhbSBvcHRpb25zIHtPcHRpb25hbCBPYmplY3R9XG4gIGFwcGx5QXN5bmM6IGZ1bmN0aW9uIChuYW1lLCBhcmdzLCBvcHRpb25zKSB7XG4gICAgLy8gUnVuIHRoZSBoYW5kbGVyXG4gICAgdmFyIGhhbmRsZXIgPSB0aGlzLm1ldGhvZF9oYW5kbGVyc1tuYW1lXTtcbiAgICBpZiAoISBoYW5kbGVyKSB7XG4gICAgICByZXR1cm4gUHJvbWlzZS5yZWplY3QoXG4gICAgICAgIG5ldyBNZXRlb3IuRXJyb3IoNDA0LCBgTWV0aG9kICcke25hbWV9JyBub3QgZm91bmRgKVxuICAgICAgKTtcbiAgICB9XG5cbiAgICAvLyBJZiB0aGlzIGlzIGEgbWV0aG9kIGNhbGwgZnJvbSB3aXRoaW4gYW5vdGhlciBtZXRob2Qgb3IgcHVibGlzaCBmdW5jdGlvbixcbiAgICAvLyBnZXQgdGhlIHVzZXIgc3RhdGUgZnJvbSB0aGUgb3V0ZXIgbWV0aG9kIG9yIHB1Ymxpc2ggZnVuY3Rpb24sIG90aGVyd2lzZVxuICAgIC8vIGRvbid0IGFsbG93IHNldFVzZXJJZCB0byBiZSBjYWxsZWRcbiAgICB2YXIgdXNlcklkID0gbnVsbDtcbiAgICB2YXIgc2V0VXNlcklkID0gZnVuY3Rpb24oKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXCJDYW4ndCBjYWxsIHNldFVzZXJJZCBvbiBhIHNlcnZlciBpbml0aWF0ZWQgbWV0aG9kIGNhbGxcIik7XG4gICAgfTtcbiAgICB2YXIgY29ubmVjdGlvbiA9IG51bGw7XG4gICAgdmFyIGN1cnJlbnRNZXRob2RJbnZvY2F0aW9uID0gRERQLl9DdXJyZW50TWV0aG9kSW52b2NhdGlvbi5nZXQoKTtcbiAgICB2YXIgY3VycmVudFB1YmxpY2F0aW9uSW52b2NhdGlvbiA9IEREUC5fQ3VycmVudFB1YmxpY2F0aW9uSW52b2NhdGlvbi5nZXQoKTtcbiAgICB2YXIgcmFuZG9tU2VlZCA9IG51bGw7XG4gICAgaWYgKGN1cnJlbnRNZXRob2RJbnZvY2F0aW9uKSB7XG4gICAgICB1c2VySWQgPSBjdXJyZW50TWV0aG9kSW52b2NhdGlvbi51c2VySWQ7XG4gICAgICBzZXRVc2VySWQgPSBmdW5jdGlvbih1c2VySWQpIHtcbiAgICAgICAgY3VycmVudE1ldGhvZEludm9jYXRpb24uc2V0VXNlcklkKHVzZXJJZCk7XG4gICAgICB9O1xuICAgICAgY29ubmVjdGlvbiA9IGN1cnJlbnRNZXRob2RJbnZvY2F0aW9uLmNvbm5lY3Rpb247XG4gICAgICByYW5kb21TZWVkID0gRERQQ29tbW9uLm1ha2VScGNTZWVkKGN1cnJlbnRNZXRob2RJbnZvY2F0aW9uLCBuYW1lKTtcbiAgICB9IGVsc2UgaWYgKGN1cnJlbnRQdWJsaWNhdGlvbkludm9jYXRpb24pIHtcbiAgICAgIHVzZXJJZCA9IGN1cnJlbnRQdWJsaWNhdGlvbkludm9jYXRpb24udXNlcklkO1xuICAgICAgc2V0VXNlcklkID0gZnVuY3Rpb24odXNlcklkKSB7XG4gICAgICAgIGN1cnJlbnRQdWJsaWNhdGlvbkludm9jYXRpb24uX3Nlc3Npb24uX3NldFVzZXJJZCh1c2VySWQpO1xuICAgICAgfTtcbiAgICAgIGNvbm5lY3Rpb24gPSBjdXJyZW50UHVibGljYXRpb25JbnZvY2F0aW9uLmNvbm5lY3Rpb247XG4gICAgfVxuXG4gICAgdmFyIGludm9jYXRpb24gPSBuZXcgRERQQ29tbW9uLk1ldGhvZEludm9jYXRpb24oe1xuICAgICAgaXNTaW11bGF0aW9uOiBmYWxzZSxcbiAgICAgIHVzZXJJZCxcbiAgICAgIHNldFVzZXJJZCxcbiAgICAgIGNvbm5lY3Rpb24sXG4gICAgICByYW5kb21TZWVkXG4gICAgfSk7XG5cbiAgICByZXR1cm4gbmV3IFByb21pc2UocmVzb2x2ZSA9PiByZXNvbHZlKFxuICAgICAgRERQLl9DdXJyZW50TWV0aG9kSW52b2NhdGlvbi53aXRoVmFsdWUoXG4gICAgICAgIGludm9jYXRpb24sXG4gICAgICAgICgpID0+IG1heWJlQXVkaXRBcmd1bWVudENoZWNrcyhcbiAgICAgICAgICBoYW5kbGVyLCBpbnZvY2F0aW9uLCBFSlNPTi5jbG9uZShhcmdzKSxcbiAgICAgICAgICBcImludGVybmFsIGNhbGwgdG8gJ1wiICsgbmFtZSArIFwiJ1wiXG4gICAgICAgIClcbiAgICAgIClcbiAgICApKS50aGVuKEVKU09OLmNsb25lKTtcbiAgfSxcblxuICBfdXJsRm9yU2Vzc2lvbjogZnVuY3Rpb24gKHNlc3Npb25JZCkge1xuICAgIHZhciBzZWxmID0gdGhpcztcbiAgICB2YXIgc2Vzc2lvbiA9IHNlbGYuc2Vzc2lvbnMuZ2V0KHNlc3Npb25JZCk7XG4gICAgaWYgKHNlc3Npb24pXG4gICAgICByZXR1cm4gc2Vzc2lvbi5fc29ja2V0VXJsO1xuICAgIGVsc2VcbiAgICAgIHJldHVybiBudWxsO1xuICB9XG59KTtcblxudmFyIGNhbGN1bGF0ZVZlcnNpb24gPSBmdW5jdGlvbiAoY2xpZW50U3VwcG9ydGVkVmVyc2lvbnMsXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBzZXJ2ZXJTdXBwb3J0ZWRWZXJzaW9ucykge1xuICB2YXIgY29ycmVjdFZlcnNpb24gPSBfLmZpbmQoY2xpZW50U3VwcG9ydGVkVmVyc2lvbnMsIGZ1bmN0aW9uICh2ZXJzaW9uKSB7XG4gICAgcmV0dXJuIF8uY29udGFpbnMoc2VydmVyU3VwcG9ydGVkVmVyc2lvbnMsIHZlcnNpb24pO1xuICB9KTtcbiAgaWYgKCFjb3JyZWN0VmVyc2lvbikge1xuICAgIGNvcnJlY3RWZXJzaW9uID0gc2VydmVyU3VwcG9ydGVkVmVyc2lvbnNbMF07XG4gIH1cbiAgcmV0dXJuIGNvcnJlY3RWZXJzaW9uO1xufTtcblxuRERQU2VydmVyLl9jYWxjdWxhdGVWZXJzaW9uID0gY2FsY3VsYXRlVmVyc2lvbjtcblxuXG4vLyBcImJsaW5kXCIgZXhjZXB0aW9ucyBvdGhlciB0aGFuIHRob3NlIHRoYXQgd2VyZSBkZWxpYmVyYXRlbHkgdGhyb3duIHRvIHNpZ25hbFxuLy8gZXJyb3JzIHRvIHRoZSBjbGllbnRcbnZhciB3cmFwSW50ZXJuYWxFeGNlcHRpb24gPSBmdW5jdGlvbiAoZXhjZXB0aW9uLCBjb250ZXh0KSB7XG4gIGlmICghZXhjZXB0aW9uKSByZXR1cm4gZXhjZXB0aW9uO1xuXG4gIC8vIFRvIGFsbG93IHBhY2thZ2VzIHRvIHRocm93IGVycm9ycyBpbnRlbmRlZCBmb3IgdGhlIGNsaWVudCBidXQgbm90IGhhdmUgdG9cbiAgLy8gZGVwZW5kIG9uIHRoZSBNZXRlb3IuRXJyb3IgY2xhc3MsIGBpc0NsaWVudFNhZmVgIGNhbiBiZSBzZXQgdG8gdHJ1ZSBvbiBhbnlcbiAgLy8gZXJyb3IgYmVmb3JlIGl0IGlzIHRocm93bi5cbiAgaWYgKGV4Y2VwdGlvbi5pc0NsaWVudFNhZmUpIHtcbiAgICBpZiAoIShleGNlcHRpb24gaW5zdGFuY2VvZiBNZXRlb3IuRXJyb3IpKSB7XG4gICAgICBjb25zdCBvcmlnaW5hbE1lc3NhZ2UgPSBleGNlcHRpb24ubWVzc2FnZTtcbiAgICAgIGV4Y2VwdGlvbiA9IG5ldyBNZXRlb3IuRXJyb3IoZXhjZXB0aW9uLmVycm9yLCBleGNlcHRpb24ucmVhc29uLCBleGNlcHRpb24uZGV0YWlscyk7XG4gICAgICBleGNlcHRpb24ubWVzc2FnZSA9IG9yaWdpbmFsTWVzc2FnZTtcbiAgICB9XG4gICAgcmV0dXJuIGV4Y2VwdGlvbjtcbiAgfVxuXG4gIC8vIFRlc3RzIGNhbiBzZXQgdGhlICdfZXhwZWN0ZWRCeVRlc3QnIGZsYWcgb24gYW4gZXhjZXB0aW9uIHNvIGl0IHdvbid0IGdvIHRvXG4gIC8vIHRoZSBzZXJ2ZXIgbG9nLlxuICBpZiAoIWV4Y2VwdGlvbi5fZXhwZWN0ZWRCeVRlc3QpIHtcbiAgICBNZXRlb3IuX2RlYnVnKFwiRXhjZXB0aW9uIFwiICsgY29udGV4dCwgZXhjZXB0aW9uLnN0YWNrKTtcbiAgICBpZiAoZXhjZXB0aW9uLnNhbml0aXplZEVycm9yKSB7XG4gICAgICBNZXRlb3IuX2RlYnVnKFwiU2FuaXRpemVkIGFuZCByZXBvcnRlZCB0byB0aGUgY2xpZW50IGFzOlwiLCBleGNlcHRpb24uc2FuaXRpemVkRXJyb3IpO1xuICAgICAgTWV0ZW9yLl9kZWJ1ZygpO1xuICAgIH1cbiAgfVxuXG4gIC8vIERpZCB0aGUgZXJyb3IgY29udGFpbiBtb3JlIGRldGFpbHMgdGhhdCBjb3VsZCBoYXZlIGJlZW4gdXNlZnVsIGlmIGNhdWdodCBpblxuICAvLyBzZXJ2ZXIgY29kZSAob3IgaWYgdGhyb3duIGZyb20gbm9uLWNsaWVudC1vcmlnaW5hdGVkIGNvZGUpLCBidXQgYWxzb1xuICAvLyBwcm92aWRlZCBhIFwic2FuaXRpemVkXCIgdmVyc2lvbiB3aXRoIG1vcmUgY29udGV4dCB0aGFuIDUwMCBJbnRlcm5hbCBzZXJ2ZXJcbiAgLy8gZXJyb3I/IFVzZSB0aGF0LlxuICBpZiAoZXhjZXB0aW9uLnNhbml0aXplZEVycm9yKSB7XG4gICAgaWYgKGV4Y2VwdGlvbi5zYW5pdGl6ZWRFcnJvci5pc0NsaWVudFNhZmUpXG4gICAgICByZXR1cm4gZXhjZXB0aW9uLnNhbml0aXplZEVycm9yO1xuICAgIE1ldGVvci5fZGVidWcoXCJFeGNlcHRpb24gXCIgKyBjb250ZXh0ICsgXCIgcHJvdmlkZXMgYSBzYW5pdGl6ZWRFcnJvciB0aGF0IFwiICtcbiAgICAgICAgICAgICAgICAgIFwiZG9lcyBub3QgaGF2ZSBpc0NsaWVudFNhZmUgcHJvcGVydHkgc2V0OyBpZ25vcmluZ1wiKTtcbiAgfVxuXG4gIHJldHVybiBuZXcgTWV0ZW9yLkVycm9yKDUwMCwgXCJJbnRlcm5hbCBzZXJ2ZXIgZXJyb3JcIik7XG59O1xuXG5cbi8vIEF1ZGl0IGFyZ3VtZW50IGNoZWNrcywgaWYgdGhlIGF1ZGl0LWFyZ3VtZW50LWNoZWNrcyBwYWNrYWdlIGV4aXN0cyAoaXQgaXMgYVxuLy8gd2VhayBkZXBlbmRlbmN5IG9mIHRoaXMgcGFja2FnZSkuXG52YXIgbWF5YmVBdWRpdEFyZ3VtZW50Q2hlY2tzID0gZnVuY3Rpb24gKGYsIGNvbnRleHQsIGFyZ3MsIGRlc2NyaXB0aW9uKSB7XG4gIGFyZ3MgPSBhcmdzIHx8IFtdO1xuICBpZiAoUGFja2FnZVsnYXVkaXQtYXJndW1lbnQtY2hlY2tzJ10pIHtcbiAgICByZXR1cm4gTWF0Y2guX2ZhaWxJZkFyZ3VtZW50c0FyZU5vdEFsbENoZWNrZWQoXG4gICAgICBmLCBjb250ZXh0LCBhcmdzLCBkZXNjcmlwdGlvbik7XG4gIH1cbiAgcmV0dXJuIGYuYXBwbHkoY29udGV4dCwgYXJncyk7XG59O1xuIiwidmFyIEZ1dHVyZSA9IE5wbS5yZXF1aXJlKCdmaWJlcnMvZnV0dXJlJyk7XG5cbi8vIEEgd3JpdGUgZmVuY2UgY29sbGVjdHMgYSBncm91cCBvZiB3cml0ZXMsIGFuZCBwcm92aWRlcyBhIGNhbGxiYWNrXG4vLyB3aGVuIGFsbCBvZiB0aGUgd3JpdGVzIGFyZSBmdWxseSBjb21taXR0ZWQgYW5kIHByb3BhZ2F0ZWQgKGFsbFxuLy8gb2JzZXJ2ZXJzIGhhdmUgYmVlbiBub3RpZmllZCBvZiB0aGUgd3JpdGUgYW5kIGFja25vd2xlZGdlZCBpdC4pXG4vL1xuRERQU2VydmVyLl9Xcml0ZUZlbmNlID0gZnVuY3Rpb24gKCkge1xuICB2YXIgc2VsZiA9IHRoaXM7XG5cbiAgc2VsZi5hcm1lZCA9IGZhbHNlO1xuICBzZWxmLmZpcmVkID0gZmFsc2U7XG4gIHNlbGYucmV0aXJlZCA9IGZhbHNlO1xuICBzZWxmLm91dHN0YW5kaW5nX3dyaXRlcyA9IDA7XG4gIHNlbGYuYmVmb3JlX2ZpcmVfY2FsbGJhY2tzID0gW107XG4gIHNlbGYuY29tcGxldGlvbl9jYWxsYmFja3MgPSBbXTtcbn07XG5cbi8vIFRoZSBjdXJyZW50IHdyaXRlIGZlbmNlLiBXaGVuIHRoZXJlIGlzIGEgY3VycmVudCB3cml0ZSBmZW5jZSwgY29kZVxuLy8gdGhhdCB3cml0ZXMgdG8gZGF0YWJhc2VzIHNob3VsZCByZWdpc3RlciB0aGVpciB3cml0ZXMgd2l0aCBpdCB1c2luZ1xuLy8gYmVnaW5Xcml0ZSgpLlxuLy9cbkREUFNlcnZlci5fQ3VycmVudFdyaXRlRmVuY2UgPSBuZXcgTWV0ZW9yLkVudmlyb25tZW50VmFyaWFibGU7XG5cbl8uZXh0ZW5kKEREUFNlcnZlci5fV3JpdGVGZW5jZS5wcm90b3R5cGUsIHtcbiAgLy8gU3RhcnQgdHJhY2tpbmcgYSB3cml0ZSwgYW5kIHJldHVybiBhbiBvYmplY3QgdG8gcmVwcmVzZW50IGl0LiBUaGVcbiAgLy8gb2JqZWN0IGhhcyBhIHNpbmdsZSBtZXRob2QsIGNvbW1pdHRlZCgpLiBUaGlzIG1ldGhvZCBzaG91bGQgYmVcbiAgLy8gY2FsbGVkIHdoZW4gdGhlIHdyaXRlIGlzIGZ1bGx5IGNvbW1pdHRlZCBhbmQgcHJvcGFnYXRlZC4gWW91IGNhblxuICAvLyBjb250aW51ZSB0byBhZGQgd3JpdGVzIHRvIHRoZSBXcml0ZUZlbmNlIHVwIHVudGlsIGl0IGlzIHRyaWdnZXJlZFxuICAvLyAoY2FsbHMgaXRzIGNhbGxiYWNrcyBiZWNhdXNlIGFsbCB3cml0ZXMgaGF2ZSBjb21taXR0ZWQuKVxuICBiZWdpbldyaXRlOiBmdW5jdGlvbiAoKSB7XG4gICAgdmFyIHNlbGYgPSB0aGlzO1xuXG4gICAgaWYgKHNlbGYucmV0aXJlZClcbiAgICAgIHJldHVybiB7IGNvbW1pdHRlZDogZnVuY3Rpb24gKCkge30gfTtcblxuICAgIGlmIChzZWxmLmZpcmVkKVxuICAgICAgdGhyb3cgbmV3IEVycm9yKFwiZmVuY2UgaGFzIGFscmVhZHkgYWN0aXZhdGVkIC0tIHRvbyBsYXRlIHRvIGFkZCB3cml0ZXNcIik7XG5cbiAgICBzZWxmLm91dHN0YW5kaW5nX3dyaXRlcysrO1xuICAgIHZhciBjb21taXR0ZWQgPSBmYWxzZTtcbiAgICByZXR1cm4ge1xuICAgICAgY29tbWl0dGVkOiBmdW5jdGlvbiAoKSB7XG4gICAgICAgIGlmIChjb21taXR0ZWQpXG4gICAgICAgICAgdGhyb3cgbmV3IEVycm9yKFwiY29tbWl0dGVkIGNhbGxlZCB0d2ljZSBvbiB0aGUgc2FtZSB3cml0ZVwiKTtcbiAgICAgICAgY29tbWl0dGVkID0gdHJ1ZTtcbiAgICAgICAgc2VsZi5vdXRzdGFuZGluZ193cml0ZXMtLTtcbiAgICAgICAgc2VsZi5fbWF5YmVGaXJlKCk7XG4gICAgICB9XG4gICAgfTtcbiAgfSxcblxuICAvLyBBcm0gdGhlIGZlbmNlLiBPbmNlIHRoZSBmZW5jZSBpcyBhcm1lZCwgYW5kIHRoZXJlIGFyZSBubyBtb3JlXG4gIC8vIHVuY29tbWl0dGVkIHdyaXRlcywgaXQgd2lsbCBhY3RpdmF0ZS5cbiAgYXJtOiBmdW5jdGlvbiAoKSB7XG4gICAgdmFyIHNlbGYgPSB0aGlzO1xuICAgIGlmIChzZWxmID09PSBERFBTZXJ2ZXIuX0N1cnJlbnRXcml0ZUZlbmNlLmdldCgpKVxuICAgICAgdGhyb3cgRXJyb3IoXCJDYW4ndCBhcm0gdGhlIGN1cnJlbnQgZmVuY2VcIik7XG4gICAgc2VsZi5hcm1lZCA9IHRydWU7XG4gICAgc2VsZi5fbWF5YmVGaXJlKCk7XG4gIH0sXG5cbiAgLy8gUmVnaXN0ZXIgYSBmdW5jdGlvbiB0byBiZSBjYWxsZWQgb25jZSBiZWZvcmUgZmlyaW5nIHRoZSBmZW5jZS5cbiAgLy8gQ2FsbGJhY2sgZnVuY3Rpb24gY2FuIGFkZCBuZXcgd3JpdGVzIHRvIHRoZSBmZW5jZSwgaW4gd2hpY2ggY2FzZVxuICAvLyBpdCB3b24ndCBmaXJlIHVudGlsIHRob3NlIHdyaXRlcyBhcmUgZG9uZSBhcyB3ZWxsLlxuICBvbkJlZm9yZUZpcmU6IGZ1bmN0aW9uIChmdW5jKSB7XG4gICAgdmFyIHNlbGYgPSB0aGlzO1xuICAgIGlmIChzZWxmLmZpcmVkKVxuICAgICAgdGhyb3cgbmV3IEVycm9yKFwiZmVuY2UgaGFzIGFscmVhZHkgYWN0aXZhdGVkIC0tIHRvbyBsYXRlIHRvIFwiICtcbiAgICAgICAgICAgICAgICAgICAgICBcImFkZCBhIGNhbGxiYWNrXCIpO1xuICAgIHNlbGYuYmVmb3JlX2ZpcmVfY2FsbGJhY2tzLnB1c2goZnVuYyk7XG4gIH0sXG5cbiAgLy8gUmVnaXN0ZXIgYSBmdW5jdGlvbiB0byBiZSBjYWxsZWQgd2hlbiB0aGUgZmVuY2UgZmlyZXMuXG4gIG9uQWxsQ29tbWl0dGVkOiBmdW5jdGlvbiAoZnVuYykge1xuICAgIHZhciBzZWxmID0gdGhpcztcbiAgICBpZiAoc2VsZi5maXJlZClcbiAgICAgIHRocm93IG5ldyBFcnJvcihcImZlbmNlIGhhcyBhbHJlYWR5IGFjdGl2YXRlZCAtLSB0b28gbGF0ZSB0byBcIiArXG4gICAgICAgICAgICAgICAgICAgICAgXCJhZGQgYSBjYWxsYmFja1wiKTtcbiAgICBzZWxmLmNvbXBsZXRpb25fY2FsbGJhY2tzLnB1c2goZnVuYyk7XG4gIH0sXG5cbiAgLy8gQ29udmVuaWVuY2UgZnVuY3Rpb24uIEFybXMgdGhlIGZlbmNlLCB0aGVuIGJsb2NrcyB1bnRpbCBpdCBmaXJlcy5cbiAgYXJtQW5kV2FpdDogZnVuY3Rpb24gKCkge1xuICAgIHZhciBzZWxmID0gdGhpcztcbiAgICB2YXIgZnV0dXJlID0gbmV3IEZ1dHVyZTtcbiAgICBzZWxmLm9uQWxsQ29tbWl0dGVkKGZ1bmN0aW9uICgpIHtcbiAgICAgIGZ1dHVyZVsncmV0dXJuJ10oKTtcbiAgICB9KTtcbiAgICBzZWxmLmFybSgpO1xuICAgIGZ1dHVyZS53YWl0KCk7XG4gIH0sXG5cbiAgX21heWJlRmlyZTogZnVuY3Rpb24gKCkge1xuICAgIHZhciBzZWxmID0gdGhpcztcbiAgICBpZiAoc2VsZi5maXJlZClcbiAgICAgIHRocm93IG5ldyBFcnJvcihcIndyaXRlIGZlbmNlIGFscmVhZHkgYWN0aXZhdGVkP1wiKTtcbiAgICBpZiAoc2VsZi5hcm1lZCAmJiAhc2VsZi5vdXRzdGFuZGluZ193cml0ZXMpIHtcbiAgICAgIGZ1bmN0aW9uIGludm9rZUNhbGxiYWNrIChmdW5jKSB7XG4gICAgICAgIHRyeSB7XG4gICAgICAgICAgZnVuYyhzZWxmKTtcbiAgICAgICAgfSBjYXRjaCAoZXJyKSB7XG4gICAgICAgICAgTWV0ZW9yLl9kZWJ1ZyhcImV4Y2VwdGlvbiBpbiB3cml0ZSBmZW5jZSBjYWxsYmFja1wiLCBlcnIpO1xuICAgICAgICB9XG4gICAgICB9XG5cbiAgICAgIHNlbGYub3V0c3RhbmRpbmdfd3JpdGVzKys7XG4gICAgICB3aGlsZSAoc2VsZi5iZWZvcmVfZmlyZV9jYWxsYmFja3MubGVuZ3RoID4gMCkge1xuICAgICAgICB2YXIgY2FsbGJhY2tzID0gc2VsZi5iZWZvcmVfZmlyZV9jYWxsYmFja3M7XG4gICAgICAgIHNlbGYuYmVmb3JlX2ZpcmVfY2FsbGJhY2tzID0gW107XG4gICAgICAgIF8uZWFjaChjYWxsYmFja3MsIGludm9rZUNhbGxiYWNrKTtcbiAgICAgIH1cbiAgICAgIHNlbGYub3V0c3RhbmRpbmdfd3JpdGVzLS07XG5cbiAgICAgIGlmICghc2VsZi5vdXRzdGFuZGluZ193cml0ZXMpIHtcbiAgICAgICAgc2VsZi5maXJlZCA9IHRydWU7XG4gICAgICAgIHZhciBjYWxsYmFja3MgPSBzZWxmLmNvbXBsZXRpb25fY2FsbGJhY2tzO1xuICAgICAgICBzZWxmLmNvbXBsZXRpb25fY2FsbGJhY2tzID0gW107XG4gICAgICAgIF8uZWFjaChjYWxsYmFja3MsIGludm9rZUNhbGxiYWNrKTtcbiAgICAgIH1cbiAgICB9XG4gIH0sXG5cbiAgLy8gRGVhY3RpdmF0ZSB0aGlzIGZlbmNlIHNvIHRoYXQgYWRkaW5nIG1vcmUgd3JpdGVzIGhhcyBubyBlZmZlY3QuXG4gIC8vIFRoZSBmZW5jZSBtdXN0IGhhdmUgYWxyZWFkeSBmaXJlZC5cbiAgcmV0aXJlOiBmdW5jdGlvbiAoKSB7XG4gICAgdmFyIHNlbGYgPSB0aGlzO1xuICAgIGlmICghIHNlbGYuZmlyZWQpXG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXCJDYW4ndCByZXRpcmUgYSBmZW5jZSB0aGF0IGhhc24ndCBmaXJlZC5cIik7XG4gICAgc2VsZi5yZXRpcmVkID0gdHJ1ZTtcbiAgfVxufSk7XG4iLCIvLyBBIFwiY3Jvc3NiYXJcIiBpcyBhIGNsYXNzIHRoYXQgcHJvdmlkZXMgc3RydWN0dXJlZCBub3RpZmljYXRpb24gcmVnaXN0cmF0aW9uLlxuLy8gU2VlIF9tYXRjaCBmb3IgdGhlIGRlZmluaXRpb24gb2YgaG93IGEgbm90aWZpY2F0aW9uIG1hdGNoZXMgYSB0cmlnZ2VyLlxuLy8gQWxsIG5vdGlmaWNhdGlvbnMgYW5kIHRyaWdnZXJzIG11c3QgaGF2ZSBhIHN0cmluZyBrZXkgbmFtZWQgJ2NvbGxlY3Rpb24nLlxuXG5ERFBTZXJ2ZXIuX0Nyb3NzYmFyID0gZnVuY3Rpb24gKG9wdGlvbnMpIHtcbiAgdmFyIHNlbGYgPSB0aGlzO1xuICBvcHRpb25zID0gb3B0aW9ucyB8fCB7fTtcblxuICBzZWxmLm5leHRJZCA9IDE7XG4gIC8vIG1hcCBmcm9tIGNvbGxlY3Rpb24gbmFtZSAoc3RyaW5nKSAtPiBsaXN0ZW5lciBpZCAtPiBvYmplY3QuIGVhY2ggb2JqZWN0IGhhc1xuICAvLyBrZXlzICd0cmlnZ2VyJywgJ2NhbGxiYWNrJy4gIEFzIGEgaGFjaywgdGhlIGVtcHR5IHN0cmluZyBtZWFucyBcIm5vXG4gIC8vIGNvbGxlY3Rpb25cIi5cbiAgc2VsZi5saXN0ZW5lcnNCeUNvbGxlY3Rpb24gPSB7fTtcbiAgc2VsZi5saXN0ZW5lcnNCeUNvbGxlY3Rpb25Db3VudCA9IHt9O1xuICBzZWxmLmZhY3RQYWNrYWdlID0gb3B0aW9ucy5mYWN0UGFja2FnZSB8fCBcImxpdmVkYXRhXCI7XG4gIHNlbGYuZmFjdE5hbWUgPSBvcHRpb25zLmZhY3ROYW1lIHx8IG51bGw7XG59O1xuXG5fLmV4dGVuZChERFBTZXJ2ZXIuX0Nyb3NzYmFyLnByb3RvdHlwZSwge1xuICAvLyBtc2cgaXMgYSB0cmlnZ2VyIG9yIGEgbm90aWZpY2F0aW9uXG4gIF9jb2xsZWN0aW9uRm9yTWVzc2FnZTogZnVuY3Rpb24gKG1zZykge1xuICAgIHZhciBzZWxmID0gdGhpcztcbiAgICBpZiAoISBfLmhhcyhtc2csICdjb2xsZWN0aW9uJykpIHtcbiAgICAgIHJldHVybiAnJztcbiAgICB9IGVsc2UgaWYgKHR5cGVvZihtc2cuY29sbGVjdGlvbikgPT09ICdzdHJpbmcnKSB7XG4gICAgICBpZiAobXNnLmNvbGxlY3Rpb24gPT09ICcnKVxuICAgICAgICB0aHJvdyBFcnJvcihcIk1lc3NhZ2UgaGFzIGVtcHR5IGNvbGxlY3Rpb24hXCIpO1xuICAgICAgcmV0dXJuIG1zZy5jb2xsZWN0aW9uO1xuICAgIH0gZWxzZSB7XG4gICAgICB0aHJvdyBFcnJvcihcIk1lc3NhZ2UgaGFzIG5vbi1zdHJpbmcgY29sbGVjdGlvbiFcIik7XG4gICAgfVxuICB9LFxuXG4gIC8vIExpc3RlbiBmb3Igbm90aWZpY2F0aW9uIHRoYXQgbWF0Y2ggJ3RyaWdnZXInLiBBIG5vdGlmaWNhdGlvblxuICAvLyBtYXRjaGVzIGlmIGl0IGhhcyB0aGUga2V5LXZhbHVlIHBhaXJzIGluIHRyaWdnZXIgYXMgYVxuICAvLyBzdWJzZXQuIFdoZW4gYSBub3RpZmljYXRpb24gbWF0Y2hlcywgY2FsbCAnY2FsbGJhY2snLCBwYXNzaW5nXG4gIC8vIHRoZSBhY3R1YWwgbm90aWZpY2F0aW9uLlxuICAvL1xuICAvLyBSZXR1cm5zIGEgbGlzdGVuIGhhbmRsZSwgd2hpY2ggaXMgYW4gb2JqZWN0IHdpdGggYSBtZXRob2RcbiAgLy8gc3RvcCgpLiBDYWxsIHN0b3AoKSB0byBzdG9wIGxpc3RlbmluZy5cbiAgLy9cbiAgLy8gWFhYIEl0IHNob3VsZCBiZSBsZWdhbCB0byBjYWxsIGZpcmUoKSBmcm9tIGluc2lkZSBhIGxpc3RlbigpXG4gIC8vIGNhbGxiYWNrP1xuICBsaXN0ZW46IGZ1bmN0aW9uICh0cmlnZ2VyLCBjYWxsYmFjaykge1xuICAgIHZhciBzZWxmID0gdGhpcztcbiAgICB2YXIgaWQgPSBzZWxmLm5leHRJZCsrO1xuXG4gICAgdmFyIGNvbGxlY3Rpb24gPSBzZWxmLl9jb2xsZWN0aW9uRm9yTWVzc2FnZSh0cmlnZ2VyKTtcbiAgICB2YXIgcmVjb3JkID0ge3RyaWdnZXI6IEVKU09OLmNsb25lKHRyaWdnZXIpLCBjYWxsYmFjazogY2FsbGJhY2t9O1xuICAgIGlmICghIF8uaGFzKHNlbGYubGlzdGVuZXJzQnlDb2xsZWN0aW9uLCBjb2xsZWN0aW9uKSkge1xuICAgICAgc2VsZi5saXN0ZW5lcnNCeUNvbGxlY3Rpb25bY29sbGVjdGlvbl0gPSB7fTtcbiAgICAgIHNlbGYubGlzdGVuZXJzQnlDb2xsZWN0aW9uQ291bnRbY29sbGVjdGlvbl0gPSAwO1xuICAgIH1cbiAgICBzZWxmLmxpc3RlbmVyc0J5Q29sbGVjdGlvbltjb2xsZWN0aW9uXVtpZF0gPSByZWNvcmQ7XG4gICAgc2VsZi5saXN0ZW5lcnNCeUNvbGxlY3Rpb25Db3VudFtjb2xsZWN0aW9uXSsrO1xuXG4gICAgaWYgKHNlbGYuZmFjdE5hbWUgJiYgUGFja2FnZVsnZmFjdHMtYmFzZSddKSB7XG4gICAgICBQYWNrYWdlWydmYWN0cy1iYXNlJ10uRmFjdHMuaW5jcmVtZW50U2VydmVyRmFjdChcbiAgICAgICAgc2VsZi5mYWN0UGFja2FnZSwgc2VsZi5mYWN0TmFtZSwgMSk7XG4gICAgfVxuXG4gICAgcmV0dXJuIHtcbiAgICAgIHN0b3A6IGZ1bmN0aW9uICgpIHtcbiAgICAgICAgaWYgKHNlbGYuZmFjdE5hbWUgJiYgUGFja2FnZVsnZmFjdHMtYmFzZSddKSB7XG4gICAgICAgICAgUGFja2FnZVsnZmFjdHMtYmFzZSddLkZhY3RzLmluY3JlbWVudFNlcnZlckZhY3QoXG4gICAgICAgICAgICBzZWxmLmZhY3RQYWNrYWdlLCBzZWxmLmZhY3ROYW1lLCAtMSk7XG4gICAgICAgIH1cbiAgICAgICAgZGVsZXRlIHNlbGYubGlzdGVuZXJzQnlDb2xsZWN0aW9uW2NvbGxlY3Rpb25dW2lkXTtcbiAgICAgICAgc2VsZi5saXN0ZW5lcnNCeUNvbGxlY3Rpb25Db3VudFtjb2xsZWN0aW9uXS0tO1xuICAgICAgICBpZiAoc2VsZi5saXN0ZW5lcnNCeUNvbGxlY3Rpb25Db3VudFtjb2xsZWN0aW9uXSA9PT0gMCkge1xuICAgICAgICAgIGRlbGV0ZSBzZWxmLmxpc3RlbmVyc0J5Q29sbGVjdGlvbltjb2xsZWN0aW9uXTtcbiAgICAgICAgICBkZWxldGUgc2VsZi5saXN0ZW5lcnNCeUNvbGxlY3Rpb25Db3VudFtjb2xsZWN0aW9uXTtcbiAgICAgICAgfVxuICAgICAgfVxuICAgIH07XG4gIH0sXG5cbiAgLy8gRmlyZSB0aGUgcHJvdmlkZWQgJ25vdGlmaWNhdGlvbicgKGFuIG9iamVjdCB3aG9zZSBhdHRyaWJ1dGVcbiAgLy8gdmFsdWVzIGFyZSBhbGwgSlNPTi1jb21wYXRpYmlsZSkgLS0gaW5mb3JtIGFsbCBtYXRjaGluZyBsaXN0ZW5lcnNcbiAgLy8gKHJlZ2lzdGVyZWQgd2l0aCBsaXN0ZW4oKSkuXG4gIC8vXG4gIC8vIElmIGZpcmUoKSBpcyBjYWxsZWQgaW5zaWRlIGEgd3JpdGUgZmVuY2UsIHRoZW4gZWFjaCBvZiB0aGVcbiAgLy8gbGlzdGVuZXIgY2FsbGJhY2tzIHdpbGwgYmUgY2FsbGVkIGluc2lkZSB0aGUgd3JpdGUgZmVuY2UgYXMgd2VsbC5cbiAgLy9cbiAgLy8gVGhlIGxpc3RlbmVycyBtYXkgYmUgaW52b2tlZCBpbiBwYXJhbGxlbCwgcmF0aGVyIHRoYW4gc2VyaWFsbHkuXG4gIGZpcmU6IGZ1bmN0aW9uIChub3RpZmljYXRpb24pIHtcbiAgICB2YXIgc2VsZiA9IHRoaXM7XG5cbiAgICB2YXIgY29sbGVjdGlvbiA9IHNlbGYuX2NvbGxlY3Rpb25Gb3JNZXNzYWdlKG5vdGlmaWNhdGlvbik7XG5cbiAgICBpZiAoISBfLmhhcyhzZWxmLmxpc3RlbmVyc0J5Q29sbGVjdGlvbiwgY29sbGVjdGlvbikpIHtcbiAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICB2YXIgbGlzdGVuZXJzRm9yQ29sbGVjdGlvbiA9IHNlbGYubGlzdGVuZXJzQnlDb2xsZWN0aW9uW2NvbGxlY3Rpb25dO1xuICAgIHZhciBjYWxsYmFja0lkcyA9IFtdO1xuICAgIF8uZWFjaChsaXN0ZW5lcnNGb3JDb2xsZWN0aW9uLCBmdW5jdGlvbiAobCwgaWQpIHtcbiAgICAgIGlmIChzZWxmLl9tYXRjaGVzKG5vdGlmaWNhdGlvbiwgbC50cmlnZ2VyKSkge1xuICAgICAgICBjYWxsYmFja0lkcy5wdXNoKGlkKTtcbiAgICAgIH1cbiAgICB9KTtcblxuICAgIC8vIExpc3RlbmVyIGNhbGxiYWNrcyBjYW4geWllbGQsIHNvIHdlIG5lZWQgdG8gZmlyc3QgZmluZCBhbGwgdGhlIG9uZXMgdGhhdFxuICAgIC8vIG1hdGNoIGluIGEgc2luZ2xlIGl0ZXJhdGlvbiBvdmVyIHNlbGYubGlzdGVuZXJzQnlDb2xsZWN0aW9uICh3aGljaCBjYW4ndFxuICAgIC8vIGJlIG11dGF0ZWQgZHVyaW5nIHRoaXMgaXRlcmF0aW9uKSwgYW5kIHRoZW4gaW52b2tlIHRoZSBtYXRjaGluZ1xuICAgIC8vIGNhbGxiYWNrcywgY2hlY2tpbmcgYmVmb3JlIGVhY2ggY2FsbCB0byBlbnN1cmUgdGhleSBoYXZlbid0IHN0b3BwZWQuXG4gICAgLy8gTm90ZSB0aGF0IHdlIGRvbid0IGhhdmUgdG8gY2hlY2sgdGhhdFxuICAgIC8vIHNlbGYubGlzdGVuZXJzQnlDb2xsZWN0aW9uW2NvbGxlY3Rpb25dIHN0aWxsID09PSBsaXN0ZW5lcnNGb3JDb2xsZWN0aW9uLFxuICAgIC8vIGJlY2F1c2UgdGhlIG9ubHkgd2F5IHRoYXQgc3RvcHMgYmVpbmcgdHJ1ZSBpcyBpZiBsaXN0ZW5lcnNGb3JDb2xsZWN0aW9uXG4gICAgLy8gZmlyc3QgZ2V0cyByZWR1Y2VkIGRvd24gdG8gdGhlIGVtcHR5IG9iamVjdCAoYW5kIHRoZW4gbmV2ZXIgZ2V0c1xuICAgIC8vIGluY3JlYXNlZCBhZ2FpbikuXG4gICAgXy5lYWNoKGNhbGxiYWNrSWRzLCBmdW5jdGlvbiAoaWQpIHtcbiAgICAgIGlmIChfLmhhcyhsaXN0ZW5lcnNGb3JDb2xsZWN0aW9uLCBpZCkpIHtcbiAgICAgICAgbGlzdGVuZXJzRm9yQ29sbGVjdGlvbltpZF0uY2FsbGJhY2sobm90aWZpY2F0aW9uKTtcbiAgICAgIH1cbiAgICB9KTtcbiAgfSxcblxuICAvLyBBIG5vdGlmaWNhdGlvbiBtYXRjaGVzIGEgdHJpZ2dlciBpZiBhbGwga2V5cyB0aGF0IGV4aXN0IGluIGJvdGggYXJlIGVxdWFsLlxuICAvL1xuICAvLyBFeGFtcGxlczpcbiAgLy8gIE46e2NvbGxlY3Rpb246IFwiQ1wifSBtYXRjaGVzIFQ6e2NvbGxlY3Rpb246IFwiQ1wifVxuICAvLyAgICAoYSBub24tdGFyZ2V0ZWQgd3JpdGUgdG8gYSBjb2xsZWN0aW9uIG1hdGNoZXMgYVxuICAvLyAgICAgbm9uLXRhcmdldGVkIHF1ZXJ5KVxuICAvLyAgTjp7Y29sbGVjdGlvbjogXCJDXCIsIGlkOiBcIlhcIn0gbWF0Y2hlcyBUOntjb2xsZWN0aW9uOiBcIkNcIn1cbiAgLy8gICAgKGEgdGFyZ2V0ZWQgd3JpdGUgdG8gYSBjb2xsZWN0aW9uIG1hdGNoZXMgYSBub24tdGFyZ2V0ZWQgcXVlcnkpXG4gIC8vICBOOntjb2xsZWN0aW9uOiBcIkNcIn0gbWF0Y2hlcyBUOntjb2xsZWN0aW9uOiBcIkNcIiwgaWQ6IFwiWFwifVxuICAvLyAgICAoYSBub24tdGFyZ2V0ZWQgd3JpdGUgdG8gYSBjb2xsZWN0aW9uIG1hdGNoZXMgYVxuICAvLyAgICAgdGFyZ2V0ZWQgcXVlcnkpXG4gIC8vICBOOntjb2xsZWN0aW9uOiBcIkNcIiwgaWQ6IFwiWFwifSBtYXRjaGVzIFQ6e2NvbGxlY3Rpb246IFwiQ1wiLCBpZDogXCJYXCJ9XG4gIC8vICAgIChhIHRhcmdldGVkIHdyaXRlIHRvIGEgY29sbGVjdGlvbiBtYXRjaGVzIGEgdGFyZ2V0ZWQgcXVlcnkgdGFyZ2V0ZWRcbiAgLy8gICAgIGF0IHRoZSBzYW1lIGRvY3VtZW50KVxuICAvLyAgTjp7Y29sbGVjdGlvbjogXCJDXCIsIGlkOiBcIlhcIn0gZG9lcyBub3QgbWF0Y2ggVDp7Y29sbGVjdGlvbjogXCJDXCIsIGlkOiBcIllcIn1cbiAgLy8gICAgKGEgdGFyZ2V0ZWQgd3JpdGUgdG8gYSBjb2xsZWN0aW9uIGRvZXMgbm90IG1hdGNoIGEgdGFyZ2V0ZWQgcXVlcnlcbiAgLy8gICAgIHRhcmdldGVkIGF0IGEgZGlmZmVyZW50IGRvY3VtZW50KVxuICBfbWF0Y2hlczogZnVuY3Rpb24gKG5vdGlmaWNhdGlvbiwgdHJpZ2dlcikge1xuICAgIC8vIE1vc3Qgbm90aWZpY2F0aW9ucyB0aGF0IHVzZSB0aGUgY3Jvc3NiYXIgaGF2ZSBhIHN0cmluZyBgY29sbGVjdGlvbmAgYW5kXG4gICAgLy8gbWF5YmUgYW4gYGlkYCB0aGF0IGlzIGEgc3RyaW5nIG9yIE9iamVjdElELiBXZSdyZSBhbHJlYWR5IGRpdmlkaW5nIHVwXG4gICAgLy8gdHJpZ2dlcnMgYnkgY29sbGVjdGlvbiwgYnV0IGxldCdzIGZhc3QtdHJhY2sgXCJub3BlLCBkaWZmZXJlbnQgSURcIiAoYW5kXG4gICAgLy8gYXZvaWQgdGhlIG92ZXJseSBnZW5lcmljIEVKU09OLmVxdWFscykuIFRoaXMgbWFrZXMgYSBub3RpY2VhYmxlXG4gICAgLy8gcGVyZm9ybWFuY2UgZGlmZmVyZW5jZTsgc2VlIGh0dHBzOi8vZ2l0aHViLmNvbS9tZXRlb3IvbWV0ZW9yL3B1bGwvMzY5N1xuICAgIGlmICh0eXBlb2Yobm90aWZpY2F0aW9uLmlkKSA9PT0gJ3N0cmluZycgJiZcbiAgICAgICAgdHlwZW9mKHRyaWdnZXIuaWQpID09PSAnc3RyaW5nJyAmJlxuICAgICAgICBub3RpZmljYXRpb24uaWQgIT09IHRyaWdnZXIuaWQpIHtcbiAgICAgIHJldHVybiBmYWxzZTtcbiAgICB9XG4gICAgaWYgKG5vdGlmaWNhdGlvbi5pZCBpbnN0YW5jZW9mIE1vbmdvSUQuT2JqZWN0SUQgJiZcbiAgICAgICAgdHJpZ2dlci5pZCBpbnN0YW5jZW9mIE1vbmdvSUQuT2JqZWN0SUQgJiZcbiAgICAgICAgISBub3RpZmljYXRpb24uaWQuZXF1YWxzKHRyaWdnZXIuaWQpKSB7XG4gICAgICByZXR1cm4gZmFsc2U7XG4gICAgfVxuXG4gICAgcmV0dXJuIF8uYWxsKHRyaWdnZXIsIGZ1bmN0aW9uICh0cmlnZ2VyVmFsdWUsIGtleSkge1xuICAgICAgcmV0dXJuICFfLmhhcyhub3RpZmljYXRpb24sIGtleSkgfHxcbiAgICAgICAgRUpTT04uZXF1YWxzKHRyaWdnZXJWYWx1ZSwgbm90aWZpY2F0aW9uW2tleV0pO1xuICAgIH0pO1xuICB9XG59KTtcblxuLy8gVGhlIFwiaW52YWxpZGF0aW9uIGNyb3NzYmFyXCIgaXMgYSBzcGVjaWZpYyBpbnN0YW5jZSB1c2VkIGJ5IHRoZSBERFAgc2VydmVyIHRvXG4vLyBpbXBsZW1lbnQgd3JpdGUgZmVuY2Ugbm90aWZpY2F0aW9ucy4gTGlzdGVuZXIgY2FsbGJhY2tzIG9uIHRoaXMgY3Jvc3NiYXJcbi8vIHNob3VsZCBjYWxsIGJlZ2luV3JpdGUgb24gdGhlIGN1cnJlbnQgd3JpdGUgZmVuY2UgYmVmb3JlIHRoZXkgcmV0dXJuLCBpZiB0aGV5XG4vLyB3YW50IHRvIGRlbGF5IHRoZSB3cml0ZSBmZW5jZSBmcm9tIGZpcmluZyAoaWUsIHRoZSBERFAgbWV0aG9kLWRhdGEtdXBkYXRlZFxuLy8gbWVzc2FnZSBmcm9tIGJlaW5nIHNlbnQpLlxuRERQU2VydmVyLl9JbnZhbGlkYXRpb25Dcm9zc2JhciA9IG5ldyBERFBTZXJ2ZXIuX0Nyb3NzYmFyKHtcbiAgZmFjdE5hbWU6IFwiaW52YWxpZGF0aW9uLWNyb3NzYmFyLWxpc3RlbmVyc1wiXG59KTtcbiIsImlmIChwcm9jZXNzLmVudi5ERFBfREVGQVVMVF9DT05ORUNUSU9OX1VSTCkge1xuICBfX21ldGVvcl9ydW50aW1lX2NvbmZpZ19fLkREUF9ERUZBVUxUX0NPTk5FQ1RJT05fVVJMID1cbiAgICBwcm9jZXNzLmVudi5ERFBfREVGQVVMVF9DT05ORUNUSU9OX1VSTDtcbn1cblxuTWV0ZW9yLnNlcnZlciA9IG5ldyBTZXJ2ZXI7XG5cbk1ldGVvci5yZWZyZXNoID0gZnVuY3Rpb24gKG5vdGlmaWNhdGlvbikge1xuICBERFBTZXJ2ZXIuX0ludmFsaWRhdGlvbkNyb3NzYmFyLmZpcmUobm90aWZpY2F0aW9uKTtcbn07XG5cbi8vIFByb3h5IHRoZSBwdWJsaWMgbWV0aG9kcyBvZiBNZXRlb3Iuc2VydmVyIHNvIHRoZXkgY2FuXG4vLyBiZSBjYWxsZWQgZGlyZWN0bHkgb24gTWV0ZW9yLlxuXy5lYWNoKFsncHVibGlzaCcsICdtZXRob2RzJywgJ2NhbGwnLCAnYXBwbHknLCAnb25Db25uZWN0aW9uJywgJ29uTWVzc2FnZSddLFxuICAgICAgIGZ1bmN0aW9uIChuYW1lKSB7XG4gICAgICAgICBNZXRlb3JbbmFtZV0gPSBfLmJpbmQoTWV0ZW9yLnNlcnZlcltuYW1lXSwgTWV0ZW9yLnNlcnZlcik7XG4gICAgICAgfSk7XG4iXX0=
