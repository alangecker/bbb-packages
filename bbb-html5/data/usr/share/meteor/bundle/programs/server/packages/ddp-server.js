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
var url = Npm.require('url'); // By default, we use the permessage-deflate extension with default
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
    self.open_sockets.push(socket); // XXX COMPAT WITH 0.6.6. Send the old style welcome message, which
    // will force old clients to reload. Remove this once we're not
    // concerned about people upgrading from a pre-0.7.0 release. Also,
    // remove the clause in the client that ignores the welcome message
    // (livedata_connection.js)

    socket.send(JSON.stringify({
      server_id: "0"
    })); // call all our callbacks when we get a new socket. they will do the
    // work of setting up handlers and such for specific messages.

    _.each(self.registration_callbacks, function (callback) {
      callback(socket);
    });
  });
};

_.extend(StreamServer.prototype, {
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

    _.each(['request', 'upgrade'], function (event) {
      var httpServer = WebApp.httpServer;
      var oldHttpServerListeners = httpServer.listeners(event).slice(0);
      httpServer.removeAllListeners(event); // request and upgrade have different arguments passed but
      // we only care about the first one which is always request

      var newListener = function (request
      /*, moreArguments */
      ) {
        // Store arguments for use within the closure below
        var args = arguments; // Rewrite /websocket and /websocket/ urls to /sockjs/websocket while
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

_.extend(SessionCollectionView.prototype, {
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
  self.workerRunning = false; // Sub objects for active subscriptions

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

_.extend(Session.prototype, {
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
    sub: function (msg) {
      var self = this; // reject malformed messages

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

      self._startSubscription(handler, msg.id, msg.params, msg.name);
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

_.extend(Subscription.prototype, {
  _runHandler: function () {
    // XXX should we unblock() here? Either before running the publish
    // function, or before running _publishCursor.
    //
    // Right now, each publish function blocks all future publishes and
    // methods waiting on data from Mongo (or whatever else the function
    // blocks on). This probably slows page load in common cases.
    var self = this;

    try {
      var res = DDP._CurrentPublicationInvocation.withValue(self, () => maybeAuditArgumentChecks(self._handler, self, EJSON.clone(self._params), // It's OK that this would look weird for universal subscriptions,
      // because they have no arguments so there can never be an
      // audit-argument-checks failure.
      "publisher '" + self._name + "'"));
    } catch (e) {
      self.error(e);
      return;
    } // Did the handler call this.error or this.stop?


    if (self._isDeactivated()) return;

    self._publishHandlerResult(res);
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

_.extend(Server.prototype, {
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
}); // Meteor.server used to be called Meteor.default_server. Provide
// backcompat as a courtesy even though it was never documented.
// XXX COMPAT WITH 0.6.4


Meteor.default_server = Meteor.server;
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
//# sourceMappingURL=data:application/json;charset=utf8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIm1ldGVvcjovL/CfkrthcHAvcGFja2FnZXMvZGRwLXNlcnZlci9zdHJlYW1fc2VydmVyLmpzIiwibWV0ZW9yOi8v8J+Su2FwcC9wYWNrYWdlcy9kZHAtc2VydmVyL2xpdmVkYXRhX3NlcnZlci5qcyIsIm1ldGVvcjovL/CfkrthcHAvcGFja2FnZXMvZGRwLXNlcnZlci93cml0ZWZlbmNlLmpzIiwibWV0ZW9yOi8v8J+Su2FwcC9wYWNrYWdlcy9kZHAtc2VydmVyL2Nyb3NzYmFyLmpzIiwibWV0ZW9yOi8v8J+Su2FwcC9wYWNrYWdlcy9kZHAtc2VydmVyL3NlcnZlcl9jb252ZW5pZW5jZS5qcyJdLCJuYW1lcyI6WyJ1cmwiLCJOcG0iLCJyZXF1aXJlIiwid2Vic29ja2V0RXh0ZW5zaW9ucyIsIl8iLCJvbmNlIiwiZXh0ZW5zaW9ucyIsIndlYnNvY2tldENvbXByZXNzaW9uQ29uZmlnIiwicHJvY2VzcyIsImVudiIsIlNFUlZFUl9XRUJTT0NLRVRfQ09NUFJFU1NJT04iLCJKU09OIiwicGFyc2UiLCJwdXNoIiwiY29uZmlndXJlIiwicGF0aFByZWZpeCIsIl9fbWV0ZW9yX3J1bnRpbWVfY29uZmlnX18iLCJST09UX1VSTF9QQVRIX1BSRUZJWCIsIlN0cmVhbVNlcnZlciIsInNlbGYiLCJyZWdpc3RyYXRpb25fY2FsbGJhY2tzIiwib3Blbl9zb2NrZXRzIiwicHJlZml4IiwiUm91dGVQb2xpY3kiLCJkZWNsYXJlIiwic29ja2pzIiwic2VydmVyT3B0aW9ucyIsImxvZyIsImhlYXJ0YmVhdF9kZWxheSIsImRpc2Nvbm5lY3RfZGVsYXkiLCJqc2Vzc2lvbmlkIiwiVVNFX0pTRVNTSU9OSUQiLCJESVNBQkxFX1dFQlNPQ0tFVFMiLCJ3ZWJzb2NrZXQiLCJmYXllX3NlcnZlcl9vcHRpb25zIiwic2VydmVyIiwiY3JlYXRlU2VydmVyIiwiV2ViQXBwIiwiaHR0cFNlcnZlciIsInJlbW92ZUxpc3RlbmVyIiwiX3RpbWVvdXRBZGp1c3RtZW50UmVxdWVzdENhbGxiYWNrIiwiaW5zdGFsbEhhbmRsZXJzIiwiYWRkTGlzdGVuZXIiLCJfcmVkaXJlY3RXZWJzb2NrZXRFbmRwb2ludCIsIm9uIiwic29ja2V0Iiwic2V0V2Vic29ja2V0VGltZW91dCIsInRpbWVvdXQiLCJwcm90b2NvbCIsIl9zZXNzaW9uIiwicmVjdiIsImNvbm5lY3Rpb24iLCJzZXRUaW1lb3V0Iiwic2VuZCIsImRhdGEiLCJ3cml0ZSIsIndpdGhvdXQiLCJzdHJpbmdpZnkiLCJzZXJ2ZXJfaWQiLCJlYWNoIiwiY2FsbGJhY2siLCJleHRlbmQiLCJwcm90b3R5cGUiLCJyZWdpc3RlciIsImFsbF9zb2NrZXRzIiwidmFsdWVzIiwiZXZlbnQiLCJvbGRIdHRwU2VydmVyTGlzdGVuZXJzIiwibGlzdGVuZXJzIiwic2xpY2UiLCJyZW1vdmVBbGxMaXN0ZW5lcnMiLCJuZXdMaXN0ZW5lciIsInJlcXVlc3QiLCJhcmdzIiwiYXJndW1lbnRzIiwicGFyc2VkVXJsIiwicGF0aG5hbWUiLCJmb3JtYXQiLCJvbGRMaXN0ZW5lciIsImFwcGx5IiwiRERQU2VydmVyIiwiRmliZXIiLCJTZXNzaW9uRG9jdW1lbnRWaWV3IiwiZXhpc3RzSW4iLCJTZXQiLCJkYXRhQnlLZXkiLCJNYXAiLCJfU2Vzc2lvbkRvY3VtZW50VmlldyIsImdldEZpZWxkcyIsInJldCIsImZvckVhY2giLCJwcmVjZWRlbmNlTGlzdCIsImtleSIsInZhbHVlIiwiY2xlYXJGaWVsZCIsInN1YnNjcmlwdGlvbkhhbmRsZSIsImNoYW5nZUNvbGxlY3RvciIsImdldCIsInJlbW92ZWRWYWx1ZSIsInVuZGVmaW5lZCIsImkiLCJsZW5ndGgiLCJwcmVjZWRlbmNlIiwic3BsaWNlIiwiZGVsZXRlIiwiRUpTT04iLCJlcXVhbHMiLCJjaGFuZ2VGaWVsZCIsImlzQWRkIiwiY2xvbmUiLCJoYXMiLCJzZXQiLCJlbHQiLCJmaW5kIiwiU2Vzc2lvbkNvbGxlY3Rpb25WaWV3IiwiY29sbGVjdGlvbk5hbWUiLCJzZXNzaW9uQ2FsbGJhY2tzIiwiZG9jdW1lbnRzIiwiY2FsbGJhY2tzIiwiX1Nlc3Npb25Db2xsZWN0aW9uVmlldyIsImlzRW1wdHkiLCJzaXplIiwiZGlmZiIsInByZXZpb3VzIiwiRGlmZlNlcXVlbmNlIiwiZGlmZk1hcHMiLCJib3RoIiwiYmluZCIsImRpZmZEb2N1bWVudCIsInJpZ2h0T25seSIsImlkIiwibm93RFYiLCJhZGRlZCIsImxlZnRPbmx5IiwicHJldkRWIiwicmVtb3ZlZCIsImZpZWxkcyIsImRpZmZPYmplY3RzIiwicHJldiIsIm5vdyIsImNoYW5nZWQiLCJkb2NWaWV3IiwiYWRkIiwiY2hhbmdlZFJlc3VsdCIsIkVycm9yIiwiZXJyIiwiU2Vzc2lvbiIsInZlcnNpb24iLCJvcHRpb25zIiwiUmFuZG9tIiwiaW5pdGlhbGl6ZWQiLCJpblF1ZXVlIiwiTWV0ZW9yIiwiX0RvdWJsZUVuZGVkUXVldWUiLCJibG9ja2VkIiwid29ya2VyUnVubmluZyIsIl9uYW1lZFN1YnMiLCJfdW5pdmVyc2FsU3VicyIsInVzZXJJZCIsImNvbGxlY3Rpb25WaWV3cyIsIl9pc1NlbmRpbmciLCJfZG9udFN0YXJ0TmV3VW5pdmVyc2FsU3VicyIsIl9wZW5kaW5nUmVhZHkiLCJfY2xvc2VDYWxsYmFja3MiLCJfc29ja2V0VXJsIiwiX3Jlc3BvbmRUb1BpbmdzIiwicmVzcG9uZFRvUGluZ3MiLCJjb25uZWN0aW9uSGFuZGxlIiwiY2xvc2UiLCJvbkNsb3NlIiwiZm4iLCJjYiIsImJpbmRFbnZpcm9ubWVudCIsImRlZmVyIiwiY2xpZW50QWRkcmVzcyIsIl9jbGllbnRBZGRyZXNzIiwiaHR0cEhlYWRlcnMiLCJoZWFkZXJzIiwibXNnIiwic2Vzc2lvbiIsInN0YXJ0VW5pdmVyc2FsU3VicyIsInJ1biIsImhlYXJ0YmVhdEludGVydmFsIiwiaGVhcnRiZWF0IiwiRERQQ29tbW9uIiwiSGVhcnRiZWF0IiwiaGVhcnRiZWF0VGltZW91dCIsIm9uVGltZW91dCIsInNlbmRQaW5nIiwic3RhcnQiLCJQYWNrYWdlIiwiRmFjdHMiLCJpbmNyZW1lbnRTZXJ2ZXJGYWN0Iiwic2VuZFJlYWR5Iiwic3Vic2NyaXB0aW9uSWRzIiwic3VicyIsInN1YnNjcmlwdGlvbklkIiwic2VuZEFkZGVkIiwiY29sbGVjdGlvbiIsInNlbmRDaGFuZ2VkIiwic2VuZFJlbW92ZWQiLCJnZXRTZW5kQ2FsbGJhY2tzIiwiZ2V0Q29sbGVjdGlvblZpZXciLCJ2aWV3IiwiaGFuZGxlcnMiLCJ1bml2ZXJzYWxfcHVibGlzaF9oYW5kbGVycyIsImhhbmRsZXIiLCJfc3RhcnRTdWJzY3JpcHRpb24iLCJzdG9wIiwiX21ldGVvclNlc3Npb24iLCJfZGVhY3RpdmF0ZUFsbFN1YnNjcmlwdGlvbnMiLCJfcmVtb3ZlU2Vzc2lvbiIsIl9wcmludFNlbnRERFAiLCJfZGVidWciLCJzdHJpbmdpZnlERFAiLCJzZW5kRXJyb3IiLCJyZWFzb24iLCJvZmZlbmRpbmdNZXNzYWdlIiwicHJvY2Vzc01lc3NhZ2UiLCJtc2dfaW4iLCJtZXNzYWdlUmVjZWl2ZWQiLCJwcm9jZXNzTmV4dCIsInNoaWZ0IiwidW5ibG9jayIsIm9uTWVzc2FnZUhvb2siLCJwcm90b2NvbF9oYW5kbGVycyIsImNhbGwiLCJzdWIiLCJuYW1lIiwicGFyYW1zIiwiQXJyYXkiLCJwdWJsaXNoX2hhbmRsZXJzIiwiZXJyb3IiLCJERFBSYXRlTGltaXRlciIsInJhdGVMaW1pdGVySW5wdXQiLCJ0eXBlIiwiY29ubmVjdGlvbklkIiwiX2luY3JlbWVudCIsInJhdGVMaW1pdFJlc3VsdCIsIl9jaGVjayIsImFsbG93ZWQiLCJnZXRFcnJvck1lc3NhZ2UiLCJ0aW1lVG9SZXNldCIsInVuc3ViIiwiX3N0b3BTdWJzY3JpcHRpb24iLCJtZXRob2QiLCJyYW5kb21TZWVkIiwiZmVuY2UiLCJfV3JpdGVGZW5jZSIsIm9uQWxsQ29tbWl0dGVkIiwicmV0aXJlIiwibWV0aG9kcyIsIm1ldGhvZF9oYW5kbGVycyIsImFybSIsInNldFVzZXJJZCIsIl9zZXRVc2VySWQiLCJpbnZvY2F0aW9uIiwiTWV0aG9kSW52b2NhdGlvbiIsImlzU2ltdWxhdGlvbiIsInByb21pc2UiLCJQcm9taXNlIiwicmVzb2x2ZSIsInJlamVjdCIsIl9DdXJyZW50V3JpdGVGZW5jZSIsIndpdGhWYWx1ZSIsIkREUCIsIl9DdXJyZW50TWV0aG9kSW52b2NhdGlvbiIsIm1heWJlQXVkaXRBcmd1bWVudENoZWNrcyIsImZpbmlzaCIsInBheWxvYWQiLCJ0aGVuIiwicmVzdWx0IiwiZXhjZXB0aW9uIiwid3JhcEludGVybmFsRXhjZXB0aW9uIiwiX2VhY2hTdWIiLCJmIiwiX2RpZmZDb2xsZWN0aW9uVmlld3MiLCJiZWZvcmVDVnMiLCJsZWZ0VmFsdWUiLCJyaWdodFZhbHVlIiwiZG9jIiwiX2RlYWN0aXZhdGUiLCJvbGROYW1lZFN1YnMiLCJuZXdTdWIiLCJfcmVjcmVhdGUiLCJfcnVuSGFuZGxlciIsIl9ub1lpZWxkc0FsbG93ZWQiLCJzdWJJZCIsIlN1YnNjcmlwdGlvbiIsInN1Yk5hbWUiLCJtYXliZVN1YiIsIl9uYW1lIiwiX3JlbW92ZUFsbERvY3VtZW50cyIsInJlc3BvbnNlIiwiaHR0cEZvcndhcmRlZENvdW50IiwicGFyc2VJbnQiLCJyZW1vdGVBZGRyZXNzIiwiZm9yd2FyZGVkRm9yIiwiaXNTdHJpbmciLCJ0cmltIiwic3BsaXQiLCJfaGFuZGxlciIsIl9zdWJzY3JpcHRpb25JZCIsIl9wYXJhbXMiLCJfc3Vic2NyaXB0aW9uSGFuZGxlIiwiX2RlYWN0aXZhdGVkIiwiX3N0b3BDYWxsYmFja3MiLCJfZG9jdW1lbnRzIiwiX3JlYWR5IiwiX2lkRmlsdGVyIiwiaWRTdHJpbmdpZnkiLCJNb25nb0lEIiwiaWRQYXJzZSIsInJlcyIsIl9DdXJyZW50UHVibGljYXRpb25JbnZvY2F0aW9uIiwiZSIsIl9pc0RlYWN0aXZhdGVkIiwiX3B1Ymxpc2hIYW5kbGVyUmVzdWx0IiwiaXNDdXJzb3IiLCJjIiwiX3B1Ymxpc2hDdXJzb3IiLCJyZWFkeSIsImlzQXJyYXkiLCJhbGwiLCJjb2xsZWN0aW9uTmFtZXMiLCJfZ2V0Q29sbGVjdGlvbk5hbWUiLCJjdXIiLCJfY2FsbFN0b3BDYWxsYmFja3MiLCJjb2xsZWN0aW9uRG9jcyIsInN0cklkIiwib25TdG9wIiwiaWRzIiwiU2VydmVyIiwiZGVmYXVsdHMiLCJvbkNvbm5lY3Rpb25Ib29rIiwiSG9vayIsImRlYnVnUHJpbnRFeGNlcHRpb25zIiwic2Vzc2lvbnMiLCJzdHJlYW1fc2VydmVyIiwicmF3X21zZyIsIl9wcmludFJlY2VpdmVkRERQIiwicGFyc2VERFAiLCJfaGFuZGxlQ29ubmVjdCIsIm9uQ29ubmVjdGlvbiIsIm9uTWVzc2FnZSIsInN1cHBvcnQiLCJjb250YWlucyIsIlNVUFBPUlRFRF9ERFBfVkVSU0lPTlMiLCJjYWxjdWxhdGVWZXJzaW9uIiwicHVibGlzaCIsImlzT2JqZWN0IiwiYXV0b3B1Ymxpc2giLCJpc19hdXRvIiwid2FybmVkX2Fib3V0X2F1dG9wdWJsaXNoIiwiZnVuYyIsInBvcCIsImNhbGxBc3luYyIsImFwcGx5QXN5bmMiLCJhd2FpdCIsImN1cnJlbnRNZXRob2RJbnZvY2F0aW9uIiwiY3VycmVudFB1YmxpY2F0aW9uSW52b2NhdGlvbiIsIm1ha2VScGNTZWVkIiwiX3VybEZvclNlc3Npb24iLCJzZXNzaW9uSWQiLCJjbGllbnRTdXBwb3J0ZWRWZXJzaW9ucyIsInNlcnZlclN1cHBvcnRlZFZlcnNpb25zIiwiY29ycmVjdFZlcnNpb24iLCJfY2FsY3VsYXRlVmVyc2lvbiIsImNvbnRleHQiLCJpc0NsaWVudFNhZmUiLCJvcmlnaW5hbE1lc3NhZ2UiLCJtZXNzYWdlIiwiZGV0YWlscyIsIl9leHBlY3RlZEJ5VGVzdCIsInN0YWNrIiwic2FuaXRpemVkRXJyb3IiLCJkZXNjcmlwdGlvbiIsIk1hdGNoIiwiX2ZhaWxJZkFyZ3VtZW50c0FyZU5vdEFsbENoZWNrZWQiLCJGdXR1cmUiLCJhcm1lZCIsImZpcmVkIiwicmV0aXJlZCIsIm91dHN0YW5kaW5nX3dyaXRlcyIsImJlZm9yZV9maXJlX2NhbGxiYWNrcyIsImNvbXBsZXRpb25fY2FsbGJhY2tzIiwiRW52aXJvbm1lbnRWYXJpYWJsZSIsImJlZ2luV3JpdGUiLCJjb21taXR0ZWQiLCJfbWF5YmVGaXJlIiwib25CZWZvcmVGaXJlIiwiYXJtQW5kV2FpdCIsImZ1dHVyZSIsIndhaXQiLCJpbnZva2VDYWxsYmFjayIsIl9Dcm9zc2JhciIsIm5leHRJZCIsImxpc3RlbmVyc0J5Q29sbGVjdGlvbiIsImxpc3RlbmVyc0J5Q29sbGVjdGlvbkNvdW50IiwiZmFjdFBhY2thZ2UiLCJmYWN0TmFtZSIsIl9jb2xsZWN0aW9uRm9yTWVzc2FnZSIsImxpc3RlbiIsInRyaWdnZXIiLCJyZWNvcmQiLCJmaXJlIiwibm90aWZpY2F0aW9uIiwibGlzdGVuZXJzRm9yQ29sbGVjdGlvbiIsImNhbGxiYWNrSWRzIiwibCIsIl9tYXRjaGVzIiwiT2JqZWN0SUQiLCJ0cmlnZ2VyVmFsdWUiLCJfSW52YWxpZGF0aW9uQ3Jvc3NiYXIiLCJERFBfREVGQVVMVF9DT05ORUNUSU9OX1VSTCIsInJlZnJlc2giLCJkZWZhdWx0X3NlcnZlciJdLCJtYXBwaW5ncyI6Ijs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7O0FBQUEsSUFBSUEsR0FBRyxHQUFHQyxHQUFHLENBQUNDLE9BQUosQ0FBWSxLQUFaLENBQVYsQyxDQUVBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7OztBQUNBLElBQUlDLG1CQUFtQixHQUFHQyxDQUFDLENBQUNDLElBQUYsQ0FBTyxZQUFZO0FBQzNDLE1BQUlDLFVBQVUsR0FBRyxFQUFqQjtBQUVBLE1BQUlDLDBCQUEwQixHQUFHQyxPQUFPLENBQUNDLEdBQVIsQ0FBWUMsNEJBQVosR0FDekJDLElBQUksQ0FBQ0MsS0FBTCxDQUFXSixPQUFPLENBQUNDLEdBQVIsQ0FBWUMsNEJBQXZCLENBRHlCLEdBQzhCLEVBRC9EOztBQUVBLE1BQUlILDBCQUFKLEVBQWdDO0FBQzlCRCxjQUFVLENBQUNPLElBQVgsQ0FBZ0JaLEdBQUcsQ0FBQ0MsT0FBSixDQUFZLG9CQUFaLEVBQWtDWSxTQUFsQyxDQUNkUCwwQkFEYyxDQUFoQjtBQUdEOztBQUVE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ckgsTUFBUCxHQUFnQixJQUFJeVMsTUFBSixFQUFoQjs7QUFFQXBMLE1BQU0sQ0FBQ3VRLE9BQVAsR0FBaUIsVUFBVVQsWUFBVixFQUF3QjtBQUN2Q3RVLFdBQVMsQ0FBQzZVLHFCQUFWLENBQWdDUixJQUFoQyxDQUFxQ0MsWUFBckM7QUFDRCxDQUZELEMsQ0FJQTtBQUNBOzs7QUFDQWxaLENBQUMsQ0FBQ3VELElBQUYsQ0FBTyxDQUFDLFNBQUQsRUFBWSxTQUFaLEVBQXVCLE1BQXZCLEVBQStCLE9BQS9CLEVBQXdDLGNBQXhDLEVBQXdELFdBQXhELENBQVAsRUFDTyxVQUFVeUssSUFBVixFQUFnQjtBQUNkNUUsUUFBTSxDQUFDNEUsSUFBRCxDQUFOLEdBQWVoTyxDQUFDLENBQUMySCxJQUFGLENBQU95QixNQUFNLENBQUNySCxNQUFQLENBQWNpTSxJQUFkLENBQVAsRUFBNEI1RSxNQUFNLENBQUNySCxNQUFuQyxDQUFmO0FBQ0QsQ0FIUixFLENBS0E7QUFDQTtBQUNBOzs7QUFDQXFILE1BQU0sQ0FBQ3dRLGNBQVAsR0FBd0J4USxNQUFNLENBQUNySCxNQUEvQixDIiwiZmlsZSI6Ii9wYWNrYWdlcy9kZHAtc2VydmVyLmpzIiwic291cmNlc0NvbnRlbnQiOlsidmFyIHVybCA9IE5wbS5yZXF1aXJlKCd1cmwnKTtcblxuLy8gQnkgZGVmYXVsdCwgd2UgdXNlIHRoZSBwZXJtZXNzYWdlLWRlZmxhdGUgZXh0ZW5zaW9uIHdpdGggZGVmYXVsdFxuLy8gY29uZmlndXJhdGlvbi4gSWYgJFNFUlZFUl9XRUJTT0NLRVRfQ09NUFJFU1NJT04gaXMgc2V0LCB0aGVuIGl0IG11c3QgYmUgdmFsaWRcbi8vIEpTT04uIElmIGl0IHJlcHJlc2VudHMgYSBmYWxzZXkgdmFsdWUsIHRoZW4gd2UgZG8gbm90IHVzZSBwZXJtZXNzYWdlLWRlZmxhdGVcbi8vIGF0IGFsbDsgb3RoZXJ3aXNlLCB0aGUgSlNPTiB2YWx1ZSBpcyB1c2VkIGFzIGFuIGFyZ3VtZW50IHRvIGRlZmxhdGUnc1xuLy8gY29uZmlndXJlIG1ldGhvZDsgc2VlXG4vLyBodHRwczovL2dpdGh1Yi5jb20vZmF5ZS9wZXJtZXNzYWdlLWRlZmxhdGUtbm9kZS9ibG9iL21hc3Rlci9SRUFETUUubWRcbi8vXG4vLyAoV2UgZG8gdGhpcyBpbiBhbiBfLm9uY2UgaW5zdGVhZCBvZiBhdCBzdGFydHVwLCBiZWNhdXNlIHdlIGRvbid0IHdhbnQgdG9cbi8vIGNyYXNoIHRoZSB0b29sIGR1cmluZyBpc29wYWNrZXQgbG9hZCBpZiB5b3VyIEpTT04gZG9lc24ndCBwYXJzZS4gVGhpcyBpcyBvbmx5XG4vLyBhIHByb2JsZW0gYmVjYXVzZSB0aGUgdG9vbCBoYXMgdG8gbG9hZCB0aGUgRERQIHNlcnZlciBjb2RlIGp1c3QgaW4gb3JkZXIgdG9cbi8vIGJlIGEgRERQIGNsaWVudDsgc2VlIGh0dHBzOi8vZ2l0aHViLmNvbS9tZXRlb3IvbWV0ZW9yL2lzc3Vlcy8zNDUyIC4pXG52YXIgd2Vic29ja2V0RXh0ZW5zaW9ucyA9IF8ub25jZShmdW5jdGlvbiAoKSB7XG4gIHZhciBleHRlbnNpb25zID0gW107XG5cbiAgdmFyIHdlYnNvY2tldENvbXByZXNzaW9uQ29uZmlnID0gcHJvY2Vzcy5lbnYuU0VSVkVSX1dFQlNPQ0tFVF9DT01QUkVTU0lPTlxuICAgICAgICA/IEpTT04ucGFyc2UocHJvY2Vzcy5lbnYuU0VSVkVSX1dFQlNPQ0tFVF9DT01QUkVTU0lPTikgOiB7fTtcbiAgaWYgKHdlYnNvY2tldENvbXByZXNzaW9uQ29uZmlnKSB7XG4gICAgZXh0ZW5zaW9ucy5wdXNoKE5wbS5yZXF1aXJlKCdwZXJtZXNzYWdlLWRlZmxhdGUnKS5jb25maWd1cmUoXG4gICAgICB3ZWJzb2NrZXRDb21wcmVzc2lvbkNvbmZpZ1xuICAgICkpO1xuICB9XG5cbiAgcmV0dXJuIGV4dGVuc2lvbnM7XG59KTtcblxudmFyIHBhdGhQcmVmaXggPSBfX21ldGVvcl9ydW50aW1lX2NvbmZpZ19fLlJPT1RfVVJMX1BBVEhfUFJFRklYIHx8ICBcIlwiO1xuXG5TdHJlYW1TZXJ2ZXIgPSBmdW5jdGlvbiAoKSB7XG4gIHZhciBzZWxmID0gdGhpcztcbiAgc2VsZi5yZWdpc3RyYXRpb25fY2FsbGJhY2tzID0gW107XG4gIHNlbGYub3Blbl9zb2NrZXRzID0gW107XG5cbiAgLy8gQmVjYXVzZSB3ZSBhcmUgaW5zdGFsbGluZyBkaXJlY3RseSBvbnRvIFdlYkFwcC5odHRwU2VydmVyIGluc3RlYWQgb2YgdXNpbmdcbiAgLy8gV2ViQXBwLmFwcCwgd2UgaGF2ZSB0byBwcm9jZXNzIHRoZSBwYXRoIHByZWZpeCBvdXJzZWx2ZXMuXG4gIHNlbGYucHJlZml4ID0gcGF0aFByZWZpeCArICcvc29ja2pzJztcbiAgUm91dGVQb2xpY3kuZGVjbGFyZShzZWxmLnByZWZpeCArICcvJywgJ25ldHdvcmsnKTtcblxuICAvLyBzZXQgdXAgc29ja2pzXG4gIHZhciBzb2NranMgPSBOcG0ucmVxdWlyZSgnc29ja2pzJyk7XG4gIHZhciBzZXJ2ZXJPcHRpb25zID0ge1xuICAgIHByZWZpeDogc2VsZi5wcmVmaXgsXG4gICAgbG9nOiBmdW5jdGlvbigpIHt9LFxuICAgIC8vIHRoaXMgaXMgdGhlIGRlZmF1bHQsIGJ1dCB3ZSBjb2RlIGl0IGV4cGxpY2l0bHkgYmVjYXVzZSB3ZSBkZXBlbmRcbiAgICAvLyBvbiBpdCBpbiBzdHJlYW1fY2xpZW50OkhFQVJUQkVBVF9USU1FT1VUXG4gICAgaGVhcnRiZWF0X2RlbGF5OiA0NTAwMCxcbiAgICAvLyBUaGUgZGVmYXVsdCBkaXNjb25uZWN0X2RlbGF5IGlzIDUgc2Vjb25kcywgYnV0IGlmIHRoZSBzZXJ2ZXIgZW5kcyB1cCBDUFVcbiAgICAvLyBib3VuZCBmb3IgdGhhdCBtdWNoIHRpbWUsIFNvY2tKUyBtaWdodCBub3Qgbm90aWNlIHRoYXQgdGhlIHVzZXIgaGFzXG4gICAgLy8gcmVjb25uZWN0ZWQgYmVjYXVzZSB0aGUgdGltZXIgKG9mIGRpc2Nvbm5lY3RfZGVsYXkgbXMpIGNhbiBmaXJlIGJlZm9yZVxuICAgIC8vIFNvY2tKUyBwcm9jZXNzZXMgdGhlIG5ldyBjb25uZWN0aW9uLiBFdmVudHVhbGx5IHdlJ2xsIGZpeCB0aGlzIGJ5IG5vdFxuICAgIC8vIGNvbWJpbmluZyBDUFUtaGVhdnkgcHJvY2Vzc2luZyB3aXRoIFNvY2tKUyB0ZXJtaW5hdGlvbiAoZWcgYSBwcm94eSB3aGljaFxuICAgIC8vIGNvbnZlcnRzIHRvIFVuaXggc29ja2V0cykgYnV0IGZvciBub3csIHJhaXNlIHRoZSBkZWxheS5cbiAgICBkaXNjb25uZWN0X2RlbGF5OiA2MCAqIDEwMDAsXG4gICAgLy8gU2V0IHRoZSBVU0VfSlNFU1NJT05JRCBlbnZpcm9ubWVudCB2YXJpYWJsZSB0byBlbmFibGUgc2V0dGluZyB0aGVcbiAgICAvLyBKU0VTU0lPTklEIGNvb2tpZS4gVGhpcyBpcyB1c2VmdWwgZm9yIHNldHRpbmcgdXAgcHJveGllcyB3aXRoXG4gICAgLy8gc2Vzc2lvbiBhZmZpbml0eS5cbiAgICBqc2Vzc2lvbmlkOiAhIXByb2Nlc3MuZW52LlVTRV9KU0VTU0lPTklEXG4gIH07XG5cbiAgLy8gSWYgeW91IGtub3cgeW91ciBzZXJ2ZXIgZW52aXJvbm1lbnQgKGVnLCBwcm94aWVzKSB3aWxsIHByZXZlbnQgd2Vic29ja2V0c1xuICAvLyBmcm9tIGV2ZXIgd29ya2luZywgc2V0ICRESVNBQkxFX1dFQlNPQ0tFVFMgYW5kIFNvY2tKUyBjbGllbnRzIChpZSxcbiAgLy8gYnJvd3NlcnMpIHdpbGwgbm90IHdhc3RlIHRpbWUgYXR0ZW1wdGluZyB0byB1c2UgdGhlbS5cbiAgLy8gKFlvdXIgc2VydmVyIHdpbGwgc3RpbGwgaGF2ZSBhIC93ZWJzb2NrZXQgZW5kcG9pbnQuKVxuICBpZiAocHJvY2Vzcy5lbnYuRElTQUJMRV9XRUJTT0NLRVRTKSB7XG4gICAgc2VydmVyT3B0aW9ucy53ZWJzb2NrZXQgPSBmYWxzZTtcbiAgfSBlbHNlIHtcbiAgICBzZXJ2ZXJPcHRpb25zLmZheWVfc2VydmVyX29wdGlvbnMgPSB7XG4gICAgICBleHRlbnNpb25zOiB3ZWJzb2NrZXRFeHRlbnNpb25zKClcbiAgICB9O1xuICB9XG5cbiAgc2VsZi5zZXJ2ZXIgPSBzb2NranMuY3JlYXRlU2VydmVyKHNlcnZlck9wdGlvbnMpO1xuXG4gIC8vIEluc3RhbGwgdGhlIHNvY2tqcyBoYW5kbGVycywgYnV0IHdlIHdhbnQgdG8ga2VlcCBhcm91bmQgb3VyIG93biBwYXJ0aWN1bGFyXG4gIC8vIHJlcXVlc3QgaGFuZGxlciB0aGF0IGFkanVzdHMgaWRsZSB0aW1lb3V0cyB3aGlsZSB3ZSBoYXZlIGFuIG91dHN0YW5kaW5nXG4gIC8vIHJlcXVlc3QuICBUaGlzIGNvbXBlbnNhdGVzIGZvciB0aGUgZmFjdCB0aGF0IHNvY2tqcyByZW1vdmVzIGFsbCBsaXN0ZW5lcnNcbiAgLy8gZm9yIFwicmVxdWVzdFwiIHRvIGFkZCBpdHMgb3duLlxuICBXZWJBcHAuaHR0cFNlcnZlci5yZW1vdmVMaXN0ZW5lcihcbiAgICAncmVxdWVzdCcsIFdlYkFwcC5fdGltZW91dEFkanVzdG1lbnRSZXF1ZXN0Q2FsbGJhY2spO1xuICBzZWxmLnNlcnZlci5pbnN0YWxsSGFuZGxlcnMoV2ViQXBwLmh0dHBTZXJ2ZXIpO1xuICBXZWJBcHAuaHR0cFNlcnZlci5hZGRMaXN0ZW5lcihcbiAgICAncmVxdWVzdCcsIFdlYkFwcC5fdGltZW91dEFkanVzdG1lbnRSZXF1ZXN0Q2FsbGJhY2spO1xuXG4gIC8vIFN1cHBvcnQgdGhlIC93ZWJzb2NrZXQgZW5kcG9pbnRcbiAgc2VsZi5fcmVkaXJlY3RXZWJzb2NrZXRFbmRwb2ludCgpO1xuXG4gIHNlbGYuc2VydmVyLm9uKCdjb25uZWN0aW9uJywgZnVuY3Rpb24gKHNvY2tldCkge1xuICAgIC8vIHNvY2tqcyBzb21ldGltZXMgcGFzc2VzIHVzIG51bGwgaW5zdGVhZCBvZiBhIHNvY2tldCBvYmplY3RcbiAgICAvLyBzbyB3ZSBuZWVkIHRvIGd1YXJkIGFnYWluc3QgdGhhdC4gc2VlOlxuICAgIC8vIGh0dHBzOi8vZ2l0aHViLmNvbS9zb2NranMvc29ja2pzLW5vZGUvaXNzdWVzLzEyMVxuICAgIC8vIGh0dHBzOi8vZ2l0aHViLmNvbS9tZXRlb3IvbWV0ZW9yL2lzc3Vlcy8xMDQ2OFxuICAgIGlmICghc29ja2V0KSByZXR1cm47XG5cbiAgICAvLyBXZSB3YW50IHRvIG1ha2Ugc3VyZSB0aGF0IGlmIGEgY2xpZW50IGNvbm5lY3RzIHRvIHVzIGFuZCBkb2VzIHRoZSBpbml0aWFsXG4gICAgLy8gV2Vic29ja2V0IGhhbmRzaGFrZSBidXQgbmV2ZXIgZ2V0cyB0byB0aGUgRERQIGhhbmRzaGFrZSwgdGhhdCB3ZVxuICAgIC8vIGV2ZW50dWFsbHkga2lsbCB0aGUgc29ja2V0LiAgT25jZSB0aGUgRERQIGhhbmRzaGFrZSBoYXBwZW5zLCBERFBcbiAgICAvLyBoZWFydGJlYXRpbmcgd2lsbCB3b3JrLiBBbmQgYmVmb3JlIHRoZSBXZWJzb2NrZXQgaGFuZHNoYWtlLCB0aGUgdGltZW91dHNcbiAgICAvLyB3ZSBzZXQgYXQgdGhlIHNlcnZlciBsZXZlbCBpbiB3ZWJhcHBfc2VydmVyLmpzIHdpbGwgd29yay4gQnV0XG4gICAgLy8gZmF5ZS13ZWJzb2NrZXQgY2FsbHMgc2V0VGltZW91dCgwKSBvbiBhbnkgc29ja2V0IGl0IHRha2VzIG92ZXIsIHNvIHRoZXJlXG4gICAgLy8gaXMgYW4gXCJpbiBiZXR3ZWVuXCIgc3RhdGUgd2hlcmUgdGhpcyBkb2Vzbid0IGhhcHBlbi4gIFdlIHdvcmsgYXJvdW5kIHRoaXNcbiAgICAvLyBieSBleHBsaWNpdGx5IHNldHRpbmcgdGhlIHNvY2tldCB0aW1lb3V0IHRvIGEgcmVsYXRpdmVseSBsYXJnZSB0aW1lIGhlcmUsXG4gICAgLy8gYW5kIHNldHRpbmcgaXQgYmFjayB0byB6ZXJvIHdoZW4gd2Ugc2V0IHVwIHRoZSBoZWFydGJlYXQgaW5cbiAgICAvLyBsaXZlZGF0YV9zZXJ2ZXIuanMuXG4gICAgc29ja2V0LnNldFdlYnNvY2tldFRpbWVvdXQgPSBmdW5jdGlvbiAodGltZW91dCkge1xuICAgICAgaWYgKChzb2NrZXQucHJvdG9jb2wgPT09ICd3ZWJzb2NrZXQnIHx8XG4gICAgICAgICAgIHNvY2tldC5wcm90b2NvbCA9PT0gJ3dlYnNvY2tldC1yYXcnKVxuICAgICAgICAgICYmIHNvY2tldC5fc2Vzc2lvbi5yZWN2KSB7XG4gICAgICAgIHNvY2tldC5fc2Vzc2lvbi5yZWN2LmNvbm5lY3Rpb24uc2V0VGltZW91dCh0aW1lb3V0KTtcbiAgICAgIH1cbiAgICB9O1xuICAgIHNvY2tldC5zZXRXZWJzb2NrZXRUaW1lb3V0KDQ1ICogMTAwMCk7XG5cbiAgICBzb2NrZXQuc2VuZCA9IGZ1bmN0aW9uIChkYXRhKSB7XG4gICAgICBzb2NrZXQud3JpdGUoZGF0YSk7XG4gICAgfTtcbiAgICBzb2NrZXQub24oJ2Nsb3NlJywgZnVuY3Rpb24gKCkge1xuICAgICAgc2VsZi5vcGVuX3NvY2tldHMgPSBfLndpdGhvdXQoc2VsZi5vcGVuX3NvY2tldHMsIHNvY2tldCk7XG4gICAgfSk7XG4gICAgc2VsZi5vcGVuX3NvY2tldHMucHVzaChzb2NrZXQpO1xuXG4gICAgLy8gWFhYIENPTVBBVCBXSVRIIDAuNi42LiBTZW5kIHRoZSBvbGQgc3R5bGUgd2VsY29tZSBtZXNzYWdlLCB3aGljaFxuICAgIC8vIHdpbGwgZm9yY2Ugb2xkIGNsaWVudHMgdG8gcmVsb2FkLiBSZW1vdmUgdGhpcyBvbmNlIHdlJ3JlIG5vdFxuICAgIC8vIGNvbmNlcm5lZCBhYm91dCBwZW9wbGUgdXBncmFkaW5nIGZyb20gYSBwcmUtMC43LjAgcmVsZWFzZS4gQWxzbyxcbiAgICAvLyByZW1vdmUgdGhlIGNsYXVzZSBpbiB0aGUgY2xpZW50IHRoYXQgaWdub3JlcyB0aGUgd2VsY29tZSBtZXNzYWdlXG4gICAgLy8gKGxpdmVkYXRhX2Nvbm5lY3Rpb24uanMpXG4gICAgc29ja2V0LnNlbmQoSlNPTi5zdHJpbmdpZnkoe3NlcnZlcl9pZDogXCIwXCJ9KSk7XG5cbiAgICAvLyBjYWxsIGFsbCBvdXIgY2FsbGJhY2tzIHdoZW4gd2UgZ2V0IGEgbmV3IHNvY2tldC4gdGhleSB3aWxsIGRvIHRoZVxuICAgIC8vIHdvcmsgb2Ygc2V0dGluZyB1cCBoYW5kbGVycyBhbmQgc3VjaCBmb3Igc3BlY2lmaWMgbWVzc2FnZXMuXG4gICAgXy5lYWNoKHNlbGYucmVnaXN0cmF0aW9uX2NhbGxiYWNrcywgZnVuY3Rpb24gKGNhbGxiYWNrKSB7XG4gICAgICBjYWxsYmFjayhzb2NrZXQpO1xuICAgIH0pO1xuICB9KTtcblxufTtcblxuXy5leHRlbmQoU3RyZWFtU2VydmVyLnByb3RvdHlwZSwge1xuICAvLyBjYWxsIG15IGNhbGxiYWNrIHdoZW4gYSBuZXcgc29ja2V0IGNvbm5lY3RzLlxuICAvLyBhbHNvIGNhbGwgaXQgZm9yIGFsbCBjdXJyZW50IGNvbm5lY3Rpb25zLlxuICByZWdpc3RlcjogZnVuY3Rpb24gKGNhbGxiYWNrKSB7XG4gICAgdmFyIHNlbGYgPSB0aGlzO1xuICAgIHNlbGYucmVnaXN0cmF0aW9uX2NhbGxiYWNrcy5wdXNoKGNhbGxiYWNrKTtcbiAgICBfLmVhY2goc2VsZi5hbGxfc29ja2V0cygpLCBmdW5jdGlvbiAoc29ja2V0KSB7XG4gICAgICBjYWxsYmFjayhzb2NrZXQpO1xuICAgIH0pO1xuICB9LFxuXG4gIC8vIGdldCBhIGxpc3Qgb2YgYWxsIHNvY2tldHNcbiAgYWxsX3NvY2tldHM6IGZ1bmN0aW9uICgpIHtcbiAgICB2YXIgc2VsZiA9IHRoaXM7XG4gICAgcmV0dXJuIF8udmFsdWVzKHNlbGYub3Blbl9zb2NrZXRzKTtcbiAgfSxcblxuICAvLyBSZWRpcmVjdCAvd2Vic29ja2V0IHRvIC9zb2NranMvd2Vic29ja2V0IGluIG9yZGVyIHRvIG5vdCBleHBvc2VcbiAgLy8gc29ja2pzIHRvIGNsaWVudHMgdGhhdCB3YW50IHRvIHVzZSByYXcgd2Vic29ja2V0c1xuICBfcmVkaXJlY3RXZWJzb2NrZXRFbmRwb2ludDogZnVuY3Rpb24oKSB7XG4gICAgdmFyIHNlbGYgPSB0aGlzO1xuICAgIC8vIFVuZm9ydHVuYXRlbHkgd2UgY2FuJ3QgdXNlIGEgY29ubmVjdCBtaWRkbGV3YXJlIGhlcmUgc2luY2VcbiAgICAvLyBzb2NranMgaW5zdGFsbHMgaXRzZWxmIHByaW9yIHRvIGFsbCBleGlzdGluZyBsaXN0ZW5lcnNcbiAgICAvLyAobWVhbmluZyBwcmlvciB0byBhbnkgY29ubmVjdCBtaWRkbGV3YXJlcykgc28gd2UgbmVlZCB0byB0YWtlXG4gICAgLy8gYW4gYXBwcm9hY2ggc2ltaWxhciB0byBvdmVyc2hhZG93TGlzdGVuZXJzIGluXG4gICAgLy8gaHR0cHM6Ly9naXRodWIuY29tL3NvY2tqcy9zb2NranMtbm9kZS9ibG9iL2NmODIwYzU1YWY2YTk5NTNlMTY1NTg1NTVhMzFkZWNlYTU1NGY3MGUvc3JjL3V0aWxzLmNvZmZlZVxuICAgIF8uZWFjaChbJ3JlcXVlc3QnLCAndXBncmFkZSddLCBmdW5jdGlvbihldmVudCkge1xuICAgICAgdmFyIGh0dHBTZXJ2ZXIgPSBXZWJBcHAuaHR0cFNlcnZlcjtcbiAgICAgIHZhciBvbGRIdHRwU2VydmVyTGlzdGVuZXJzID0gaHR0cFNlcnZlci5saXN0ZW5lcnMoZXZlbnQpLnNsaWNlKDApO1xuICAgICAgaHR0cFNlcnZlci5yZW1vdmVBbGxMaXN0ZW5lcnMoZXZlbnQpO1xuXG4gICAgICAvLyByZXF1ZXN0IGFuZCB1cGdyYWRlIGhhdmUgZGlmZmVyZW50IGFyZ3VtZW50cyBwYXNzZWQgYnV0XG4gICAgICAvLyB3ZSBvbmx5IGNhcmUgYWJvdXQgdGhlIGZpcnN0IG9uZSB3aGljaCBpcyBhbHdheXMgcmVxdWVzdFxuICAgICAgdmFyIG5ld0xpc3RlbmVyID0gZnVuY3Rpb24ocmVxdWVzdCAvKiwgbW9yZUFyZ3VtZW50cyAqLykge1xuICAgICAgICAvLyBTdG9yZSBhcmd1bWVudHMgZm9yIHVzZSB3aXRoaW4gdGhlIGNsb3N1cmUgYmVsb3dcbiAgICAgICAgdmFyIGFyZ3MgPSBhcmd1bWVudHM7XG5cbiAgICAgICAgLy8gUmV3cml0ZSAvd2Vic29ja2V0IGFuZCAvd2Vic29ja2V0LyB1cmxzIHRvIC9zb2NranMvd2Vic29ja2V0IHdoaWxlXG4gICAgICAgIC8vIHByZXNlcnZpbmcgcXVlcnkgc3RyaW5nLlxuICAgICAgICB2YXIgcGFyc2VkVXJsID0gdXJsLnBhcnNlKHJlcXVlc3QudXJsKTtcbiAgICAgICAgaWYgKHBhcnNlZFVybC5wYXRobmFtZSA9PT0gcGF0aFByZWZpeCArICcvd2Vic29ja2V0JyB8fFxuICAgICAgICAgICAgcGFyc2VkVXJsLnBhdGhuYW1lID09PSBwYXRoUHJlZml4ICsgJy93ZWJzb2NrZXQvJykge1xuICAgICAgICAgIHBhcnNlZFVybC5wYXRobmFtZSA9IHNlbGYucHJlZml4ICsgJy93ZWJzb2NrZXQnO1xuICAgICAgICAgIHJlcXVlc3QudXJsID0gdXJsLmZvcm1hdChwYXJzZWRVcmwpO1xuICAgICAgICB9XG4gICAgICAgIF8uZWFjaChvbGRIdHRwU2VydmVyTGlzdGVuZXJzLCBmdW5jdGlvbihvbGRMaXN0ZW5lcikge1xuICAgICAgICAgIG9sZExpc3RlbmVyLmFwcGx5KGh0dHBTZXJ2ZXIsIGFyZ3MpO1xuICAgICAgICB9KTtcbiAgICAgIH07XG4gICAgICBodHRwU2VydmVyLmFkZExpc3RlbmVyKGV2ZW50LCBuZXdMaXN0ZW5lcik7XG4gICAgfSk7XG4gIH1cbn0pO1xuIiwiRERQU2VydmVyID0ge307XG5cbnZhciBGaWJlciA9IE5wbS5yZXF1aXJlKCdmaWJlcnMnKTtcblxuLy8gVGhpcyBmaWxlIGNvbnRhaW5zIGNsYXNzZXM6XG4vLyAqIFNlc3Npb24gLSBUaGUgc2VydmVyJ3MgY29ubmVjdGlvbiB0byBhIHNpbmdsZSBERFAgY2xpZW50XG4vLyAqIFN1YnNjcmlwdGlvbiAtIEEgc2luZ2xlIHN1YnNjcmlwdGlvbiBmb3IgYSBzaW5nbGUgY2xpZW50XG4vLyAqIFNlcnZlciAtIEFuIGVudGlyZSBzZXJ2ZXIgdGhhdCBtYXkgdGFsayB0byA+IDEgY2xpZW50LiBBIEREUCBlbmRwb2ludC5cbi8vXG4vLyBTZXNzaW9uIGFuZCBTdWJzY3JpcHRpb24gYXJlIGZpbGUgc2NvcGUuIEZvciBub3csIHVudGlsIHdlIGZyZWV6ZVxuLy8gdGhlIGludGVyZmFjZSwgU2VydmVyIGlzIHBhY2thZ2Ugc2NvcGUgKGluIHRoZSBmdXR1cmUgaXQgc2hvdWxkIGJlXG4vLyBleHBvcnRlZC4pXG5cbi8vIFJlcHJlc2VudHMgYSBzaW5nbGUgZG9jdW1lbnQgaW4gYSBTZXNzaW9uQ29sbGVjdGlvblZpZXdcbnZhciBTZXNzaW9uRG9jdW1lbnRWaWV3ID0gZnVuY3Rpb24gKCkge1xuICB2YXIgc2VsZiA9IHRoaXM7XG4gIHNlbGYuZXhpc3RzSW4gPSBuZXcgU2V0KCk7IC8vIHNldCBvZiBzdWJzY3JpcHRpb25IYW5kbGVcbiAgc2VsZi5kYXRhQnlLZXkgPSBuZXcgTWFwKCk7IC8vIGtleS0+IFsge3N1YnNjcmlwdGlvbkhhbmRsZSwgdmFsdWV9IGJ5IHByZWNlZGVuY2VdXG59O1xuXG5ERFBTZXJ2ZXIuX1Nlc3Npb25Eb2N1bWVudFZpZXcgPSBTZXNzaW9uRG9jdW1lbnRWaWV3O1xuXG5cbl8uZXh0ZW5kKFNlc3Npb25Eb2N1bWVudFZpZXcucHJvdG90eXBlLCB7XG5cbiAgZ2V0RmllbGRzOiBmdW5jdGlvbiAoKSB7XG4gICAgdmFyIHNlbGYgPSB0aGlzO1xuICAgIHZhciByZXQgPSB7fTtcbiAgICBzZWxmLmRhdGFCeUtleS5mb3JFYWNoKGZ1bmN0aW9uIChwcmVjZWRlbmNlTGlzdCwga2V5KSB7XG4gICAgICByZXRba2V5XSA9IHByZWNlZGVuY2VMaXN0WzBdLnZhbHVlO1xuICAgIH0pO1xuICAgIHJldHVybiByZXQ7XG4gIH0sXG5cbiAgY2xlYXJGaWVsZDogZnVuY3Rpb24gKHN1YnNjcmlwdGlvbkhhbmRsZSwga2V5LCBjaGFuZ2VDb2xsZWN0b3IpIHtcbiAgICB2YXIgc2VsZiA9IHRoaXM7XG4gICAgLy8gUHVibGlzaCBBUEkgaWdub3JlcyBfaWQgaWYgcHJlc2VudCBpbiBmaWVsZHNcbiAgICBpZiAoa2V5ID09PSBcIl9pZFwiKVxuICAgICAgcmV0dXJuO1xuICAgIHZhciBwcmVjZWRlbmNlTGlzdCA9IHNlbGYuZGF0YUJ5S2V5LmdldChrZXkpO1xuXG4gICAgLy8gSXQncyBva2F5IHRvIGNsZWFyIGZpZWxkcyB0aGF0IGRpZG4ndCBleGlzdC4gTm8gbmVlZCB0byB0aHJvd1xuICAgIC8vIGFuIGVycm9yLlxuICAgIGlmICghcHJlY2VkZW5jZUxpc3QpXG4gICAgICByZXR1cm47XG5cbiAgICB2YXIgcmVtb3ZlZFZhbHVlID0gdW5kZWZpbmVkO1xuICAgIGZvciAodmFyIGkgPSAwOyBpIDwgcHJlY2VkZW5jZUxpc3QubGVuZ3RoOyBpKyspIHtcbiAgICAgIHZhciBwcmVjZWRlbmNlID0gcHJlY2VkZW5jZUxpc3RbaV07XG4gICAgICBpZiAocHJlY2VkZW5jZS5zdWJzY3JpcHRpb25IYW5kbGUgPT09IHN1YnNjcmlwdGlvbkhhbmRsZSkge1xuICAgICAgICAvLyBUaGUgdmlldydzIHZhbHVlIGNhbiBvbmx5IGNoYW5nZSBpZiB0aGlzIHN1YnNjcmlwdGlvbiBpcyB0aGUgb25lIHRoYXRcbiAgICAgICAgLy8gdXNlZCB0byBoYXZlIHByZWNlZGVuY2UuXG4gICAgICAgIGlmIChpID09PSAwKVxuICAgICAgICAgIHJlbW92ZWRWYWx1ZSA9IHByZWNlZGVuY2UudmFsdWU7XG4gICAgICAgIHByZWNlZGVuY2VMaXN0LnNwbGljZShpLCAxKTtcbiAgICAgICAgYnJlYWs7XG4gICAgICB9XG4gICAgfVxuICAgIGlmIChwcmVjZWRlbmNlTGlzdC5sZW5ndGggPT09IDApIHtcbiAgICAgIHNlbGYuZGF0YUJ5S2V5LmRlbGV0ZShrZXkpO1xuICAgICAgY2hhbmdlQ29sbGVjdG9yW2tleV0gPSB1bmRlZmluZWQ7XG4gICAgfSBlbHNlIGlmIChyZW1vdmVkVmFsdWUgIT09IHVuZGVmaW5lZCAmJlxuICAgICAgICAgICAgICAgIUVKU09OLmVxdWFscyhyZW1vdmVkVmFsdWUsIHByZWNlZGVuY2VMaXN0WzBdLnZhbHVlKSkge1xuICAgICAgY2hhbmdlQ29sbGVjdG9yW2tleV0gPSBwcmVjZWRlbmNlTGlzdFswXS52YWx1ZTtcbiAgICB9XG4gIH0sXG5cbiAgY2hhbmdlRmllbGQ6IGZ1bmN0aW9uIChzdWJzY3JpcHRpb25IYW5kbGUsIGtleSwgdmFsdWUsXG4gICAgICAgICAgICAgICAgICAgICAgICAgY2hhbmdlQ29sbGVjdG9yLCBpc0FkZCkge1xuICAgIHZhciBzZWxmID0gdGhpcztcbiAgICAvLyBQdWJsaXNoIEFQSSBpZ25vcmVzIF9pZCBpZiBwcmVzZW50IGluIGZpZWxkc1xuICAgIGlmIChrZXkgPT09IFwiX2lkXCIpXG4gICAgICByZXR1cm47XG5cbiAgICAvLyBEb24ndCBzaGFyZSBzdGF0ZSB3aXRoIHRoZSBkYXRhIHBhc3NlZCBpbiBieSB0aGUgdXNlci5cbiAgICB2YWx1ZSA9IEVKU09OLmNsb25lKHZhbHVlKTtcblxuICAgIGlmICghc2VsZi5kYXRhQnlLZXkuaGFzKGtleSkpIHtcbiAgICAgIHNlbGYuZGF0YUJ5S2V5LnNldChrZXksIFt7c3Vic2NyaXB0aW9uSGFuZGxlOiBzdWJzY3JpcHRpb25IYW5kbGUsXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHZhbHVlOiB2YWx1ZX1dKTtcbiAgICAgIGNoYW5nZUNvbGxlY3RvcltrZXldID0gdmFsdWU7XG4gICAgICByZXR1cm47XG4gICAgfVxuICAgIHZhciBwcmVjZWRlbmNlTGlzdCA9IHNlbGYuZGF0YUJ5S2V5LmdldChrZXkpO1xuICAgIHZhciBlbHQ7XG4gICAgaWYgKCFpc0FkZCkge1xuICAgICAgZWx0ID0gcHJlY2VkZW5jZUxpc3QuZmluZChmdW5jdGlvbiAocHJlY2VkZW5jZSkge1xuICAgICAgICAgIHJldHVybiBwcmVjZWRlbmNlLnN1YnNjcmlwdGlvbkhhbmRsZSA9PT0gc3Vic2NyaXB0aW9uSGFuZGxlO1xuICAgICAgfSk7XG4gICAgfVxuXG4gICAgaWYgKGVsdCkge1xuICAgICAgaWYgKGVsdCA9PT0gcHJlY2VkZW5jZUxpc3RbMF0gJiYgIUVKU09OLmVxdWFscyh2YWx1ZSwgZWx0LnZhbHVlKSkge1xuICAgICAgICAvLyB0aGlzIHN1YnNjcmlwdGlvbiBpcyBjaGFuZ2luZyB0aGUgdmFsdWUgb2YgdGhpcyBmaWVsZC5cbiAgICAgICAgY2hhbmdlQ29sbGVjdG9yW2tleV0gPSB2YWx1ZTtcbiAgICAgIH1cbiAgICAgIGVsdC52YWx1ZSA9IHZhbHVlO1xuICAgIH0gZWxzZSB7XG4gICAgICAvLyB0aGlzIHN1YnNjcmlwdGlvbiBpcyBuZXdseSBjYXJpbmcgYWJvdXQgdGhpcyBmaWVsZFxuICAgICAgcHJlY2VkZW5jZUxpc3QucHVzaCh7c3Vic2NyaXB0aW9uSGFuZGxlOiBzdWJzY3JpcHRpb25IYW5kbGUsIHZhbHVlOiB2YWx1ZX0pO1xuICAgIH1cblxuICB9XG59KTtcblxuLyoqXG4gKiBSZXByZXNlbnRzIGEgY2xpZW50J3MgdmlldyBvZiBhIHNpbmdsZSBjb2xsZWN0aW9uXG4gKiBAcGFyYW0ge1N0cmluZ30gY29sbGVjdGlvbk5hbWUgTmFtZSBvZiB0aGUgY29sbGVjdGlvbiBpdCByZXByZXNlbnRzXG4gKiBAcGFyYW0ge09iamVjdC48U3RyaW5nLCBGdW5jdGlvbj59IHNlc3Npb25DYWxsYmFja3MgVGhlIGNhbGxiYWNrcyBmb3IgYWRkZWQsIGNoYW5nZWQsIHJlbW92ZWRcbiAqIEBjbGFzcyBTZXNzaW9uQ29sbGVjdGlvblZpZXdcbiAqL1xudmFyIFNlc3Npb25Db2xsZWN0aW9uVmlldyA9IGZ1bmN0aW9uIChjb2xsZWN0aW9uTmFtZSwgc2Vzc2lvbkNhbGxiYWNrcykge1xuICB2YXIgc2VsZiA9IHRoaXM7XG4gIHNlbGYuY29sbGVjdGlvbk5hbWUgPSBjb2xsZWN0aW9uTmFtZTtcbiAgc2VsZi5kb2N1bWVudHMgPSBuZXcgTWFwKCk7XG4gIHNlbGYuY2FsbGJhY2tzID0gc2Vzc2lvbkNhbGxiYWNrcztcbn07XG5cbkREUFNlcnZlci5fU2Vzc2lvbkNvbGxlY3Rpb25WaWV3ID0gU2Vzc2lvbkNvbGxlY3Rpb25WaWV3O1xuXG5cbl8uZXh0ZW5kKFNlc3Npb25Db2xsZWN0aW9uVmlldy5wcm90b3R5cGUsIHtcblxuICBpc0VtcHR5OiBmdW5jdGlvbiAoKSB7XG4gICAgdmFyIHNlbGYgPSB0aGlzO1xuICAgIHJldHVybiBzZWxmLmRvY3VtZW50cy5zaXplID09PSAwO1xuICB9LFxuXG4gIGRpZmY6IGZ1bmN0aW9uIChwcmV2aW91cykge1xuICAgIHZhciBzZWxmID0gdGhpcztcbiAgICBEaWZmU2VxdWVuY2UuZGlmZk1hcHMocHJldmlvdXMuZG9jdW1lbnRzLCBzZWxmLmRvY3VtZW50cywge1xuICAgICAgYm90aDogXy5iaW5kKHNlbGYuZGlmZkRvY3VtZW50LCBzZWxmKSxcblxuICAgICAgcmlnaHRPbmx5OiBmdW5jdGlvbiAoaWQsIG5vd0RWKSB7XG4gICAgICAgIHNlbGYuY2FsbGJhY2tzLmFkZGVkKHNlbGYuY29sbGVjdGlvbk5hbWUsIGlkLCBub3dEVi5nZXRGaWVsZHMoKSk7XG4gICAgICB9LFxuXG4gICAgICBsZWZ0T25seTogZnVuY3Rpb24gKGlkLCBwcmV2RFYpIHtcbiAgICAgICAgc2VsZi5jYWxsYmFja3MucmVtb3ZlZChzZWxmLmNvbGxlY3Rpb25OYW1lLCBpZCk7XG4gICAgICB9XG4gICAgfSk7XG4gIH0sXG5cbiAgZGlmZkRvY3VtZW50OiBmdW5jdGlvbiAoaWQsIHByZXZEViwgbm93RFYpIHtcbiAgICB2YXIgc2VsZiA9IHRoaXM7XG4gICAgdmFyIGZpZWxkcyA9IHt9O1xuICAgIERpZmZTZXF1ZW5jZS5kaWZmT2JqZWN0cyhwcmV2RFYuZ2V0RmllbGRzKCksIG5vd0RWLmdldEZpZWxkcygpLCB7XG4gICAgICBib3RoOiBmdW5jdGlvbiAoa2V5LCBwcmV2LCBub3cpIHtcbiAgICAgICAgaWYgKCFFSlNPTi5lcXVhbHMocHJldiwgbm93KSlcbiAgICAgICAgICBmaWVsZHNba2V5XSA9IG5vdztcbiAgICAgIH0sXG4gICAgICByaWdodE9ubHk6IGZ1bmN0aW9uIChrZXksIG5vdykge1xuICAgICAgICBmaWVsZHNba2V5XSA9IG5vdztcbiAgICAgIH0sXG4gICAgICBsZWZ0T25seTogZnVuY3Rpb24oa2V5LCBwcmV2KSB7XG4gICAgICAgIGZpZWxkc1trZXldID0gdW5kZWZpbmVkO1xuICAgICAgfVxuICAgIH0pO1xuICAgIHNlbGYuY2FsbGJhY2tzLmNoYW5nZWQoc2VsZi5jb2xsZWN0aW9uTmFtZSwgaWQsIGZpZWxkcyk7XG4gIH0sXG5cbiAgYWRkZWQ6IGZ1bmN0aW9uIChzdWJzY3JpcHRpb25IYW5kbGUsIGlkLCBmaWVsZHMpIHtcbiAgICB2YXIgc2VsZiA9IHRoaXM7XG4gICAgdmFyIGRvY1ZpZXcgPSBzZWxmLmRvY3VtZW50cy5nZXQoaWQpO1xuICAgIHZhciBhZGRlZCA9IGZhbHNlO1xuICAgIGlmICghZG9jVmlldykge1xuICAgICAgYWRkZWQgPSB0cnVlO1xuICAgICAgZG9jVmlldyA9IG5ldyBTZXNzaW9uRG9jdW1lbnRWaWV3KCk7XG4gICAgICBzZWxmLmRvY3VtZW50cy5zZXQoaWQsIGRvY1ZpZXcpO1xuICAgIH1cbiAgICBkb2NWaWV3LmV4aXN0c0luLmFkZChzdWJzY3JpcHRpb25IYW5kbGUpO1xuICAgIHZhciBjaGFuZ2VDb2xsZWN0b3IgPSB7fTtcbiAgICBfLmVhY2goZmllbGRzLCBmdW5jdGlvbiAodmFsdWUsIGtleSkge1xuICAgICAgZG9jVmlldy5jaGFuZ2VGaWVsZChcbiAgICAgICAgc3Vic2NyaXB0aW9uSGFuZGxlLCBrZXksIHZhbHVlLCBjaGFuZ2VDb2xsZWN0b3IsIHRydWUpO1xuICAgIH0pO1xuICAgIGlmIChhZGRlZClcbiAgICAgIHNlbGYuY2FsbGJhY2tzLmFkZGVkKHNlbGYuY29sbGVjdGlvbk5hbWUsIGlkLCBjaGFuZ2VDb2xsZWN0b3IpO1xuICAgIGVsc2VcbiAgICAgIHNlbGYuY2FsbGJhY2tzLmNoYW5nZWQoc2VsZi5jb2xsZWN0aW9uTmFtZSwgaWQsIGNoYW5nZUNvbGxlY3Rvcik7XG4gIH0sXG5cbiAgY2hhbmdlZDogZnVuY3Rpb24gKHN1YnNjcmlwdGlvbkhhbmRsZSwgaWQsIGNoYW5nZWQpIHtcbiAgICB2YXIgc2VsZiA9IHRoaXM7XG4gICAgdmFyIGNoYW5nZWRSZXN1bHQgPSB7fTtcbiAgICB2YXIgZG9jVmlldyA9IHNlbGYuZG9jdW1lbnRzLmdldChpZCk7XG4gICAgaWYgKCFkb2NWaWV3KVxuICAgICAgdGhyb3cgbmV3IEVycm9yKFwiQ291bGQgbm90IGZpbmQgZWxlbWVudCB3aXRoIGlkIFwiICsgaWQgKyBcIiB0byBjaGFuZ2VcIik7XG4gICAgXy5lYWNoKGNoYW5nZWQsIGZ1bmN0aW9uICh2YWx1ZSwga2V5KSB7XG4gICAgICBpZiAodmFsdWUgPT09IHVuZGVmaW5lZClcbiAgICAgICAgZG9jVmlldy5jbGVhckZpZWxkKHN1YnNjcmlwdGlvbkhhbmRsZSwga2V5LCBjaGFuZ2VkUmVzdWx0KTtcbiAgICAgIGVsc2VcbiAgICAgICAgZG9jVmlldy5jaGFuZ2VGaWVsZChzdWJzY3JpcHRpb25IYW5kbGUsIGtleSwgdmFsdWUsIGNoYW5nZWRSZXN1bHQpO1xuICAgIH0pO1xuICAgIHNlbGYuY2FsbGJhY2tzLmNoYW5nZWQoc2VsZi5jb2xsZWN0aW9uTmFtZSwgaWQsIGNoYW5nZWRSZXN1bHQpO1xuICB9LFxuXG4gIHJlbW92ZWQ6IGZ1bmN0aW9uIChzdWJzY3JpcHRpb25IYW5kbGUsIGlkKSB7XG4gICAgdmFyIHNlbGYgPSB0aGlzO1xuICAgIHZhciBkb2NWaWV3ID0gc2VsZi5kb2N1bWVudHMuZ2V0KGlkKTtcbiAgICBpZiAoIWRvY1ZpZXcpIHtcbiAgICAgIHZhciBlcnIgPSBuZXcgRXJyb3IoXCJSZW1vdmVkIG5vbmV4aXN0ZW50IGRvY3VtZW50IFwiICsgaWQpO1xuICAgICAgdGhyb3cgZXJyO1xuICAgIH1cbiAgICBkb2NWaWV3LmV4aXN0c0luLmRlbGV0ZShzdWJzY3JpcHRpb25IYW5kbGUpO1xuICAgIGlmIChkb2NWaWV3LmV4aXN0c0luLnNpemUgPT09IDApIHtcbiAgICAgIC8vIGl0IGlzIGdvbmUgZnJvbSBldmVyeW9uZVxuICAgICAgc2VsZi5jYWxsYmFja3MucmVtb3ZlZChzZWxmLmNvbGxlY3Rpb25OYW1lLCBpZCk7XG4gICAgICBzZWxmLmRvY3VtZW50cy5kZWxldGUoaWQpO1xuICAgIH0gZWxzZSB7XG4gICAgICB2YXIgY2hhbmdlZCA9IHt9O1xuICAgICAgLy8gcmVtb3ZlIHRoaXMgc3Vic2NyaXB0aW9uIGZyb20gZXZlcnkgcHJlY2VkZW5jZSBsaXN0XG4gICAgICAvLyBhbmQgcmVjb3JkIHRoZSBjaGFuZ2VzXG4gICAgICBkb2NWaWV3LmRhdGFCeUtleS5mb3JFYWNoKGZ1bmN0aW9uIChwcmVjZWRlbmNlTGlzdCwga2V5KSB7XG4gICAgICAgIGRvY1ZpZXcuY2xlYXJGaWVsZChzdWJzY3JpcHRpb25IYW5kbGUsIGtleSwgY2hhbmdlZCk7XG4gICAgICB9KTtcblxuICAgICAgc2VsZi5jYWxsYmFja3MuY2hhbmdlZChzZWxmLmNvbGxlY3Rpb25OYW1lLCBpZCwgY2hhbmdlZCk7XG4gICAgfVxuICB9XG59KTtcblxuLyoqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKi9cbi8qIFNlc3Npb24gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICovXG4vKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqL1xuXG52YXIgU2Vzc2lvbiA9IGZ1bmN0aW9uIChzZXJ2ZXIsIHZlcnNpb24sIHNvY2tldCwgb3B0aW9ucykge1xuICB2YXIgc2VsZiA9IHRoaXM7XG4gIHNlbGYuaWQgPSBSYW5kb20uaWQoKTtcblxuICBzZWxmLnNlcnZlciA9IHNlcnZlcjtcbiAgc2VsZi52ZXJzaW9uID0gdmVyc2lvbjtcblxuICBzZWxmLmluaXRpYWxpemVkID0gZmFsc2U7XG4gIHNlbGYuc29ja2V0ID0gc29ja2V0O1xuXG4gIC8vIHNldCB0byBudWxsIHdoZW4gdGhlIHNlc3Npb24gaXMgZGVzdHJveWVkLiBtdWx0aXBsZSBwbGFjZXMgYmVsb3dcbiAgLy8gdXNlIHRoaXMgdG8gZGV0ZXJtaW5lIGlmIHRoZSBzZXNzaW9uIGlzIGFsaXZlIG9yIG5vdC5cbiAgc2VsZi5pblF1ZXVlID0gbmV3IE1ldGVvci5fRG91YmxlRW5kZWRRdWV1ZSgpO1xuXG4gIHNlbGYuYmxvY2tlZCA9IGZhbHNlO1xuICBzZWxmLndvcmtlclJ1bm5pbmcgPSBmYWxzZTtcblxuICAvLyBTdWIgb2JqZWN0cyBmb3IgYWN0aXZlIHN1YnNjcmlwdGlvbnNcbiAgc2VsZi5fbmFtZWRTdWJzID0gbmV3IE1hcCgpO1xuICBzZWxmLl91bml2ZXJzYWxTdWJzID0gW107XG5cbiAgc2VsZi51c2VySWQgPSBudWxsO1xuXG4gIHNlbGYuY29sbGVjdGlvblZpZXdzID0gbmV3IE1hcCgpO1xuXG4gIC8vIFNldCB0aGlzIHRvIGZhbHNlIHRvIG5vdCBzZW5kIG1lc3NhZ2VzIHdoZW4gY29sbGVjdGlvblZpZXdzIGFyZVxuICAvLyBtb2RpZmllZC4gVGhpcyBpcyBkb25lIHdoZW4gcmVydW5uaW5nIHN1YnMgaW4gX3NldFVzZXJJZCBhbmQgdGhvc2UgbWVzc2FnZXNcbiAgLy8gYXJlIGNhbGN1bGF0ZWQgdmlhIGEgZGlmZiBpbnN0ZWFkLlxuICBzZWxmLl9pc1NlbmRpbmcgPSB0cnVlO1xuXG4gIC8vIElmIHRoaXMgaXMgdHJ1ZSwgZG9uJ3Qgc3RhcnQgYSBuZXdseS1jcmVhdGVkIHVuaXZlcnNhbCBwdWJsaXNoZXIgb24gdGhpc1xuICAvLyBzZXNzaW9uLiBUaGUgc2Vzc2lvbiB3aWxsIHRha2UgY2FyZSBvZiBzdGFydGluZyBpdCB3aGVuIGFwcHJvcHJpYXRlLlxuICBzZWxmLl9kb250U3RhcnROZXdVbml2ZXJzYWxTdWJzID0gZmFsc2U7XG5cbiAgLy8gd2hlbiB3ZSBhcmUgcmVydW5uaW5nIHN1YnNjcmlwdGlvbnMsIGFueSByZWFkeSBtZXNzYWdlc1xuICAvLyB3ZSB3YW50IHRvIGJ1ZmZlciB1cCBmb3Igd2hlbiB3ZSBhcmUgZG9uZSByZXJ1bm5pbmcgc3Vic2NyaXB0aW9uc1xuICBzZWxmLl9wZW5kaW5nUmVhZHkgPSBbXTtcblxuICAvLyBMaXN0IG9mIGNhbGxiYWNrcyB0byBjYWxsIHdoZW4gdGhpcyBjb25uZWN0aW9uIGlzIGNsb3NlZC5cbiAgc2VsZi5fY2xvc2VDYWxsYmFja3MgPSBbXTtcblxuXG4gIC8vIFhYWCBIQUNLOiBJZiBhIHNvY2tqcyBjb25uZWN0aW9uLCBzYXZlIG9mZiB0aGUgVVJMLiBUaGlzIGlzXG4gIC8vIHRlbXBvcmFyeSBhbmQgd2lsbCBnbyBhd2F5IGluIHRoZSBuZWFyIGZ1dHVyZS5cbiAgc2VsZi5fc29ja2V0VXJsID0gc29ja2V0LnVybDtcblxuICAvLyBBbGxvdyB0ZXN0cyB0byBkaXNhYmxlIHJlc3BvbmRpbmcgdG8gcGluZ3MuXG4gIHNlbGYuX3Jlc3BvbmRUb1BpbmdzID0gb3B0aW9ucy5yZXNwb25kVG9QaW5ncztcblxuICAvLyBUaGlzIG9iamVjdCBpcyB0aGUgcHVibGljIGludGVyZmFjZSB0byB0aGUgc2Vzc2lvbi4gSW4gdGhlIHB1YmxpY1xuICAvLyBBUEksIGl0IGlzIGNhbGxlZCB0aGUgYGNvbm5lY3Rpb25gIG9iamVjdC4gIEludGVybmFsbHkgd2UgY2FsbCBpdFxuICAvLyBhIGBjb25uZWN0aW9uSGFuZGxlYCB0byBhdm9pZCBhbWJpZ3VpdHkuXG4gIHNlbGYuY29ubmVjdGlvbkhhbmRsZSA9IHtcbiAgICBpZDogc2VsZi5pZCxcbiAgICBjbG9zZTogZnVuY3Rpb24gKCkge1xuICAgICAgc2VsZi5jbG9zZSgpO1xuICAgIH0sXG4gICAgb25DbG9zZTogZnVuY3Rpb24gKGZuKSB7XG4gICAgICB2YXIgY2IgPSBNZXRlb3IuYmluZEVudmlyb25tZW50KGZuLCBcImNvbm5lY3Rpb24gb25DbG9zZSBjYWxsYmFja1wiKTtcbiAgICAgIGlmIChzZWxmLmluUXVldWUpIHtcbiAgICAgICAgc2VsZi5fY2xvc2VDYWxsYmFja3MucHVzaChjYik7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICAvLyBpZiB3ZSdyZSBhbHJlYWR5IGNsb3NlZCwgY2FsbCB0aGUgY2FsbGJhY2suXG4gICAgICAgIE1ldGVvci5kZWZlcihjYik7XG4gICAgICB9XG4gICAgfSxcbiAgICBjbGllbnRBZGRyZXNzOiBzZWxmLl9jbGllbnRBZGRyZXNzKCksXG4gICAgaHR0cEhlYWRlcnM6IHNlbGYuc29ja2V0LmhlYWRlcnNcbiAgfTtcblxuICBzZWxmLnNlbmQoeyBtc2c6ICdjb25uZWN0ZWQnLCBzZXNzaW9uOiBzZWxmLmlkIH0pO1xuXG4gIC8vIE9uIGluaXRpYWwgY29ubmVjdCwgc3BpbiB1cCBhbGwgdGhlIHVuaXZlcnNhbCBwdWJsaXNoZXJzLlxuICBGaWJlcihmdW5jdGlvbiAoKSB7XG4gICAgc2VsZi5zdGFydFVuaXZlcnNhbFN1YnMoKTtcbiAgfSkucnVuKCk7XG5cbiAgaWYgKHZlcnNpb24gIT09ICdwcmUxJyAmJiBvcHRpb25zLmhlYXJ0YmVhdEludGVydmFsICE9PSAwKSB7XG4gICAgLy8gV2Ugbm8gbG9uZ2VyIG5lZWQgdGhlIGxvdyBsZXZlbCB0aW1lb3V0IGJlY2F1c2Ugd2UgaGF2ZSBoZWFydGJlYXRpbmcuXG4gICAgc29ja2V0LnNldFdlYnNvY2tldFRpbWVvdXQoMCk7XG5cbiAgICBzZWxmLmhlYXJ0YmVhdCA9IG5ldyBERFBDb21tb24uSGVhcnRiZWF0KHtcbiAgICAgIGhlYXJ0YmVhdEludGVydmFsOiBvcHRpb25zLmhlYXJ0YmVhdEludGVydmFsLFxuICAgICAgaGVhcnRiZWF0VGltZW91dDogb3B0aW9ucy5oZWFydGJlYXRUaW1lb3V0LFxuICAgICAgb25UaW1lb3V0OiBmdW5jdGlvbiAoKSB7XG4gICAgICAgIHNlbGYuY2xvc2UoKTtcbiAgICAgIH0sXG4gICAgICBzZW5kUGluZzogZnVuY3Rpb24gKCkge1xuICAgICAgICBzZWxmLnNlbmQoe21zZzogJ3BpbmcnfSk7XG4gICAgICB9XG4gICAgfSk7XG4gICAgc2VsZi5oZWFydGJlYXQuc3RhcnQoKTtcbiAgfVxuXG4gIFBhY2thZ2VbJ2ZhY3RzLWJhc2UnXSAmJiBQYWNrYWdlWydmYWN0cy1iYXNlJ10uRmFjdHMuaW5jcmVtZW50U2VydmVyRmFjdChcbiAgICBcImxpdmVkYXRhXCIsIFwic2Vzc2lvbnNcIiwgMSk7XG59O1xuXG5fLmV4dGVuZChTZXNzaW9uLnByb3RvdHlwZSwge1xuXG4gIHNlbmRSZWFkeTogZnVuY3Rpb24gKHN1YnNjcmlwdGlvbklkcykge1xuICAgIHZhciBzZWxmID0gdGhpcztcbiAgICBpZiAoc2VsZi5faXNTZW5kaW5nKVxuICAgICAgc2VsZi5zZW5kKHttc2c6IFwicmVhZHlcIiwgc3Viczogc3Vic2NyaXB0aW9uSWRzfSk7XG4gICAgZWxzZSB7XG4gICAgICBfLmVhY2goc3Vic2NyaXB0aW9uSWRzLCBmdW5jdGlvbiAoc3Vic2NyaXB0aW9uSWQpIHtcbiAgICAgICAgc2VsZi5fcGVuZGluZ1JlYWR5LnB1c2goc3Vic2NyaXB0aW9uSWQpO1xuICAgICAgfSk7XG4gICAgfVxuICB9LFxuXG4gIHNlbmRBZGRlZDogZnVuY3Rpb24gKGNvbGxlY3Rpb25OYW1lLCBpZCwgZmllbGRzKSB7XG4gICAgdmFyIHNlbGYgPSB0aGlzO1xuICAgIGlmIChzZWxmLl9pc1NlbmRpbmcpXG4gICAgICBzZWxmLnNlbmQoe21zZzogXCJhZGRlZFwiLCBjb2xsZWN0aW9uOiBjb2xsZWN0aW9uTmFtZSwgaWQ6IGlkLCBmaWVsZHM6IGZpZWxkc30pO1xuICB9LFxuXG4gIHNlbmRDaGFuZ2VkOiBmdW5jdGlvbiAoY29sbGVjdGlvbk5hbWUsIGlkLCBmaWVsZHMpIHtcbiAgICB2YXIgc2VsZiA9IHRoaXM7XG4gICAgaWYgKF8uaXNFbXB0eShmaWVsZHMpKVxuICAgICAgcmV0dXJuO1xuXG4gICAgaWYgKHNlbGYuX2lzU2VuZGluZykge1xuICAgICAgc2VsZi5zZW5kKHtcbiAgICAgICAgbXNnOiBcImNoYW5nZWRcIixcbiAgICAgICAgY29sbGVjdGlvbjogY29sbGVjdGlvbk5hbWUsXG4gICAgICAgIGlkOiBpZCxcbiAgICAgICAgZmllbGRzOiBmaWVsZHNcbiAgICAgIH0pO1xuICAgIH1cbiAgfSxcblxuICBzZW5kUmVtb3ZlZDogZnVuY3Rpb24gKGNvbGxlY3Rpb25OYW1lLCBpZCkge1xuICAgIHZhciBzZWxmID0gdGhpcztcbiAgICBpZiAoc2VsZi5faXNTZW5kaW5nKVxuICAgICAgc2VsZi5zZW5kKHttc2c6IFwicmVtb3ZlZFwiLCBjb2xsZWN0aW9uOiBjb2xsZWN0aW9uTmFtZSwgaWQ6IGlkfSk7XG4gIH0sXG5cbiAgZ2V0U2VuZENhbGxiYWNrczogZnVuY3Rpb24gKCkge1xuICAgIHZhciBzZWxmID0gdGhpcztcbiAgICByZXR1cm4ge1xuICAgICAgYWRkZWQ6IF8uYmluZChzZWxmLnNlbmRBZGRlZCwgc2VsZiksXG4gICAgICBjaGFuZ2VkOiBfLmJpbmQoc2VsZi5zZW5kQ2hhbmdlZCwgc2VsZiksXG4gICAgICByZW1vdmVkOiBfLmJpbmQoc2VsZi5zZW5kUmVtb3ZlZCwgc2VsZilcbiAgICB9O1xuICB9LFxuXG4gIGdldENvbGxlY3Rpb25WaWV3OiBmdW5jdGlvbiAoY29sbGVjdGlvbk5hbWUpIHtcbiAgICB2YXIgc2VsZiA9IHRoaXM7XG4gICAgdmFyIHJldCA9IHNlbGYuY29sbGVjdGlvblZpZXdzLmdldChjb2xsZWN0aW9uTmFtZSk7XG4gICAgaWYgKCFyZXQpIHtcbiAgICAgIHJldCA9IG5ldyBTZXNzaW9uQ29sbGVjdGlvblZpZXcoY29sbGVjdGlvbk5hbWUsXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgc2VsZi5nZXRTZW5kQ2FsbGJhY2tzKCkpO1xuICAgICAgc2VsZi5jb2xsZWN0aW9uVmlld3Muc2V0KGNvbGxlY3Rpb25OYW1lLCByZXQpO1xuICAgIH1cbiAgICByZXR1cm4gcmV0O1xuICB9LFxuXG4gIGFkZGVkOiBmdW5jdGlvbiAoc3Vic2NyaXB0aW9uSGFuZGxlLCBjb2xsZWN0aW9uTmFtZSwgaWQsIGZpZWxkcykge1xuICAgIHZhciBzZWxmID0gdGhpcztcbiAgICB2YXIgdmlldyA9IHNlbGYuZ2V0Q29sbGVjdGlvblZpZXcoY29sbGVjdGlvbk5hbWUpO1xuICAgIHZpZXcuYWRkZWQoc3Vic2NyaXB0aW9uSGFuZGxlLCBpZCwgZmllbGRzKTtcbiAgfSxcblxuICByZW1vdmVkOiBmdW5jdGlvbiAoc3Vic2NyaXB0aW9uSGFuZGxlLCBjb2xsZWN0aW9uTmFtZSwgaWQpIHtcbiAgICB2YXIgc2VsZiA9IHRoaXM7XG4gICAgdmFyIHZpZXcgPSBzZWxmLmdldENvbGxlY3Rpb25WaWV3KGNvbGxlY3Rpb25OYW1lKTtcbiAgICB2aWV3LnJlbW92ZWQoc3Vic2NyaXB0aW9uSGFuZGxlLCBpZCk7XG4gICAgaWYgKHZpZXcuaXNFbXB0eSgpKSB7XG4gICAgICAgc2VsZi5jb2xsZWN0aW9uVmlld3MuZGVsZXRlKGNvbGxlY3Rpb25OYW1lKTtcbiAgICB9XG4gIH0sXG5cbiAgY2hhbmdlZDogZnVuY3Rpb24gKHN1YnNjcmlwdGlvbkhhbmRsZSwgY29sbGVjdGlvbk5hbWUsIGlkLCBmaWVsZHMpIHtcbiAgICB2YXIgc2VsZiA9IHRoaXM7XG4gICAgdmFyIHZpZXcgPSBzZWxmLmdldENvbGxlY3Rpb25WaWV3KGNvbGxlY3Rpb25OYW1lKTtcbiAgICB2aWV3LmNoYW5nZWQoc3Vic2NyaXB0aW9uSGFuZGxlLCBpZCwgZmllbGRzKTtcbiAgfSxcblxuICBzdGFydFVuaXZlcnNhbFN1YnM6IGZ1bmN0aW9uICgpIHtcbiAgICB2YXIgc2VsZiA9IHRoaXM7XG4gICAgLy8gTWFrZSBhIHNoYWxsb3cgY29weSBvZiB0aGUgc2V0IG9mIHVuaXZlcnNhbCBoYW5kbGVycyBhbmQgc3RhcnQgdGhlbS4gSWZcbiAgICAvLyBhZGRpdGlvbmFsIHVuaXZlcnNhbCBwdWJsaXNoZXJzIHN0YXJ0IHdoaWxlIHdlJ3JlIHJ1bm5pbmcgdGhlbSAoZHVlIHRvXG4gICAgLy8geWllbGRpbmcpLCB0aGV5IHdpbGwgcnVuIHNlcGFyYXRlbHkgYXMgcGFydCBvZiBTZXJ2ZXIucHVibGlzaC5cbiAgICB2YXIgaGFuZGxlcnMgPSBfLmNsb25lKHNlbGYuc2VydmVyLnVuaXZlcnNhbF9wdWJsaXNoX2hhbmRsZXJzKTtcbiAgICBfLmVhY2goaGFuZGxlcnMsIGZ1bmN0aW9uIChoYW5kbGVyKSB7XG4gICAgICBzZWxmLl9zdGFydFN1YnNjcmlwdGlvbihoYW5kbGVyKTtcbiAgICB9KTtcbiAgfSxcblxuICAvLyBEZXN0cm95IHRoaXMgc2Vzc2lvbiBhbmQgdW5yZWdpc3RlciBpdCBhdCB0aGUgc2VydmVyLlxuICBjbG9zZTogZnVuY3Rpb24gKCkge1xuICAgIHZhciBzZWxmID0gdGhpcztcblxuICAgIC8vIERlc3Ryb3kgdGhpcyBzZXNzaW9uLCBldmVuIGlmIGl0J3Mgbm90IHJlZ2lzdGVyZWQgYXQgdGhlXG4gICAgLy8gc2VydmVyLiBTdG9wIGFsbCBwcm9jZXNzaW5nIGFuZCB0ZWFyIGV2ZXJ5dGhpbmcgZG93bi4gSWYgYSBzb2NrZXRcbiAgICAvLyB3YXMgYXR0YWNoZWQsIGNsb3NlIGl0LlxuXG4gICAgLy8gQWxyZWFkeSBkZXN0cm95ZWQuXG4gICAgaWYgKCEgc2VsZi5pblF1ZXVlKVxuICAgICAgcmV0dXJuO1xuXG4gICAgLy8gRHJvcCB0aGUgbWVyZ2UgYm94IGRhdGEgaW1tZWRpYXRlbHkuXG4gICAgc2VsZi5pblF1ZXVlID0gbnVsbDtcbiAgICBzZWxmLmNvbGxlY3Rpb25WaWV3cyA9IG5ldyBNYXAoKTtcblxuICAgIGlmIChzZWxmLmhlYXJ0YmVhdCkge1xuICAgICAgc2VsZi5oZWFydGJlYXQuc3RvcCgpO1xuICAgICAgc2VsZi5oZWFydGJlYXQgPSBudWxsO1xuICAgIH1cblxuICAgIGlmIChzZWxmLnNvY2tldCkge1xuICAgICAgc2VsZi5zb2NrZXQuY2xvc2UoKTtcbiAgICAgIHNlbGYuc29ja2V0Ll9tZXRlb3JTZXNzaW9uID0gbnVsbDtcbiAgICB9XG5cbiAgICBQYWNrYWdlWydmYWN0cy1iYXNlJ10gJiYgUGFja2FnZVsnZmFjdHMtYmFzZSddLkZhY3RzLmluY3JlbWVudFNlcnZlckZhY3QoXG4gICAgICBcImxpdmVkYXRhXCIsIFwic2Vzc2lvbnNcIiwgLTEpO1xuXG4gICAgTWV0ZW9yLmRlZmVyKGZ1bmN0aW9uICgpIHtcbiAgICAgIC8vIHN0b3AgY2FsbGJhY2tzIGNhbiB5aWVsZCwgc28gd2UgZGVmZXIgdGhpcyBvbiBjbG9zZS5cbiAgICAgIC8vIHN1Yi5faXNEZWFjdGl2YXRlZCgpIGRldGVjdHMgdGhhdCB3ZSBzZXQgaW5RdWV1ZSB0byBudWxsIGFuZFxuICAgICAgLy8gdHJlYXRzIGl0IGFzIHNlbWktZGVhY3RpdmF0ZWQgKGl0IHdpbGwgaWdub3JlIGluY29taW5nIGNhbGxiYWNrcywgZXRjKS5cbiAgICAgIHNlbGYuX2RlYWN0aXZhdGVBbGxTdWJzY3JpcHRpb25zKCk7XG5cbiAgICAgIC8vIERlZmVyIGNhbGxpbmcgdGhlIGNsb3NlIGNhbGxiYWNrcywgc28gdGhhdCB0aGUgY2FsbGVyIGNsb3NpbmdcbiAgICAgIC8vIHRoZSBzZXNzaW9uIGlzbid0IHdhaXRpbmcgZm9yIGFsbCB0aGUgY2FsbGJhY2tzIHRvIGNvbXBsZXRlLlxuICAgICAgXy5lYWNoKHNlbGYuX2Nsb3NlQ2FsbGJhY2tzLCBmdW5jdGlvbiAoY2FsbGJhY2spIHtcbiAgICAgICAgY2FsbGJhY2soKTtcbiAgICAgIH0pO1xuICAgIH0pO1xuXG4gICAgLy8gVW5yZWdpc3RlciB0aGUgc2Vzc2lvbi5cbiAgICBzZWxmLnNlcnZlci5fcmVtb3ZlU2Vzc2lvbihzZWxmKTtcbiAgfSxcblxuICAvLyBTZW5kIGEgbWVzc2FnZSAoZG9pbmcgbm90aGluZyBpZiBubyBzb2NrZXQgaXMgY29ubmVjdGVkIHJpZ2h0IG5vdy4pXG4gIC8vIEl0IHNob3VsZCBiZSBhIEpTT04gb2JqZWN0IChpdCB3aWxsIGJlIHN0cmluZ2lmaWVkLilcbiAgc2VuZDogZnVuY3Rpb24gKG1zZykge1xuICAgIHZhciBzZWxmID0gdGhpcztcbiAgICBpZiAoc2VsZi5zb2NrZXQpIHtcbiAgICAgIGlmIChNZXRlb3IuX3ByaW50U2VudEREUClcbiAgICAgICAgTWV0ZW9yLl9kZWJ1ZyhcIlNlbnQgRERQXCIsIEREUENvbW1vbi5zdHJpbmdpZnlERFAobXNnKSk7XG4gICAgICBzZWxmLnNvY2tldC5zZW5kKEREUENvbW1vbi5zdHJpbmdpZnlERFAobXNnKSk7XG4gICAgfVxuICB9LFxuXG4gIC8vIFNlbmQgYSBjb25uZWN0aW9uIGVycm9yLlxuICBzZW5kRXJyb3I6IGZ1bmN0aW9uIChyZWFzb24sIG9mZmVuZGluZ01lc3NhZ2UpIHtcbiAgICB2YXIgc2VsZiA9IHRoaXM7XG4gICAgdmFyIG1zZyA9IHttc2c6ICdlcnJvcicsIHJlYXNvbjogcmVhc29ufTtcbiAgICBpZiAob2ZmZW5kaW5nTWVzc2FnZSlcbiAgICAgIG1zZy5vZmZlbmRpbmdNZXNzYWdlID0gb2ZmZW5kaW5nTWVzc2FnZTtcbiAgICBzZWxmLnNlbmQobXNnKTtcbiAgfSxcblxuICAvLyBQcm9jZXNzICdtc2cnIGFzIGFuIGluY29taW5nIG1lc3NhZ2UuIChCdXQgYXMgYSBndWFyZCBhZ2FpbnN0XG4gIC8vIHJhY2UgY29uZGl0aW9ucyBkdXJpbmcgcmVjb25uZWN0aW9uLCBpZ25vcmUgdGhlIG1lc3NhZ2UgaWZcbiAgLy8gJ3NvY2tldCcgaXMgbm90IHRoZSBjdXJyZW50bHkgY29ubmVjdGVkIHNvY2tldC4pXG4gIC8vXG4gIC8vIFdlIHJ1biB0aGUgbWVzc2FnZXMgZnJvbSB0aGUgY2xpZW50IG9uZSBhdCBhIHRpbWUsIGluIHRoZSBvcmRlclxuICAvLyBnaXZlbiBieSB0aGUgY2xpZW50LiBUaGUgbWVzc2FnZSBoYW5kbGVyIGlzIHBhc3NlZCBhbiBpZGVtcG90ZW50XG4gIC8vIGZ1bmN0aW9uICd1bmJsb2NrJyB3aGljaCBpdCBtYXkgY2FsbCB0byBhbGxvdyBvdGhlciBtZXNzYWdlcyB0b1xuICAvLyBiZWdpbiBydW5uaW5nIGluIHBhcmFsbGVsIGluIGFub3RoZXIgZmliZXIgKGZvciBleGFtcGxlLCBhIG1ldGhvZFxuICAvLyB0aGF0IHdhbnRzIHRvIHlpZWxkLikgT3RoZXJ3aXNlLCBpdCBpcyBhdXRvbWF0aWNhbGx5IHVuYmxvY2tlZFxuICAvLyB3aGVuIGl0IHJldHVybnMuXG4gIC8vXG4gIC8vIEFjdHVhbGx5LCB3ZSBkb24ndCBoYXZlIHRvICd0b3RhbGx5IG9yZGVyJyB0aGUgbWVzc2FnZXMgaW4gdGhpc1xuICAvLyB3YXksIGJ1dCBpdCdzIHRoZSBlYXNpZXN0IHRoaW5nIHRoYXQncyBjb3JyZWN0LiAodW5zdWIgbmVlZHMgdG9cbiAgLy8gYmUgb3JkZXJlZCBhZ2FpbnN0IHN1YiwgbWV0aG9kcyBuZWVkIHRvIGJlIG9yZGVyZWQgYWdhaW5zdCBlYWNoXG4gIC8vIG90aGVyLilcbiAgcHJvY2Vzc01lc3NhZ2U6IGZ1bmN0aW9uIChtc2dfaW4pIHtcbiAgICB2YXIgc2VsZiA9IHRoaXM7XG4gICAgaWYgKCFzZWxmLmluUXVldWUpIC8vIHdlIGhhdmUgYmVlbiBkZXN0cm95ZWQuXG4gICAgICByZXR1cm47XG5cbiAgICAvLyBSZXNwb25kIHRvIHBpbmcgYW5kIHBvbmcgbWVzc2FnZXMgaW1tZWRpYXRlbHkgd2l0aG91dCBxdWV1aW5nLlxuICAgIC8vIElmIHRoZSBuZWdvdGlhdGVkIEREUCB2ZXJzaW9uIGlzIFwicHJlMVwiIHdoaWNoIGRpZG4ndCBzdXBwb3J0XG4gICAgLy8gcGluZ3MsIHByZXNlcnZlIHRoZSBcInByZTFcIiBiZWhhdmlvciBvZiByZXNwb25kaW5nIHdpdGggYSBcImJhZFxuICAgIC8vIHJlcXVlc3RcIiBmb3IgdGhlIHVua25vd24gbWVzc2FnZXMuXG4gICAgLy9cbiAgICAvLyBGaWJlcnMgYXJlIG5lZWRlZCBiZWNhdXNlIGhlYXJ0YmVhdCB1c2VzIE1ldGVvci5zZXRUaW1lb3V0LCB3aGljaFxuICAgIC8vIG5lZWRzIGEgRmliZXIuIFdlIGNvdWxkIGFjdHVhbGx5IHVzZSByZWd1bGFyIHNldFRpbWVvdXQgYW5kIGF2b2lkXG4gICAgLy8gdGhlc2UgbmV3IGZpYmVycywgYnV0IGl0IGlzIGVhc2llciB0byBqdXN0IG1ha2UgZXZlcnl0aGluZyB1c2VcbiAgICAvLyBNZXRlb3Iuc2V0VGltZW91dCBhbmQgbm90IHRoaW5rIHRvbyBoYXJkLlxuICAgIC8vXG4gICAgLy8gQW55IG1lc3NhZ2UgY291bnRzIGFzIHJlY2VpdmluZyBhIHBvbmcsIGFzIGl0IGRlbW9uc3RyYXRlcyB0aGF0XG4gICAgLy8gdGhlIGNsaWVudCBpcyBzdGlsbCBhbGl2ZS5cbiAgICBpZiAoc2VsZi5oZWFydGJlYXQpIHtcbiAgICAgIEZpYmVyKGZ1bmN0aW9uICgpIHtcbiAgICAgICAgc2VsZi5oZWFydGJlYXQubWVzc2FnZVJlY2VpdmVkKCk7XG4gICAgICB9KS5ydW4oKTtcbiAgICB9XG5cbiAgICBpZiAoc2VsZi52ZXJzaW9uICE9PSAncHJlMScgJiYgbXNnX2luLm1zZyA9PT0gJ3BpbmcnKSB7XG4gICAgICBpZiAoc2VsZi5fcmVzcG9uZFRvUGluZ3MpXG4gICAgICAgIHNlbGYuc2VuZCh7bXNnOiBcInBvbmdcIiwgaWQ6IG1zZ19pbi5pZH0pO1xuICAgICAgcmV0dXJuO1xuICAgIH1cbiAgICBpZiAoc2VsZi52ZXJzaW9uICE9PSAncHJlMScgJiYgbXNnX2luLm1zZyA9PT0gJ3BvbmcnKSB7XG4gICAgICAvLyBTaW5jZSBldmVyeXRoaW5nIGlzIGEgcG9uZywgbm90aGluZyB0byBkb1xuICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIHNlbGYuaW5RdWV1ZS5wdXNoKG1zZ19pbik7XG4gICAgaWYgKHNlbGYud29ya2VyUnVubmluZylcbiAgICAgIHJldHVybjtcbiAgICBzZWxmLndvcmtlclJ1bm5pbmcgPSB0cnVlO1xuXG4gICAgdmFyIHByb2Nlc3NOZXh0ID0gZnVuY3Rpb24gKCkge1xuICAgICAgdmFyIG1zZyA9IHNlbGYuaW5RdWV1ZSAmJiBzZWxmLmluUXVldWUuc2hpZnQoKTtcbiAgICAgIGlmICghbXNnKSB7XG4gICAgICAgIHNlbGYud29ya2VyUnVubmluZyA9IGZhbHNlO1xuICAgICAgICByZXR1cm47XG4gICAgICB9XG5cbiAgICAgIEZpYmVyKGZ1bmN0aW9uICgpIHtcbiAgICAgICAgdmFyIGJsb2NrZWQgPSB0cnVlO1xuXG4gICAgICAgIHZhciB1bmJsb2NrID0gZnVuY3Rpb24gKCkge1xuICAgICAgICAgIGlmICghYmxvY2tlZClcbiAgICAgICAgICAgIHJldHVybjsgLy8gaWRlbXBvdGVudFxuICAgICAgICAgIGJsb2NrZWQgPSBmYWxzZTtcbiAgICAgICAgICBwcm9jZXNzTmV4dCgpO1xuICAgICAgICB9O1xuXG4gICAgICAgIHNlbGYuc2VydmVyLm9uTWVzc2FnZUhvb2suZWFjaChmdW5jdGlvbiAoY2FsbGJhY2spIHtcbiAgICAgICAgICBjYWxsYmFjayhtc2csIHNlbGYpO1xuICAgICAgICAgIHJldHVybiB0cnVlO1xuICAgICAgICB9KTtcblxuICAgICAgICBpZiAoXy5oYXMoc2VsZi5wcm90b2NvbF9oYW5kbGVycywgbXNnLm1zZykpXG4gICAgICAgICAgc2VsZi5wcm90b2NvbF9oYW5kbGVyc1ttc2cubXNnXS5jYWxsKHNlbGYsIG1zZywgdW5ibG9jayk7XG4gICAgICAgIGVsc2VcbiAgICAgICAgICBzZWxmLnNlbmRFcnJvcignQmFkIHJlcXVlc3QnLCBtc2cpO1xuICAgICAgICB1bmJsb2NrKCk7IC8vIGluIGNhc2UgdGhlIGhhbmRsZXIgZGlkbid0IGFscmVhZHkgZG8gaXRcbiAgICAgIH0pLnJ1bigpO1xuICAgIH07XG5cbiAgICBwcm9jZXNzTmV4dCgpO1xuICB9LFxuXG4gIHByb3RvY29sX2hhbmRsZXJzOiB7XG4gICAgc3ViOiBmdW5jdGlvbiAobXNnKSB7XG4gICAgICB2YXIgc2VsZiA9IHRoaXM7XG5cbiAgICAgIC8vIHJlamVjdCBtYWxmb3JtZWQgbWVzc2FnZXNcbiAgICAgIGlmICh0eXBlb2YgKG1zZy5pZCkgIT09IFwic3RyaW5nXCIgfHxcbiAgICAgICAgICB0eXBlb2YgKG1zZy5uYW1lKSAhPT0gXCJzdHJpbmdcIiB8fFxuICAgICAgICAgICgoJ3BhcmFtcycgaW4gbXNnKSAmJiAhKG1zZy5wYXJhbXMgaW5zdGFuY2VvZiBBcnJheSkpKSB7XG4gICAgICAgIHNlbGYuc2VuZEVycm9yKFwiTWFsZm9ybWVkIHN1YnNjcmlwdGlvblwiLCBtc2cpO1xuICAgICAgICByZXR1cm47XG4gICAgICB9XG5cbiAgICAgIGlmICghc2VsZi5zZXJ2ZXIucHVibGlzaF9oYW5kbGVyc1ttc2cubmFtZV0pIHtcbiAgICAgICAgc2VsZi5zZW5kKHtcbiAgICAgICAgICBtc2c6ICdub3N1YicsIGlkOiBtc2cuaWQsXG4gICAgICAgICAgZXJyb3I6IG5ldyBNZXRlb3IuRXJyb3IoNDA0LCBgU3Vic2NyaXB0aW9uICcke21zZy5uYW1lfScgbm90IGZvdW5kYCl9KTtcbiAgICAgICAgcmV0dXJuO1xuICAgICAgfVxuXG4gICAgICBpZiAoc2VsZi5fbmFtZWRTdWJzLmhhcyhtc2cuaWQpKVxuICAgICAgICAvLyBzdWJzIGFyZSBpZGVtcG90ZW50LCBvciByYXRoZXIsIHRoZXkgYXJlIGlnbm9yZWQgaWYgYSBzdWJcbiAgICAgICAgLy8gd2l0aCB0aGF0IGlkIGFscmVhZHkgZXhpc3RzLiB0aGlzIGlzIGltcG9ydGFudCBkdXJpbmdcbiAgICAgICAgLy8gcmVjb25uZWN0LlxuICAgICAgICByZXR1cm47XG5cbiAgICAgIC8vIFhYWCBJdCdkIGJlIG11Y2ggYmV0dGVyIGlmIHdlIGhhZCBnZW5lcmljIGhvb2tzIHdoZXJlIGFueSBwYWNrYWdlIGNhblxuICAgICAgLy8gaG9vayBpbnRvIHN1YnNjcmlwdGlvbiBoYW5kbGluZywgYnV0IGluIHRoZSBtZWFuIHdoaWxlIHdlIHNwZWNpYWwgY2FzZVxuICAgICAgLy8gZGRwLXJhdGUtbGltaXRlciBwYWNrYWdlLiBUaGlzIGlzIGFsc28gZG9uZSBmb3Igd2VhayByZXF1aXJlbWVudHMgdG9cbiAgICAgIC8vIGFkZCB0aGUgZGRwLXJhdGUtbGltaXRlciBwYWNrYWdlIGluIGNhc2Ugd2UgZG9uJ3QgaGF2ZSBBY2NvdW50cy4gQVxuICAgICAgLy8gdXNlciB0cnlpbmcgdG8gdXNlIHRoZSBkZHAtcmF0ZS1saW1pdGVyIG11c3QgZXhwbGljaXRseSByZXF1aXJlIGl0LlxuICAgICAgaWYgKFBhY2thZ2VbJ2RkcC1yYXRlLWxpbWl0ZXInXSkge1xuICAgICAgICB2YXIgRERQUmF0ZUxpbWl0ZXIgPSBQYWNrYWdlWydkZHAtcmF0ZS1saW1pdGVyJ10uRERQUmF0ZUxpbWl0ZXI7XG4gICAgICAgIHZhciByYXRlTGltaXRlcklucHV0ID0ge1xuICAgICAgICAgIHVzZXJJZDogc2VsZi51c2VySWQsXG4gICAgICAgICAgY2xpZW50QWRkcmVzczogc2VsZi5jb25uZWN0aW9uSGFuZGxlLmNsaWVudEFkZHJlc3MsXG4gICAgICAgICAgdHlwZTogXCJzdWJzY3JpcHRpb25cIixcbiAgICAgICAgICBuYW1lOiBtc2cubmFtZSxcbiAgICAgICAgICBjb25uZWN0aW9uSWQ6IHNlbGYuaWRcbiAgICAgICAgfTtcblxuICAgICAgICBERFBSYXRlTGltaXRlci5faW5jcmVtZW50KHJhdGVMaW1pdGVySW5wdXQpO1xuICAgICAgICB2YXIgcmF0ZUxpbWl0UmVzdWx0ID0gRERQUmF0ZUxpbWl0ZXIuX2NoZWNrKHJhdGVMaW1pdGVySW5wdXQpO1xuICAgICAgICBpZiAoIXJhdGVMaW1pdFJlc3VsdC5hbGxvd2VkKSB7XG4gICAgICAgICAgc2VsZi5zZW5kKHtcbiAgICAgICAgICAgIG1zZzogJ25vc3ViJywgaWQ6IG1zZy5pZCxcbiAgICAgICAgICAgIGVycm9yOiBuZXcgTWV0ZW9yLkVycm9yKFxuICAgICAgICAgICAgICAndG9vLW1hbnktcmVxdWVzdHMnLFxuICAgICAgICAgICAgICBERFBSYXRlTGltaXRlci5nZXRFcnJvck1lc3NhZ2UocmF0ZUxpbWl0UmVzdWx0KSxcbiAgICAgICAgICAgICAge3RpbWVUb1Jlc2V0OiByYXRlTGltaXRSZXN1bHQudGltZVRvUmVzZXR9KVxuICAgICAgICAgIH0pO1xuICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuICAgICAgfVxuXG4gICAgICB2YXIgaGFuZGxlciA9IHNlbGYuc2VydmVyLnB1Ymxpc2hfaGFuZGxlcnNbbXNnLm5hbWVdO1xuXG4gICAgICBzZWxmLl9zdGFydFN1YnNjcmlwdGlvbihoYW5kbGVyLCBtc2cuaWQsIG1zZy5wYXJhbXMsIG1zZy5uYW1lKTtcblxuICAgIH0sXG5cbiAgICB1bnN1YjogZnVuY3Rpb24gKG1zZykge1xuICAgICAgdmFyIHNlbGYgPSB0aGlzO1xuXG4gICAgICBzZWxmLl9zdG9wU3Vic2NyaXB0aW9uKG1zZy5pZCk7XG4gICAgfSxcblxuICAgIG1ldGhvZDogZnVuY3Rpb24gKG1zZywgdW5ibG9jaykge1xuICAgICAgdmFyIHNlbGYgPSB0aGlzO1xuXG4gICAgICAvLyByZWplY3QgbWFsZm9ybWVkIG1lc3NhZ2VzXG4gICAgICAvLyBGb3Igbm93LCB3ZSBzaWxlbnRseSBpZ25vcmUgdW5rbm93biBhdHRyaWJ1dGVzLFxuICAgICAgLy8gZm9yIGZvcndhcmRzIGNvbXBhdGliaWxpdHkuXG4gICAgICBpZiAodHlwZW9mIChtc2cuaWQpICE9PSBcInN0cmluZ1wiIHx8XG4gICAgICAgICAgdHlwZW9mIChtc2cubWV0aG9kKSAhPT0gXCJzdHJpbmdcIiB8fFxuICAgICAgICAgICgoJ3BhcmFtcycgaW4gbXNnKSAmJiAhKG1zZy5wYXJhbXMgaW5zdGFuY2VvZiBBcnJheSkpIHx8XG4gICAgICAgICAgKCgncmFuZG9tU2VlZCcgaW4gbXNnKSAmJiAodHlwZW9mIG1zZy5yYW5kb21TZWVkICE9PSBcInN0cmluZ1wiKSkpIHtcbiAgICAgICAgc2VsZi5zZW5kRXJyb3IoXCJNYWxmb3JtZWQgbWV0aG9kIGludm9jYXRpb25cIiwgbXNnKTtcbiAgICAgICAgcmV0dXJuO1xuICAgICAgfVxuXG4gICAgICB2YXIgcmFuZG9tU2VlZCA9IG1zZy5yYW5kb21TZWVkIHx8IG51bGw7XG5cbiAgICAgIC8vIHNldCB1cCB0byBtYXJrIHRoZSBtZXRob2QgYXMgc2F0aXNmaWVkIG9uY2UgYWxsIG9ic2VydmVyc1xuICAgICAgLy8gKGFuZCBzdWJzY3JpcHRpb25zKSBoYXZlIHJlYWN0ZWQgdG8gYW55IHdyaXRlcyB0aGF0IHdlcmVcbiAgICAgIC8vIGRvbmUuXG4gICAgICB2YXIgZmVuY2UgPSBuZXcgRERQU2VydmVyLl9Xcml0ZUZlbmNlO1xuICAgICAgZmVuY2Uub25BbGxDb21taXR0ZWQoZnVuY3Rpb24gKCkge1xuICAgICAgICAvLyBSZXRpcmUgdGhlIGZlbmNlIHNvIHRoYXQgZnV0dXJlIHdyaXRlcyBhcmUgYWxsb3dlZC5cbiAgICAgICAgLy8gVGhpcyBtZWFucyB0aGF0IGNhbGxiYWNrcyBsaWtlIHRpbWVycyBhcmUgZnJlZSB0byB1c2VcbiAgICAgICAgLy8gdGhlIGZlbmNlLCBhbmQgaWYgdGhleSBmaXJlIGJlZm9yZSBpdCdzIGFybWVkIChmb3JcbiAgICAgICAgLy8gZXhhbXBsZSwgYmVjYXVzZSB0aGUgbWV0aG9kIHdhaXRzIGZvciB0aGVtKSB0aGVpclxuICAgICAgICAvLyB3cml0ZXMgd2lsbCBiZSBpbmNsdWRlZCBpbiB0aGUgZmVuY2UuXG4gICAgICAgIGZlbmNlLnJldGlyZSgpO1xuICAgICAgICBzZWxmLnNlbmQoe1xuICAgICAgICAgIG1zZzogJ3VwZGF0ZWQnLCBtZXRob2RzOiBbbXNnLmlkXX0pO1xuICAgICAgfSk7XG5cbiAgICAgIC8vIGZpbmQgdGhlIGhhbmRsZXJcbiAgICAgIHZhciBoYW5kbGVyID0gc2VsZi5zZXJ2ZXIubWV0aG9kX2hhbmRsZXJzW21zZy5tZXRob2RdO1xuICAgICAgaWYgKCFoYW5kbGVyKSB7XG4gICAgICAgIHNlbGYuc2VuZCh7XG4gICAgICAgICAgbXNnOiAncmVzdWx0JywgaWQ6IG1zZy5pZCxcbiAgICAgICAgICBlcnJvcjogbmV3IE1ldGVvci5FcnJvcig0MDQsIGBNZXRob2QgJyR7bXNnLm1ldGhvZH0nIG5vdCBmb3VuZGApfSk7XG4gICAgICAgIGZlbmNlLmFybSgpO1xuICAgICAgICByZXR1cm47XG4gICAgICB9XG5cbiAgICAgIHZhciBzZXRVc2VySWQgPSBmdW5jdGlvbih1c2VySWQpIHtcbiAgICAgICAgc2VsZi5fc2V0VXNlcklkKHVzZXJJZCk7XG4gICAgICB9O1xuXG4gICAgICB2YXIgaW52b2NhdGlvbiA9IG5ldyBERFBDb21tb24uTWV0aG9kSW52b2NhdGlvbih7XG4gICAgICAgIGlzU2ltdWxhdGlvbjogZmFsc2UsXG4gICAgICAgIHVzZXJJZDogc2VsZi51c2VySWQsXG4gICAgICAgIHNldFVzZXJJZDogc2V0VXNlcklkLFxuICAgICAgICB1bmJsb2NrOiB1bmJsb2NrLFxuICAgICAgICBjb25uZWN0aW9uOiBzZWxmLmNvbm5lY3Rpb25IYW5kbGUsXG4gICAgICAgIHJhbmRvbVNlZWQ6IHJhbmRvbVNlZWRcbiAgICAgIH0pO1xuXG4gICAgICBjb25zdCBwcm9taXNlID0gbmV3IFByb21pc2UoKHJlc29sdmUsIHJlamVjdCkgPT4ge1xuICAgICAgICAvLyBYWFggSXQnZCBiZSBiZXR0ZXIgaWYgd2UgY291bGQgaG9vayBpbnRvIG1ldGhvZCBoYW5kbGVycyBiZXR0ZXIgYnV0XG4gICAgICAgIC8vIGZvciBub3csIHdlIG5lZWQgdG8gY2hlY2sgaWYgdGhlIGRkcC1yYXRlLWxpbWl0ZXIgZXhpc3RzIHNpbmNlIHdlXG4gICAgICAgIC8vIGhhdmUgYSB3ZWFrIHJlcXVpcmVtZW50IGZvciB0aGUgZGRwLXJhdGUtbGltaXRlciBwYWNrYWdlIHRvIGJlIGFkZGVkXG4gICAgICAgIC8vIHRvIG91ciBhcHBsaWNhdGlvbi5cbiAgICAgICAgaWYgKFBhY2thZ2VbJ2RkcC1yYXRlLWxpbWl0ZXInXSkge1xuICAgICAgICAgIHZhciBERFBSYXRlTGltaXRlciA9IFBhY2thZ2VbJ2RkcC1yYXRlLWxpbWl0ZXInXS5ERFBSYXRlTGltaXRlcjtcbiAgICAgICAgICB2YXIgcmF0ZUxpbWl0ZXJJbnB1dCA9IHtcbiAgICAgICAgICAgIHVzZXJJZDogc2VsZi51c2VySWQsXG4gICAgICAgICAgICBjbGllbnRBZGRyZXNzOiBzZWxmLmNvbm5lY3Rpb25IYW5kbGUuY2xpZW50QWRkcmVzcyxcbiAgICAgICAgICAgIHR5cGU6IFwibWV0aG9kXCIsXG4gICAgICAgICAgICBuYW1lOiBtc2cubWV0aG9kLFxuICAgICAgICAgICAgY29ubmVjdGlvbklkOiBzZWxmLmlkXG4gICAgICAgICAgfTtcbiAgICAgICAgICBERFBSYXRlTGltaXRlci5faW5jcmVtZW50KHJhdGVMaW1pdGVySW5wdXQpO1xuICAgICAgICAgIHZhciByYXRlTGltaXRSZXN1bHQgPSBERFBSYXRlTGltaXRlci5fY2hlY2socmF0ZUxpbWl0ZXJJbnB1dClcbiAgICAgICAgICBpZiAoIXJhdGVMaW1pdFJlc3VsdC5hbGxvd2VkKSB7XG4gICAgICAgICAgICByZWplY3QobmV3IE1ldGVvci5FcnJvcihcbiAgICAgICAgICAgICAgXCJ0b28tbWFueS1yZXF1ZXN0c1wiLFxuICAgICAgICAgICAgICBERFBSYXRlTGltaXRlci5nZXRFcnJvck1lc3NhZ2UocmF0ZUxpbWl0UmVzdWx0KSxcbiAgICAgICAgICAgICAge3RpbWVUb1Jlc2V0OiByYXRlTGltaXRSZXN1bHQudGltZVRvUmVzZXR9XG4gICAgICAgICAgICApKTtcbiAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgICB9XG4gICAgICAgIH1cblxuICAgICAgICByZXNvbHZlKEREUFNlcnZlci5fQ3VycmVudFdyaXRlRmVuY2Uud2l0aFZhbHVlKFxuICAgICAgICAgIGZlbmNlLFxuICAgICAgICAgICgpID0+IEREUC5fQ3VycmVudE1ldGhvZEludm9jYXRpb24ud2l0aFZhbHVlKFxuICAgICAgICAgICAgaW52b2NhdGlvbixcbiAgICAgICAgICAgICgpID0+IG1heWJlQXVkaXRBcmd1bWVudENoZWNrcyhcbiAgICAgICAgICAgICAgaGFuZGxlciwgaW52b2NhdGlvbiwgbXNnLnBhcmFtcyxcbiAgICAgICAgICAgICAgXCJjYWxsIHRvICdcIiArIG1zZy5tZXRob2QgKyBcIidcIlxuICAgICAgICAgICAgKVxuICAgICAgICAgIClcbiAgICAgICAgKSk7XG4gICAgICB9KTtcblxuICAgICAgZnVuY3Rpb24gZmluaXNoKCkge1xuICAgICAgICBmZW5jZS5hcm0oKTtcbiAgICAgICAgdW5ibG9jaygpO1xuICAgICAgfVxuXG4gICAgICBjb25zdCBwYXlsb2FkID0ge1xuICAgICAgICBtc2c6IFwicmVzdWx0XCIsXG4gICAgICAgIGlkOiBtc2cuaWRcbiAgICAgIH07XG5cbiAgICAgIHByb21pc2UudGhlbigocmVzdWx0KSA9PiB7XG4gICAgICAgIGZpbmlzaCgpO1xuICAgICAgICBpZiAocmVzdWx0ICE9PSB1bmRlZmluZWQpIHtcbiAgICAgICAgICBwYXlsb2FkLnJlc3VsdCA9IHJlc3VsdDtcbiAgICAgICAgfVxuICAgICAgICBzZWxmLnNlbmQocGF5bG9hZCk7XG4gICAgICB9LCAoZXhjZXB0aW9uKSA9PiB7XG4gICAgICAgIGZpbmlzaCgpO1xuICAgICAgICBwYXlsb2FkLmVycm9yID0gd3JhcEludGVybmFsRXhjZXB0aW9uKFxuICAgICAgICAgIGV4Y2VwdGlvbixcbiAgICAgICAgICBgd2hpbGUgaW52b2tpbmcgbWV0aG9kICcke21zZy5tZXRob2R9J2BcbiAgICAgICAgKTtcbiAgICAgICAgc2VsZi5zZW5kKHBheWxvYWQpO1xuICAgICAgfSk7XG4gICAgfVxuICB9LFxuXG4gIF9lYWNoU3ViOiBmdW5jdGlvbiAoZikge1xuICAgIHZhciBzZWxmID0gdGhpcztcbiAgICBzZWxmLl9uYW1lZFN1YnMuZm9yRWFjaChmKTtcbiAgICBzZWxmLl91bml2ZXJzYWxTdWJzLmZvckVhY2goZik7XG4gIH0sXG5cbiAgX2RpZmZDb2xsZWN0aW9uVmlld3M6IGZ1bmN0aW9uIChiZWZvcmVDVnMpIHtcbiAgICB2YXIgc2VsZiA9IHRoaXM7XG4gICAgRGlmZlNlcXVlbmNlLmRpZmZNYXBzKGJlZm9yZUNWcywgc2VsZi5jb2xsZWN0aW9uVmlld3MsIHtcbiAgICAgIGJvdGg6IGZ1bmN0aW9uIChjb2xsZWN0aW9uTmFtZSwgbGVmdFZhbHVlLCByaWdodFZhbHVlKSB7XG4gICAgICAgIHJpZ2h0VmFsdWUuZGlmZihsZWZ0VmFsdWUpO1xuICAgICAgfSxcbiAgICAgIHJpZ2h0T25seTogZnVuY3Rpb24gKGNvbGxlY3Rpb25OYW1lLCByaWdodFZhbHVlKSB7XG4gICAgICAgIHJpZ2h0VmFsdWUuZG9jdW1lbnRzLmZvckVhY2goZnVuY3Rpb24gKGRvY1ZpZXcsIGlkKSB7XG4gICAgICAgICAgc2VsZi5zZW5kQWRkZWQoY29sbGVjdGlvbk5hbWUsIGlkLCBkb2NWaWV3LmdldEZpZWxkcygpKTtcbiAgICAgICAgfSk7XG4gICAgICB9LFxuICAgICAgbGVmdE9ubHk6IGZ1bmN0aW9uIChjb2xsZWN0aW9uTmFtZSwgbGVmdFZhbHVlKSB7XG4gICAgICAgIGxlZnRWYWx1ZS5kb2N1bWVudHMuZm9yRWFjaChmdW5jdGlvbiAoZG9jLCBpZCkge1xuICAgICAgICAgIHNlbGYuc2VuZFJlbW92ZWQoY29sbGVjdGlvbk5hbWUsIGlkKTtcbiAgICAgICAgfSk7XG4gICAgICB9XG4gICAgfSk7XG4gIH0sXG5cbiAgLy8gU2V0cyB0aGUgY3VycmVudCB1c2VyIGlkIGluIGFsbCBhcHByb3ByaWF0ZSBjb250ZXh0cyBhbmQgcmVydW5zXG4gIC8vIGFsbCBzdWJzY3JpcHRpb25zXG4gIF9zZXRVc2VySWQ6IGZ1bmN0aW9uKHVzZXJJZCkge1xuICAgIHZhciBzZWxmID0gdGhpcztcblxuICAgIGlmICh1c2VySWQgIT09IG51bGwgJiYgdHlwZW9mIHVzZXJJZCAhPT0gXCJzdHJpbmdcIilcbiAgICAgIHRocm93IG5ldyBFcnJvcihcInNldFVzZXJJZCBtdXN0IGJlIGNhbGxlZCBvbiBzdHJpbmcgb3IgbnVsbCwgbm90IFwiICtcbiAgICAgICAgICAgICAgICAgICAgICB0eXBlb2YgdXNlcklkKTtcblxuICAgIC8vIFByZXZlbnQgbmV3bHktY3JlYXRlZCB1bml2ZXJzYWwgc3Vic2NyaXB0aW9ucyBmcm9tIGJlaW5nIGFkZGVkIHRvIG91clxuICAgIC8vIHNlc3Npb247IHRoZXkgd2lsbCBiZSBmb3VuZCBiZWxvdyB3aGVuIHdlIGNhbGwgc3RhcnRVbml2ZXJzYWxTdWJzLlxuICAgIC8vXG4gICAgLy8gKFdlIGRvbid0IGhhdmUgdG8gd29ycnkgYWJvdXQgbmFtZWQgc3Vic2NyaXB0aW9ucywgYmVjYXVzZSB3ZSBvbmx5IGFkZFxuICAgIC8vIHRoZW0gd2hlbiB3ZSBwcm9jZXNzIGEgJ3N1YicgbWVzc2FnZS4gV2UgYXJlIGN1cnJlbnRseSBwcm9jZXNzaW5nIGFcbiAgICAvLyAnbWV0aG9kJyBtZXNzYWdlLCBhbmQgdGhlIG1ldGhvZCBkaWQgbm90IHVuYmxvY2ssIGJlY2F1c2UgaXQgaXMgaWxsZWdhbFxuICAgIC8vIHRvIGNhbGwgc2V0VXNlcklkIGFmdGVyIHVuYmxvY2suIFRodXMgd2UgY2Fubm90IGJlIGNvbmN1cnJlbnRseSBhZGRpbmcgYVxuICAgIC8vIG5ldyBuYW1lZCBzdWJzY3JpcHRpb24uKVxuICAgIHNlbGYuX2RvbnRTdGFydE5ld1VuaXZlcnNhbFN1YnMgPSB0cnVlO1xuXG4gICAgLy8gUHJldmVudCBjdXJyZW50IHN1YnMgZnJvbSB1cGRhdGluZyBvdXIgY29sbGVjdGlvblZpZXdzIGFuZCBjYWxsIHRoZWlyXG4gICAgLy8gc3RvcCBjYWxsYmFja3MuIFRoaXMgbWF5IHlpZWxkLlxuICAgIHNlbGYuX2VhY2hTdWIoZnVuY3Rpb24gKHN1Yikge1xuICAgICAgc3ViLl9kZWFjdGl2YXRlKCk7XG4gICAgfSk7XG5cbiAgICAvLyBBbGwgc3VicyBzaG91bGQgbm93IGJlIGRlYWN0aXZhdGVkLiBTdG9wIHNlbmRpbmcgbWVzc2FnZXMgdG8gdGhlIGNsaWVudCxcbiAgICAvLyBzYXZlIHRoZSBzdGF0ZSBvZiB0aGUgcHVibGlzaGVkIGNvbGxlY3Rpb25zLCByZXNldCB0byBhbiBlbXB0eSB2aWV3LCBhbmRcbiAgICAvLyB1cGRhdGUgdGhlIHVzZXJJZC5cbiAgICBzZWxmLl9pc1NlbmRpbmcgPSBmYWxzZTtcbiAgICB2YXIgYmVmb3JlQ1ZzID0gc2VsZi5jb2xsZWN0aW9uVmlld3M7XG4gICAgc2VsZi5jb2xsZWN0aW9uVmlld3MgPSBuZXcgTWFwKCk7XG4gICAgc2VsZi51c2VySWQgPSB1c2VySWQ7XG5cbiAgICAvLyBfc2V0VXNlcklkIGlzIG5vcm1hbGx5IGNhbGxlZCBmcm9tIGEgTWV0ZW9yIG1ldGhvZCB3aXRoXG4gICAgLy8gRERQLl9DdXJyZW50TWV0aG9kSW52b2NhdGlvbiBzZXQuIEJ1dCBERFAuX0N1cnJlbnRNZXRob2RJbnZvY2F0aW9uIGlzIG5vdFxuICAgIC8vIGV4cGVjdGVkIHRvIGJlIHNldCBpbnNpZGUgYSBwdWJsaXNoIGZ1bmN0aW9uLCBzbyB3ZSB0ZW1wb3JhcnkgdW5zZXQgaXQuXG4gICAgLy8gSW5zaWRlIGEgcHVibGlzaCBmdW5jdGlvbiBERFAuX0N1cnJlbnRQdWJsaWNhdGlvbkludm9jYXRpb24gaXMgc2V0LlxuICAgIEREUC5fQ3VycmVudE1ldGhvZEludm9jYXRpb24ud2l0aFZhbHVlKHVuZGVmaW5lZCwgZnVuY3Rpb24gKCkge1xuICAgICAgLy8gU2F2ZSB0aGUgb2xkIG5hbWVkIHN1YnMsIGFuZCByZXNldCB0byBoYXZpbmcgbm8gc3Vic2NyaXB0aW9ucy5cbiAgICAgIHZhciBvbGROYW1lZFN1YnMgPSBzZWxmLl9uYW1lZFN1YnM7XG4gICAgICBzZWxmLl9uYW1lZFN1YnMgPSBuZXcgTWFwKCk7XG4gICAgICBzZWxmLl91bml2ZXJzYWxTdWJzID0gW107XG5cbiAgICAgIG9sZE5hbWVkU3Vicy5mb3JFYWNoKGZ1bmN0aW9uIChzdWIsIHN1YnNjcmlwdGlvbklkKSB7XG4gICAgICAgIHZhciBuZXdTdWIgPSBzdWIuX3JlY3JlYXRlKCk7XG4gICAgICAgIHNlbGYuX25hbWVkU3Vicy5zZXQoc3Vic2NyaXB0aW9uSWQsIG5ld1N1Yik7XG4gICAgICAgIC8vIG5iOiBpZiB0aGUgaGFuZGxlciB0aHJvd3Mgb3IgY2FsbHMgdGhpcy5lcnJvcigpLCBpdCB3aWxsIGluIGZhY3RcbiAgICAgICAgLy8gaW1tZWRpYXRlbHkgc2VuZCBpdHMgJ25vc3ViJy4gVGhpcyBpcyBPSywgdGhvdWdoLlxuICAgICAgICBuZXdTdWIuX3J1bkhhbmRsZXIoKTtcbiAgICAgIH0pO1xuXG4gICAgICAvLyBBbGxvdyBuZXdseS1jcmVhdGVkIHVuaXZlcnNhbCBzdWJzIHRvIGJlIHN0YXJ0ZWQgb24gb3VyIGNvbm5lY3Rpb24gaW5cbiAgICAgIC8vIHBhcmFsbGVsIHdpdGggdGhlIG9uZXMgd2UncmUgc3Bpbm5pbmcgdXAgaGVyZSwgYW5kIHNwaW4gdXAgdW5pdmVyc2FsXG4gICAgICAvLyBzdWJzLlxuICAgICAgc2VsZi5fZG9udFN0YXJ0TmV3VW5pdmVyc2FsU3VicyA9IGZhbHNlO1xuICAgICAgc2VsZi5zdGFydFVuaXZlcnNhbFN1YnMoKTtcbiAgICB9KTtcblxuICAgIC8vIFN0YXJ0IHNlbmRpbmcgbWVzc2FnZXMgYWdhaW4sIGJlZ2lubmluZyB3aXRoIHRoZSBkaWZmIGZyb20gdGhlIHByZXZpb3VzXG4gICAgLy8gc3RhdGUgb2YgdGhlIHdvcmxkIHRvIHRoZSBjdXJyZW50IHN0YXRlLiBObyB5aWVsZHMgYXJlIGFsbG93ZWQgZHVyaW5nXG4gICAgLy8gdGhpcyBkaWZmLCBzbyB0aGF0IG90aGVyIGNoYW5nZXMgY2Fubm90IGludGVybGVhdmUuXG4gICAgTWV0ZW9yLl9ub1lpZWxkc0FsbG93ZWQoZnVuY3Rpb24gKCkge1xuICAgICAgc2VsZi5faXNTZW5kaW5nID0gdHJ1ZTtcbiAgICAgIHNlbGYuX2RpZmZDb2xsZWN0aW9uVmlld3MoYmVmb3JlQ1ZzKTtcbiAgICAgIGlmICghXy5pc0VtcHR5KHNlbGYuX3BlbmRpbmdSZWFkeSkpIHtcbiAgICAgICAgc2VsZi5zZW5kUmVhZHkoc2VsZi5fcGVuZGluZ1JlYWR5KTtcbiAgICAgICAgc2VsZi5fcGVuZGluZ1JlYWR5ID0gW107XG4gICAgICB9XG4gICAgfSk7XG4gIH0sXG5cbiAgX3N0YXJ0U3Vic2NyaXB0aW9uOiBmdW5jdGlvbiAoaGFuZGxlciwgc3ViSWQsIHBhcmFtcywgbmFtZSkge1xuICAgIHZhciBzZWxmID0gdGhpcztcblxuICAgIHZhciBzdWIgPSBuZXcgU3Vic2NyaXB0aW9uKFxuICAgICAgc2VsZiwgaGFuZGxlciwgc3ViSWQsIHBhcmFtcywgbmFtZSk7XG4gICAgaWYgKHN1YklkKVxuICAgICAgc2VsZi5fbmFtZWRTdWJzLnNldChzdWJJZCwgc3ViKTtcbiAgICBlbHNlXG4gICAgICBzZWxmLl91bml2ZXJzYWxTdWJzLnB1c2goc3ViKTtcblxuICAgIHN1Yi5fcnVuSGFuZGxlcigpO1xuICB9LFxuXG4gIC8vIHRlYXIgZG93biBzcGVjaWZpZWQgc3Vic2NyaXB0aW9uXG4gIF9zdG9wU3Vic2NyaXB0aW9uOiBmdW5jdGlvbiAoc3ViSWQsIGVycm9yKSB7XG4gICAgdmFyIHNlbGYgPSB0aGlzO1xuXG4gICAgdmFyIHN1Yk5hbWUgPSBudWxsO1xuICAgIGlmIChzdWJJZCkge1xuICAgICAgdmFyIG1heWJlU3ViID0gc2VsZi5fbmFtZWRTdWJzLmdldChzdWJJZCk7XG4gICAgICBpZiAobWF5YmVTdWIpIHtcbiAgICAgICAgc3ViTmFtZSA9IG1heWJlU3ViLl9uYW1lO1xuICAgICAgICBtYXliZVN1Yi5fcmVtb3ZlQWxsRG9jdW1lbnRzKCk7XG4gICAgICAgIG1heWJlU3ViLl9kZWFjdGl2YXRlKCk7XG4gICAgICAgIHNlbGYuX25hbWVkU3Vicy5kZWxldGUoc3ViSWQpO1xuICAgICAgfVxuICAgIH1cblxuICAgIHZhciByZXNwb25zZSA9IHttc2c6ICdub3N1YicsIGlkOiBzdWJJZH07XG5cbiAgICBpZiAoZXJyb3IpIHtcbiAgICAgIHJlc3BvbnNlLmVycm9yID0gd3JhcEludGVybmFsRXhjZXB0aW9uKFxuICAgICAgICBlcnJvcixcbiAgICAgICAgc3ViTmFtZSA/IChcImZyb20gc3ViIFwiICsgc3ViTmFtZSArIFwiIGlkIFwiICsgc3ViSWQpXG4gICAgICAgICAgOiAoXCJmcm9tIHN1YiBpZCBcIiArIHN1YklkKSk7XG4gICAgfVxuXG4gICAgc2VsZi5zZW5kKHJlc3BvbnNlKTtcbiAgfSxcblxuICAvLyB0ZWFyIGRvd24gYWxsIHN1YnNjcmlwdGlvbnMuIE5vdGUgdGhhdCB0aGlzIGRvZXMgTk9UIHNlbmQgcmVtb3ZlZCBvciBub3N1YlxuICAvLyBtZXNzYWdlcywgc2luY2Ugd2UgYXNzdW1lIHRoZSBjbGllbnQgaXMgZ29uZS5cbiAgX2RlYWN0aXZhdGVBbGxTdWJzY3JpcHRpb25zOiBmdW5jdGlvbiAoKSB7XG4gICAgdmFyIHNlbGYgPSB0aGlzO1xuXG4gICAgc2VsZi5fbmFtZWRTdWJzLmZvckVhY2goZnVuY3Rpb24gKHN1YiwgaWQpIHtcbiAgICAgIHN1Yi5fZGVhY3RpdmF0ZSgpO1xuICAgIH0pO1xuICAgIHNlbGYuX25hbWVkU3VicyA9IG5ldyBNYXAoKTtcblxuICAgIHNlbGYuX3VuaXZlcnNhbFN1YnMuZm9yRWFjaChmdW5jdGlvbiAoc3ViKSB7XG4gICAgICBzdWIuX2RlYWN0aXZhdGUoKTtcbiAgICB9KTtcbiAgICBzZWxmLl91bml2ZXJzYWxTdWJzID0gW107XG4gIH0sXG5cbiAgLy8gRGV0ZXJtaW5lIHRoZSByZW1vdGUgY2xpZW50J3MgSVAgYWRkcmVzcywgYmFzZWQgb24gdGhlXG4gIC8vIEhUVFBfRk9SV0FSREVEX0NPVU5UIGVudmlyb25tZW50IHZhcmlhYmxlIHJlcHJlc2VudGluZyBob3cgbWFueVxuICAvLyBwcm94aWVzIHRoZSBzZXJ2ZXIgaXMgYmVoaW5kLlxuICBfY2xpZW50QWRkcmVzczogZnVuY3Rpb24gKCkge1xuICAgIHZhciBzZWxmID0gdGhpcztcblxuICAgIC8vIEZvciB0aGUgcmVwb3J0ZWQgY2xpZW50IGFkZHJlc3MgZm9yIGEgY29ubmVjdGlvbiB0byBiZSBjb3JyZWN0LFxuICAgIC8vIHRoZSBkZXZlbG9wZXIgbXVzdCBzZXQgdGhlIEhUVFBfRk9SV0FSREVEX0NPVU5UIGVudmlyb25tZW50XG4gICAgLy8gdmFyaWFibGUgdG8gYW4gaW50ZWdlciByZXByZXNlbnRpbmcgdGhlIG51bWJlciBvZiBob3BzIHRoZXlcbiAgICAvLyBleHBlY3QgaW4gdGhlIGB4LWZvcndhcmRlZC1mb3JgIGhlYWRlci4gRS5nLiwgc2V0IHRvIFwiMVwiIGlmIHRoZVxuICAgIC8vIHNlcnZlciBpcyBiZWhpbmQgb25lIHByb3h5LlxuICAgIC8vXG4gICAgLy8gVGhpcyBjb3VsZCBiZSBjb21wdXRlZCBvbmNlIGF0IHN0YXJ0dXAgaW5zdGVhZCBvZiBldmVyeSB0aW1lLlxuICAgIHZhciBodHRwRm9yd2FyZGVkQ291bnQgPSBwYXJzZUludChwcm9jZXNzLmVudlsnSFRUUF9GT1JXQVJERURfQ09VTlQnXSkgfHwgMDtcblxuICAgIGlmIChodHRwRm9yd2FyZGVkQ291bnQgPT09IDApXG4gICAgICByZXR1cm4gc2VsZi5zb2NrZXQucmVtb3RlQWRkcmVzcztcblxuICAgIHZhciBmb3J3YXJkZWRGb3IgPSBzZWxmLnNvY2tldC5oZWFkZXJzW1wieC1mb3J3YXJkZWQtZm9yXCJdO1xuICAgIGlmICghIF8uaXNTdHJpbmcoZm9yd2FyZGVkRm9yKSlcbiAgICAgIHJldHVybiBudWxsO1xuICAgIGZvcndhcmRlZEZvciA9IGZvcndhcmRlZEZvci50cmltKCkuc3BsaXQoL1xccyosXFxzKi8pO1xuXG4gICAgLy8gVHlwaWNhbGx5IHRoZSBmaXJzdCB2YWx1ZSBpbiB0aGUgYHgtZm9yd2FyZGVkLWZvcmAgaGVhZGVyIGlzXG4gICAgLy8gdGhlIG9yaWdpbmFsIElQIGFkZHJlc3Mgb2YgdGhlIGNsaWVudCBjb25uZWN0aW5nIHRvIHRoZSBmaXJzdFxuICAgIC8vIHByb3h5LiAgSG93ZXZlciwgdGhlIGVuZCB1c2VyIGNhbiBlYXNpbHkgc3Bvb2YgdGhlIGhlYWRlciwgaW5cbiAgICAvLyB3aGljaCBjYXNlIHRoZSBmaXJzdCB2YWx1ZShzKSB3aWxsIGJlIHRoZSBmYWtlIElQIGFkZHJlc3MgZnJvbVxuICAgIC8vIHRoZSB1c2VyIHByZXRlbmRpbmcgdG8gYmUgYSBwcm94eSByZXBvcnRpbmcgdGhlIG9yaWdpbmFsIElQXG4gICAgLy8gYWRkcmVzcyB2YWx1ZS4gIEJ5IGNvdW50aW5nIEhUVFBfRk9SV0FSREVEX0NPVU5UIGJhY2sgZnJvbSB0aGVcbiAgICAvLyBlbmQgb2YgdGhlIGxpc3QsIHdlIGVuc3VyZSB0aGF0IHdlIGdldCB0aGUgSVAgYWRkcmVzcyBiZWluZ1xuICAgIC8vIHJlcG9ydGVkIGJ5ICpvdXIqIGZpcnN0IHByb3h5LlxuXG4gICAgaWYgKGh0dHBGb3J3YXJkZWRDb3VudCA8IDAgfHwgaHR0cEZvcndhcmRlZENvdW50ID4gZm9yd2FyZGVkRm9yLmxlbmd0aClcbiAgICAgIHJldHVybiBudWxsO1xuXG4gICAgcmV0dXJuIGZvcndhcmRlZEZvcltmb3J3YXJkZWRGb3IubGVuZ3RoIC0gaHR0cEZvcndhcmRlZENvdW50XTtcbiAgfVxufSk7XG5cbi8qKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKiovXG4vKiBTdWJzY3JpcHRpb24gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAqL1xuLyoqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKi9cblxuLy8gY3RvciBmb3IgYSBzdWIgaGFuZGxlOiB0aGUgaW5wdXQgdG8gZWFjaCBwdWJsaXNoIGZ1bmN0aW9uXG5cbi8vIEluc3RhbmNlIG5hbWUgaXMgdGhpcyBiZWNhdXNlIGl0J3MgdXN1YWxseSByZWZlcnJlZCB0byBhcyB0aGlzIGluc2lkZSBhXG4vLyBwdWJsaXNoXG4vKipcbiAqIEBzdW1tYXJ5IFRoZSBzZXJ2ZXIncyBzaWRlIG9mIGEgc3Vic2NyaXB0aW9uXG4gKiBAY2xhc3MgU3Vic2NyaXB0aW9uXG4gKiBAaW5zdGFuY2VOYW1lIHRoaXNcbiAqIEBzaG93SW5zdGFuY2VOYW1lIHRydWVcbiAqL1xudmFyIFN1YnNjcmlwdGlvbiA9IGZ1bmN0aW9uIChcbiAgICBzZXNzaW9uLCBoYW5kbGVyLCBzdWJzY3JpcHRpb25JZCwgcGFyYW1zLCBuYW1lKSB7XG4gIHZhciBzZWxmID0gdGhpcztcbiAgc2VsZi5fc2Vzc2lvbiA9IHNlc3Npb247IC8vIHR5cGUgaXMgU2Vzc2lvblxuXG4gIC8qKlxuICAgKiBAc3VtbWFyeSBBY2Nlc3MgaW5zaWRlIHRoZSBwdWJsaXNoIGZ1bmN0aW9uLiBUaGUgaW5jb21pbmcgW2Nvbm5lY3Rpb25dKCNtZXRlb3Jfb25jb25uZWN0aW9uKSBmb3IgdGhpcyBzdWJzY3JpcHRpb24uXG4gICAqIEBsb2N1cyBTZXJ2ZXJcbiAgICogQG5hbWUgIGNvbm5lY3Rpb25cbiAgICogQG1lbWJlck9mIFN1YnNjcmlwdGlvblxuICAgKiBAaW5zdGFuY2VcbiAgICovXG4gIHNlbGYuY29ubmVjdGlvbiA9IHNlc3Npb24uY29ubmVjdGlvbkhhbmRsZTsgLy8gcHVibGljIEFQSSBvYmplY3RcblxuICBzZWxmLl9oYW5kbGVyID0gaGFuZGxlcjtcblxuICAvLyBteSBzdWJzY3JpcHRpb24gSUQgKGdlbmVyYXRlZCBieSBjbGllbnQsIHVuZGVmaW5lZCBmb3IgdW5pdmVyc2FsIHN1YnMpLlxuICBzZWxmLl9zdWJzY3JpcHRpb25JZCA9IHN1YnNjcmlwdGlvbklkO1xuICAvLyB1bmRlZmluZWQgZm9yIHVuaXZlcnNhbCBzdWJzXG4gIHNlbGYuX25hbWUgPSBuYW1lO1xuXG4gIHNlbGYuX3BhcmFtcyA9IHBhcmFtcyB8fCBbXTtcblxuICAvLyBPbmx5IG5hbWVkIHN1YnNjcmlwdGlvbnMgaGF2ZSBJRHMsIGJ1dCB3ZSBuZWVkIHNvbWUgc29ydCBvZiBzdHJpbmdcbiAgLy8gaW50ZXJuYWxseSB0byBrZWVwIHRyYWNrIG9mIGFsbCBzdWJzY3JpcHRpb25zIGluc2lkZVxuICAvLyBTZXNzaW9uRG9jdW1lbnRWaWV3cy4gV2UgdXNlIHRoaXMgc3Vic2NyaXB0aW9uSGFuZGxlIGZvciB0aGF0LlxuICBpZiAoc2VsZi5fc3Vic2NyaXB0aW9uSWQpIHtcbiAgICBzZWxmLl9zdWJzY3JpcHRpb25IYW5kbGUgPSAnTicgKyBzZWxmLl9zdWJzY3JpcHRpb25JZDtcbiAgfSBlbHNlIHtcbiAgICBzZWxmLl9zdWJzY3JpcHRpb25IYW5kbGUgPSAnVScgKyBSYW5kb20uaWQoKTtcbiAgfVxuXG4gIC8vIGhhcyBfZGVhY3RpdmF0ZSBiZWVuIGNhbGxlZD9cbiAgc2VsZi5fZGVhY3RpdmF0ZWQgPSBmYWxzZTtcblxuICAvLyBzdG9wIGNhbGxiYWNrcyB0byBnL2MgdGhpcyBzdWIuICBjYWxsZWQgdy8gemVybyBhcmd1bWVudHMuXG4gIHNlbGYuX3N0b3BDYWxsYmFja3MgPSBbXTtcblxuICAvLyB0aGUgc2V0IG9mIChjb2xsZWN0aW9uLCBkb2N1bWVudGlkKSB0aGF0IHRoaXMgc3Vic2NyaXB0aW9uIGhhc1xuICAvLyBhbiBvcGluaW9uIGFib3V0XG4gIHNlbGYuX2RvY3VtZW50cyA9IG5ldyBNYXAoKTtcblxuICAvLyByZW1lbWJlciBpZiB3ZSBhcmUgcmVhZHkuXG4gIHNlbGYuX3JlYWR5ID0gZmFsc2U7XG5cbiAgLy8gUGFydCBvZiB0aGUgcHVibGljIEFQSTogdGhlIHVzZXIgb2YgdGhpcyBzdWIuXG5cbiAgLyoqXG4gICAqIEBzdW1tYXJ5IEFjY2VzcyBpbnNpZGUgdGhlIHB1Ymxpc2ggZnVuY3Rpb24uIFRoZSBpZCBvZiB0aGUgbG9nZ2VkLWluIHVzZXIsIG9yIGBudWxsYCBpZiBubyB1c2VyIGlzIGxvZ2dlZCBpbi5cbiAgICogQGxvY3VzIFNlcnZlclxuICAgKiBAbWVtYmVyT2YgU3Vic2NyaXB0aW9uXG4gICAqIEBuYW1lICB1c2VySWRcbiAgICogQGluc3RhbmNlXG4gICAqL1xuICBzZWxmLnVzZXJJZCA9IHNlc3Npb24udXNlcklkO1xuXG4gIC8vIEZvciBub3csIHRoZSBpZCBmaWx0ZXIgaXMgZ29pbmcgdG8gZGVmYXVsdCB0b1xuICAvLyB0aGUgdG8vZnJvbSBERFAgbWV0aG9kcyBvbiBNb25nb0lELCB0b1xuICAvLyBzcGVjaWZpY2FsbHkgZGVhbCB3aXRoIG1vbmdvL21pbmltb25nbyBPYmplY3RJZHMuXG5cbiAgLy8gTGF0ZXIsIHlvdSB3aWxsIGJlIGFibGUgdG8gbWFrZSB0aGlzIGJlIFwicmF3XCJcbiAgLy8gaWYgeW91IHdhbnQgdG8gcHVibGlzaCBhIGNvbGxlY3Rpb24gdGhhdCB5b3Uga25vd1xuICAvLyBqdXN0IGhhcyBzdHJpbmdzIGZvciBrZXlzIGFuZCBubyBmdW5ueSBidXNpbmVzcywgdG9cbiAgLy8gYSBkZHAgY29uc3VtZXIgdGhhdCBpc24ndCBtaW5pbW9uZ29cblxuICBzZWxmLl9pZEZpbHRlciA9IHtcbiAgICBpZFN0cmluZ2lmeTogTW9uZ29JRC5pZFN0cmluZ2lmeSxcbiAgICBpZFBhcnNlOiBNb25nb0lELmlkUGFyc2VcbiAgfTtcblxuICBQYWNrYWdlWydmYWN0cy1iYXNlJ10gJiYgUGFja2FnZVsnZmFjdHMtYmFzZSddLkZhY3RzLmluY3JlbWVudFNlcnZlckZhY3QoXG4gICAgXCJsaXZlZGF0YVwiLCBcInN1YnNjcmlwdGlvbnNcIiwgMSk7XG59O1xuXG5fLmV4dGVuZChTdWJzY3JpcHRpb24ucHJvdG90eXBlLCB7XG4gIF9ydW5IYW5kbGVyOiBmdW5jdGlvbiAoKSB7XG4gICAgLy8gWFhYIHNob3VsZCB3ZSB1bmJsb2NrKCkgaGVyZT8gRWl0aGVyIGJlZm9yZSBydW5uaW5nIHRoZSBwdWJsaXNoXG4gICAgLy8gZnVuY3Rpb24sIG9yIGJlZm9yZSBydW5uaW5nIF9wdWJsaXNoQ3Vyc29yLlxuICAgIC8vXG4gICAgLy8gUmlnaHQgbm93LCBlYWNoIHB1Ymxpc2ggZnVuY3Rpb24gYmxvY2tzIGFsbCBmdXR1cmUgcHVibGlzaGVzIGFuZFxuICAgIC8vIG1ldGhvZHMgd2FpdGluZyBvbiBkYXRhIGZyb20gTW9uZ28gKG9yIHdoYXRldmVyIGVsc2UgdGhlIGZ1bmN0aW9uXG4gICAgLy8gYmxvY2tzIG9uKS4gVGhpcyBwcm9iYWJseSBzbG93cyBwYWdlIGxvYWQgaW4gY29tbW9uIGNhc2VzLlxuXG4gICAgdmFyIHNlbGYgPSB0aGlzO1xuICAgIHRyeSB7XG4gICAgICB2YXIgcmVzID0gRERQLl9DdXJyZW50UHVibGljYXRpb25JbnZvY2F0aW9uLndpdGhWYWx1ZShcbiAgICAgICAgc2VsZixcbiAgICAgICAgKCkgPT4gbWF5YmVBdWRpdEFyZ3VtZW50Q2hlY2tzKFxuICAgICAgICAgIHNlbGYuX2hhbmRsZXIsIHNlbGYsIEVKU09OLmNsb25lKHNlbGYuX3BhcmFtcyksXG4gICAgICAgICAgLy8gSXQncyBPSyB0aGF0IHRoaXMgd291bGQgbG9vayB3ZWlyZCBmb3IgdW5pdmVyc2FsIHN1YnNjcmlwdGlvbnMsXG4gICAgICAgICAgLy8gYmVjYXVzZSB0aGV5IGhhdmUgbm8gYXJndW1lbnRzIHNvIHRoZXJlIGNhbiBuZXZlciBiZSBhblxuICAgICAgICAgIC8vIGF1ZGl0LWFyZ3VtZW50LWNoZWNrcyBmYWlsdXJlLlxuICAgICAgICAgIFwicHVibGlzaGVyICdcIiArIHNlbGYuX25hbWUgKyBcIidcIlxuICAgICAgICApXG4gICAgICApO1xuICAgIH0gY2F0Y2ggKGUpIHtcbiAgICAgIHNlbGYuZXJyb3IoZSk7XG4gICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgLy8gRGlkIHRoZSBoYW5kbGVyIGNhbGwgdGhpcy5lcnJvciBvciB0aGlzLnN0b3A/XG4gICAgaWYgKHNlbGYuX2lzRGVhY3RpdmF0ZWQoKSlcbiAgICAgIHJldHVybjtcblxuICAgIHNlbGYuX3B1Ymxpc2hIYW5kbGVyUmVzdWx0KHJlcyk7XG4gIH0sXG5cbiAgX3B1Ymxpc2hIYW5kbGVyUmVzdWx0OiBmdW5jdGlvbiAocmVzKSB7XG4gICAgLy8gU1BFQ0lBTCBDQVNFOiBJbnN0ZWFkIG9mIHdyaXRpbmcgdGhlaXIgb3duIGNhbGxiYWNrcyB0aGF0IGludm9rZVxuICAgIC8vIHRoaXMuYWRkZWQvY2hhbmdlZC9yZWFkeS9ldGMsIHRoZSB1c2VyIGNhbiBqdXN0IHJldHVybiBhIGNvbGxlY3Rpb25cbiAgICAvLyBjdXJzb3Igb3IgYXJyYXkgb2YgY3Vyc29ycyBmcm9tIHRoZSBwdWJsaXNoIGZ1bmN0aW9uOyB3ZSBjYWxsIHRoZWlyXG4gICAgLy8gX3B1Ymxpc2hDdXJzb3IgbWV0aG9kIHdoaWNoIHN0YXJ0cyBvYnNlcnZpbmcgdGhlIGN1cnNvciBhbmQgcHVibGlzaGVzIHRoZVxuICAgIC8vIHJlc3VsdHMuIE5vdGUgdGhhdCBfcHVibGlzaEN1cnNvciBkb2VzIE5PVCBjYWxsIHJlYWR5KCkuXG4gICAgLy9cbiAgICAvLyBYWFggVGhpcyB1c2VzIGFuIHVuZG9jdW1lbnRlZCBpbnRlcmZhY2Ugd2hpY2ggb25seSB0aGUgTW9uZ28gY3Vyc29yXG4gICAgLy8gaW50ZXJmYWNlIHB1Ymxpc2hlcy4gU2hvdWxkIHdlIG1ha2UgdGhpcyBpbnRlcmZhY2UgcHVibGljIGFuZCBlbmNvdXJhZ2VcbiAgICAvLyB1c2VycyB0byBpbXBsZW1lbnQgaXQgdGhlbXNlbHZlcz8gQXJndWFibHksIGl0J3MgdW5uZWNlc3Nhcnk7IHVzZXJzIGNhblxuICAgIC8vIGFscmVhZHkgd3JpdGUgdGhlaXIgb3duIGZ1bmN0aW9ucyBsaWtlXG4gICAgLy8gICB2YXIgcHVibGlzaE15UmVhY3RpdmVUaGluZ3kgPSBmdW5jdGlvbiAobmFtZSwgaGFuZGxlcikge1xuICAgIC8vICAgICBNZXRlb3IucHVibGlzaChuYW1lLCBmdW5jdGlvbiAoKSB7XG4gICAgLy8gICAgICAgdmFyIHJlYWN0aXZlVGhpbmd5ID0gaGFuZGxlcigpO1xuICAgIC8vICAgICAgIHJlYWN0aXZlVGhpbmd5LnB1Ymxpc2hNZSgpO1xuICAgIC8vICAgICB9KTtcbiAgICAvLyAgIH07XG5cbiAgICB2YXIgc2VsZiA9IHRoaXM7XG4gICAgdmFyIGlzQ3Vyc29yID0gZnVuY3Rpb24gKGMpIHtcbiAgICAgIHJldHVybiBjICYmIGMuX3B1Ymxpc2hDdXJzb3I7XG4gICAgfTtcbiAgICBpZiAoaXNDdXJzb3IocmVzKSkge1xuICAgICAgdHJ5IHtcbiAgICAgICAgcmVzLl9wdWJsaXNoQ3Vyc29yKHNlbGYpO1xuICAgICAgfSBjYXRjaCAoZSkge1xuICAgICAgICBzZWxmLmVycm9yKGUpO1xuICAgICAgICByZXR1cm47XG4gICAgICB9XG4gICAgICAvLyBfcHVibGlzaEN1cnNvciBvbmx5IHJldHVybnMgYWZ0ZXIgdGhlIGluaXRpYWwgYWRkZWQgY2FsbGJhY2tzIGhhdmUgcnVuLlxuICAgICAgLy8gbWFyayBzdWJzY3JpcHRpb24gYXMgcmVhZHkuXG4gICAgICBzZWxmLnJlYWR5KCk7XG4gICAgfSBlbHNlIGlmIChfLmlzQXJyYXkocmVzKSkge1xuICAgICAgLy8gY2hlY2sgYWxsIHRoZSBlbGVtZW50cyBhcmUgY3Vyc29yc1xuICAgICAgaWYgKCEgXy5hbGwocmVzLCBpc0N1cnNvcikpIHtcbiAgICAgICAgc2VsZi5lcnJvcihuZXcgRXJyb3IoXCJQdWJsaXNoIGZ1bmN0aW9uIHJldHVybmVkIGFuIGFycmF5IG9mIG5vbi1DdXJzb3JzXCIpKTtcbiAgICAgICAgcmV0dXJuO1xuICAgICAgfVxuICAgICAgLy8gZmluZCBkdXBsaWNhdGUgY29sbGVjdGlvbiBuYW1lc1xuICAgICAgLy8gWFhYIHdlIHNob3VsZCBzdXBwb3J0IG92ZXJsYXBwaW5nIGN1cnNvcnMsIGJ1dCB0aGF0IHdvdWxkIHJlcXVpcmUgdGhlXG4gICAgICAvLyBtZXJnZSBib3ggdG8gYWxsb3cgb3ZlcmxhcCB3aXRoaW4gYSBzdWJzY3JpcHRpb25cbiAgICAgIHZhciBjb2xsZWN0aW9uTmFtZXMgPSB7fTtcbiAgICAgIGZvciAodmFyIGkgPSAwOyBpIDwgcmVzLmxlbmd0aDsgKytpKSB7XG4gICAgICAgIHZhciBjb2xsZWN0aW9uTmFtZSA9IHJlc1tpXS5fZ2V0Q29sbGVjdGlvbk5hbWUoKTtcbiAgICAgICAgaWYgKF8uaGFzKGNvbGxlY3Rpb25OYW1lcywgY29sbGVjdGlvbk5hbWUpKSB7XG4gICAgICAgICAgc2VsZi5lcnJvcihuZXcgRXJyb3IoXG4gICAgICAgICAgICBcIlB1Ymxpc2ggZnVuY3Rpb24gcmV0dXJuZWQgbXVsdGlwbGUgY3Vyc29ycyBmb3IgY29sbGVjdGlvbiBcIiArXG4gICAgICAgICAgICAgIGNvbGxlY3Rpb25OYW1lKSk7XG4gICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG4gICAgICAgIGNvbGxlY3Rpb25OYW1lc1tjb2xsZWN0aW9uTmFtZV0gPSB0cnVlO1xuICAgICAgfTtcblxuICAgICAgdHJ5IHtcbiAgICAgICAgXy5lYWNoKHJlcywgZnVuY3Rpb24gKGN1cikge1xuICAgICAgICAgIGN1ci5fcHVibGlzaEN1cnNvcihzZWxmKTtcbiAgICAgICAgfSk7XG4gICAgICB9IGNhdGNoIChlKSB7XG4gICAgICAgIHNlbGYuZXJyb3IoZSk7XG4gICAgICAgIHJldHVybjtcbiAgICAgIH1cbiAgICAgIHNlbGYucmVhZHkoKTtcbiAgICB9IGVsc2UgaWYgKHJlcykge1xuICAgICAgLy8gdHJ1dGh5IHZhbHVlcyBvdGhlciB0aGFuIGN1cnNvcnMgb3IgYXJyYXlzIGFyZSBwcm9iYWJseSBhXG4gICAgICAvLyB1c2VyIG1pc3Rha2UgKHBvc3NpYmxlIHJldHVybmluZyBhIE1vbmdvIGRvY3VtZW50IHZpYSwgc2F5LFxuICAgICAgLy8gYGNvbGwuZmluZE9uZSgpYCkuXG4gICAgICBzZWxmLmVycm9yKG5ldyBFcnJvcihcIlB1Ymxpc2ggZnVuY3Rpb24gY2FuIG9ubHkgcmV0dXJuIGEgQ3Vyc29yIG9yIFwiXG4gICAgICAgICAgICAgICAgICAgICAgICAgICArIFwiYW4gYXJyYXkgb2YgQ3Vyc29yc1wiKSk7XG4gICAgfVxuICB9LFxuXG4gIC8vIFRoaXMgY2FsbHMgYWxsIHN0b3AgY2FsbGJhY2tzIGFuZCBwcmV2ZW50cyB0aGUgaGFuZGxlciBmcm9tIHVwZGF0aW5nIGFueVxuICAvLyBTZXNzaW9uQ29sbGVjdGlvblZpZXdzIGZ1cnRoZXIuIEl0J3MgdXNlZCB3aGVuIHRoZSB1c2VyIHVuc3Vic2NyaWJlcyBvclxuICAvLyBkaXNjb25uZWN0cywgYXMgd2VsbCBhcyBkdXJpbmcgc2V0VXNlcklkIHJlLXJ1bnMuIEl0IGRvZXMgKk5PVCogc2VuZFxuICAvLyByZW1vdmVkIG1lc3NhZ2VzIGZvciB0aGUgcHVibGlzaGVkIG9iamVjdHM7IGlmIHRoYXQgaXMgbmVjZXNzYXJ5LCBjYWxsXG4gIC8vIF9yZW1vdmVBbGxEb2N1bWVudHMgZmlyc3QuXG4gIF9kZWFjdGl2YXRlOiBmdW5jdGlvbigpIHtcbiAgICB2YXIgc2VsZiA9IHRoaXM7XG4gICAgaWYgKHNlbGYuX2RlYWN0aXZhdGVkKVxuICAgICAgcmV0dXJuO1xuICAgIHNlbGYuX2RlYWN0aXZhdGVkID0gdHJ1ZTtcbiAgICBzZWxmLl9jYWxsU3RvcENhbGxiYWNrcygpO1xuICAgIFBhY2thZ2VbJ2ZhY3RzLWJhc2UnXSAmJiBQYWNrYWdlWydmYWN0cy1iYXNlJ10uRmFjdHMuaW5jcmVtZW50U2VydmVyRmFjdChcbiAgICAgIFwibGl2ZWRhdGFcIiwgXCJzdWJzY3JpcHRpb25zXCIsIC0xKTtcbiAgfSxcblxuICBfY2FsbFN0b3BDYWxsYmFja3M6IGZ1bmN0aW9uICgpIHtcbiAgICB2YXIgc2VsZiA9IHRoaXM7XG4gICAgLy8gdGVsbCBsaXN0ZW5lcnMsIHNvIHRoZXkgY2FuIGNsZWFuIHVwXG4gICAgdmFyIGNhbGxiYWNrcyA9IHNlbGYuX3N0b3BDYWxsYmFja3M7XG4gICAgc2VsZi5fc3RvcENhbGxiYWNrcyA9IFtdO1xuICAgIF8uZWFjaChjYWxsYmFja3MsIGZ1bmN0aW9uIChjYWxsYmFjaykge1xuICAgICAgY2FsbGJhY2soKTtcbiAgICB9KTtcbiAgfSxcblxuICAvLyBTZW5kIHJlbW92ZSBtZXNzYWdlcyBmb3IgZXZlcnkgZG9jdW1lbnQuXG4gIF9yZW1vdmVBbGxEb2N1bWVudHM6IGZ1bmN0aW9uICgpIHtcbiAgICB2YXIgc2VsZiA9IHRoaXM7XG4gICAgTWV0ZW9yLl9ub1lpZWxkc0FsbG93ZWQoZnVuY3Rpb24gKCkge1xuICAgICAgc2VsZi5fZG9jdW1lbnRzLmZvckVhY2goZnVuY3Rpb24gKGNvbGxlY3Rpb25Eb2NzLCBjb2xsZWN0aW9uTmFtZSkge1xuICAgICAgICBjb2xsZWN0aW9uRG9jcy5mb3JFYWNoKGZ1bmN0aW9uIChzdHJJZCkge1xuICAgICAgICAgIHNlbGYucmVtb3ZlZChjb2xsZWN0aW9uTmFtZSwgc2VsZi5faWRGaWx0ZXIuaWRQYXJzZShzdHJJZCkpO1xuICAgICAgICB9KTtcbiAgICAgIH0pO1xuICAgIH0pO1xuICB9LFxuXG4gIC8vIFJldHVybnMgYSBuZXcgU3Vic2NyaXB0aW9uIGZvciB0aGUgc2FtZSBzZXNzaW9uIHdpdGggdGhlIHNhbWVcbiAgLy8gaW5pdGlhbCBjcmVhdGlvbiBwYXJhbWV0ZXJzLiBUaGlzIGlzbid0IGEgY2xvbmU6IGl0IGRvZXNuJ3QgaGF2ZVxuICAvLyB0aGUgc2FtZSBfZG9jdW1lbnRzIGNhY2hlLCBzdG9wcGVkIHN0YXRlIG9yIGNhbGxiYWNrczsgbWF5IGhhdmUgYVxuICAvLyBkaWZmZXJlbnQgX3N1YnNjcmlwdGlvbkhhbmRsZSwgYW5kIGdldHMgaXRzIHVzZXJJZCBmcm9tIHRoZVxuICAvLyBzZXNzaW9uLCBub3QgZnJvbSB0aGlzIG9iamVjdC5cbiAgX3JlY3JlYXRlOiBmdW5jdGlvbiAoKSB7XG4gICAgdmFyIHNlbGYgPSB0aGlzO1xuICAgIHJldHVybiBuZXcgU3Vic2NyaXB0aW9uKFxuICAgICAgc2VsZi5fc2Vzc2lvbiwgc2VsZi5faGFuZGxlciwgc2VsZi5fc3Vic2NyaXB0aW9uSWQsIHNlbGYuX3BhcmFtcyxcbiAgICAgIHNlbGYuX25hbWUpO1xuICB9LFxuXG4gIC8qKlxuICAgKiBAc3VtbWFyeSBDYWxsIGluc2lkZSB0aGUgcHVibGlzaCBmdW5jdGlvbi4gIFN0b3BzIHRoaXMgY2xpZW50J3Mgc3Vic2NyaXB0aW9uLCB0cmlnZ2VyaW5nIGEgY2FsbCBvbiB0aGUgY2xpZW50IHRvIHRoZSBgb25TdG9wYCBjYWxsYmFjayBwYXNzZWQgdG8gW2BNZXRlb3Iuc3Vic2NyaWJlYF0oI21ldGVvcl9zdWJzY3JpYmUpLCBpZiBhbnkuIElmIGBlcnJvcmAgaXMgbm90IGEgW2BNZXRlb3IuRXJyb3JgXSgjbWV0ZW9yX2Vycm9yKSwgaXQgd2lsbCBiZSBbc2FuaXRpemVkXSgjbWV0ZW9yX2Vycm9yKS5cbiAgICogQGxvY3VzIFNlcnZlclxuICAgKiBAcGFyYW0ge0Vycm9yfSBlcnJvciBUaGUgZXJyb3IgdG8gcGFzcyB0byB0aGUgY2xpZW50LlxuICAgKiBAaW5zdGFuY2VcbiAgICogQG1lbWJlck9mIFN1YnNjcmlwdGlvblxuICAgKi9cbiAgZXJyb3I6IGZ1bmN0aW9uIChlcnJvcikge1xuICAgIHZhciBzZWxmID0gdGhpcztcbiAgICBpZiAoc2VsZi5faXNEZWFjdGl2YXRlZCgpKVxuICAgICAgcmV0dXJuO1xuICAgIHNlbGYuX3Nlc3Npb24uX3N0b3BTdWJzY3JpcHRpb24oc2VsZi5fc3Vic2NyaXB0aW9uSWQsIGVycm9yKTtcbiAgfSxcblxuICAvLyBOb3RlIHRoYXQgd2hpbGUgb3VyIEREUCBjbGllbnQgd2lsbCBub3RpY2UgdGhhdCB5b3UndmUgY2FsbGVkIHN0b3AoKSBvbiB0aGVcbiAgLy8gc2VydmVyIChhbmQgY2xlYW4gdXAgaXRzIF9zdWJzY3JpcHRpb25zIHRhYmxlKSB3ZSBkb24ndCBhY3R1YWxseSBwcm92aWRlIGFcbiAgLy8gbWVjaGFuaXNtIGZvciBhbiBhcHAgdG8gbm90aWNlIHRoaXMgKHRoZSBzdWJzY3JpYmUgb25FcnJvciBjYWxsYmFjayBvbmx5XG4gIC8vIHRyaWdnZXJzIGlmIHRoZXJlIGlzIGFuIGVycm9yKS5cblxuICAvKipcbiAgICogQHN1bW1hcnkgQ2FsbCBpbnNpZGUgdGhlIHB1Ymxpc2ggZnVuY3Rpb24uICBTdG9wcyB0aGlzIGNsaWVudCdzIHN1YnNjcmlwdGlvbiBhbmQgaW52b2tlcyB0aGUgY2xpZW50J3MgYG9uU3RvcGAgY2FsbGJhY2sgd2l0aCBubyBlcnJvci5cbiAgICogQGxvY3VzIFNlcnZlclxuICAgKiBAaW5zdGFuY2VcbiAgICogQG1lbWJlck9mIFN1YnNjcmlwdGlvblxuICAgKi9cbiAgc3RvcDogZnVuY3Rpb24gKCkge1xuICAgIHZhciBzZWxmID0gdGhpcztcbiAgICBpZiAoc2VsZi5faXNEZWFjdGl2YXRlZCgpKVxuICAgICAgcmV0dXJuO1xuICAgIHNlbGYuX3Nlc3Npb24uX3N0b3BTdWJzY3JpcHRpb24oc2VsZi5fc3Vic2NyaXB0aW9uSWQpO1xuICB9LFxuXG4gIC8qKlxuICAgKiBAc3VtbWFyeSBDYWxsIGluc2lkZSB0aGUgcHVibGlzaCBmdW5jdGlvbi4gIFJlZ2lzdGVycyBhIGNhbGxiYWNrIGZ1bmN0aW9uIHRvIHJ1biB3aGVuIHRoZSBzdWJzY3JpcHRpb24gaXMgc3RvcHBlZC5cbiAgICogQGxvY3VzIFNlcnZlclxuICAgKiBAbWVtYmVyT2YgU3Vic2NyaXB0aW9uXG4gICAqIEBpbnN0YW5jZVxuICAgKiBAcGFyYW0ge0Z1bmN0aW9ufSBmdW5jIFRoZSBjYWxsYmFjayBmdW5jdGlvblxuICAgKi9cbiAgb25TdG9wOiBmdW5jdGlvbiAoY2FsbGJhY2spIHtcbiAgICB2YXIgc2VsZiA9IHRoaXM7XG4gICAgY2FsbGJhY2sgPSBNZXRlb3IuYmluZEVudmlyb25tZW50KGNhbGxiYWNrLCAnb25TdG9wIGNhbGxiYWNrJywgc2VsZik7XG4gICAgaWYgKHNlbGYuX2lzRGVhY3RpdmF0ZWQoKSlcbiAgICAgIGNhbGxiYWNrKCk7XG4gICAgZWxzZVxuICAgICAgc2VsZi5fc3RvcENhbGxiYWNrcy5wdXNoKGNhbGxiYWNrKTtcbiAgfSxcblxuICAvLyBUaGlzIHJldHVybnMgdHJ1ZSBpZiB0aGUgc3ViIGhhcyBiZWVuIGRlYWN0aXZhdGVkLCAqT1IqIGlmIHRoZSBzZXNzaW9uIHdhc1xuICAvLyBkZXN0cm95ZWQgYnV0IHRoZSBkZWZlcnJlZCBjYWxsIHRvIF9kZWFjdGl2YXRlQWxsU3Vic2NyaXB0aW9ucyBoYXNuJ3RcbiAgLy8gaGFwcGVuZWQgeWV0LlxuICBfaXNEZWFjdGl2YXRlZDogZnVuY3Rpb24gKCkge1xuICAgIHZhciBzZWxmID0gdGhpcztcbiAgICByZXR1cm4gc2VsZi5fZGVhY3RpdmF0ZWQgfHwgc2VsZi5fc2Vzc2lvbi5pblF1ZXVlID09PSBudWxsO1xuICB9LFxuXG4gIC8qKlxuICAgKiBAc3VtbWFyeSBDYWxsIGluc2lkZSB0aGUgcHVibGlzaCBmdW5jdGlvbi4gIEluZm9ybXMgdGhlIHN1YnNjcmliZXIgdGhhdCBhIGRvY3VtZW50IGhhcyBiZWVuIGFkZGVkIHRvIHRoZSByZWNvcmQgc2V0LlxuICAgKiBAbG9jdXMgU2VydmVyXG4gICAqIEBtZW1iZXJPZiBTdWJzY3JpcHRpb25cbiAgICogQGluc3RhbmNlXG4gICAqIEBwYXJhbSB7U3RyaW5nfSBjb2xsZWN0aW9uIFRoZSBuYW1lIG9mIHRoZSBjb2xsZWN0aW9uIHRoYXQgY29udGFpbnMgdGhlIG5ldyBkb2N1bWVudC5cbiAgICogQHBhcmFtIHtTdHJpbmd9IGlkIFRoZSBuZXcgZG9jdW1lbnQncyBJRC5cbiAgICogQHBhcmFtIHtPYmplY3R9IGZpZWxkcyBUaGUgZmllbGRzIGluIHRoZSBuZXcgZG9jdW1lbnQuICBJZiBgX2lkYCBpcyBwcmVzZW50IGl0IGlzIGlnbm9yZWQuXG4gICAqL1xuICBhZGRlZDogZnVuY3Rpb24gKGNvbGxlY3Rpb25OYW1lLCBpZCwgZmllbGRzKSB7XG4gICAgdmFyIHNlbGYgPSB0aGlzO1xuICAgIGlmIChzZWxmLl9pc0RlYWN0aXZhdGVkKCkpXG4gICAgICByZXR1cm47XG4gICAgaWQgPSBzZWxmLl9pZEZpbHRlci5pZFN0cmluZ2lmeShpZCk7XG4gICAgbGV0IGlkcyA9IHNlbGYuX2RvY3VtZW50cy5nZXQoY29sbGVjdGlvbk5hbWUpO1xuICAgIGlmIChpZHMgPT0gbnVsbCkge1xuICAgICAgaWRzID0gbmV3IFNldCgpO1xuICAgICAgc2VsZi5fZG9jdW1lbnRzLnNldChjb2xsZWN0aW9uTmFtZSwgaWRzKTtcbiAgICB9XG4gICAgaWRzLmFkZChpZCk7XG4gICAgc2VsZi5fc2Vzc2lvbi5hZGRlZChzZWxmLl9zdWJzY3JpcHRpb25IYW5kbGUsIGNvbGxlY3Rpb25OYW1lLCBpZCwgZmllbGRzKTtcbiAgfSxcblxuICAvKipcbiAgICogQHN1bW1hcnkgQ2FsbCBpbnNpZGUgdGhlIHB1Ymxpc2ggZnVuY3Rpb24uICBJbmZvcm1zIHRoZSBzdWJzY3JpYmVyIHRoYXQgYSBkb2N1bWVudCBpbiB0aGUgcmVjb3JkIHNldCBoYXMgYmVlbiBtb2RpZmllZC5cbiAgICogQGxvY3VzIFNlcnZlclxuICAgKiBAbWVtYmVyT2YgU3Vic2NyaXB0aW9uXG4gICAqIEBpbnN0YW5jZVxuICAgKiBAcGFyYW0ge1N0cmluZ30gY29sbGVjdGlvbiBUaGUgbmFtZSBvZiB0aGUgY29sbGVjdGlvbiB0aGF0IGNvbnRhaW5zIHRoZSBjaGFuZ2VkIGRvY3VtZW50LlxuICAgKiBAcGFyYW0ge1N0cmluZ30gaWQgVGhlIGNoYW5nZWQgZG9jdW1lbnQncyBJRC5cbiAgICogQHBhcmFtIHtPYmplY3R9IGZpZWxkcyBUaGUgZmllbGRzIGluIHRoZSBkb2N1bWVudCB0aGF0IGhhdmUgY2hhbmdlZCwgdG9nZXRoZXIgd2l0aCB0aGVpciBuZXcgdmFsdWVzLiAgSWYgYSBmaWVsZCBpcyBub3QgcHJlc2VudCBpbiBgZmllbGRzYCBpdCB3YXMgbGVmdCB1bmNoYW5nZWQ7IGlmIGl0IGlzIHByZXNlbnQgaW4gYGZpZWxkc2AgYW5kIGhhcyBhIHZhbHVlIG9mIGB1bmRlZmluZWRgIGl0IHdhcyByZW1vdmVkIGZyb20gdGhlIGRvY3VtZW50LiAgSWYgYF9pZGAgaXMgcHJlc2VudCBpdCBpcyBpZ25vcmVkLlxuICAgKi9cbiAgY2hhbmdlZDogZnVuY3Rpb24gKGNvbGxlY3Rpb25OYW1lLCBpZCwgZmllbGRzKSB7XG4gICAgdmFyIHNlbGYgPSB0aGlzO1xuICAgIGlmIChzZWxmLl9pc0RlYWN0aXZhdGVkKCkpXG4gICAgICByZXR1cm47XG4gICAgaWQgPSBzZWxmLl9pZEZpbHRlci5pZFN0cmluZ2lmeShpZCk7XG4gICAgc2VsZi5fc2Vzc2lvbi5jaGFuZ2VkKHNlbGYuX3N1YnNjcmlwdGlvbkhhbmRsZSwgY29sbGVjdGlvbk5hbWUsIGlkLCBmaWVsZHMpO1xuICB9LFxuXG4gIC8qKlxuICAgKiBAc3VtbWFyeSBDYWxsIGluc2lkZSB0aGUgcHVibGlzaCBmdW5jdGlvbi4gIEluZm9ybXMgdGhlIHN1YnNjcmliZXIgdGhhdCBhIGRvY3VtZW50IGhhcyBiZWVuIHJlbW92ZWQgZnJvbSB0aGUgcmVjb3JkIHNldC5cbiAgICogQGxvY3VzIFNlcnZlclxuICAgKiBAbWVtYmVyT2YgU3Vic2NyaXB0aW9uXG4gICAqIEBpbnN0YW5jZVxuICAgKiBAcGFyYW0ge1N0cmluZ30gY29sbGVjdGlvbiBUaGUgbmFtZSBvZiB0aGUgY29sbGVjdGlvbiB0aGF0IHRoZSBkb2N1bWVudCBoYXMgYmVlbiByZW1vdmVkIGZyb20uXG4gICAqIEBwYXJhbSB7U3RyaW5nfSBpZCBUaGUgSUQgb2YgdGhlIGRvY3VtZW50IHRoYXQgaGFzIGJlZW4gcmVtb3ZlZC5cbiAgICovXG4gIHJlbW92ZWQ6IGZ1bmN0aW9uIChjb2xsZWN0aW9uTmFtZSwgaWQpIHtcbiAgICB2YXIgc2VsZiA9IHRoaXM7XG4gICAgaWYgKHNlbGYuX2lzRGVhY3RpdmF0ZWQoKSlcbiAgICAgIHJldHVybjtcbiAgICBpZCA9IHNlbGYuX2lkRmlsdGVyLmlkU3RyaW5naWZ5KGlkKTtcbiAgICAvLyBXZSBkb24ndCBib3RoZXIgdG8gZGVsZXRlIHNldHMgb2YgdGhpbmdzIGluIGEgY29sbGVjdGlvbiBpZiB0aGVcbiAgICAvLyBjb2xsZWN0aW9uIGlzIGVtcHR5LiAgSXQgY291bGQgYnJlYWsgX3JlbW92ZUFsbERvY3VtZW50cy5cbiAgICBzZWxmLl9kb2N1bWVudHMuZ2V0KGNvbGxlY3Rpb25OYW1lKS5kZWxldGUoaWQpO1xuICAgIHNlbGYuX3Nlc3Npb24ucmVtb3ZlZChzZWxmLl9zdWJzY3JpcHRpb25IYW5kbGUsIGNvbGxlY3Rpb25OYW1lLCBpZCk7XG4gIH0sXG5cbiAgLyoqXG4gICAqIEBzdW1tYXJ5IENhbGwgaW5zaWRlIHRoZSBwdWJsaXNoIGZ1bmN0aW9uLiAgSW5mb3JtcyB0aGUgc3Vic2NyaWJlciB0aGF0IGFuIGluaXRpYWwsIGNvbXBsZXRlIHNuYXBzaG90IG9mIHRoZSByZWNvcmQgc2V0IGhhcyBiZWVuIHNlbnQuICBUaGlzIHdpbGwgdHJpZ2dlciBhIGNhbGwgb24gdGhlIGNsaWVudCB0byB0aGUgYG9uUmVhZHlgIGNhbGxiYWNrIHBhc3NlZCB0byAgW2BNZXRlb3Iuc3Vic2NyaWJlYF0oI21ldGVvcl9zdWJzY3JpYmUpLCBpZiBhbnkuXG4gICAqIEBsb2N1cyBTZXJ2ZXJcbiAgICogQG1lbWJlck9mIFN1YnNjcmlwdGlvblxuICAgKiBAaW5zdGFuY2VcbiAgICovXG4gIHJlYWR5OiBmdW5jdGlvbiAoKSB7XG4gICAgdmFyIHNlbGYgPSB0aGlzO1xuICAgIGlmIChzZWxmLl9pc0RlYWN0aXZhdGVkKCkpXG4gICAgICByZXR1cm47XG4gICAgaWYgKCFzZWxmLl9zdWJzY3JpcHRpb25JZClcbiAgICAgIHJldHVybjsgIC8vIHVubmVjZXNzYXJ5IGJ1dCBpZ25vcmVkIGZvciB1bml2ZXJzYWwgc3ViXG4gICAgaWYgKCFzZWxmLl9yZWFkeSkge1xuICAgICAgc2VsZi5fc2Vzc2lvbi5zZW5kUmVhZHkoW3NlbGYuX3N1YnNjcmlwdGlvbklkXSk7XG4gICAgICBzZWxmLl9yZWFkeSA9IHRydWU7XG4gICAgfVxuICB9XG59KTtcblxuLyoqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKi9cbi8qIFNlcnZlciAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICovXG4vKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqL1xuXG5TZXJ2ZXIgPSBmdW5jdGlvbiAob3B0aW9ucykge1xuICB2YXIgc2VsZiA9IHRoaXM7XG5cbiAgLy8gVGhlIGRlZmF1bHQgaGVhcnRiZWF0IGludGVydmFsIGlzIDMwIHNlY29uZHMgb24gdGhlIHNlcnZlciBhbmQgMzVcbiAgLy8gc2Vjb25kcyBvbiB0aGUgY2xpZW50LiAgU2luY2UgdGhlIGNsaWVudCBkb2Vzbid0IG5lZWQgdG8gc2VuZCBhXG4gIC8vIHBpbmcgYXMgbG9uZyBhcyBpdCBpcyByZWNlaXZpbmcgcGluZ3MsIHRoaXMgbWVhbnMgdGhhdCBwaW5nc1xuICAvLyBub3JtYWxseSBnbyBmcm9tIHRoZSBzZXJ2ZXIgdG8gdGhlIGNsaWVudC5cbiAgLy9cbiAgLy8gTm90ZTogVHJvcG9zcGhlcmUgZGVwZW5kcyBvbiB0aGUgYWJpbGl0eSB0byBtdXRhdGVcbiAgLy8gTWV0ZW9yLnNlcnZlci5vcHRpb25zLmhlYXJ0YmVhdFRpbWVvdXQhIFRoaXMgaXMgYSBoYWNrLCBidXQgaXQncyBsaWZlLlxuICBzZWxmLm9wdGlvbnMgPSBfLmRlZmF1bHRzKG9wdGlvbnMgfHwge30sIHtcbiAgICBoZWFydGJlYXRJbnRlcnZhbDogMTUwMDAsXG4gICAgaGVhcnRiZWF0VGltZW91dDogMTUwMDAsXG4gICAgLy8gRm9yIHRlc3RpbmcsIGFsbG93IHJlc3BvbmRpbmcgdG8gcGluZ3MgdG8gYmUgZGlzYWJsZWQuXG4gICAgcmVzcG9uZFRvUGluZ3M6IHRydWVcbiAgfSk7XG5cbiAgLy8gTWFwIG9mIGNhbGxiYWNrcyB0byBjYWxsIHdoZW4gYSBuZXcgY29ubmVjdGlvbiBjb21lcyBpbiB0byB0aGVcbiAgLy8gc2VydmVyIGFuZCBjb21wbGV0ZXMgRERQIHZlcnNpb24gbmVnb3RpYXRpb24uIFVzZSBhbiBvYmplY3QgaW5zdGVhZFxuICAvLyBvZiBhbiBhcnJheSBzbyB3ZSBjYW4gc2FmZWx5IHJlbW92ZSBvbmUgZnJvbSB0aGUgbGlzdCB3aGlsZVxuICAvLyBpdGVyYXRpbmcgb3ZlciBpdC5cbiAgc2VsZi5vbkNvbm5lY3Rpb25Ib29rID0gbmV3IEhvb2soe1xuICAgIGRlYnVnUHJpbnRFeGNlcHRpb25zOiBcIm9uQ29ubmVjdGlvbiBjYWxsYmFja1wiXG4gIH0pO1xuXG4gIC8vIE1hcCBvZiBjYWxsYmFja3MgdG8gY2FsbCB3aGVuIGEgbmV3IG1lc3NhZ2UgY29tZXMgaW4uXG4gIHNlbGYub25NZXNzYWdlSG9vayA9IG5ldyBIb29rKHtcbiAgICBkZWJ1Z1ByaW50RXhjZXB0aW9uczogXCJvbk1lc3NhZ2UgY2FsbGJhY2tcIlxuICB9KTtcblxuICBzZWxmLnB1Ymxpc2hfaGFuZGxlcnMgPSB7fTtcbiAgc2VsZi51bml2ZXJzYWxfcHVibGlzaF9oYW5kbGVycyA9IFtdO1xuXG4gIHNlbGYubWV0aG9kX2hhbmRsZXJzID0ge307XG5cbiAgc2VsZi5zZXNzaW9ucyA9IG5ldyBNYXAoKTsgLy8gbWFwIGZyb20gaWQgdG8gc2Vzc2lvblxuXG4gIHNlbGYuc3RyZWFtX3NlcnZlciA9IG5ldyBTdHJlYW1TZXJ2ZXI7XG5cbiAgc2VsZi5zdHJlYW1fc2VydmVyLnJlZ2lzdGVyKGZ1bmN0aW9uIChzb2NrZXQpIHtcbiAgICAvLyBzb2NrZXQgaW1wbGVtZW50cyB0aGUgU29ja0pTQ29ubmVjdGlvbiBpbnRlcmZhY2VcbiAgICBzb2NrZXQuX21ldGVvclNlc3Npb24gPSBudWxsO1xuXG4gICAgdmFyIHNlbmRFcnJvciA9IGZ1bmN0aW9uIChyZWFzb24sIG9mZmVuZGluZ01lc3NhZ2UpIHtcbiAgICAgIHZhciBtc2cgPSB7bXNnOiAnZXJyb3InLCByZWFzb246IHJlYXNvbn07XG4gICAgICBpZiAob2ZmZW5kaW5nTWVzc2FnZSlcbiAgICAgICAgbXNnLm9mZmVuZGluZ01lc3NhZ2UgPSBvZmZlbmRpbmdNZXNzYWdlO1xuICAgICAgc29ja2V0LnNlbmQoRERQQ29tbW9uLnN0cmluZ2lmeUREUChtc2cpKTtcbiAgICB9O1xuXG4gICAgc29ja2V0Lm9uKCdkYXRhJywgZnVuY3Rpb24gKHJhd19tc2cpIHtcbiAgICAgIGlmIChNZXRlb3IuX3ByaW50UmVjZWl2ZWRERFApIHtcbiAgICAgICAgTWV0ZW9yLl9kZWJ1ZyhcIlJlY2VpdmVkIEREUFwiLCByYXdfbXNnKTtcbiAgICAgIH1cbiAgICAgIHRyeSB7XG4gICAgICAgIHRyeSB7XG4gICAgICAgICAgdmFyIG1zZyA9IEREUENvbW1vbi5wYXJzZUREUChyYXdfbXNnKTtcbiAgICAgICAgfSBjYXRjaCAoZXJyKSB7XG4gICAgICAgICAgc2VuZEVycm9yKCdQYXJzZSBlcnJvcicpO1xuICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuICAgICAgICBpZiAobXNnID09PSBudWxsIHx8ICFtc2cubXNnKSB7XG4gICAgICAgICAgc2VuZEVycm9yKCdCYWQgcmVxdWVzdCcsIG1zZyk7XG4gICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG5cbiAgICAgICAgaWYgKG1zZy5tc2cgPT09ICdjb25uZWN0Jykge1xuICAgICAgICAgIGlmIChzb2NrZXQuX21ldGVvclNlc3Npb24pIHtcbiAgICAgICAgICAgIHNlbmRFcnJvcihcIkFscmVhZHkgY29ubmVjdGVkXCIsIG1zZyk7XG4gICAgICAgICAgICByZXR1cm47XG4gICAgICAgICAgfVxuICAgICAgICAgIEZpYmVyKGZ1bmN0aW9uICgpIHtcbiAgICAgICAgICAgIHNlbGYuX2hhbmRsZUNvbm5lY3Qoc29ja2V0LCBtc2cpO1xuICAgICAgICAgIH0pLnJ1bigpO1xuICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuXG4gICAgICAgIGlmICghc29ja2V0Ll9tZXRlb3JTZXNzaW9uKSB7XG4gICAgICAgICAgc2VuZEVycm9yKCdNdXN0IGNvbm5lY3QgZmlyc3QnLCBtc2cpO1xuICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuICAgICAgICBzb2NrZXQuX21ldGVvclNlc3Npb24ucHJvY2Vzc01lc3NhZ2UobXNnKTtcbiAgICAgIH0gY2F0Y2ggKGUpIHtcbiAgICAgICAgLy8gWFhYIHByaW50IHN0YWNrIG5pY2VseVxuICAgICAgICBNZXRlb3IuX2RlYnVnKFwiSW50ZXJuYWwgZXhjZXB0aW9uIHdoaWxlIHByb2Nlc3NpbmcgbWVzc2FnZVwiLCBtc2csIGUpO1xuICAgICAgfVxuICAgIH0pO1xuXG4gICAgc29ja2V0Lm9uKCdjbG9zZScsIGZ1bmN0aW9uICgpIHtcbiAgICAgIGlmIChzb2NrZXQuX21ldGVvclNlc3Npb24pIHtcbiAgICAgICAgRmliZXIoZnVuY3Rpb24gKCkge1xuICAgICAgICAgIHNvY2tldC5fbWV0ZW9yU2Vzc2lvbi5jbG9zZSgpO1xuICAgICAgICB9KS5ydW4oKTtcbiAgICAgIH1cbiAgICB9KTtcbiAgfSk7XG59O1xuXG5fLmV4dGVuZChTZXJ2ZXIucHJvdG90eXBlLCB7XG5cbiAgLyoqXG4gICAqIEBzdW1tYXJ5IFJlZ2lzdGVyIGEgY2FsbGJhY2sgdG8gYmUgY2FsbGVkIHdoZW4gYSBuZXcgRERQIGNvbm5lY3Rpb24gaXMgbWFkZSB0byB0aGUgc2VydmVyLlxuICAgKiBAbG9jdXMgU2VydmVyXG4gICAqIEBwYXJhbSB7ZnVuY3Rpb259IGNhbGxiYWNrIFRoZSBmdW5jdGlvbiB0byBjYWxsIHdoZW4gYSBuZXcgRERQIGNvbm5lY3Rpb24gaXMgZXN0YWJsaXNoZWQuXG4gICAqIEBtZW1iZXJPZiBNZXRlb3JcbiAgICogQGltcG9ydEZyb21QYWNrYWdlIG1ldGVvclxuICAgKi9cbiAgb25Db25uZWN0aW9uOiBmdW5jdGlvbiAoZm4pIHtcbiAgICB2YXIgc2VsZiA9IHRoaXM7XG4gICAgcmV0dXJuIHNlbGYub25Db25uZWN0aW9uSG9vay5yZWdpc3Rlcihmbik7XG4gIH0sXG5cbiAgLyoqXG4gICAqIEBzdW1tYXJ5IFJlZ2lzdGVyIGEgY2FsbGJhY2sgdG8gYmUgY2FsbGVkIHdoZW4gYSBuZXcgRERQIG1lc3NhZ2UgaXMgcmVjZWl2ZWQuXG4gICAqIEBsb2N1cyBTZXJ2ZXJcbiAgICogQHBhcmFtIHtmdW5jdGlvbn0gY2FsbGJhY2sgVGhlIGZ1bmN0aW9uIHRvIGNhbGwgd2hlbiBhIG5ldyBERFAgbWVzc2FnZSBpcyByZWNlaXZlZC5cbiAgICogQG1lbWJlck9mIE1ldGVvclxuICAgKiBAaW1wb3J0RnJvbVBhY2thZ2UgbWV0ZW9yXG4gICAqL1xuICBvbk1lc3NhZ2U6IGZ1bmN0aW9uIChmbikge1xuICAgIHZhciBzZWxmID0gdGhpcztcbiAgICByZXR1cm4gc2VsZi5vbk1lc3NhZ2VIb29rLnJlZ2lzdGVyKGZuKTtcbiAgfSxcblxuICBfaGFuZGxlQ29ubmVjdDogZnVuY3Rpb24gKHNvY2tldCwgbXNnKSB7XG4gICAgdmFyIHNlbGYgPSB0aGlzO1xuXG4gICAgLy8gVGhlIGNvbm5lY3QgbWVzc2FnZSBtdXN0IHNwZWNpZnkgYSB2ZXJzaW9uIGFuZCBhbiBhcnJheSBvZiBzdXBwb3J0ZWRcbiAgICAvLyB2ZXJzaW9ucywgYW5kIGl0IG11c3QgY2xhaW0gdG8gc3VwcG9ydCB3aGF0IGl0IGlzIHByb3Bvc2luZy5cbiAgICBpZiAoISh0eXBlb2YgKG1zZy52ZXJzaW9uKSA9PT0gJ3N0cmluZycgJiZcbiAgICAgICAgICBfLmlzQXJyYXkobXNnLnN1cHBvcnQpICYmXG4gICAgICAgICAgXy5hbGwobXNnLnN1cHBvcnQsIF8uaXNTdHJpbmcpICYmXG4gICAgICAgICAgXy5jb250YWlucyhtc2cuc3VwcG9ydCwgbXNnLnZlcnNpb24pKSkge1xuICAgICAgc29ja2V0LnNlbmQoRERQQ29tbW9uLnN0cmluZ2lmeUREUCh7bXNnOiAnZmFpbGVkJyxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgdmVyc2lvbjogRERQQ29tbW9uLlNVUFBPUlRFRF9ERFBfVkVSU0lPTlNbMF19KSk7XG4gICAgICBzb2NrZXQuY2xvc2UoKTtcbiAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICAvLyBJbiB0aGUgZnV0dXJlLCBoYW5kbGUgc2Vzc2lvbiByZXN1bXB0aW9uOiBzb21ldGhpbmcgbGlrZTpcbiAgICAvLyAgc29ja2V0Ll9tZXRlb3JTZXNzaW9uID0gc2VsZi5zZXNzaW9uc1ttc2cuc2Vzc2lvbl1cbiAgICB2YXIgdmVyc2lvbiA9IGNhbGN1bGF0ZVZlcnNpb24obXNnLnN1cHBvcnQsIEREUENvbW1vbi5TVVBQT1JURURfRERQX1ZFUlNJT05TKTtcblxuICAgIGlmIChtc2cudmVyc2lvbiAhPT0gdmVyc2lvbikge1xuICAgICAgLy8gVGhlIGJlc3QgdmVyc2lvbiB0byB1c2UgKGFjY29yZGluZyB0byB0aGUgY2xpZW50J3Mgc3RhdGVkIHByZWZlcmVuY2VzKVxuICAgICAgLy8gaXMgbm90IHRoZSBvbmUgdGhlIGNsaWVudCBpcyB0cnlpbmcgdG8gdXNlLiBJbmZvcm0gdGhlbSBhYm91dCB0aGUgYmVzdFxuICAgICAgLy8gdmVyc2lvbiB0byB1c2UuXG4gICAgICBzb2NrZXQuc2VuZChERFBDb21tb24uc3RyaW5naWZ5RERQKHttc2c6ICdmYWlsZWQnLCB2ZXJzaW9uOiB2ZXJzaW9ufSkpO1xuICAgICAgc29ja2V0LmNsb3NlKCk7XG4gICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgLy8gWWF5LCB2ZXJzaW9uIG1hdGNoZXMhIENyZWF0ZSBhIG5ldyBzZXNzaW9uLlxuICAgIC8vIE5vdGU6IFRyb3Bvc3BoZXJlIGRlcGVuZHMgb24gdGhlIGFiaWxpdHkgdG8gbXV0YXRlXG4gICAgLy8gTWV0ZW9yLnNlcnZlci5vcHRpb25zLmhlYXJ0YmVhdFRpbWVvdXQhIFRoaXMgaXMgYSBoYWNrLCBidXQgaXQncyBsaWZlLlxuICAgIHNvY2tldC5fbWV0ZW9yU2Vzc2lvbiA9IG5ldyBTZXNzaW9uKHNlbGYsIHZlcnNpb24sIHNvY2tldCwgc2VsZi5vcHRpb25zKTtcbiAgICBzZWxmLnNlc3Npb25zLnNldChzb2NrZXQuX21ldGVvclNlc3Npb24uaWQsIHNvY2tldC5fbWV0ZW9yU2Vzc2lvbik7XG4gICAgc2VsZi5vbkNvbm5lY3Rpb25Ib29rLmVhY2goZnVuY3Rpb24gKGNhbGxiYWNrKSB7XG4gICAgICBpZiAoc29ja2V0Ll9tZXRlb3JTZXNzaW9uKVxuICAgICAgICBjYWxsYmFjayhzb2NrZXQuX21ldGVvclNlc3Npb24uY29ubmVjdGlvbkhhbmRsZSk7XG4gICAgICByZXR1cm4gdHJ1ZTtcbiAgICB9KTtcbiAgfSxcbiAgLyoqXG4gICAqIFJlZ2lzdGVyIGEgcHVibGlzaCBoYW5kbGVyIGZ1bmN0aW9uLlxuICAgKlxuICAgKiBAcGFyYW0gbmFtZSB7U3RyaW5nfSBpZGVudGlmaWVyIGZvciBxdWVyeVxuICAgKiBAcGFyYW0gaGFuZGxlciB7RnVuY3Rpb259IHB1Ymxpc2ggaGFuZGxlclxuICAgKiBAcGFyYW0gb3B0aW9ucyB7T2JqZWN0fVxuICAgKlxuICAgKiBTZXJ2ZXIgd2lsbCBjYWxsIGhhbmRsZXIgZnVuY3Rpb24gb24gZWFjaCBuZXcgc3Vic2NyaXB0aW9uLFxuICAgKiBlaXRoZXIgd2hlbiByZWNlaXZpbmcgRERQIHN1YiBtZXNzYWdlIGZvciBhIG5hbWVkIHN1YnNjcmlwdGlvbiwgb3Igb25cbiAgICogRERQIGNvbm5lY3QgZm9yIGEgdW5pdmVyc2FsIHN1YnNjcmlwdGlvbi5cbiAgICpcbiAgICogSWYgbmFtZSBpcyBudWxsLCB0aGlzIHdpbGwgYmUgYSBzdWJzY3JpcHRpb24gdGhhdCBpc1xuICAgKiBhdXRvbWF0aWNhbGx5IGVzdGFibGlzaGVkIGFuZCBwZXJtYW5lbnRseSBvbiBmb3IgYWxsIGNvbm5lY3RlZFxuICAgKiBjbGllbnQsIGluc3RlYWQgb2YgYSBzdWJzY3JpcHRpb24gdGhhdCBjYW4gYmUgdHVybmVkIG9uIGFuZCBvZmZcbiAgICogd2l0aCBzdWJzY3JpYmUoKS5cbiAgICpcbiAgICogb3B0aW9ucyB0byBjb250YWluOlxuICAgKiAgLSAobW9zdGx5IGludGVybmFsKSBpc19hdXRvOiB0cnVlIGlmIGdlbmVyYXRlZCBhdXRvbWF0aWNhbGx5XG4gICAqICAgIGZyb20gYW4gYXV0b3B1Ymxpc2ggaG9vay4gdGhpcyBpcyBmb3IgY29zbWV0aWMgcHVycG9zZXMgb25seVxuICAgKiAgICAoaXQgbGV0cyB1cyBkZXRlcm1pbmUgd2hldGhlciB0byBwcmludCBhIHdhcm5pbmcgc3VnZ2VzdGluZ1xuICAgKiAgICB0aGF0IHlvdSB0dXJuIG9mZiBhdXRvcHVibGlzaC4pXG4gICAqL1xuXG4gIC8qKlxuICAgKiBAc3VtbWFyeSBQdWJsaXNoIGEgcmVjb3JkIHNldC5cbiAgICogQG1lbWJlck9mIE1ldGVvclxuICAgKiBAaW1wb3J0RnJvbVBhY2thZ2UgbWV0ZW9yXG4gICAqIEBsb2N1cyBTZXJ2ZXJcbiAgICogQHBhcmFtIHtTdHJpbmd8T2JqZWN0fSBuYW1lIElmIFN0cmluZywgbmFtZSBvZiB0aGUgcmVjb3JkIHNldC4gIElmIE9iamVjdCwgcHVibGljYXRpb25zIERpY3Rpb25hcnkgb2YgcHVibGlzaCBmdW5jdGlvbnMgYnkgbmFtZS4gIElmIGBudWxsYCwgdGhlIHNldCBoYXMgbm8gbmFtZSwgYW5kIHRoZSByZWNvcmQgc2V0IGlzIGF1dG9tYXRpY2FsbHkgc2VudCB0byBhbGwgY29ubmVjdGVkIGNsaWVudHMuXG4gICAqIEBwYXJhbSB7RnVuY3Rpb259IGZ1bmMgRnVuY3Rpb24gY2FsbGVkIG9uIHRoZSBzZXJ2ZXIgZWFjaCB0aW1lIGEgY2xpZW50IHN1YnNjcmliZXMuICBJbnNpZGUgdGhlIGZ1bmN0aW9uLCBgdGhpc2AgaXMgdGhlIHB1Ymxpc2ggaGFuZGxlciBvYmplY3QsIGRlc2NyaWJlZCBiZWxvdy4gIElmIHRoZSBjbGllbnQgcGFzc2VkIGFyZ3VtZW50cyB0byBgc3Vic2NyaWJlYCwgdGhlIGZ1bmN0aW9uIGlzIGNhbGxlZCB3aXRoIHRoZSBzYW1lIGFyZ3VtZW50cy5cbiAgICovXG4gIHB1Ymxpc2g6IGZ1bmN0aW9uIChuYW1lLCBoYW5kbGVyLCBvcHRpb25zKSB7XG4gICAgdmFyIHNlbGYgPSB0aGlzO1xuXG4gICAgaWYgKCEgXy5pc09iamVjdChuYW1lKSkge1xuICAgICAgb3B0aW9ucyA9IG9wdGlvbnMgfHwge307XG5cbiAgICAgIGlmIChuYW1lICYmIG5hbWUgaW4gc2VsZi5wdWJsaXNoX2hhbmRsZXJzKSB7XG4gICAgICAgIE1ldGVvci5fZGVidWcoXCJJZ25vcmluZyBkdXBsaWNhdGUgcHVibGlzaCBuYW1lZCAnXCIgKyBuYW1lICsgXCInXCIpO1xuICAgICAgICByZXR1cm47XG4gICAgICB9XG5cbiAgICAgIGlmIChQYWNrYWdlLmF1dG9wdWJsaXNoICYmICFvcHRpb25zLmlzX2F1dG8pIHtcbiAgICAgICAgLy8gVGhleSBoYXZlIGF1dG9wdWJsaXNoIG9uLCB5ZXQgdGhleSdyZSB0cnlpbmcgdG8gbWFudWFsbHlcbiAgICAgICAgLy8gcGlja2luZyBzdHVmZiB0byBwdWJsaXNoLiBUaGV5IHByb2JhYmx5IHNob3VsZCB0dXJuIG9mZlxuICAgICAgICAvLyBhdXRvcHVibGlzaC4gKFRoaXMgY2hlY2sgaXNuJ3QgcGVyZmVjdCAtLSBpZiB5b3UgY3JlYXRlIGFcbiAgICAgICAgLy8gcHVibGlzaCBiZWZvcmUgeW91IHR1cm4gb24gYXV0b3B1Ymxpc2gsIGl0IHdvbid0IGNhdGNoXG4gICAgICAgIC8vIGl0LiBCdXQgdGhpcyB3aWxsIGRlZmluaXRlbHkgaGFuZGxlIHRoZSBzaW1wbGUgY2FzZSB3aGVyZVxuICAgICAgICAvLyB5b3UndmUgYWRkZWQgdGhlIGF1dG9wdWJsaXNoIHBhY2thZ2UgdG8geW91ciBhcHAsIGFuZCBhcmVcbiAgICAgICAgLy8gY2FsbGluZyBwdWJsaXNoIGZyb20geW91ciBhcHAgY29kZS4pXG4gICAgICAgIGlmICghc2VsZi53YXJuZWRfYWJvdXRfYXV0b3B1Ymxpc2gpIHtcbiAgICAgICAgICBzZWxmLndhcm5lZF9hYm91dF9hdXRvcHVibGlzaCA9IHRydWU7XG4gICAgICAgICAgTWV0ZW9yLl9kZWJ1ZyhcbiAgICBcIioqIFlvdSd2ZSBzZXQgdXAgc29tZSBkYXRhIHN1YnNjcmlwdGlvbnMgd2l0aCBNZXRlb3IucHVibGlzaCgpLCBidXRcXG5cIiArXG4gICAgXCIqKiB5b3Ugc3RpbGwgaGF2ZSBhdXRvcHVibGlzaCB0dXJuZWQgb24uIEJlY2F1c2UgYXV0b3B1Ymxpc2ggaXMgc3RpbGxcXG5cIiArXG4gICAgXCIqKiBvbiwgeW91ciBNZXRlb3IucHVibGlzaCgpIGNhbGxzIHdvbid0IGhhdmUgbXVjaCBlZmZlY3QuIEFsbCBkYXRhXFxuXCIgK1xuICAgIFwiKiogd2lsbCBzdGlsbCBiZSBzZW50IHRvIGFsbCBjbGllbnRzLlxcblwiICtcbiAgICBcIioqXFxuXCIgK1xuICAgIFwiKiogVHVybiBvZmYgYXV0b3B1Ymxpc2ggYnkgcmVtb3ZpbmcgdGhlIGF1dG9wdWJsaXNoIHBhY2thZ2U6XFxuXCIgK1xuICAgIFwiKipcXG5cIiArXG4gICAgXCIqKiAgICQgbWV0ZW9yIHJlbW92ZSBhdXRvcHVibGlzaFxcblwiICtcbiAgICBcIioqXFxuXCIgK1xuICAgIFwiKiogLi4gYW5kIG1ha2Ugc3VyZSB5b3UgaGF2ZSBNZXRlb3IucHVibGlzaCgpIGFuZCBNZXRlb3Iuc3Vic2NyaWJlKCkgY2FsbHNcXG5cIiArXG4gICAgXCIqKiBmb3IgZWFjaCBjb2xsZWN0aW9uIHRoYXQgeW91IHdhbnQgY2xpZW50cyB0byBzZWUuXFxuXCIpO1xuICAgICAgICB9XG4gICAgICB9XG5cbiAgICAgIGlmIChuYW1lKVxuICAgICAgICBzZWxmLnB1Ymxpc2hfaGFuZGxlcnNbbmFtZV0gPSBoYW5kbGVyO1xuICAgICAgZWxzZSB7XG4gICAgICAgIHNlbGYudW5pdmVyc2FsX3B1Ymxpc2hfaGFuZGxlcnMucHVzaChoYW5kbGVyKTtcbiAgICAgICAgLy8gU3BpbiB1cCB0aGUgbmV3IHB1Ymxpc2hlciBvbiBhbnkgZXhpc3Rpbmcgc2Vzc2lvbiB0b28uIFJ1biBlYWNoXG4gICAgICAgIC8vIHNlc3Npb24ncyBzdWJzY3JpcHRpb24gaW4gYSBuZXcgRmliZXIsIHNvIHRoYXQgdGhlcmUncyBubyBjaGFuZ2UgZm9yXG4gICAgICAgIC8vIHNlbGYuc2Vzc2lvbnMgdG8gY2hhbmdlIHdoaWxlIHdlJ3JlIHJ1bm5pbmcgdGhpcyBsb29wLlxuICAgICAgICBzZWxmLnNlc3Npb25zLmZvckVhY2goZnVuY3Rpb24gKHNlc3Npb24pIHtcbiAgICAgICAgICBpZiAoIXNlc3Npb24uX2RvbnRTdGFydE5ld1VuaXZlcnNhbFN1YnMpIHtcbiAgICAgICAgICAgIEZpYmVyKGZ1bmN0aW9uKCkge1xuICAgICAgICAgICAgICBzZXNzaW9uLl9zdGFydFN1YnNjcmlwdGlvbihoYW5kbGVyKTtcbiAgICAgICAgICAgIH0pLnJ1bigpO1xuICAgICAgICAgIH1cbiAgICAgICAgfSk7XG4gICAgICB9XG4gICAgfVxuICAgIGVsc2V7XG4gICAgICBfLmVhY2gobmFtZSwgZnVuY3Rpb24odmFsdWUsIGtleSkge1xuICAgICAgICBzZWxmLnB1Ymxpc2goa2V5LCB2YWx1ZSwge30pO1xuICAgICAgfSk7XG4gICAgfVxuICB9LFxuXG4gIF9yZW1vdmVTZXNzaW9uOiBmdW5jdGlvbiAoc2Vzc2lvbikge1xuICAgIHZhciBzZWxmID0gdGhpcztcbiAgICBzZWxmLnNlc3Npb25zLmRlbGV0ZShzZXNzaW9uLmlkKTtcbiAgfSxcblxuICAvKipcbiAgICogQHN1bW1hcnkgRGVmaW5lcyBmdW5jdGlvbnMgdGhhdCBjYW4gYmUgaW52b2tlZCBvdmVyIHRoZSBuZXR3b3JrIGJ5IGNsaWVudHMuXG4gICAqIEBsb2N1cyBBbnl3aGVyZVxuICAgKiBAcGFyYW0ge09iamVjdH0gbWV0aG9kcyBEaWN0aW9uYXJ5IHdob3NlIGtleXMgYXJlIG1ldGhvZCBuYW1lcyBhbmQgdmFsdWVzIGFyZSBmdW5jdGlvbnMuXG4gICAqIEBtZW1iZXJPZiBNZXRlb3JcbiAgICogQGltcG9ydEZyb21QYWNrYWdlIG1ldGVvclxuICAgKi9cbiAgbWV0aG9kczogZnVuY3Rpb24gKG1ldGhvZHMpIHtcbiAgICB2YXIgc2VsZiA9IHRoaXM7XG4gICAgXy5lYWNoKG1ldGhvZHMsIGZ1bmN0aW9uIChmdW5jLCBuYW1lKSB7XG4gICAgICBpZiAodHlwZW9mIGZ1bmMgIT09ICdmdW5jdGlvbicpXG4gICAgICAgIHRocm93IG5ldyBFcnJvcihcIk1ldGhvZCAnXCIgKyBuYW1lICsgXCInIG11c3QgYmUgYSBmdW5jdGlvblwiKTtcbiAgICAgIGlmIChzZWxmLm1ldGhvZF9oYW5kbGVyc1tuYW1lXSlcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKFwiQSBtZXRob2QgbmFtZWQgJ1wiICsgbmFtZSArIFwiJyBpcyBhbHJlYWR5IGRlZmluZWRcIik7XG4gICAgICBzZWxmLm1ldGhvZF9oYW5kbGVyc1tuYW1lXSA9IGZ1bmM7XG4gICAgfSk7XG4gIH0sXG5cbiAgY2FsbDogZnVuY3Rpb24gKG5hbWUsIC4uLmFyZ3MpIHtcbiAgICBpZiAoYXJncy5sZW5ndGggJiYgdHlwZW9mIGFyZ3NbYXJncy5sZW5ndGggLSAxXSA9PT0gXCJmdW5jdGlvblwiKSB7XG4gICAgICAvLyBJZiBpdCdzIGEgZnVuY3Rpb24sIHRoZSBsYXN0IGFyZ3VtZW50IGlzIHRoZSByZXN1bHQgY2FsbGJhY2ssIG5vdFxuICAgICAgLy8gYSBwYXJhbWV0ZXIgdG8gdGhlIHJlbW90ZSBtZXRob2QuXG4gICAgICB2YXIgY2FsbGJhY2sgPSBhcmdzLnBvcCgpO1xuICAgIH1cblxuICAgIHJldHVybiB0aGlzLmFwcGx5KG5hbWUsIGFyZ3MsIGNhbGxiYWNrKTtcbiAgfSxcblxuICAvLyBBIHZlcnNpb24gb2YgdGhlIGNhbGwgbWV0aG9kIHRoYXQgYWx3YXlzIHJldHVybnMgYSBQcm9taXNlLlxuICBjYWxsQXN5bmM6IGZ1bmN0aW9uIChuYW1lLCAuLi5hcmdzKSB7XG4gICAgcmV0dXJuIHRoaXMuYXBwbHlBc3luYyhuYW1lLCBhcmdzKTtcbiAgfSxcblxuICBhcHBseTogZnVuY3Rpb24gKG5hbWUsIGFyZ3MsIG9wdGlvbnMsIGNhbGxiYWNrKSB7XG4gICAgLy8gV2Ugd2VyZSBwYXNzZWQgMyBhcmd1bWVudHMuIFRoZXkgbWF5IGJlIGVpdGhlciAobmFtZSwgYXJncywgb3B0aW9ucylcbiAgICAvLyBvciAobmFtZSwgYXJncywgY2FsbGJhY2spXG4gICAgaWYgKCEgY2FsbGJhY2sgJiYgdHlwZW9mIG9wdGlvbnMgPT09ICdmdW5jdGlvbicpIHtcbiAgICAgIGNhbGxiYWNrID0gb3B0aW9ucztcbiAgICAgIG9wdGlvbnMgPSB7fTtcbiAgICB9IGVsc2Uge1xuICAgICAgb3B0aW9ucyA9IG9wdGlvbnMgfHwge307XG4gICAgfVxuXG4gICAgY29uc3QgcHJvbWlzZSA9IHRoaXMuYXBwbHlBc3luYyhuYW1lLCBhcmdzLCBvcHRpb25zKTtcblxuICAgIC8vIFJldHVybiB0aGUgcmVzdWx0IGluIHdoaWNoZXZlciB3YXkgdGhlIGNhbGxlciBhc2tlZCBmb3IgaXQuIE5vdGUgdGhhdCB3ZVxuICAgIC8vIGRvIE5PVCBibG9jayBvbiB0aGUgd3JpdGUgZmVuY2UgaW4gYW4gYW5hbG9nb3VzIHdheSB0byBob3cgdGhlIGNsaWVudFxuICAgIC8vIGJsb2NrcyBvbiB0aGUgcmVsZXZhbnQgZGF0YSBiZWluZyB2aXNpYmxlLCBzbyB5b3UgYXJlIE5PVCBndWFyYW50ZWVkIHRoYXRcbiAgICAvLyBjdXJzb3Igb2JzZXJ2ZSBjYWxsYmFja3MgaGF2ZSBmaXJlZCB3aGVuIHlvdXIgY2FsbGJhY2sgaXMgaW52b2tlZC4gKFdlXG4gICAgLy8gY2FuIGNoYW5nZSB0aGlzIGlmIHRoZXJlJ3MgYSByZWFsIHVzZSBjYXNlLilcbiAgICBpZiAoY2FsbGJhY2spIHtcbiAgICAgIHByb21pc2UudGhlbihcbiAgICAgICAgcmVzdWx0ID0+IGNhbGxiYWNrKHVuZGVmaW5lZCwgcmVzdWx0KSxcbiAgICAgICAgZXhjZXB0aW9uID0+IGNhbGxiYWNrKGV4Y2VwdGlvbilcbiAgICAgICk7XG4gICAgfSBlbHNlIHtcbiAgICAgIHJldHVybiBwcm9taXNlLmF3YWl0KCk7XG4gICAgfVxuICB9LFxuXG4gIC8vIEBwYXJhbSBvcHRpb25zIHtPcHRpb25hbCBPYmplY3R9XG4gIGFwcGx5QXN5bmM6IGZ1bmN0aW9uIChuYW1lLCBhcmdzLCBvcHRpb25zKSB7XG4gICAgLy8gUnVuIHRoZSBoYW5kbGVyXG4gICAgdmFyIGhhbmRsZXIgPSB0aGlzLm1ldGhvZF9oYW5kbGVyc1tuYW1lXTtcbiAgICBpZiAoISBoYW5kbGVyKSB7XG4gICAgICByZXR1cm4gUHJvbWlzZS5yZWplY3QoXG4gICAgICAgIG5ldyBNZXRlb3IuRXJyb3IoNDA0LCBgTWV0aG9kICcke25hbWV9JyBub3QgZm91bmRgKVxuICAgICAgKTtcbiAgICB9XG5cbiAgICAvLyBJZiB0aGlzIGlzIGEgbWV0aG9kIGNhbGwgZnJvbSB3aXRoaW4gYW5vdGhlciBtZXRob2Qgb3IgcHVibGlzaCBmdW5jdGlvbixcbiAgICAvLyBnZXQgdGhlIHVzZXIgc3RhdGUgZnJvbSB0aGUgb3V0ZXIgbWV0aG9kIG9yIHB1Ymxpc2ggZnVuY3Rpb24sIG90aGVyd2lzZVxuICAgIC8vIGRvbid0IGFsbG93IHNldFVzZXJJZCB0byBiZSBjYWxsZWRcbiAgICB2YXIgdXNlcklkID0gbnVsbDtcbiAgICB2YXIgc2V0VXNlcklkID0gZnVuY3Rpb24oKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXCJDYW4ndCBjYWxsIHNldFVzZXJJZCBvbiBhIHNlcnZlciBpbml0aWF0ZWQgbWV0aG9kIGNhbGxcIik7XG4gICAgfTtcbiAgICB2YXIgY29ubmVjdGlvbiA9IG51bGw7XG4gICAgdmFyIGN1cnJlbnRNZXRob2RJbnZvY2F0aW9uID0gRERQLl9DdXJyZW50TWV0aG9kSW52b2NhdGlvbi5nZXQoKTtcbiAgICB2YXIgY3VycmVudFB1YmxpY2F0aW9uSW52b2NhdGlvbiA9IEREUC5fQ3VycmVudFB1YmxpY2F0aW9uSW52b2NhdGlvbi5nZXQoKTtcbiAgICB2YXIgcmFuZG9tU2VlZCA9IG51bGw7XG4gICAgaWYgKGN1cnJlbnRNZXRob2RJbnZvY2F0aW9uKSB7XG4gICAgICB1c2VySWQgPSBjdXJyZW50TWV0aG9kSW52b2NhdGlvbi51c2VySWQ7XG4gICAgICBzZXRVc2VySWQgPSBmdW5jdGlvbih1c2VySWQpIHtcbiAgICAgICAgY3VycmVudE1ldGhvZEludm9jYXRpb24uc2V0VXNlcklkKHVzZXJJZCk7XG4gICAgICB9O1xuICAgICAgY29ubmVjdGlvbiA9IGN1cnJlbnRNZXRob2RJbnZvY2F0aW9uLmNvbm5lY3Rpb247XG4gICAgICByYW5kb21TZWVkID0gRERQQ29tbW9uLm1ha2VScGNTZWVkKGN1cnJlbnRNZXRob2RJbnZvY2F0aW9uLCBuYW1lKTtcbiAgICB9IGVsc2UgaWYgKGN1cnJlbnRQdWJsaWNhdGlvbkludm9jYXRpb24pIHtcbiAgICAgIHVzZXJJZCA9IGN1cnJlbnRQdWJsaWNhdGlvbkludm9jYXRpb24udXNlcklkO1xuICAgICAgc2V0VXNlcklkID0gZnVuY3Rpb24odXNlcklkKSB7XG4gICAgICAgIGN1cnJlbnRQdWJsaWNhdGlvbkludm9jYXRpb24uX3Nlc3Npb24uX3NldFVzZXJJZCh1c2VySWQpO1xuICAgICAgfTtcbiAgICAgIGNvbm5lY3Rpb24gPSBjdXJyZW50UHVibGljYXRpb25JbnZvY2F0aW9uLmNvbm5lY3Rpb247XG4gICAgfVxuXG4gICAgdmFyIGludm9jYXRpb24gPSBuZXcgRERQQ29tbW9uLk1ldGhvZEludm9jYXRpb24oe1xuICAgICAgaXNTaW11bGF0aW9uOiBmYWxzZSxcbiAgICAgIHVzZXJJZCxcbiAgICAgIHNldFVzZXJJZCxcbiAgICAgIGNvbm5lY3Rpb24sXG4gICAgICByYW5kb21TZWVkXG4gICAgfSk7XG5cbiAgICByZXR1cm4gbmV3IFByb21pc2UocmVzb2x2ZSA9PiByZXNvbHZlKFxuICAgICAgRERQLl9DdXJyZW50TWV0aG9kSW52b2NhdGlvbi53aXRoVmFsdWUoXG4gICAgICAgIGludm9jYXRpb24sXG4gICAgICAgICgpID0+IG1heWJlQXVkaXRBcmd1bWVudENoZWNrcyhcbiAgICAgICAgICBoYW5kbGVyLCBpbnZvY2F0aW9uLCBFSlNPTi5jbG9uZShhcmdzKSxcbiAgICAgICAgICBcImludGVybmFsIGNhbGwgdG8gJ1wiICsgbmFtZSArIFwiJ1wiXG4gICAgICAgIClcbiAgICAgIClcbiAgICApKS50aGVuKEVKU09OLmNsb25lKTtcbiAgfSxcblxuICBfdXJsRm9yU2Vzc2lvbjogZnVuY3Rpb24gKHNlc3Npb25JZCkge1xuICAgIHZhciBzZWxmID0gdGhpcztcbiAgICB2YXIgc2Vzc2lvbiA9IHNlbGYuc2Vzc2lvbnMuZ2V0KHNlc3Npb25JZCk7XG4gICAgaWYgKHNlc3Npb24pXG4gICAgICByZXR1cm4gc2Vzc2lvbi5fc29ja2V0VXJsO1xuICAgIGVsc2VcbiAgICAgIHJldHVybiBudWxsO1xuICB9XG59KTtcblxudmFyIGNhbGN1bGF0ZVZlcnNpb24gPSBmdW5jdGlvbiAoY2xpZW50U3VwcG9ydGVkVmVyc2lvbnMsXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBzZXJ2ZXJTdXBwb3J0ZWRWZXJzaW9ucykge1xuICB2YXIgY29ycmVjdFZlcnNpb24gPSBfLmZpbmQoY2xpZW50U3VwcG9ydGVkVmVyc2lvbnMsIGZ1bmN0aW9uICh2ZXJzaW9uKSB7XG4gICAgcmV0dXJuIF8uY29udGFpbnMoc2VydmVyU3VwcG9ydGVkVmVyc2lvbnMsIHZlcnNpb24pO1xuICB9KTtcbiAgaWYgKCFjb3JyZWN0VmVyc2lvbikge1xuICAgIGNvcnJlY3RWZXJzaW9uID0gc2VydmVyU3VwcG9ydGVkVmVyc2lvbnNbMF07XG4gIH1cbiAgcmV0dXJuIGNvcnJlY3RWZXJzaW9uO1xufTtcblxuRERQU2VydmVyLl9jYWxjdWxhdGVWZXJzaW9uID0gY2FsY3VsYXRlVmVyc2lvbjtcblxuXG4vLyBcImJsaW5kXCIgZXhjZXB0aW9ucyBvdGhlciB0aGFuIHRob3NlIHRoYXQgd2VyZSBkZWxpYmVyYXRlbHkgdGhyb3duIHRvIHNpZ25hbFxuLy8gZXJyb3JzIHRvIHRoZSBjbGllbnRcbnZhciB3cmFwSW50ZXJuYWxFeGNlcHRpb24gPSBmdW5jdGlvbiAoZXhjZXB0aW9uLCBjb250ZXh0KSB7XG4gIGlmICghZXhjZXB0aW9uKSByZXR1cm4gZXhjZXB0aW9uO1xuXG4gIC8vIFRvIGFsbG93IHBhY2thZ2VzIHRvIHRocm93IGVycm9ycyBpbnRlbmRlZCBmb3IgdGhlIGNsaWVudCBidXQgbm90IGhhdmUgdG9cbiAgLy8gZGVwZW5kIG9uIHRoZSBNZXRlb3IuRXJyb3IgY2xhc3MsIGBpc0NsaWVudFNhZmVgIGNhbiBiZSBzZXQgdG8gdHJ1ZSBvbiBhbnlcbiAgLy8gZXJyb3IgYmVmb3JlIGl0IGlzIHRocm93bi5cbiAgaWYgKGV4Y2VwdGlvbi5pc0NsaWVudFNhZmUpIHtcbiAgICBpZiAoIShleGNlcHRpb24gaW5zdGFuY2VvZiBNZXRlb3IuRXJyb3IpKSB7XG4gICAgICBjb25zdCBvcmlnaW5hbE1lc3NhZ2UgPSBleGNlcHRpb24ubWVzc2FnZTtcbiAgICAgIGV4Y2VwdGlvbiA9IG5ldyBNZXRlb3IuRXJyb3IoZXhjZXB0aW9uLmVycm9yLCBleGNlcHRpb24ucmVhc29uLCBleGNlcHRpb24uZGV0YWlscyk7XG4gICAgICBleGNlcHRpb24ubWVzc2FnZSA9IG9yaWdpbmFsTWVzc2FnZTtcbiAgICB9XG4gICAgcmV0dXJuIGV4Y2VwdGlvbjtcbiAgfVxuXG4gIC8vIFRlc3RzIGNhbiBzZXQgdGhlICdfZXhwZWN0ZWRCeVRlc3QnIGZsYWcgb24gYW4gZXhjZXB0aW9uIHNvIGl0IHdvbid0IGdvIHRvXG4gIC8vIHRoZSBzZXJ2ZXIgbG9nLlxuICBpZiAoIWV4Y2VwdGlvbi5fZXhwZWN0ZWRCeVRlc3QpIHtcbiAgICBNZXRlb3IuX2RlYnVnKFwiRXhjZXB0aW9uIFwiICsgY29udGV4dCwgZXhjZXB0aW9uLnN0YWNrKTtcbiAgICBpZiAoZXhjZXB0aW9uLnNhbml0aXplZEVycm9yKSB7XG4gICAgICBNZXRlb3IuX2RlYnVnKFwiU2FuaXRpemVkIGFuZCByZXBvcnRlZCB0byB0aGUgY2xpZW50IGFzOlwiLCBleGNlcHRpb24uc2FuaXRpemVkRXJyb3IpO1xuICAgICAgTWV0ZW9yLl9kZWJ1ZygpO1xuICAgIH1cbiAgfVxuXG4gIC8vIERpZCB0aGUgZXJyb3IgY29udGFpbiBtb3JlIGRldGFpbHMgdGhhdCBjb3VsZCBoYXZlIGJlZW4gdXNlZnVsIGlmIGNhdWdodCBpblxuICAvLyBzZXJ2ZXIgY29kZSAob3IgaWYgdGhyb3duIGZyb20gbm9uLWNsaWVudC1vcmlnaW5hdGVkIGNvZGUpLCBidXQgYWxzb1xuICAvLyBwcm92aWRlZCBhIFwic2FuaXRpemVkXCIgdmVyc2lvbiB3aXRoIG1vcmUgY29udGV4dCB0aGFuIDUwMCBJbnRlcm5hbCBzZXJ2ZXJcbiAgLy8gZXJyb3I/IFVzZSB0aGF0LlxuICBpZiAoZXhjZXB0aW9uLnNhbml0aXplZEVycm9yKSB7XG4gICAgaWYgKGV4Y2VwdGlvbi5zYW5pdGl6ZWRFcnJvci5pc0NsaWVudFNhZmUpXG4gICAgICByZXR1cm4gZXhjZXB0aW9uLnNhbml0aXplZEVycm9yO1xuICAgIE1ldGVvci5fZGVidWcoXCJFeGNlcHRpb24gXCIgKyBjb250ZXh0ICsgXCIgcHJvdmlkZXMgYSBzYW5pdGl6ZWRFcnJvciB0aGF0IFwiICtcbiAgICAgICAgICAgICAgICAgIFwiZG9lcyBub3QgaGF2ZSBpc0NsaWVudFNhZmUgcHJvcGVydHkgc2V0OyBpZ25vcmluZ1wiKTtcbiAgfVxuXG4gIHJldHVybiBuZXcgTWV0ZW9yLkVycm9yKDUwMCwgXCJJbnRlcm5hbCBzZXJ2ZXIgZXJyb3JcIik7XG59O1xuXG5cbi8vIEF1ZGl0IGFyZ3VtZW50IGNoZWNrcywgaWYgdGhlIGF1ZGl0LWFyZ3VtZW50LWNoZWNrcyBwYWNrYWdlIGV4aXN0cyAoaXQgaXMgYVxuLy8gd2VhayBkZXBlbmRlbmN5IG9mIHRoaXMgcGFja2FnZSkuXG52YXIgbWF5YmVBdWRpdEFyZ3VtZW50Q2hlY2tzID0gZnVuY3Rpb24gKGYsIGNvbnRleHQsIGFyZ3MsIGRlc2NyaXB0aW9uKSB7XG4gIGFyZ3MgPSBhcmdzIHx8IFtdO1xuICBpZiAoUGFja2FnZVsnYXVkaXQtYXJndW1lbnQtY2hlY2tzJ10pIHtcbiAgICByZXR1cm4gTWF0Y2guX2ZhaWxJZkFyZ3VtZW50c0FyZU5vdEFsbENoZWNrZWQoXG4gICAgICBmLCBjb250ZXh0LCBhcmdzLCBkZXNjcmlwdGlvbik7XG4gIH1cbiAgcmV0dXJuIGYuYXBwbHkoY29udGV4dCwgYXJncyk7XG59O1xuIiwidmFyIEZ1dHVyZSA9IE5wbS5yZXF1aXJlKCdmaWJlcnMvZnV0dXJlJyk7XG5cbi8vIEEgd3JpdGUgZmVuY2UgY29sbGVjdHMgYSBncm91cCBvZiB3cml0ZXMsIGFuZCBwcm92aWRlcyBhIGNhbGxiYWNrXG4vLyB3aGVuIGFsbCBvZiB0aGUgd3JpdGVzIGFyZSBmdWxseSBjb21taXR0ZWQgYW5kIHByb3BhZ2F0ZWQgKGFsbFxuLy8gb2JzZXJ2ZXJzIGhhdmUgYmVlbiBub3RpZmllZCBvZiB0aGUgd3JpdGUgYW5kIGFja25vd2xlZGdlZCBpdC4pXG4vL1xuRERQU2VydmVyLl9Xcml0ZUZlbmNlID0gZnVuY3Rpb24gKCkge1xuICB2YXIgc2VsZiA9IHRoaXM7XG5cbiAgc2VsZi5hcm1lZCA9IGZhbHNlO1xuICBzZWxmLmZpcmVkID0gZmFsc2U7XG4gIHNlbGYucmV0aXJlZCA9IGZhbHNlO1xuICBzZWxmLm91dHN0YW5kaW5nX3dyaXRlcyA9IDA7XG4gIHNlbGYuYmVmb3JlX2ZpcmVfY2FsbGJhY2tzID0gW107XG4gIHNlbGYuY29tcGxldGlvbl9jYWxsYmFja3MgPSBbXTtcbn07XG5cbi8vIFRoZSBjdXJyZW50IHdyaXRlIGZlbmNlLiBXaGVuIHRoZXJlIGlzIGEgY3VycmVudCB3cml0ZSBmZW5jZSwgY29kZVxuLy8gdGhhdCB3cml0ZXMgdG8gZGF0YWJhc2VzIHNob3VsZCByZWdpc3RlciB0aGVpciB3cml0ZXMgd2l0aCBpdCB1c2luZ1xuLy8gYmVnaW5Xcml0ZSgpLlxuLy9cbkREUFNlcnZlci5fQ3VycmVudFdyaXRlRmVuY2UgPSBuZXcgTWV0ZW9yLkVudmlyb25tZW50VmFyaWFibGU7XG5cbl8uZXh0ZW5kKEREUFNlcnZlci5fV3JpdGVGZW5jZS5wcm90b3R5cGUsIHtcbiAgLy8gU3RhcnQgdHJhY2tpbmcgYSB3cml0ZSwgYW5kIHJldHVybiBhbiBvYmplY3QgdG8gcmVwcmVzZW50IGl0LiBUaGVcbiAgLy8gb2JqZWN0IGhhcyBhIHNpbmdsZSBtZXRob2QsIGNvbW1pdHRlZCgpLiBUaGlzIG1ldGhvZCBzaG91bGQgYmVcbiAgLy8gY2FsbGVkIHdoZW4gdGhlIHdyaXRlIGlzIGZ1bGx5IGNvbW1pdHRlZCBhbmQgcHJvcGFnYXRlZC4gWW91IGNhblxuICAvLyBjb250aW51ZSB0byBhZGQgd3JpdGVzIHRvIHRoZSBXcml0ZUZlbmNlIHVwIHVudGlsIGl0IGlzIHRyaWdnZXJlZFxuICAvLyAoY2FsbHMgaXRzIGNhbGxiYWNrcyBiZWNhdXNlIGFsbCB3cml0ZXMgaGF2ZSBjb21taXR0ZWQuKVxuICBiZWdpbldyaXRlOiBmdW5jdGlvbiAoKSB7XG4gICAgdmFyIHNlbGYgPSB0aGlzO1xuXG4gICAgaWYgKHNlbGYucmV0aXJlZClcbiAgICAgIHJldHVybiB7IGNvbW1pdHRlZDogZnVuY3Rpb24gKCkge30gfTtcblxuICAgIGlmIChzZWxmLmZpcmVkKVxuICAgICAgdGhyb3cgbmV3IEVycm9yKFwiZmVuY2UgaGFzIGFscmVhZHkgYWN0aXZhdGVkIC0tIHRvbyBsYXRlIHRvIGFkZCB3cml0ZXNcIik7XG5cbiAgICBzZWxmLm91dHN0YW5kaW5nX3dyaXRlcysrO1xuICAgIHZhciBjb21taXR0ZWQgPSBmYWxzZTtcbiAgICByZXR1cm4ge1xuICAgICAgY29tbWl0dGVkOiBmdW5jdGlvbiAoKSB7XG4gICAgICAgIGlmIChjb21taXR0ZWQpXG4gICAgICAgICAgdGhyb3cgbmV3IEVycm9yKFwiY29tbWl0dGVkIGNhbGxlZCB0d2ljZSBvbiB0aGUgc2FtZSB3cml0ZVwiKTtcbiAgICAgICAgY29tbWl0dGVkID0gdHJ1ZTtcbiAgICAgICAgc2VsZi5vdXRzdGFuZGluZ193cml0ZXMtLTtcbiAgICAgICAgc2VsZi5fbWF5YmVGaXJlKCk7XG4gICAgICB9XG4gICAgfTtcbiAgfSxcblxuICAvLyBBcm0gdGhlIGZlbmNlLiBPbmNlIHRoZSBmZW5jZSBpcyBhcm1lZCwgYW5kIHRoZXJlIGFyZSBubyBtb3JlXG4gIC8vIHVuY29tbWl0dGVkIHdyaXRlcywgaXQgd2lsbCBhY3RpdmF0ZS5cbiAgYXJtOiBmdW5jdGlvbiAoKSB7XG4gICAgdmFyIHNlbGYgPSB0aGlzO1xuICAgIGlmIChzZWxmID09PSBERFBTZXJ2ZXIuX0N1cnJlbnRXcml0ZUZlbmNlLmdldCgpKVxuICAgICAgdGhyb3cgRXJyb3IoXCJDYW4ndCBhcm0gdGhlIGN1cnJlbnQgZmVuY2VcIik7XG4gICAgc2VsZi5hcm1lZCA9IHRydWU7XG4gICAgc2VsZi5fbWF5YmVGaXJlKCk7XG4gIH0sXG5cbiAgLy8gUmVnaXN0ZXIgYSBmdW5jdGlvbiB0byBiZSBjYWxsZWQgb25jZSBiZWZvcmUgZmlyaW5nIHRoZSBmZW5jZS5cbiAgLy8gQ2FsbGJhY2sgZnVuY3Rpb24gY2FuIGFkZCBuZXcgd3JpdGVzIHRvIHRoZSBmZW5jZSwgaW4gd2hpY2ggY2FzZVxuICAvLyBpdCB3b24ndCBmaXJlIHVudGlsIHRob3NlIHdyaXRlcyBhcmUgZG9uZSBhcyB3ZWxsLlxuICBvbkJlZm9yZUZpcmU6IGZ1bmN0aW9uIChmdW5jKSB7XG4gICAgdmFyIHNlbGYgPSB0aGlzO1xuICAgIGlmIChzZWxmLmZpcmVkKVxuICAgICAgdGhyb3cgbmV3IEVycm9yKFwiZmVuY2UgaGFzIGFscmVhZHkgYWN0aXZhdGVkIC0tIHRvbyBsYXRlIHRvIFwiICtcbiAgICAgICAgICAgICAgICAgICAgICBcImFkZCBhIGNhbGxiYWNrXCIpO1xuICAgIHNlbGYuYmVmb3JlX2ZpcmVfY2FsbGJhY2tzLnB1c2goZnVuYyk7XG4gIH0sXG5cbiAgLy8gUmVnaXN0ZXIgYSBmdW5jdGlvbiB0byBiZSBjYWxsZWQgd2hlbiB0aGUgZmVuY2UgZmlyZXMuXG4gIG9uQWxsQ29tbWl0dGVkOiBmdW5jdGlvbiAoZnVuYykge1xuICAgIHZhciBzZWxmID0gdGhpcztcbiAgICBpZiAoc2VsZi5maXJlZClcbiAgICAgIHRocm93IG5ldyBFcnJvcihcImZlbmNlIGhhcyBhbHJlYWR5IGFjdGl2YXRlZCAtLSB0b28gbGF0ZSB0byBcIiArXG4gICAgICAgICAgICAgICAgICAgICAgXCJhZGQgYSBjYWxsYmFja1wiKTtcbiAgICBzZWxmLmNvbXBsZXRpb25fY2FsbGJhY2tzLnB1c2goZnVuYyk7XG4gIH0sXG5cbiAgLy8gQ29udmVuaWVuY2UgZnVuY3Rpb24uIEFybXMgdGhlIGZlbmNlLCB0aGVuIGJsb2NrcyB1bnRpbCBpdCBmaXJlcy5cbiAgYXJtQW5kV2FpdDogZnVuY3Rpb24gKCkge1xuICAgIHZhciBzZWxmID0gdGhpcztcbiAgICB2YXIgZnV0dXJlID0gbmV3IEZ1dHVyZTtcbiAgICBzZWxmLm9uQWxsQ29tbWl0dGVkKGZ1bmN0aW9uICgpIHtcbiAgICAgIGZ1dHVyZVsncmV0dXJuJ10oKTtcbiAgICB9KTtcbiAgICBzZWxmLmFybSgpO1xuICAgIGZ1dHVyZS53YWl0KCk7XG4gIH0sXG5cbiAgX21heWJlRmlyZTogZnVuY3Rpb24gKCkge1xuICAgIHZhciBzZWxmID0gdGhpcztcbiAgICBpZiAoc2VsZi5maXJlZClcbiAgICAgIHRocm93IG5ldyBFcnJvcihcIndyaXRlIGZlbmNlIGFscmVhZHkgYWN0aXZhdGVkP1wiKTtcbiAgICBpZiAoc2VsZi5hcm1lZCAmJiAhc2VsZi5vdXRzdGFuZGluZ193cml0ZXMpIHtcbiAgICAgIGZ1bmN0aW9uIGludm9rZUNhbGxiYWNrIChmdW5jKSB7XG4gICAgICAgIHRyeSB7XG4gICAgICAgICAgZnVuYyhzZWxmKTtcbiAgICAgICAgfSBjYXRjaCAoZXJyKSB7XG4gICAgICAgICAgTWV0ZW9yLl9kZWJ1ZyhcImV4Y2VwdGlvbiBpbiB3cml0ZSBmZW5jZSBjYWxsYmFja1wiLCBlcnIpO1xuICAgICAgICB9XG4gICAgICB9XG5cbiAgICAgIHNlbGYub3V0c3RhbmRpbmdfd3JpdGVzKys7XG4gICAgICB3aGlsZSAoc2VsZi5iZWZvcmVfZmlyZV9jYWxsYmFja3MubGVuZ3RoID4gMCkge1xuICAgICAgICB2YXIgY2FsbGJhY2tzID0gc2VsZi5iZWZvcmVfZmlyZV9jYWxsYmFja3M7XG4gICAgICAgIHNlbGYuYmVmb3JlX2ZpcmVfY2FsbGJhY2tzID0gW107XG4gICAgICAgIF8uZWFjaChjYWxsYmFja3MsIGludm9rZUNhbGxiYWNrKTtcbiAgICAgIH1cbiAgICAgIHNlbGYub3V0c3RhbmRpbmdfd3JpdGVzLS07XG5cbiAgICAgIGlmICghc2VsZi5vdXRzdGFuZGluZ193cml0ZXMpIHtcbiAgICAgICAgc2VsZi5maXJlZCA9IHRydWU7XG4gICAgICAgIHZhciBjYWxsYmFja3MgPSBzZWxmLmNvbXBsZXRpb25fY2FsbGJhY2tzO1xuICAgICAgICBzZWxmLmNvbXBsZXRpb25fY2FsbGJhY2tzID0gW107XG4gICAgICAgIF8uZWFjaChjYWxsYmFja3MsIGludm9rZUNhbGxiYWNrKTtcbiAgICAgIH1cbiAgICB9XG4gIH0sXG5cbiAgLy8gRGVhY3RpdmF0ZSB0aGlzIGZlbmNlIHNvIHRoYXQgYWRkaW5nIG1vcmUgd3JpdGVzIGhhcyBubyBlZmZlY3QuXG4gIC8vIFRoZSBmZW5jZSBtdXN0IGhhdmUgYWxyZWFkeSBmaXJlZC5cbiAgcmV0aXJlOiBmdW5jdGlvbiAoKSB7XG4gICAgdmFyIHNlbGYgPSB0aGlzO1xuICAgIGlmICghIHNlbGYuZmlyZWQpXG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXCJDYW4ndCByZXRpcmUgYSBmZW5jZSB0aGF0IGhhc24ndCBmaXJlZC5cIik7XG4gICAgc2VsZi5yZXRpcmVkID0gdHJ1ZTtcbiAgfVxufSk7XG4iLCIvLyBBIFwiY3Jvc3NiYXJcIiBpcyBhIGNsYXNzIHRoYXQgcHJvdmlkZXMgc3RydWN0dXJlZCBub3RpZmljYXRpb24gcmVnaXN0cmF0aW9uLlxuLy8gU2VlIF9tYXRjaCBmb3IgdGhlIGRlZmluaXRpb24gb2YgaG93IGEgbm90aWZpY2F0aW9uIG1hdGNoZXMgYSB0cmlnZ2VyLlxuLy8gQWxsIG5vdGlmaWNhdGlvbnMgYW5kIHRyaWdnZXJzIG11c3QgaGF2ZSBhIHN0cmluZyBrZXkgbmFtZWQgJ2NvbGxlY3Rpb24nLlxuXG5ERFBTZXJ2ZXIuX0Nyb3NzYmFyID0gZnVuY3Rpb24gKG9wdGlvbnMpIHtcbiAgdmFyIHNlbGYgPSB0aGlzO1xuICBvcHRpb25zID0gb3B0aW9ucyB8fCB7fTtcblxuICBzZWxmLm5leHRJZCA9IDE7XG4gIC8vIG1hcCBmcm9tIGNvbGxlY3Rpb24gbmFtZSAoc3RyaW5nKSAtPiBsaXN0ZW5lciBpZCAtPiBvYmplY3QuIGVhY2ggb2JqZWN0IGhhc1xuICAvLyBrZXlzICd0cmlnZ2VyJywgJ2NhbGxiYWNrJy4gIEFzIGEgaGFjaywgdGhlIGVtcHR5IHN0cmluZyBtZWFucyBcIm5vXG4gIC8vIGNvbGxlY3Rpb25cIi5cbiAgc2VsZi5saXN0ZW5lcnNCeUNvbGxlY3Rpb24gPSB7fTtcbiAgc2VsZi5saXN0ZW5lcnNCeUNvbGxlY3Rpb25Db3VudCA9IHt9O1xuICBzZWxmLmZhY3RQYWNrYWdlID0gb3B0aW9ucy5mYWN0UGFja2FnZSB8fCBcImxpdmVkYXRhXCI7XG4gIHNlbGYuZmFjdE5hbWUgPSBvcHRpb25zLmZhY3ROYW1lIHx8IG51bGw7XG59O1xuXG5fLmV4dGVuZChERFBTZXJ2ZXIuX0Nyb3NzYmFyLnByb3RvdHlwZSwge1xuICAvLyBtc2cgaXMgYSB0cmlnZ2VyIG9yIGEgbm90aWZpY2F0aW9uXG4gIF9jb2xsZWN0aW9uRm9yTWVzc2FnZTogZnVuY3Rpb24gKG1zZykge1xuICAgIHZhciBzZWxmID0gdGhpcztcbiAgICBpZiAoISBfLmhhcyhtc2csICdjb2xsZWN0aW9uJykpIHtcbiAgICAgIHJldHVybiAnJztcbiAgICB9IGVsc2UgaWYgKHR5cGVvZihtc2cuY29sbGVjdGlvbikgPT09ICdzdHJpbmcnKSB7XG4gICAgICBpZiAobXNnLmNvbGxlY3Rpb24gPT09ICcnKVxuICAgICAgICB0aHJvdyBFcnJvcihcIk1lc3NhZ2UgaGFzIGVtcHR5IGNvbGxlY3Rpb24hXCIpO1xuICAgICAgcmV0dXJuIG1zZy5jb2xsZWN0aW9uO1xuICAgIH0gZWxzZSB7XG4gICAgICB0aHJvdyBFcnJvcihcIk1lc3NhZ2UgaGFzIG5vbi1zdHJpbmcgY29sbGVjdGlvbiFcIik7XG4gICAgfVxuICB9LFxuXG4gIC8vIExpc3RlbiBmb3Igbm90aWZpY2F0aW9uIHRoYXQgbWF0Y2ggJ3RyaWdnZXInLiBBIG5vdGlmaWNhdGlvblxuICAvLyBtYXRjaGVzIGlmIGl0IGhhcyB0aGUga2V5LXZhbHVlIHBhaXJzIGluIHRyaWdnZXIgYXMgYVxuICAvLyBzdWJzZXQuIFdoZW4gYSBub3RpZmljYXRpb24gbWF0Y2hlcywgY2FsbCAnY2FsbGJhY2snLCBwYXNzaW5nXG4gIC8vIHRoZSBhY3R1YWwgbm90aWZpY2F0aW9uLlxuICAvL1xuICAvLyBSZXR1cm5zIGEgbGlzdGVuIGhhbmRsZSwgd2hpY2ggaXMgYW4gb2JqZWN0IHdpdGggYSBtZXRob2RcbiAgLy8gc3RvcCgpLiBDYWxsIHN0b3AoKSB0byBzdG9wIGxpc3RlbmluZy5cbiAgLy9cbiAgLy8gWFhYIEl0IHNob3VsZCBiZSBsZWdhbCB0byBjYWxsIGZpcmUoKSBmcm9tIGluc2lkZSBhIGxpc3RlbigpXG4gIC8vIGNhbGxiYWNrP1xuICBsaXN0ZW46IGZ1bmN0aW9uICh0cmlnZ2VyLCBjYWxsYmFjaykge1xuICAgIHZhciBzZWxmID0gdGhpcztcbiAgICB2YXIgaWQgPSBzZWxmLm5leHRJZCsrO1xuXG4gICAgdmFyIGNvbGxlY3Rpb24gPSBzZWxmLl9jb2xsZWN0aW9uRm9yTWVzc2FnZSh0cmlnZ2VyKTtcbiAgICB2YXIgcmVjb3JkID0ge3RyaWdnZXI6IEVKU09OLmNsb25lKHRyaWdnZXIpLCBjYWxsYmFjazogY2FsbGJhY2t9O1xuICAgIGlmICghIF8uaGFzKHNlbGYubGlzdGVuZXJzQnlDb2xsZWN0aW9uLCBjb2xsZWN0aW9uKSkge1xuICAgICAgc2VsZi5saXN0ZW5lcnNCeUNvbGxlY3Rpb25bY29sbGVjdGlvbl0gPSB7fTtcbiAgICAgIHNlbGYubGlzdGVuZXJzQnlDb2xsZWN0aW9uQ291bnRbY29sbGVjdGlvbl0gPSAwO1xuICAgIH1cbiAgICBzZWxmLmxpc3RlbmVyc0J5Q29sbGVjdGlvbltjb2xsZWN0aW9uXVtpZF0gPSByZWNvcmQ7XG4gICAgc2VsZi5saXN0ZW5lcnNCeUNvbGxlY3Rpb25Db3VudFtjb2xsZWN0aW9uXSsrO1xuXG4gICAgaWYgKHNlbGYuZmFjdE5hbWUgJiYgUGFja2FnZVsnZmFjdHMtYmFzZSddKSB7XG4gICAgICBQYWNrYWdlWydmYWN0cy1iYXNlJ10uRmFjdHMuaW5jcmVtZW50U2VydmVyRmFjdChcbiAgICAgICAgc2VsZi5mYWN0UGFja2FnZSwgc2VsZi5mYWN0TmFtZSwgMSk7XG4gICAgfVxuXG4gICAgcmV0dXJuIHtcbiAgICAgIHN0b3A6IGZ1bmN0aW9uICgpIHtcbiAgICAgICAgaWYgKHNlbGYuZmFjdE5hbWUgJiYgUGFja2FnZVsnZmFjdHMtYmFzZSddKSB7XG4gICAgICAgICAgUGFja2FnZVsnZmFjdHMtYmFzZSddLkZhY3RzLmluY3JlbWVudFNlcnZlckZhY3QoXG4gICAgICAgICAgICBzZWxmLmZhY3RQYWNrYWdlLCBzZWxmLmZhY3ROYW1lLCAtMSk7XG4gICAgICAgIH1cbiAgICAgICAgZGVsZXRlIHNlbGYubGlzdGVuZXJzQnlDb2xsZWN0aW9uW2NvbGxlY3Rpb25dW2lkXTtcbiAgICAgICAgc2VsZi5saXN0ZW5lcnNCeUNvbGxlY3Rpb25Db3VudFtjb2xsZWN0aW9uXS0tO1xuICAgICAgICBpZiAoc2VsZi5saXN0ZW5lcnNCeUNvbGxlY3Rpb25Db3VudFtjb2xsZWN0aW9uXSA9PT0gMCkge1xuICAgICAgICAgIGRlbGV0ZSBzZWxmLmxpc3RlbmVyc0J5Q29sbGVjdGlvbltjb2xsZWN0aW9uXTtcbiAgICAgICAgICBkZWxldGUgc2VsZi5saXN0ZW5lcnNCeUNvbGxlY3Rpb25Db3VudFtjb2xsZWN0aW9uXTtcbiAgICAgICAgfVxuICAgICAgfVxuICAgIH07XG4gIH0sXG5cbiAgLy8gRmlyZSB0aGUgcHJvdmlkZWQgJ25vdGlmaWNhdGlvbicgKGFuIG9iamVjdCB3aG9zZSBhdHRyaWJ1dGVcbiAgLy8gdmFsdWVzIGFyZSBhbGwgSlNPTi1jb21wYXRpYmlsZSkgLS0gaW5mb3JtIGFsbCBtYXRjaGluZyBsaXN0ZW5lcnNcbiAgLy8gKHJlZ2lzdGVyZWQgd2l0aCBsaXN0ZW4oKSkuXG4gIC8vXG4gIC8vIElmIGZpcmUoKSBpcyBjYWxsZWQgaW5zaWRlIGEgd3JpdGUgZmVuY2UsIHRoZW4gZWFjaCBvZiB0aGVcbiAgLy8gbGlzdGVuZXIgY2FsbGJhY2tzIHdpbGwgYmUgY2FsbGVkIGluc2lkZSB0aGUgd3JpdGUgZmVuY2UgYXMgd2VsbC5cbiAgLy9cbiAgLy8gVGhlIGxpc3RlbmVycyBtYXkgYmUgaW52b2tlZCBpbiBwYXJhbGxlbCwgcmF0aGVyIHRoYW4gc2VyaWFsbHkuXG4gIGZpcmU6IGZ1bmN0aW9uIChub3RpZmljYXRpb24pIHtcbiAgICB2YXIgc2VsZiA9IHRoaXM7XG5cbiAgICB2YXIgY29sbGVjdGlvbiA9IHNlbGYuX2NvbGxlY3Rpb25Gb3JNZXNzYWdlKG5vdGlmaWNhdGlvbik7XG5cbiAgICBpZiAoISBfLmhhcyhzZWxmLmxpc3RlbmVyc0J5Q29sbGVjdGlvbiwgY29sbGVjdGlvbikpIHtcbiAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICB2YXIgbGlzdGVuZXJzRm9yQ29sbGVjdGlvbiA9IHNlbGYubGlzdGVuZXJzQnlDb2xsZWN0aW9uW2NvbGxlY3Rpb25dO1xuICAgIHZhciBjYWxsYmFja0lkcyA9IFtdO1xuICAgIF8uZWFjaChsaXN0ZW5lcnNGb3JDb2xsZWN0aW9uLCBmdW5jdGlvbiAobCwgaWQpIHtcbiAgICAgIGlmIChzZWxmLl9tYXRjaGVzKG5vdGlmaWNhdGlvbiwgbC50cmlnZ2VyKSkge1xuICAgICAgICBjYWxsYmFja0lkcy5wdXNoKGlkKTtcbiAgICAgIH1cbiAgICB9KTtcblxuICAgIC8vIExpc3RlbmVyIGNhbGxiYWNrcyBjYW4geWllbGQsIHNvIHdlIG5lZWQgdG8gZmlyc3QgZmluZCBhbGwgdGhlIG9uZXMgdGhhdFxuICAgIC8vIG1hdGNoIGluIGEgc2luZ2xlIGl0ZXJhdGlvbiBvdmVyIHNlbGYubGlzdGVuZXJzQnlDb2xsZWN0aW9uICh3aGljaCBjYW4ndFxuICAgIC8vIGJlIG11dGF0ZWQgZHVyaW5nIHRoaXMgaXRlcmF0aW9uKSwgYW5kIHRoZW4gaW52b2tlIHRoZSBtYXRjaGluZ1xuICAgIC8vIGNhbGxiYWNrcywgY2hlY2tpbmcgYmVmb3JlIGVhY2ggY2FsbCB0byBlbnN1cmUgdGhleSBoYXZlbid0IHN0b3BwZWQuXG4gICAgLy8gTm90ZSB0aGF0IHdlIGRvbid0IGhhdmUgdG8gY2hlY2sgdGhhdFxuICAgIC8vIHNlbGYubGlzdGVuZXJzQnlDb2xsZWN0aW9uW2NvbGxlY3Rpb25dIHN0aWxsID09PSBsaXN0ZW5lcnNGb3JDb2xsZWN0aW9uLFxuICAgIC8vIGJlY2F1c2UgdGhlIG9ubHkgd2F5IHRoYXQgc3RvcHMgYmVpbmcgdHJ1ZSBpcyBpZiBsaXN0ZW5lcnNGb3JDb2xsZWN0aW9uXG4gICAgLy8gZmlyc3QgZ2V0cyByZWR1Y2VkIGRvd24gdG8gdGhlIGVtcHR5IG9iamVjdCAoYW5kIHRoZW4gbmV2ZXIgZ2V0c1xuICAgIC8vIGluY3JlYXNlZCBhZ2FpbikuXG4gICAgXy5lYWNoKGNhbGxiYWNrSWRzLCBmdW5jdGlvbiAoaWQpIHtcbiAgICAgIGlmIChfLmhhcyhsaXN0ZW5lcnNGb3JDb2xsZWN0aW9uLCBpZCkpIHtcbiAgICAgICAgbGlzdGVuZXJzRm9yQ29sbGVjdGlvbltpZF0uY2FsbGJhY2sobm90aWZpY2F0aW9uKTtcbiAgICAgIH1cbiAgICB9KTtcbiAgfSxcblxuICAvLyBBIG5vdGlmaWNhdGlvbiBtYXRjaGVzIGEgdHJpZ2dlciBpZiBhbGwga2V5cyB0aGF0IGV4aXN0IGluIGJvdGggYXJlIGVxdWFsLlxuICAvL1xuICAvLyBFeGFtcGxlczpcbiAgLy8gIE46e2NvbGxlY3Rpb246IFwiQ1wifSBtYXRjaGVzIFQ6e2NvbGxlY3Rpb246IFwiQ1wifVxuICAvLyAgICAoYSBub24tdGFyZ2V0ZWQgd3JpdGUgdG8gYSBjb2xsZWN0aW9uIG1hdGNoZXMgYVxuICAvLyAgICAgbm9uLXRhcmdldGVkIHF1ZXJ5KVxuICAvLyAgTjp7Y29sbGVjdGlvbjogXCJDXCIsIGlkOiBcIlhcIn0gbWF0Y2hlcyBUOntjb2xsZWN0aW9uOiBcIkNcIn1cbiAgLy8gICAgKGEgdGFyZ2V0ZWQgd3JpdGUgdG8gYSBjb2xsZWN0aW9uIG1hdGNoZXMgYSBub24tdGFyZ2V0ZWQgcXVlcnkpXG4gIC8vICBOOntjb2xsZWN0aW9uOiBcIkNcIn0gbWF0Y2hlcyBUOntjb2xsZWN0aW9uOiBcIkNcIiwgaWQ6IFwiWFwifVxuICAvLyAgICAoYSBub24tdGFyZ2V0ZWQgd3JpdGUgdG8gYSBjb2xsZWN0aW9uIG1hdGNoZXMgYVxuICAvLyAgICAgdGFyZ2V0ZWQgcXVlcnkpXG4gIC8vICBOOntjb2xsZWN0aW9uOiBcIkNcIiwgaWQ6IFwiWFwifSBtYXRjaGVzIFQ6e2NvbGxlY3Rpb246IFwiQ1wiLCBpZDogXCJYXCJ9XG4gIC8vICAgIChhIHRhcmdldGVkIHdyaXRlIHRvIGEgY29sbGVjdGlvbiBtYXRjaGVzIGEgdGFyZ2V0ZWQgcXVlcnkgdGFyZ2V0ZWRcbiAgLy8gICAgIGF0IHRoZSBzYW1lIGRvY3VtZW50KVxuICAvLyAgTjp7Y29sbGVjdGlvbjogXCJDXCIsIGlkOiBcIlhcIn0gZG9lcyBub3QgbWF0Y2ggVDp7Y29sbGVjdGlvbjogXCJDXCIsIGlkOiBcIllcIn1cbiAgLy8gICAgKGEgdGFyZ2V0ZWQgd3JpdGUgdG8gYSBjb2xsZWN0aW9uIGRvZXMgbm90IG1hdGNoIGEgdGFyZ2V0ZWQgcXVlcnlcbiAgLy8gICAgIHRhcmdldGVkIGF0IGEgZGlmZmVyZW50IGRvY3VtZW50KVxuICBfbWF0Y2hlczogZnVuY3Rpb24gKG5vdGlmaWNhdGlvbiwgdHJpZ2dlcikge1xuICAgIC8vIE1vc3Qgbm90aWZpY2F0aW9ucyB0aGF0IHVzZSB0aGUgY3Jvc3NiYXIgaGF2ZSBhIHN0cmluZyBgY29sbGVjdGlvbmAgYW5kXG4gICAgLy8gbWF5YmUgYW4gYGlkYCB0aGF0IGlzIGEgc3RyaW5nIG9yIE9iamVjdElELiBXZSdyZSBhbHJlYWR5IGRpdmlkaW5nIHVwXG4gICAgLy8gdHJpZ2dlcnMgYnkgY29sbGVjdGlvbiwgYnV0IGxldCdzIGZhc3QtdHJhY2sgXCJub3BlLCBkaWZmZXJlbnQgSURcIiAoYW5kXG4gICAgLy8gYXZvaWQgdGhlIG92ZXJseSBnZW5lcmljIEVKU09OLmVxdWFscykuIFRoaXMgbWFrZXMgYSBub3RpY2VhYmxlXG4gICAgLy8gcGVyZm9ybWFuY2UgZGlmZmVyZW5jZTsgc2VlIGh0dHBzOi8vZ2l0aHViLmNvbS9tZXRlb3IvbWV0ZW9yL3B1bGwvMzY5N1xuICAgIGlmICh0eXBlb2Yobm90aWZpY2F0aW9uLmlkKSA9PT0gJ3N0cmluZycgJiZcbiAgICAgICAgdHlwZW9mKHRyaWdnZXIuaWQpID09PSAnc3RyaW5nJyAmJlxuICAgICAgICBub3RpZmljYXRpb24uaWQgIT09IHRyaWdnZXIuaWQpIHtcbiAgICAgIHJldHVybiBmYWxzZTtcbiAgICB9XG4gICAgaWYgKG5vdGlmaWNhdGlvbi5pZCBpbnN0YW5jZW9mIE1vbmdvSUQuT2JqZWN0SUQgJiZcbiAgICAgICAgdHJpZ2dlci5pZCBpbnN0YW5jZW9mIE1vbmdvSUQuT2JqZWN0SUQgJiZcbiAgICAgICAgISBub3RpZmljYXRpb24uaWQuZXF1YWxzKHRyaWdnZXIuaWQpKSB7XG4gICAgICByZXR1cm4gZmFsc2U7XG4gICAgfVxuXG4gICAgcmV0dXJuIF8uYWxsKHRyaWdnZXIsIGZ1bmN0aW9uICh0cmlnZ2VyVmFsdWUsIGtleSkge1xuICAgICAgcmV0dXJuICFfLmhhcyhub3RpZmljYXRpb24sIGtleSkgfHxcbiAgICAgICAgRUpTT04uZXF1YWxzKHRyaWdnZXJWYWx1ZSwgbm90aWZpY2F0aW9uW2tleV0pO1xuICAgIH0pO1xuICB9XG59KTtcblxuLy8gVGhlIFwiaW52YWxpZGF0aW9uIGNyb3NzYmFyXCIgaXMgYSBzcGVjaWZpYyBpbnN0YW5jZSB1c2VkIGJ5IHRoZSBERFAgc2VydmVyIHRvXG4vLyBpbXBsZW1lbnQgd3JpdGUgZmVuY2Ugbm90aWZpY2F0aW9ucy4gTGlzdGVuZXIgY2FsbGJhY2tzIG9uIHRoaXMgY3Jvc3NiYXJcbi8vIHNob3VsZCBjYWxsIGJlZ2luV3JpdGUgb24gdGhlIGN1cnJlbnQgd3JpdGUgZmVuY2UgYmVmb3JlIHRoZXkgcmV0dXJuLCBpZiB0aGV5XG4vLyB3YW50IHRvIGRlbGF5IHRoZSB3cml0ZSBmZW5jZSBmcm9tIGZpcmluZyAoaWUsIHRoZSBERFAgbWV0aG9kLWRhdGEtdXBkYXRlZFxuLy8gbWVzc2FnZSBmcm9tIGJlaW5nIHNlbnQpLlxuRERQU2VydmVyLl9JbnZhbGlkYXRpb25Dcm9zc2JhciA9IG5ldyBERFBTZXJ2ZXIuX0Nyb3NzYmFyKHtcbiAgZmFjdE5hbWU6IFwiaW52YWxpZGF0aW9uLWNyb3NzYmFyLWxpc3RlbmVyc1wiXG59KTtcbiIsImlmIChwcm9jZXNzLmVudi5ERFBfREVGQVVMVF9DT05ORUNUSU9OX1VSTCkge1xuICBfX21ldGVvcl9ydW50aW1lX2NvbmZpZ19fLkREUF9ERUZBVUxUX0NPTk5FQ1RJT05fVVJMID1cbiAgICBwcm9jZXNzLmVudi5ERFBfREVGQVVMVF9DT05ORUNUSU9OX1VSTDtcbn1cblxuTWV0ZW9yLnNlcnZlciA9IG5ldyBTZXJ2ZXI7XG5cbk1ldGVvci5yZWZyZXNoID0gZnVuY3Rpb24gKG5vdGlmaWNhdGlvbikge1xuICBERFBTZXJ2ZXIuX0ludmFsaWRhdGlvbkNyb3NzYmFyLmZpcmUobm90aWZpY2F0aW9uKTtcbn07XG5cbi8vIFByb3h5IHRoZSBwdWJsaWMgbWV0aG9kcyBvZiBNZXRlb3Iuc2VydmVyIHNvIHRoZXkgY2FuXG4vLyBiZSBjYWxsZWQgZGlyZWN0bHkgb24gTWV0ZW9yLlxuXy5lYWNoKFsncHVibGlzaCcsICdtZXRob2RzJywgJ2NhbGwnLCAnYXBwbHknLCAnb25Db25uZWN0aW9uJywgJ29uTWVzc2FnZSddLFxuICAgICAgIGZ1bmN0aW9uIChuYW1lKSB7XG4gICAgICAgICBNZXRlb3JbbmFtZV0gPSBfLmJpbmQoTWV0ZW9yLnNlcnZlcltuYW1lXSwgTWV0ZW9yLnNlcnZlcik7XG4gICAgICAgfSk7XG5cbi8vIE1ldGVvci5zZXJ2ZXIgdXNlZCB0byBiZSBjYWxsZWQgTWV0ZW9yLmRlZmF1bHRfc2VydmVyLiBQcm92aWRlXG4vLyBiYWNrY29tcGF0IGFzIGEgY291cnRlc3kgZXZlbiB0aG91Z2ggaXQgd2FzIG5ldmVyIGRvY3VtZW50ZWQuXG4vLyBYWFggQ09NUEFUIFdJVEggMC42LjRcbk1ldGVvci5kZWZhdWx0X3NlcnZlciA9IE1ldGVvci5zZXJ2ZXI7XG4iXX0=
