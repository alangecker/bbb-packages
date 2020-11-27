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
var meteorBabelHelpers = Package['babel-runtime'].meteorBabelHelpers;
var Promise = Package.promise.Promise;

/* Package-scope variables */
var StreamServer, DDPServer, Server;

var require = meteorInstall({"node_modules":{"meteor":{"ddp-server":{"stream_server.js":function(require){

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
    // We want to make sure that if a client connects to us and does the initial
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

},"livedata_server.js":function(require){

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
          error: new Meteor.Error(404, `Subscription '${msg.name}' not found`)
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
          error: new Meteor.Error(404, `Method '${msg.method}' not found`)
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
        payload.error = wrapInternalException(exception, `while invoking method '${msg.method}'`);
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
  call: function (name, ...args) {
    if (args.length && typeof args[args.length - 1] === "function") {
      // If it's a function, the last argument is the result callback, not
      // a parameter to the remote method.
      var callback = args.pop();
    }

    return this.apply(name, args, callback);
  },
  // A version of the call method that always returns a Promise.
  callAsync: function (name, ...args) {
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
      return Promise.reject(new Meteor.Error(404, `Method '${name}' not found`));
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
    Meteor._debug("Exception " + context, exception);

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

},"writefence.js":function(require){

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

},"crossbar.js":function(){

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

},"server_convenience.js":function(){

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
//# sourceMappingURL=data:application/json;charset=utf8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIm1ldGVvcjovL/CfkrthcHAvcGFja2FnZXMvZGRwLXNlcnZlci9zdHJlYW1fc2VydmVyLmpzIiwibWV0ZW9yOi8v8J+Su2FwcC9wYWNrYWdlcy9kZHAtc2VydmVyL2xpdmVkYXRhX3NlcnZlci5qcyIsIm1ldGVvcjovL/CfkrthcHAvcGFja2FnZXMvZGRwLXNlcnZlci93cml0ZWZlbmNlLmpzIiwibWV0ZW9yOi8v8J+Su2FwcC9wYWNrYWdlcy9kZHAtc2VydmVyL2Nyb3NzYmFyLmpzIiwibWV0ZW9yOi8v8J+Su2FwcC9wYWNrYWdlcy9kZHAtc2VydmVyL3NlcnZlcl9jb252ZW5pZW5jZS5qcyJdLCJuYW1lcyI6WyJ1cmwiLCJOcG0iLCJyZXF1aXJlIiwid2Vic29ja2V0RXh0ZW5zaW9ucyIsIl8iLCJvbmNlIiwiZXh0ZW5zaW9ucyIsIndlYnNvY2tldENvbXByZXNzaW9uQ29uZmlnIiwicHJvY2VzcyIsImVudiIsIlNFUlZFUl9XRUJTT0NLRVRfQ09NUFJFU1NJT04iLCJKU09OIiwicGFyc2UiLCJwdXNoIiwiY29uZmlndXJlIiwicGF0aFByZWZpeCIsIl9fbWV0ZW9yX3J1bnRpbWVfY29uZmlnX18iLCJST09UX1VSTF9QQVRIX1BSRUZJWCIsIlN0cmVhbVNlcnZlciIsInNlbGYiLCJyZWdpc3RyYXRpb25fY2FsbGJhY2tzIiwib3Blbl9zb2NrZXRzIiwicHJlZml4IiwiUm91dGVQb2xpY3kiLCJkZWNsYXJlIiwic29ja2pzIiwic2VydmVyT3B0aW9ucyIsImxvZyIsImhlYXJ0YmVhdF9kZWxheSIsImRpc2Nvbm5lY3RfZGVsYXkiLCJqc2Vzc2lvbmlkIiwiVVNFX0pTRVNTSU9OSUQiLCJESVNBQkxFX1dFQlNPQ0tFVFMiLCJ3ZWJzb2NrZXQiLCJmYXllX3NlcnZlcl9vcHRpb25zIiwic2VydmVyIiwiY3JlYXRlU2VydmVyIiwiV2ViQXBwIiwiaHR0cFNlcnZlciIsInJlbW92ZUxpc3RlbmVyIiwiX3RpbWVvdXRBZGp1c3RtZW50UmVxdWVzdENhbGxiYWNrIiwiaW5zdGFsbEhhbmRsZXJzIiwiYWRkTGlzdGVuZXIiLCJfcmVkaXJlY3RXZWJzb2NrZXRFbmRwb2ludCIsIm9uIiwic29ja2V0Iiwic2V0V2Vic29ja2V0VGltZW91dCIsInRpbWVvdXQiLCJwcm90b2NvbCIsIl9zZXNzaW9uIiwicmVjdiIsImNvbm5lY3Rpb24iLCJzZXRUaW1lb3V0Iiwic2VuZCIsImRhdGEiLCJ3cml0ZSIsIndpdGhvdXQiLCJzdHJpbmdpZnkiLCJzZXJ2ZXJfaWQiLCJlYWNoIiwiY2FsbGJhY2siLCJleHRlbmQiLCJwcm90b3R5cGUiLCJyZWdpc3RlciIsImFsbF9zb2NrZXRzIiwidmFsdWVzIiwiZXZlbnQiLCJvbGRIdHRwU2VydmVyTGlzdGVuZXJzIiwibGlzdGVuZXJzIiwic2xpY2UiLCJyZW1vdmVBbGxMaXN0ZW5lcnMiLCJuZXdMaXN0ZW5lciIsInJlcXVlc3QiLCJhcmdzIiwiYXJndW1lbnRzIiwicGFyc2VkVXJsIiwicGF0aG5hbWUiLCJmb3JtYXQiLCJvbGRMaXN0ZW5lciIsImFwcGx5IiwiRERQU2VydmVyIiwiRmliZXIiLCJTZXNzaW9uRG9jdW1lbnRWaWV3IiwiZXhpc3RzSW4iLCJTZXQiLCJkYXRhQnlLZXkiLCJNYXAiLCJfU2Vzc2lvbkRvY3VtZW50VmlldyIsImdldEZpZWxkcyIsInJldCIsImZvckVhY2giLCJwcmVjZWRlbmNlTGlzdCIsImtleSIsInZhbHVlIiwiY2xlYXJGaWVsZCIsInN1YnNjcmlwdGlvbkhhbmRsZSIsImNoYW5nZUNvbGxlY3RvciIsImdldCIsInJlbW92ZWRWYWx1ZSIsInVuZGVmaW5lZCIsImkiLCJsZW5ndGgiLCJwcmVjZWRlbmNlIiwic3BsaWNlIiwiZGVsZXRlIiwiRUpTT04iLCJlcXVhbHMiLCJjaGFuZ2VGaWVsZCIsImlzQWRkIiwiY2xvbmUiLCJoYXMiLCJzZXQiLCJlbHQiLCJmaW5kIiwiU2Vzc2lvbkNvbGxlY3Rpb25WaWV3IiwiY29sbGVjdGlvbk5hbWUiLCJzZXNzaW9uQ2FsbGJhY2tzIiwiZG9jdW1lbnRzIiwiY2FsbGJhY2tzIiwiX1Nlc3Npb25Db2xsZWN0aW9uVmlldyIsImlzRW1wdHkiLCJzaXplIiwiZGlmZiIsInByZXZpb3VzIiwiRGlmZlNlcXVlbmNlIiwiZGlmZk1hcHMiLCJib3RoIiwiYmluZCIsImRpZmZEb2N1bWVudCIsInJpZ2h0T25seSIsImlkIiwibm93RFYiLCJhZGRlZCIsImxlZnRPbmx5IiwicHJldkRWIiwicmVtb3ZlZCIsImZpZWxkcyIsImRpZmZPYmplY3RzIiwicHJldiIsIm5vdyIsImNoYW5nZWQiLCJkb2NWaWV3IiwiYWRkIiwiY2hhbmdlZFJlc3VsdCIsIkVycm9yIiwiZXJyIiwiU2Vzc2lvbiIsInZlcnNpb24iLCJvcHRpb25zIiwiUmFuZG9tIiwiaW5pdGlhbGl6ZWQiLCJpblF1ZXVlIiwiTWV0ZW9yIiwiX0RvdWJsZUVuZGVkUXVldWUiLCJibG9ja2VkIiwid29ya2VyUnVubmluZyIsIl9uYW1lZFN1YnMiLCJfdW5pdmVyc2FsU3VicyIsInVzZXJJZCIsImNvbGxlY3Rpb25WaWV3cyIsIl9pc1NlbmRpbmciLCJfZG9udFN0YXJ0TmV3VW5pdmVyc2FsU3VicyIsIl9wZW5kaW5nUmVhZHkiLCJfY2xvc2VDYWxsYmFja3MiLCJfc29ja2V0VXJsIiwiX3Jlc3BvbmRUb1BpbmdzIiwicmVzcG9uZFRvUGluZ3MiLCJjb25uZWN0aW9uSGFuZGxlIiwiY2xvc2UiLCJvbkNsb3NlIiwiZm4iLCJjYiIsImJpbmRFbnZpcm9ubWVudCIsImRlZmVyIiwiY2xpZW50QWRkcmVzcyIsIl9jbGllbnRBZGRyZXNzIiwiaHR0cEhlYWRlcnMiLCJoZWFkZXJzIiwibXNnIiwic2Vzc2lvbiIsInN0YXJ0VW5pdmVyc2FsU3VicyIsInJ1biIsImhlYXJ0YmVhdEludGVydmFsIiwiaGVhcnRiZWF0IiwiRERQQ29tbW9uIiwiSGVhcnRiZWF0IiwiaGVhcnRiZWF0VGltZW91dCIsIm9uVGltZW91dCIsInNlbmRQaW5nIiwic3RhcnQiLCJQYWNrYWdlIiwiRmFjdHMiLCJpbmNyZW1lbnRTZXJ2ZXJGYWN0Iiwic2VuZFJlYWR5Iiwic3Vic2NyaXB0aW9uSWRzIiwic3VicyIsInN1YnNjcmlwdGlvbklkIiwic2VuZEFkZGVkIiwiY29sbGVjdGlvbiIsInNlbmRDaGFuZ2VkIiwic2VuZFJlbW92ZWQiLCJnZXRTZW5kQ2FsbGJhY2tzIiwiZ2V0Q29sbGVjdGlvblZpZXciLCJ2aWV3IiwiaGFuZGxlcnMiLCJ1bml2ZXJzYWxfcHVibGlzaF9oYW5kbGVycyIsImhhbmRsZXIiLCJfc3RhcnRTdWJzY3JpcHRpb24iLCJzdG9wIiwiX21ldGVvclNlc3Npb24iLCJfZGVhY3RpdmF0ZUFsbFN1YnNjcmlwdGlvbnMiLCJfcmVtb3ZlU2Vzc2lvbiIsIl9wcmludFNlbnRERFAiLCJfZGVidWciLCJzdHJpbmdpZnlERFAiLCJzZW5kRXJyb3IiLCJyZWFzb24iLCJvZmZlbmRpbmdNZXNzYWdlIiwicHJvY2Vzc01lc3NhZ2UiLCJtc2dfaW4iLCJtZXNzYWdlUmVjZWl2ZWQiLCJwcm9jZXNzTmV4dCIsInNoaWZ0IiwidW5ibG9jayIsIm9uTWVzc2FnZUhvb2siLCJwcm90b2NvbF9oYW5kbGVycyIsImNhbGwiLCJzdWIiLCJuYW1lIiwicGFyYW1zIiwiQXJyYXkiLCJwdWJsaXNoX2hhbmRsZXJzIiwiZXJyb3IiLCJERFBSYXRlTGltaXRlciIsInJhdGVMaW1pdGVySW5wdXQiLCJ0eXBlIiwiY29ubmVjdGlvbklkIiwiX2luY3JlbWVudCIsInJhdGVMaW1pdFJlc3VsdCIsIl9jaGVjayIsImFsbG93ZWQiLCJnZXRFcnJvck1lc3NhZ2UiLCJ0aW1lVG9SZXNldCIsInVuc3ViIiwiX3N0b3BTdWJzY3JpcHRpb24iLCJtZXRob2QiLCJyYW5kb21TZWVkIiwiZmVuY2UiLCJfV3JpdGVGZW5jZSIsIm9uQWxsQ29tbWl0dGVkIiwicmV0aXJlIiwibWV0aG9kcyIsIm1ldGhvZF9oYW5kbGVycyIsImFybSIsInNldFVzZXJJZCIsIl9zZXRVc2VySWQiLCJpbnZvY2F0aW9uIiwiTWV0aG9kSW52b2NhdGlvbiIsImlzU2ltdWxhdGlvbiIsInByb21pc2UiLCJQcm9taXNlIiwicmVzb2x2ZSIsInJlamVjdCIsIl9DdXJyZW50V3JpdGVGZW5jZSIsIndpdGhWYWx1ZSIsIkREUCIsIl9DdXJyZW50TWV0aG9kSW52b2NhdGlvbiIsIm1heWJlQXVkaXRBcmd1bWVudENoZWNrcyIsImZpbmlzaCIsInBheWxvYWQiLCJ0aGVuIiwicmVzdWx0IiwiZXhjZXB0aW9uIiwid3JhcEludGVybmFsRXhjZXB0aW9uIiwiX2VhY2hTdWIiLCJmIiwiX2RpZmZDb2xsZWN0aW9uVmlld3MiLCJiZWZvcmVDVnMiLCJsZWZ0VmFsdWUiLCJyaWdodFZhbHVlIiwiZG9jIiwiX2RlYWN0aXZhdGUiLCJvbGROYW1lZFN1YnMiLCJuZXdTdWIiLCJfcmVjcmVhdGUiLCJfcnVuSGFuZGxlciIsIl9ub1lpZWxkc0FsbG93ZWQiLCJzdWJJZCIsIlN1YnNjcmlwdGlvbiIsInN1Yk5hbWUiLCJtYXliZVN1YiIsIl9uYW1lIiwiX3JlbW92ZUFsbERvY3VtZW50cyIsInJlc3BvbnNlIiwiaHR0cEZvcndhcmRlZENvdW50IiwicGFyc2VJbnQiLCJyZW1vdGVBZGRyZXNzIiwiZm9yd2FyZGVkRm9yIiwiaXNTdHJpbmciLCJ0cmltIiwic3BsaXQiLCJfaGFuZGxlciIsIl9zdWJzY3JpcHRpb25JZCIsIl9wYXJhbXMiLCJfc3Vic2NyaXB0aW9uSGFuZGxlIiwiX2RlYWN0aXZhdGVkIiwiX3N0b3BDYWxsYmFja3MiLCJfZG9jdW1lbnRzIiwiX3JlYWR5IiwiX2lkRmlsdGVyIiwiaWRTdHJpbmdpZnkiLCJNb25nb0lEIiwiaWRQYXJzZSIsInJlcyIsIl9DdXJyZW50UHVibGljYXRpb25JbnZvY2F0aW9uIiwiZSIsIl9pc0RlYWN0aXZhdGVkIiwiX3B1Ymxpc2hIYW5kbGVyUmVzdWx0IiwiaXNDdXJzb3IiLCJjIiwiX3B1Ymxpc2hDdXJzb3IiLCJyZWFkeSIsImlzQXJyYXkiLCJhbGwiLCJjb2xsZWN0aW9uTmFtZXMiLCJfZ2V0Q29sbGVjdGlvbk5hbWUiLCJjdXIiLCJfY2FsbFN0b3BDYWxsYmFja3MiLCJjb2xsZWN0aW9uRG9jcyIsInN0cklkIiwib25TdG9wIiwiaWRzIiwiU2VydmVyIiwiZGVmYXVsdHMiLCJvbkNvbm5lY3Rpb25Ib29rIiwiSG9vayIsImRlYnVnUHJpbnRFeGNlcHRpb25zIiwic2Vzc2lvbnMiLCJzdHJlYW1fc2VydmVyIiwicmF3X21zZyIsIl9wcmludFJlY2VpdmVkRERQIiwicGFyc2VERFAiLCJfaGFuZGxlQ29ubmVjdCIsIm9uQ29ubmVjdGlvbiIsIm9uTWVzc2FnZSIsInN1cHBvcnQiLCJjb250YWlucyIsIlNVUFBPUlRFRF9ERFBfVkVSU0lPTlMiLCJjYWxjdWxhdGVWZXJzaW9uIiwicHVibGlzaCIsImlzT2JqZWN0IiwiYXV0b3B1Ymxpc2giLCJpc19hdXRvIiwid2FybmVkX2Fib3V0X2F1dG9wdWJsaXNoIiwiZnVuYyIsInBvcCIsImNhbGxBc3luYyIsImFwcGx5QXN5bmMiLCJhd2FpdCIsImN1cnJlbnRNZXRob2RJbnZvY2F0aW9uIiwiY3VycmVudFB1YmxpY2F0aW9uSW52b2NhdGlvbiIsIm1ha2VScGNTZWVkIiwiX3VybEZvclNlc3Npb24iLCJzZXNzaW9uSWQiLCJjbGllbnRTdXBwb3J0ZWRWZXJzaW9ucyIsInNlcnZlclN1cHBvcnRlZFZlcnNpb25zIiwiY29ycmVjdFZlcnNpb24iLCJfY2FsY3VsYXRlVmVyc2lvbiIsImNvbnRleHQiLCJpc0NsaWVudFNhZmUiLCJvcmlnaW5hbE1lc3NhZ2UiLCJtZXNzYWdlIiwiZGV0YWlscyIsIl9leHBlY3RlZEJ5VGVzdCIsInNhbml0aXplZEVycm9yIiwiZGVzY3JpcHRpb24iLCJNYXRjaCIsIl9mYWlsSWZBcmd1bWVudHNBcmVOb3RBbGxDaGVja2VkIiwiRnV0dXJlIiwiYXJtZWQiLCJmaXJlZCIsInJldGlyZWQiLCJvdXRzdGFuZGluZ193cml0ZXMiLCJiZWZvcmVfZmlyZV9jYWxsYmFja3MiLCJjb21wbGV0aW9uX2NhbGxiYWNrcyIsIkVudmlyb25tZW50VmFyaWFibGUiLCJiZWdpbldyaXRlIiwiY29tbWl0dGVkIiwiX21heWJlRmlyZSIsIm9uQmVmb3JlRmlyZSIsImFybUFuZFdhaXQiLCJmdXR1cmUiLCJ3YWl0IiwiaW52b2tlQ2FsbGJhY2siLCJfQ3Jvc3NiYXIiLCJuZXh0SWQiLCJsaXN0ZW5lcnNCeUNvbGxlY3Rpb24iLCJsaXN0ZW5lcnNCeUNvbGxlY3Rpb25Db3VudCIsImZhY3RQYWNrYWdlIiwiZmFjdE5hbWUiLCJfY29sbGVjdGlvbkZvck1lc3NhZ2UiLCJsaXN0ZW4iLCJ0cmlnZ2VyIiwicmVjb3JkIiwiZmlyZSIsIm5vdGlmaWNhdGlvbiIsImxpc3RlbmVyc0ZvckNvbGxlY3Rpb24iLCJjYWxsYmFja0lkcyIsImwiLCJfbWF0Y2hlcyIsIk9iamVjdElEIiwidHJpZ2dlclZhbHVlIiwiX0ludmFsaWRhdGlvbkNyb3NzYmFyIiwiRERQX0RFRkFVTFRfQ09OTkVDVElPTl9VUkwiLCJyZWZyZXNoIiwiZGVmYXVsdF9zZXJ2ZXIiXSwibWFwcGluZ3MiOiI7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7QUFBQSxJQUFJQSxHQUFHLEdBQUdDLEdBQUcsQ0FBQ0MsT0FBSixDQUFZLEtBQVosQ0FBVixDLENBRUE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7O0FBQ0EsSUFBSUMsbUJBQW1CLEdBQUdDLENBQUMsQ0FBQ0MsSUFBRixDQUFPLFlBQVk7QUFDM0MsTUFBSUMsVUFBVSxHQUFHLEVBQWpCO0FBRUEsTUFBSUMsMEJBQTBCLEdBQUdDLE9BQU8sQ0FBQ0MsR0FBUixDQUFZQyw0QkFBWixHQUN6QkMsSUFBSSxDQUFDQyxLQUFMLENBQVdKLE9BQU8sQ0FBQ0MsR0FBUixDQUFZQyw0QkFBdkIsQ0FEeUIsR0FDOEIsRUFEL0Q7O0FBRUEsTUFBSUgsMEJBQUosRUFBZ0M7QUFDOUJELGNBQVUsQ0FBQ08sSUFBWCxDQUFnQlosR0FBRyxDQUFDQyxPQUFKLENBQVksb0JBQVosRUFBa0NZLFNBQWxDLENBQ2RQLDBCQURjLENBQWhCO0FBR0Q7O0FBRUQsU0FBT0Qs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VVQsWUFBVixFQUF3QjtBQUN2Q3JVLFdBQVMsQ0FBQzRVLHFCQUFWLENBQWdDUixJQUFoQyxDQUFxQ0MsWUFBckM7QUFDRCxDQUZELEMsQ0FJQTtBQUNBOzs7QUFDQWpaLENBQUMsQ0FBQ3VELElBQUYsQ0FBTyxDQUFDLFNBQUQsRUFBWSxTQUFaLEVBQXVCLE1BQXZCLEVBQStCLE9BQS9CLEVBQXdDLGNBQXhDLEVBQXdELFdBQXhELENBQVAsRUFDTyxVQUFVeUssSUFBVixFQUFnQjtBQUNkNUUsUUFBTSxDQUFDNEUsSUFBRCxDQUFOLEdBQWVoTyxDQUFDLENBQUMySCxJQUFGLENBQU95QixNQUFNLENBQUNySCxNQUFQLENBQWNpTSxJQUFkLENBQVAsRUFBNEI1RSxNQUFNLENBQUNySCxNQUFuQyxDQUFmO0FBQ0QsQ0FIUixFLENBS0E7QUFDQTtBQUNBOzs7QUFDQXFILE1BQU0sQ0FBQ3VRLGNBQVAsR0FBd0J2USxNQUFNLENBQUNySCxNQUEvQixDIiwiZmlsZSI6Ii9wYWNrYWdlcy9kZHAtc2VydmVyLmpzIiwic291cmNlc0NvbnRlbnQiOlsidmFyIHVybCA9IE5wbS5yZXF1aXJlKCd1cmwnKTtcblxuLy8gQnkgZGVmYXVsdCwgd2UgdXNlIHRoZSBwZXJtZXNzYWdlLWRlZmxhdGUgZXh0ZW5zaW9uIHdpdGggZGVmYXVsdFxuLy8gY29uZmlndXJhdGlvbi4gSWYgJFNFUlZFUl9XRUJTT0NLRVRfQ09NUFJFU1NJT04gaXMgc2V0LCB0aGVuIGl0IG11c3QgYmUgdmFsaWRcbi8vIEpTT04uIElmIGl0IHJlcHJlc2VudHMgYSBmYWxzZXkgdmFsdWUsIHRoZW4gd2UgZG8gbm90IHVzZSBwZXJtZXNzYWdlLWRlZmxhdGVcbi8vIGF0IGFsbDsgb3RoZXJ3aXNlLCB0aGUgSlNPTiB2YWx1ZSBpcyB1c2VkIGFzIGFuIGFyZ3VtZW50IHRvIGRlZmxhdGUnc1xuLy8gY29uZmlndXJlIG1ldGhvZDsgc2VlXG4vLyBodHRwczovL2dpdGh1Yi5jb20vZmF5ZS9wZXJtZXNzYWdlLWRlZmxhdGUtbm9kZS9ibG9iL21hc3Rlci9SRUFETUUubWRcbi8vXG4vLyAoV2UgZG8gdGhpcyBpbiBhbiBfLm9uY2UgaW5zdGVhZCBvZiBhdCBzdGFydHVwLCBiZWNhdXNlIHdlIGRvbid0IHdhbnQgdG9cbi8vIGNyYXNoIHRoZSB0b29sIGR1cmluZyBpc29wYWNrZXQgbG9hZCBpZiB5b3VyIEpTT04gZG9lc24ndCBwYXJzZS4gVGhpcyBpcyBvbmx5XG4vLyBhIHByb2JsZW0gYmVjYXVzZSB0aGUgdG9vbCBoYXMgdG8gbG9hZCB0aGUgRERQIHNlcnZlciBjb2RlIGp1c3QgaW4gb3JkZXIgdG9cbi8vIGJlIGEgRERQIGNsaWVudDsgc2VlIGh0dHBzOi8vZ2l0aHViLmNvbS9tZXRlb3IvbWV0ZW9yL2lzc3Vlcy8zNDUyIC4pXG52YXIgd2Vic29ja2V0RXh0ZW5zaW9ucyA9IF8ub25jZShmdW5jdGlvbiAoKSB7XG4gIHZhciBleHRlbnNpb25zID0gW107XG5cbiAgdmFyIHdlYnNvY2tldENvbXByZXNzaW9uQ29uZmlnID0gcHJvY2Vzcy5lbnYuU0VSVkVSX1dFQlNPQ0tFVF9DT01QUkVTU0lPTlxuICAgICAgICA/IEpTT04ucGFyc2UocHJvY2Vzcy5lbnYuU0VSVkVSX1dFQlNPQ0tFVF9DT01QUkVTU0lPTikgOiB7fTtcbiAgaWYgKHdlYnNvY2tldENvbXByZXNzaW9uQ29uZmlnKSB7XG4gICAgZXh0ZW5zaW9ucy5wdXNoKE5wbS5yZXF1aXJlKCdwZXJtZXNzYWdlLWRlZmxhdGUnKS5jb25maWd1cmUoXG4gICAgICB3ZWJzb2NrZXRDb21wcmVzc2lvbkNvbmZpZ1xuICAgICkpO1xuICB9XG5cbiAgcmV0dXJuIGV4dGVuc2lvbnM7XG59KTtcblxudmFyIHBhdGhQcmVmaXggPSBfX21ldGVvcl9ydW50aW1lX2NvbmZpZ19fLlJPT1RfVVJMX1BBVEhfUFJFRklYIHx8ICBcIlwiO1xuXG5TdHJlYW1TZXJ2ZXIgPSBmdW5jdGlvbiAoKSB7XG4gIHZhciBzZWxmID0gdGhpcztcbiAgc2VsZi5yZWdpc3RyYXRpb25fY2FsbGJhY2tzID0gW107XG4gIHNlbGYub3Blbl9zb2NrZXRzID0gW107XG5cbiAgLy8gQmVjYXVzZSB3ZSBhcmUgaW5zdGFsbGluZyBkaXJlY3RseSBvbnRvIFdlYkFwcC5odHRwU2VydmVyIGluc3RlYWQgb2YgdXNpbmdcbiAgLy8gV2ViQXBwLmFwcCwgd2UgaGF2ZSB0byBwcm9jZXNzIHRoZSBwYXRoIHByZWZpeCBvdXJzZWx2ZXMuXG4gIHNlbGYucHJlZml4ID0gcGF0aFByZWZpeCArICcvc29ja2pzJztcbiAgUm91dGVQb2xpY3kuZGVjbGFyZShzZWxmLnByZWZpeCArICcvJywgJ25ldHdvcmsnKTtcblxuICAvLyBzZXQgdXAgc29ja2pzXG4gIHZhciBzb2NranMgPSBOcG0ucmVxdWlyZSgnc29ja2pzJyk7XG4gIHZhciBzZXJ2ZXJPcHRpb25zID0ge1xuICAgIHByZWZpeDogc2VsZi5wcmVmaXgsXG4gICAgbG9nOiBmdW5jdGlvbigpIHt9LFxuICAgIC8vIHRoaXMgaXMgdGhlIGRlZmF1bHQsIGJ1dCB3ZSBjb2RlIGl0IGV4cGxpY2l0bHkgYmVjYXVzZSB3ZSBkZXBlbmRcbiAgICAvLyBvbiBpdCBpbiBzdHJlYW1fY2xpZW50OkhFQVJUQkVBVF9USU1FT1VUXG4gICAgaGVhcnRiZWF0X2RlbGF5OiA0NTAwMCxcbiAgICAvLyBUaGUgZGVmYXVsdCBkaXNjb25uZWN0X2RlbGF5IGlzIDUgc2Vjb25kcywgYnV0IGlmIHRoZSBzZXJ2ZXIgZW5kcyB1cCBDUFVcbiAgICAvLyBib3VuZCBmb3IgdGhhdCBtdWNoIHRpbWUsIFNvY2tKUyBtaWdodCBub3Qgbm90aWNlIHRoYXQgdGhlIHVzZXIgaGFzXG4gICAgLy8gcmVjb25uZWN0ZWQgYmVjYXVzZSB0aGUgdGltZXIgKG9mIGRpc2Nvbm5lY3RfZGVsYXkgbXMpIGNhbiBmaXJlIGJlZm9yZVxuICAgIC8vIFNvY2tKUyBwcm9jZXNzZXMgdGhlIG5ldyBjb25uZWN0aW9uLiBFdmVudHVhbGx5IHdlJ2xsIGZpeCB0aGlzIGJ5IG5vdFxuICAgIC8vIGNvbWJpbmluZyBDUFUtaGVhdnkgcHJvY2Vzc2luZyB3aXRoIFNvY2tKUyB0ZXJtaW5hdGlvbiAoZWcgYSBwcm94eSB3aGljaFxuICAgIC8vIGNvbnZlcnRzIHRvIFVuaXggc29ja2V0cykgYnV0IGZvciBub3csIHJhaXNlIHRoZSBkZWxheS5cbiAgICBkaXNjb25uZWN0X2RlbGF5OiA2MCAqIDEwMDAsXG4gICAgLy8gU2V0IHRoZSBVU0VfSlNFU1NJT05JRCBlbnZpcm9ubWVudCB2YXJpYWJsZSB0byBlbmFibGUgc2V0dGluZyB0aGVcbiAgICAvLyBKU0VTU0lPTklEIGNvb2tpZS4gVGhpcyBpcyB1c2VmdWwgZm9yIHNldHRpbmcgdXAgcHJveGllcyB3aXRoXG4gICAgLy8gc2Vzc2lvbiBhZmZpbml0eS5cbiAgICBqc2Vzc2lvbmlkOiAhIXByb2Nlc3MuZW52LlVTRV9KU0VTU0lPTklEXG4gIH07XG5cbiAgLy8gSWYgeW91IGtub3cgeW91ciBzZXJ2ZXIgZW52aXJvbm1lbnQgKGVnLCBwcm94aWVzKSB3aWxsIHByZXZlbnQgd2Vic29ja2V0c1xuICAvLyBmcm9tIGV2ZXIgd29ya2luZywgc2V0ICRESVNBQkxFX1dFQlNPQ0tFVFMgYW5kIFNvY2tKUyBjbGllbnRzIChpZSxcbiAgLy8gYnJvd3NlcnMpIHdpbGwgbm90IHdhc3RlIHRpbWUgYXR0ZW1wdGluZyB0byB1c2UgdGhlbS5cbiAgLy8gKFlvdXIgc2VydmVyIHdpbGwgc3RpbGwgaGF2ZSBhIC93ZWJzb2NrZXQgZW5kcG9pbnQuKVxuICBpZiAocHJvY2Vzcy5lbnYuRElTQUJMRV9XRUJTT0NLRVRTKSB7XG4gICAgc2VydmVyT3B0aW9ucy53ZWJzb2NrZXQgPSBmYWxzZTtcbiAgfSBlbHNlIHtcbiAgICBzZXJ2ZXJPcHRpb25zLmZheWVfc2VydmVyX29wdGlvbnMgPSB7XG4gICAgICBleHRlbnNpb25zOiB3ZWJzb2NrZXRFeHRlbnNpb25zKClcbiAgICB9O1xuICB9XG5cbiAgc2VsZi5zZXJ2ZXIgPSBzb2NranMuY3JlYXRlU2VydmVyKHNlcnZlck9wdGlvbnMpO1xuXG4gIC8vIEluc3RhbGwgdGhlIHNvY2tqcyBoYW5kbGVycywgYnV0IHdlIHdhbnQgdG8ga2VlcCBhcm91bmQgb3VyIG93biBwYXJ0aWN1bGFyXG4gIC8vIHJlcXVlc3QgaGFuZGxlciB0aGF0IGFkanVzdHMgaWRsZSB0aW1lb3V0cyB3aGlsZSB3ZSBoYXZlIGFuIG91dHN0YW5kaW5nXG4gIC8vIHJlcXVlc3QuICBUaGlzIGNvbXBlbnNhdGVzIGZvciB0aGUgZmFjdCB0aGF0IHNvY2tqcyByZW1vdmVzIGFsbCBsaXN0ZW5lcnNcbiAgLy8gZm9yIFwicmVxdWVzdFwiIHRvIGFkZCBpdHMgb3duLlxuICBXZWJBcHAuaHR0cFNlcnZlci5yZW1vdmVMaXN0ZW5lcihcbiAgICAncmVxdWVzdCcsIFdlYkFwcC5fdGltZW91dEFkanVzdG1lbnRSZXF1ZXN0Q2FsbGJhY2spO1xuICBzZWxmLnNlcnZlci5pbnN0YWxsSGFuZGxlcnMoV2ViQXBwLmh0dHBTZXJ2ZXIpO1xuICBXZWJBcHAuaHR0cFNlcnZlci5hZGRMaXN0ZW5lcihcbiAgICAncmVxdWVzdCcsIFdlYkFwcC5fdGltZW91dEFkanVzdG1lbnRSZXF1ZXN0Q2FsbGJhY2spO1xuXG4gIC8vIFN1cHBvcnQgdGhlIC93ZWJzb2NrZXQgZW5kcG9pbnRcbiAgc2VsZi5fcmVkaXJlY3RXZWJzb2NrZXRFbmRwb2ludCgpO1xuXG4gIHNlbGYuc2VydmVyLm9uKCdjb25uZWN0aW9uJywgZnVuY3Rpb24gKHNvY2tldCkge1xuICAgIC8vIFdlIHdhbnQgdG8gbWFrZSBzdXJlIHRoYXQgaWYgYSBjbGllbnQgY29ubmVjdHMgdG8gdXMgYW5kIGRvZXMgdGhlIGluaXRpYWxcbiAgICAvLyBXZWJzb2NrZXQgaGFuZHNoYWtlIGJ1dCBuZXZlciBnZXRzIHRvIHRoZSBERFAgaGFuZHNoYWtlLCB0aGF0IHdlXG4gICAgLy8gZXZlbnR1YWxseSBraWxsIHRoZSBzb2NrZXQuICBPbmNlIHRoZSBERFAgaGFuZHNoYWtlIGhhcHBlbnMsIEREUFxuICAgIC8vIGhlYXJ0YmVhdGluZyB3aWxsIHdvcmsuIEFuZCBiZWZvcmUgdGhlIFdlYnNvY2tldCBoYW5kc2hha2UsIHRoZSB0aW1lb3V0c1xuICAgIC8vIHdlIHNldCBhdCB0aGUgc2VydmVyIGxldmVsIGluIHdlYmFwcF9zZXJ2ZXIuanMgd2lsbCB3b3JrLiBCdXRcbiAgICAvLyBmYXllLXdlYnNvY2tldCBjYWxscyBzZXRUaW1lb3V0KDApIG9uIGFueSBzb2NrZXQgaXQgdGFrZXMgb3Zlciwgc28gdGhlcmVcbiAgICAvLyBpcyBhbiBcImluIGJldHdlZW5cIiBzdGF0ZSB3aGVyZSB0aGlzIGRvZXNuJ3QgaGFwcGVuLiAgV2Ugd29yayBhcm91bmQgdGhpc1xuICAgIC8vIGJ5IGV4cGxpY2l0bHkgc2V0dGluZyB0aGUgc29ja2V0IHRpbWVvdXQgdG8gYSByZWxhdGl2ZWx5IGxhcmdlIHRpbWUgaGVyZSxcbiAgICAvLyBhbmQgc2V0dGluZyBpdCBiYWNrIHRvIHplcm8gd2hlbiB3ZSBzZXQgdXAgdGhlIGhlYXJ0YmVhdCBpblxuICAgIC8vIGxpdmVkYXRhX3NlcnZlci5qcy5cbiAgICBzb2NrZXQuc2V0V2Vic29ja2V0VGltZW91dCA9IGZ1bmN0aW9uICh0aW1lb3V0KSB7XG4gICAgICBpZiAoKHNvY2tldC5wcm90b2NvbCA9PT0gJ3dlYnNvY2tldCcgfHxcbiAgICAgICAgICAgc29ja2V0LnByb3RvY29sID09PSAnd2Vic29ja2V0LXJhdycpXG4gICAgICAgICAgJiYgc29ja2V0Ll9zZXNzaW9uLnJlY3YpIHtcbiAgICAgICAgc29ja2V0Ll9zZXNzaW9uLnJlY3YuY29ubmVjdGlvbi5zZXRUaW1lb3V0KHRpbWVvdXQpO1xuICAgICAgfVxuICAgIH07XG4gICAgc29ja2V0LnNldFdlYnNvY2tldFRpbWVvdXQoNDUgKiAxMDAwKTtcblxuICAgIHNvY2tldC5zZW5kID0gZnVuY3Rpb24gKGRhdGEpIHtcbiAgICAgIHNvY2tldC53cml0ZShkYXRhKTtcbiAgICB9O1xuICAgIHNvY2tldC5vbignY2xvc2UnLCBmdW5jdGlvbiAoKSB7XG4gICAgICBzZWxmLm9wZW5fc29ja2V0cyA9IF8ud2l0aG91dChzZWxmLm9wZW5fc29ja2V0cywgc29ja2V0KTtcbiAgICB9KTtcbiAgICBzZWxmLm9wZW5fc29ja2V0cy5wdXNoKHNvY2tldCk7XG5cbiAgICAvLyBYWFggQ09NUEFUIFdJVEggMC42LjYuIFNlbmQgdGhlIG9sZCBzdHlsZSB3ZWxjb21lIG1lc3NhZ2UsIHdoaWNoXG4gICAgLy8gd2lsbCBmb3JjZSBvbGQgY2xpZW50cyB0byByZWxvYWQuIFJlbW92ZSB0aGlzIG9uY2Ugd2UncmUgbm90XG4gICAgLy8gY29uY2VybmVkIGFib3V0IHBlb3BsZSB1cGdyYWRpbmcgZnJvbSBhIHByZS0wLjcuMCByZWxlYXNlLiBBbHNvLFxuICAgIC8vIHJlbW92ZSB0aGUgY2xhdXNlIGluIHRoZSBjbGllbnQgdGhhdCBpZ25vcmVzIHRoZSB3ZWxjb21lIG1lc3NhZ2VcbiAgICAvLyAobGl2ZWRhdGFfY29ubmVjdGlvbi5qcylcbiAgICBzb2NrZXQuc2VuZChKU09OLnN0cmluZ2lmeSh7c2VydmVyX2lkOiBcIjBcIn0pKTtcblxuICAgIC8vIGNhbGwgYWxsIG91ciBjYWxsYmFja3Mgd2hlbiB3ZSBnZXQgYSBuZXcgc29ja2V0LiB0aGV5IHdpbGwgZG8gdGhlXG4gICAgLy8gd29yayBvZiBzZXR0aW5nIHVwIGhhbmRsZXJzIGFuZCBzdWNoIGZvciBzcGVjaWZpYyBtZXNzYWdlcy5cbiAgICBfLmVhY2goc2VsZi5yZWdpc3RyYXRpb25fY2FsbGJhY2tzLCBmdW5jdGlvbiAoY2FsbGJhY2spIHtcbiAgICAgIGNhbGxiYWNrKHNvY2tldCk7XG4gICAgfSk7XG4gIH0pO1xuXG59O1xuXG5fLmV4dGVuZChTdHJlYW1TZXJ2ZXIucHJvdG90eXBlLCB7XG4gIC8vIGNhbGwgbXkgY2FsbGJhY2sgd2hlbiBhIG5ldyBzb2NrZXQgY29ubmVjdHMuXG4gIC8vIGFsc28gY2FsbCBpdCBmb3IgYWxsIGN1cnJlbnQgY29ubmVjdGlvbnMuXG4gIHJlZ2lzdGVyOiBmdW5jdGlvbiAoY2FsbGJhY2spIHtcbiAgICB2YXIgc2VsZiA9IHRoaXM7XG4gICAgc2VsZi5yZWdpc3RyYXRpb25fY2FsbGJhY2tzLnB1c2goY2FsbGJhY2spO1xuICAgIF8uZWFjaChzZWxmLmFsbF9zb2NrZXRzKCksIGZ1bmN0aW9uIChzb2NrZXQpIHtcbiAgICAgIGNhbGxiYWNrKHNvY2tldCk7XG4gICAgfSk7XG4gIH0sXG5cbiAgLy8gZ2V0IGEgbGlzdCBvZiBhbGwgc29ja2V0c1xuICBhbGxfc29ja2V0czogZnVuY3Rpb24gKCkge1xuICAgIHZhciBzZWxmID0gdGhpcztcbiAgICByZXR1cm4gXy52YWx1ZXMoc2VsZi5vcGVuX3NvY2tldHMpO1xuICB9LFxuXG4gIC8vIFJlZGlyZWN0IC93ZWJzb2NrZXQgdG8gL3NvY2tqcy93ZWJzb2NrZXQgaW4gb3JkZXIgdG8gbm90IGV4cG9zZVxuICAvLyBzb2NranMgdG8gY2xpZW50cyB0aGF0IHdhbnQgdG8gdXNlIHJhdyB3ZWJzb2NrZXRzXG4gIF9yZWRpcmVjdFdlYnNvY2tldEVuZHBvaW50OiBmdW5jdGlvbigpIHtcbiAgICB2YXIgc2VsZiA9IHRoaXM7XG4gICAgLy8gVW5mb3J0dW5hdGVseSB3ZSBjYW4ndCB1c2UgYSBjb25uZWN0IG1pZGRsZXdhcmUgaGVyZSBzaW5jZVxuICAgIC8vIHNvY2tqcyBpbnN0YWxscyBpdHNlbGYgcHJpb3IgdG8gYWxsIGV4aXN0aW5nIGxpc3RlbmVyc1xuICAgIC8vIChtZWFuaW5nIHByaW9yIHRvIGFueSBjb25uZWN0IG1pZGRsZXdhcmVzKSBzbyB3ZSBuZWVkIHRvIHRha2VcbiAgICAvLyBhbiBhcHByb2FjaCBzaW1pbGFyIHRvIG92ZXJzaGFkb3dMaXN0ZW5lcnMgaW5cbiAgICAvLyBodHRwczovL2dpdGh1Yi5jb20vc29ja2pzL3NvY2tqcy1ub2RlL2Jsb2IvY2Y4MjBjNTVhZjZhOTk1M2UxNjU1ODU1NWEzMWRlY2VhNTU0ZjcwZS9zcmMvdXRpbHMuY29mZmVlXG4gICAgXy5lYWNoKFsncmVxdWVzdCcsICd1cGdyYWRlJ10sIGZ1bmN0aW9uKGV2ZW50KSB7XG4gICAgICB2YXIgaHR0cFNlcnZlciA9IFdlYkFwcC5odHRwU2VydmVyO1xuICAgICAgdmFyIG9sZEh0dHBTZXJ2ZXJMaXN0ZW5lcnMgPSBodHRwU2VydmVyLmxpc3RlbmVycyhldmVudCkuc2xpY2UoMCk7XG4gICAgICBodHRwU2VydmVyLnJlbW92ZUFsbExpc3RlbmVycyhldmVudCk7XG5cbiAgICAgIC8vIHJlcXVlc3QgYW5kIHVwZ3JhZGUgaGF2ZSBkaWZmZXJlbnQgYXJndW1lbnRzIHBhc3NlZCBidXRcbiAgICAgIC8vIHdlIG9ubHkgY2FyZSBhYm91dCB0aGUgZmlyc3Qgb25lIHdoaWNoIGlzIGFsd2F5cyByZXF1ZXN0XG4gICAgICB2YXIgbmV3TGlzdGVuZXIgPSBmdW5jdGlvbihyZXF1ZXN0IC8qLCBtb3JlQXJndW1lbnRzICovKSB7XG4gICAgICAgIC8vIFN0b3JlIGFyZ3VtZW50cyBmb3IgdXNlIHdpdGhpbiB0aGUgY2xvc3VyZSBiZWxvd1xuICAgICAgICB2YXIgYXJncyA9IGFyZ3VtZW50cztcblxuICAgICAgICAvLyBSZXdyaXRlIC93ZWJzb2NrZXQgYW5kIC93ZWJzb2NrZXQvIHVybHMgdG8gL3NvY2tqcy93ZWJzb2NrZXQgd2hpbGVcbiAgICAgICAgLy8gcHJlc2VydmluZyBxdWVyeSBzdHJpbmcuXG4gICAgICAgIHZhciBwYXJzZWRVcmwgPSB1cmwucGFyc2UocmVxdWVzdC51cmwpO1xuICAgICAgICBpZiAocGFyc2VkVXJsLnBhdGhuYW1lID09PSBwYXRoUHJlZml4ICsgJy93ZWJzb2NrZXQnIHx8XG4gICAgICAgICAgICBwYXJzZWRVcmwucGF0aG5hbWUgPT09IHBhdGhQcmVmaXggKyAnL3dlYnNvY2tldC8nKSB7XG4gICAgICAgICAgcGFyc2VkVXJsLnBhdGhuYW1lID0gc2VsZi5wcmVmaXggKyAnL3dlYnNvY2tldCc7XG4gICAgICAgICAgcmVxdWVzdC51cmwgPSB1cmwuZm9ybWF0KHBhcnNlZFVybCk7XG4gICAgICAgIH1cbiAgICAgICAgXy5lYWNoKG9sZEh0dHBTZXJ2ZXJMaXN0ZW5lcnMsIGZ1bmN0aW9uKG9sZExpc3RlbmVyKSB7XG4gICAgICAgICAgb2xkTGlzdGVuZXIuYXBwbHkoaHR0cFNlcnZlciwgYXJncyk7XG4gICAgICAgIH0pO1xuICAgICAgfTtcbiAgICAgIGh0dHBTZXJ2ZXIuYWRkTGlzdGVuZXIoZXZlbnQsIG5ld0xpc3RlbmVyKTtcbiAgICB9KTtcbiAgfVxufSk7XG4iLCJERFBTZXJ2ZXIgPSB7fTtcblxudmFyIEZpYmVyID0gTnBtLnJlcXVpcmUoJ2ZpYmVycycpO1xuXG4vLyBUaGlzIGZpbGUgY29udGFpbnMgY2xhc3Nlczpcbi8vICogU2Vzc2lvbiAtIFRoZSBzZXJ2ZXIncyBjb25uZWN0aW9uIHRvIGEgc2luZ2xlIEREUCBjbGllbnRcbi8vICogU3Vic2NyaXB0aW9uIC0gQSBzaW5nbGUgc3Vic2NyaXB0aW9uIGZvciBhIHNpbmdsZSBjbGllbnRcbi8vICogU2VydmVyIC0gQW4gZW50aXJlIHNlcnZlciB0aGF0IG1heSB0YWxrIHRvID4gMSBjbGllbnQuIEEgRERQIGVuZHBvaW50LlxuLy9cbi8vIFNlc3Npb24gYW5kIFN1YnNjcmlwdGlvbiBhcmUgZmlsZSBzY29wZS4gRm9yIG5vdywgdW50aWwgd2UgZnJlZXplXG4vLyB0aGUgaW50ZXJmYWNlLCBTZXJ2ZXIgaXMgcGFja2FnZSBzY29wZSAoaW4gdGhlIGZ1dHVyZSBpdCBzaG91bGQgYmVcbi8vIGV4cG9ydGVkLilcblxuLy8gUmVwcmVzZW50cyBhIHNpbmdsZSBkb2N1bWVudCBpbiBhIFNlc3Npb25Db2xsZWN0aW9uVmlld1xudmFyIFNlc3Npb25Eb2N1bWVudFZpZXcgPSBmdW5jdGlvbiAoKSB7XG4gIHZhciBzZWxmID0gdGhpcztcbiAgc2VsZi5leGlzdHNJbiA9IG5ldyBTZXQoKTsgLy8gc2V0IG9mIHN1YnNjcmlwdGlvbkhhbmRsZVxuICBzZWxmLmRhdGFCeUtleSA9IG5ldyBNYXAoKTsgLy8ga2V5LT4gWyB7c3Vic2NyaXB0aW9uSGFuZGxlLCB2YWx1ZX0gYnkgcHJlY2VkZW5jZV1cbn07XG5cbkREUFNlcnZlci5fU2Vzc2lvbkRvY3VtZW50VmlldyA9IFNlc3Npb25Eb2N1bWVudFZpZXc7XG5cblxuXy5leHRlbmQoU2Vzc2lvbkRvY3VtZW50Vmlldy5wcm90b3R5cGUsIHtcblxuICBnZXRGaWVsZHM6IGZ1bmN0aW9uICgpIHtcbiAgICB2YXIgc2VsZiA9IHRoaXM7XG4gICAgdmFyIHJldCA9IHt9O1xuICAgIHNlbGYuZGF0YUJ5S2V5LmZvckVhY2goZnVuY3Rpb24gKHByZWNlZGVuY2VMaXN0LCBrZXkpIHtcbiAgICAgIHJldFtrZXldID0gcHJlY2VkZW5jZUxpc3RbMF0udmFsdWU7XG4gICAgfSk7XG4gICAgcmV0dXJuIHJldDtcbiAgfSxcblxuICBjbGVhckZpZWxkOiBmdW5jdGlvbiAoc3Vic2NyaXB0aW9uSGFuZGxlLCBrZXksIGNoYW5nZUNvbGxlY3Rvcikge1xuICAgIHZhciBzZWxmID0gdGhpcztcbiAgICAvLyBQdWJsaXNoIEFQSSBpZ25vcmVzIF9pZCBpZiBwcmVzZW50IGluIGZpZWxkc1xuICAgIGlmIChrZXkgPT09IFwiX2lkXCIpXG4gICAgICByZXR1cm47XG4gICAgdmFyIHByZWNlZGVuY2VMaXN0ID0gc2VsZi5kYXRhQnlLZXkuZ2V0KGtleSk7XG5cbiAgICAvLyBJdCdzIG9rYXkgdG8gY2xlYXIgZmllbGRzIHRoYXQgZGlkbid0IGV4aXN0LiBObyBuZWVkIHRvIHRocm93XG4gICAgLy8gYW4gZXJyb3IuXG4gICAgaWYgKCFwcmVjZWRlbmNlTGlzdClcbiAgICAgIHJldHVybjtcblxuICAgIHZhciByZW1vdmVkVmFsdWUgPSB1bmRlZmluZWQ7XG4gICAgZm9yICh2YXIgaSA9IDA7IGkgPCBwcmVjZWRlbmNlTGlzdC5sZW5ndGg7IGkrKykge1xuICAgICAgdmFyIHByZWNlZGVuY2UgPSBwcmVjZWRlbmNlTGlzdFtpXTtcbiAgICAgIGlmIChwcmVjZWRlbmNlLnN1YnNjcmlwdGlvbkhhbmRsZSA9PT0gc3Vic2NyaXB0aW9uSGFuZGxlKSB7XG4gICAgICAgIC8vIFRoZSB2aWV3J3MgdmFsdWUgY2FuIG9ubHkgY2hhbmdlIGlmIHRoaXMgc3Vic2NyaXB0aW9uIGlzIHRoZSBvbmUgdGhhdFxuICAgICAgICAvLyB1c2VkIHRvIGhhdmUgcHJlY2VkZW5jZS5cbiAgICAgICAgaWYgKGkgPT09IDApXG4gICAgICAgICAgcmVtb3ZlZFZhbHVlID0gcHJlY2VkZW5jZS52YWx1ZTtcbiAgICAgICAgcHJlY2VkZW5jZUxpc3Quc3BsaWNlKGksIDEpO1xuICAgICAgICBicmVhaztcbiAgICAgIH1cbiAgICB9XG4gICAgaWYgKHByZWNlZGVuY2VMaXN0Lmxlbmd0aCA9PT0gMCkge1xuICAgICAgc2VsZi5kYXRhQnlLZXkuZGVsZXRlKGtleSk7XG4gICAgICBjaGFuZ2VDb2xsZWN0b3Jba2V5XSA9IHVuZGVmaW5lZDtcbiAgICB9IGVsc2UgaWYgKHJlbW92ZWRWYWx1ZSAhPT0gdW5kZWZpbmVkICYmXG4gICAgICAgICAgICAgICAhRUpTT04uZXF1YWxzKHJlbW92ZWRWYWx1ZSwgcHJlY2VkZW5jZUxpc3RbMF0udmFsdWUpKSB7XG4gICAgICBjaGFuZ2VDb2xsZWN0b3Jba2V5XSA9IHByZWNlZGVuY2VMaXN0WzBdLnZhbHVlO1xuICAgIH1cbiAgfSxcblxuICBjaGFuZ2VGaWVsZDogZnVuY3Rpb24gKHN1YnNjcmlwdGlvbkhhbmRsZSwga2V5LCB2YWx1ZSxcbiAgICAgICAgICAgICAgICAgICAgICAgICBjaGFuZ2VDb2xsZWN0b3IsIGlzQWRkKSB7XG4gICAgdmFyIHNlbGYgPSB0aGlzO1xuICAgIC8vIFB1Ymxpc2ggQVBJIGlnbm9yZXMgX2lkIGlmIHByZXNlbnQgaW4gZmllbGRzXG4gICAgaWYgKGtleSA9PT0gXCJfaWRcIilcbiAgICAgIHJldHVybjtcblxuICAgIC8vIERvbid0IHNoYXJlIHN0YXRlIHdpdGggdGhlIGRhdGEgcGFzc2VkIGluIGJ5IHRoZSB1c2VyLlxuICAgIHZhbHVlID0gRUpTT04uY2xvbmUodmFsdWUpO1xuXG4gICAgaWYgKCFzZWxmLmRhdGFCeUtleS5oYXMoa2V5KSkge1xuICAgICAgc2VsZi5kYXRhQnlLZXkuc2V0KGtleSwgW3tzdWJzY3JpcHRpb25IYW5kbGU6IHN1YnNjcmlwdGlvbkhhbmRsZSxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgdmFsdWU6IHZhbHVlfV0pO1xuICAgICAgY2hhbmdlQ29sbGVjdG9yW2tleV0gPSB2YWx1ZTtcbiAgICAgIHJldHVybjtcbiAgICB9XG4gICAgdmFyIHByZWNlZGVuY2VMaXN0ID0gc2VsZi5kYXRhQnlLZXkuZ2V0KGtleSk7XG4gICAgdmFyIGVsdDtcbiAgICBpZiAoIWlzQWRkKSB7XG4gICAgICBlbHQgPSBwcmVjZWRlbmNlTGlzdC5maW5kKGZ1bmN0aW9uIChwcmVjZWRlbmNlKSB7XG4gICAgICAgICAgcmV0dXJuIHByZWNlZGVuY2Uuc3Vic2NyaXB0aW9uSGFuZGxlID09PSBzdWJzY3JpcHRpb25IYW5kbGU7XG4gICAgICB9KTtcbiAgICB9XG5cbiAgICBpZiAoZWx0KSB7XG4gICAgICBpZiAoZWx0ID09PSBwcmVjZWRlbmNlTGlzdFswXSAmJiAhRUpTT04uZXF1YWxzKHZhbHVlLCBlbHQudmFsdWUpKSB7XG4gICAgICAgIC8vIHRoaXMgc3Vic2NyaXB0aW9uIGlzIGNoYW5naW5nIHRoZSB2YWx1ZSBvZiB0aGlzIGZpZWxkLlxuICAgICAgICBjaGFuZ2VDb2xsZWN0b3Jba2V5XSA9IHZhbHVlO1xuICAgICAgfVxuICAgICAgZWx0LnZhbHVlID0gdmFsdWU7XG4gICAgfSBlbHNlIHtcbiAgICAgIC8vIHRoaXMgc3Vic2NyaXB0aW9uIGlzIG5ld2x5IGNhcmluZyBhYm91dCB0aGlzIGZpZWxkXG4gICAgICBwcmVjZWRlbmNlTGlzdC5wdXNoKHtzdWJzY3JpcHRpb25IYW5kbGU6IHN1YnNjcmlwdGlvbkhhbmRsZSwgdmFsdWU6IHZhbHVlfSk7XG4gICAgfVxuXG4gIH1cbn0pO1xuXG4vKipcbiAqIFJlcHJlc2VudHMgYSBjbGllbnQncyB2aWV3IG9mIGEgc2luZ2xlIGNvbGxlY3Rpb25cbiAqIEBwYXJhbSB7U3RyaW5nfSBjb2xsZWN0aW9uTmFtZSBOYW1lIG9mIHRoZSBjb2xsZWN0aW9uIGl0IHJlcHJlc2VudHNcbiAqIEBwYXJhbSB7T2JqZWN0LjxTdHJpbmcsIEZ1bmN0aW9uPn0gc2Vzc2lvbkNhbGxiYWNrcyBUaGUgY2FsbGJhY2tzIGZvciBhZGRlZCwgY2hhbmdlZCwgcmVtb3ZlZFxuICogQGNsYXNzIFNlc3Npb25Db2xsZWN0aW9uVmlld1xuICovXG52YXIgU2Vzc2lvbkNvbGxlY3Rpb25WaWV3ID0gZnVuY3Rpb24gKGNvbGxlY3Rpb25OYW1lLCBzZXNzaW9uQ2FsbGJhY2tzKSB7XG4gIHZhciBzZWxmID0gdGhpcztcbiAgc2VsZi5jb2xsZWN0aW9uTmFtZSA9IGNvbGxlY3Rpb25OYW1lO1xuICBzZWxmLmRvY3VtZW50cyA9IG5ldyBNYXAoKTtcbiAgc2VsZi5jYWxsYmFja3MgPSBzZXNzaW9uQ2FsbGJhY2tzO1xufTtcblxuRERQU2VydmVyLl9TZXNzaW9uQ29sbGVjdGlvblZpZXcgPSBTZXNzaW9uQ29sbGVjdGlvblZpZXc7XG5cblxuXy5leHRlbmQoU2Vzc2lvbkNvbGxlY3Rpb25WaWV3LnByb3RvdHlwZSwge1xuXG4gIGlzRW1wdHk6IGZ1bmN0aW9uICgpIHtcbiAgICB2YXIgc2VsZiA9IHRoaXM7XG4gICAgcmV0dXJuIHNlbGYuZG9jdW1lbnRzLnNpemUgPT09IDA7XG4gIH0sXG5cbiAgZGlmZjogZnVuY3Rpb24gKHByZXZpb3VzKSB7XG4gICAgdmFyIHNlbGYgPSB0aGlzO1xuICAgIERpZmZTZXF1ZW5jZS5kaWZmTWFwcyhwcmV2aW91cy5kb2N1bWVudHMsIHNlbGYuZG9jdW1lbnRzLCB7XG4gICAgICBib3RoOiBfLmJpbmQoc2VsZi5kaWZmRG9jdW1lbnQsIHNlbGYpLFxuXG4gICAgICByaWdodE9ubHk6IGZ1bmN0aW9uIChpZCwgbm93RFYpIHtcbiAgICAgICAgc2VsZi5jYWxsYmFja3MuYWRkZWQoc2VsZi5jb2xsZWN0aW9uTmFtZSwgaWQsIG5vd0RWLmdldEZpZWxkcygpKTtcbiAgICAgIH0sXG5cbiAgICAgIGxlZnRPbmx5OiBmdW5jdGlvbiAoaWQsIHByZXZEVikge1xuICAgICAgICBzZWxmLmNhbGxiYWNrcy5yZW1vdmVkKHNlbGYuY29sbGVjdGlvbk5hbWUsIGlkKTtcbiAgICAgIH1cbiAgICB9KTtcbiAgfSxcblxuICBkaWZmRG9jdW1lbnQ6IGZ1bmN0aW9uIChpZCwgcHJldkRWLCBub3dEVikge1xuICAgIHZhciBzZWxmID0gdGhpcztcbiAgICB2YXIgZmllbGRzID0ge307XG4gICAgRGlmZlNlcXVlbmNlLmRpZmZPYmplY3RzKHByZXZEVi5nZXRGaWVsZHMoKSwgbm93RFYuZ2V0RmllbGRzKCksIHtcbiAgICAgIGJvdGg6IGZ1bmN0aW9uIChrZXksIHByZXYsIG5vdykge1xuICAgICAgICBpZiAoIUVKU09OLmVxdWFscyhwcmV2LCBub3cpKVxuICAgICAgICAgIGZpZWxkc1trZXldID0gbm93O1xuICAgICAgfSxcbiAgICAgIHJpZ2h0T25seTogZnVuY3Rpb24gKGtleSwgbm93KSB7XG4gICAgICAgIGZpZWxkc1trZXldID0gbm93O1xuICAgICAgfSxcbiAgICAgIGxlZnRPbmx5OiBmdW5jdGlvbihrZXksIHByZXYpIHtcbiAgICAgICAgZmllbGRzW2tleV0gPSB1bmRlZmluZWQ7XG4gICAgICB9XG4gICAgfSk7XG4gICAgc2VsZi5jYWxsYmFja3MuY2hhbmdlZChzZWxmLmNvbGxlY3Rpb25OYW1lLCBpZCwgZmllbGRzKTtcbiAgfSxcblxuICBhZGRlZDogZnVuY3Rpb24gKHN1YnNjcmlwdGlvbkhhbmRsZSwgaWQsIGZpZWxkcykge1xuICAgIHZhciBzZWxmID0gdGhpcztcbiAgICB2YXIgZG9jVmlldyA9IHNlbGYuZG9jdW1lbnRzLmdldChpZCk7XG4gICAgdmFyIGFkZGVkID0gZmFsc2U7XG4gICAgaWYgKCFkb2NWaWV3KSB7XG4gICAgICBhZGRlZCA9IHRydWU7XG4gICAgICBkb2NWaWV3ID0gbmV3IFNlc3Npb25Eb2N1bWVudFZpZXcoKTtcbiAgICAgIHNlbGYuZG9jdW1lbnRzLnNldChpZCwgZG9jVmlldyk7XG4gICAgfVxuICAgIGRvY1ZpZXcuZXhpc3RzSW4uYWRkKHN1YnNjcmlwdGlvbkhhbmRsZSk7XG4gICAgdmFyIGNoYW5nZUNvbGxlY3RvciA9IHt9O1xuICAgIF8uZWFjaChmaWVsZHMsIGZ1bmN0aW9uICh2YWx1ZSwga2V5KSB7XG4gICAgICBkb2NWaWV3LmNoYW5nZUZpZWxkKFxuICAgICAgICBzdWJzY3JpcHRpb25IYW5kbGUsIGtleSwgdmFsdWUsIGNoYW5nZUNvbGxlY3RvciwgdHJ1ZSk7XG4gICAgfSk7XG4gICAgaWYgKGFkZGVkKVxuICAgICAgc2VsZi5jYWxsYmFja3MuYWRkZWQoc2VsZi5jb2xsZWN0aW9uTmFtZSwgaWQsIGNoYW5nZUNvbGxlY3Rvcik7XG4gICAgZWxzZVxuICAgICAgc2VsZi5jYWxsYmFja3MuY2hhbmdlZChzZWxmLmNvbGxlY3Rpb25OYW1lLCBpZCwgY2hhbmdlQ29sbGVjdG9yKTtcbiAgfSxcblxuICBjaGFuZ2VkOiBmdW5jdGlvbiAoc3Vic2NyaXB0aW9uSGFuZGxlLCBpZCwgY2hhbmdlZCkge1xuICAgIHZhciBzZWxmID0gdGhpcztcbiAgICB2YXIgY2hhbmdlZFJlc3VsdCA9IHt9O1xuICAgIHZhciBkb2NWaWV3ID0gc2VsZi5kb2N1bWVudHMuZ2V0KGlkKTtcbiAgICBpZiAoIWRvY1ZpZXcpXG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXCJDb3VsZCBub3QgZmluZCBlbGVtZW50IHdpdGggaWQgXCIgKyBpZCArIFwiIHRvIGNoYW5nZVwiKTtcbiAgICBfLmVhY2goY2hhbmdlZCwgZnVuY3Rpb24gKHZhbHVlLCBrZXkpIHtcbiAgICAgIGlmICh2YWx1ZSA9PT0gdW5kZWZpbmVkKVxuICAgICAgICBkb2NWaWV3LmNsZWFyRmllbGQoc3Vic2NyaXB0aW9uSGFuZGxlLCBrZXksIGNoYW5nZWRSZXN1bHQpO1xuICAgICAgZWxzZVxuICAgICAgICBkb2NWaWV3LmNoYW5nZUZpZWxkKHN1YnNjcmlwdGlvbkhhbmRsZSwga2V5LCB2YWx1ZSwgY2hhbmdlZFJlc3VsdCk7XG4gICAgfSk7XG4gICAgc2VsZi5jYWxsYmFja3MuY2hhbmdlZChzZWxmLmNvbGxlY3Rpb25OYW1lLCBpZCwgY2hhbmdlZFJlc3VsdCk7XG4gIH0sXG5cbiAgcmVtb3ZlZDogZnVuY3Rpb24gKHN1YnNjcmlwdGlvbkhhbmRsZSwgaWQpIHtcbiAgICB2YXIgc2VsZiA9IHRoaXM7XG4gICAgdmFyIGRvY1ZpZXcgPSBzZWxmLmRvY3VtZW50cy5nZXQoaWQpO1xuICAgIGlmICghZG9jVmlldykge1xuICAgICAgdmFyIGVyciA9IG5ldyBFcnJvcihcIlJlbW92ZWQgbm9uZXhpc3RlbnQgZG9jdW1lbnQgXCIgKyBpZCk7XG4gICAgICB0aHJvdyBlcnI7XG4gICAgfVxuICAgIGRvY1ZpZXcuZXhpc3RzSW4uZGVsZXRlKHN1YnNjcmlwdGlvbkhhbmRsZSk7XG4gICAgaWYgKGRvY1ZpZXcuZXhpc3RzSW4uc2l6ZSA9PT0gMCkge1xuICAgICAgLy8gaXQgaXMgZ29uZSBmcm9tIGV2ZXJ5b25lXG4gICAgICBzZWxmLmNhbGxiYWNrcy5yZW1vdmVkKHNlbGYuY29sbGVjdGlvbk5hbWUsIGlkKTtcbiAgICAgIHNlbGYuZG9jdW1lbnRzLmRlbGV0ZShpZCk7XG4gICAgfSBlbHNlIHtcbiAgICAgIHZhciBjaGFuZ2VkID0ge307XG4gICAgICAvLyByZW1vdmUgdGhpcyBzdWJzY3JpcHRpb24gZnJvbSBldmVyeSBwcmVjZWRlbmNlIGxpc3RcbiAgICAgIC8vIGFuZCByZWNvcmQgdGhlIGNoYW5nZXNcbiAgICAgIGRvY1ZpZXcuZGF0YUJ5S2V5LmZvckVhY2goZnVuY3Rpb24gKHByZWNlZGVuY2VMaXN0LCBrZXkpIHtcbiAgICAgICAgZG9jVmlldy5jbGVhckZpZWxkKHN1YnNjcmlwdGlvbkhhbmRsZSwga2V5LCBjaGFuZ2VkKTtcbiAgICAgIH0pO1xuXG4gICAgICBzZWxmLmNhbGxiYWNrcy5jaGFuZ2VkKHNlbGYuY29sbGVjdGlvbk5hbWUsIGlkLCBjaGFuZ2VkKTtcbiAgICB9XG4gIH1cbn0pO1xuXG4vKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqL1xuLyogU2Vzc2lvbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgKi9cbi8qKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKiovXG5cbnZhciBTZXNzaW9uID0gZnVuY3Rpb24gKHNlcnZlciwgdmVyc2lvbiwgc29ja2V0LCBvcHRpb25zKSB7XG4gIHZhciBzZWxmID0gdGhpcztcbiAgc2VsZi5pZCA9IFJhbmRvbS5pZCgpO1xuXG4gIHNlbGYuc2VydmVyID0gc2VydmVyO1xuICBzZWxmLnZlcnNpb24gPSB2ZXJzaW9uO1xuXG4gIHNlbGYuaW5pdGlhbGl6ZWQgPSBmYWxzZTtcbiAgc2VsZi5zb2NrZXQgPSBzb2NrZXQ7XG5cbiAgLy8gc2V0IHRvIG51bGwgd2hlbiB0aGUgc2Vzc2lvbiBpcyBkZXN0cm95ZWQuIG11bHRpcGxlIHBsYWNlcyBiZWxvd1xuICAvLyB1c2UgdGhpcyB0byBkZXRlcm1pbmUgaWYgdGhlIHNlc3Npb24gaXMgYWxpdmUgb3Igbm90LlxuICBzZWxmLmluUXVldWUgPSBuZXcgTWV0ZW9yLl9Eb3VibGVFbmRlZFF1ZXVlKCk7XG5cbiAgc2VsZi5ibG9ja2VkID0gZmFsc2U7XG4gIHNlbGYud29ya2VyUnVubmluZyA9IGZhbHNlO1xuXG4gIC8vIFN1YiBvYmplY3RzIGZvciBhY3RpdmUgc3Vic2NyaXB0aW9uc1xuICBzZWxmLl9uYW1lZFN1YnMgPSBuZXcgTWFwKCk7XG4gIHNlbGYuX3VuaXZlcnNhbFN1YnMgPSBbXTtcblxuICBzZWxmLnVzZXJJZCA9IG51bGw7XG5cbiAgc2VsZi5jb2xsZWN0aW9uVmlld3MgPSBuZXcgTWFwKCk7XG5cbiAgLy8gU2V0IHRoaXMgdG8gZmFsc2UgdG8gbm90IHNlbmQgbWVzc2FnZXMgd2hlbiBjb2xsZWN0aW9uVmlld3MgYXJlXG4gIC8vIG1vZGlmaWVkLiBUaGlzIGlzIGRvbmUgd2hlbiByZXJ1bm5pbmcgc3VicyBpbiBfc2V0VXNlcklkIGFuZCB0aG9zZSBtZXNzYWdlc1xuICAvLyBhcmUgY2FsY3VsYXRlZCB2aWEgYSBkaWZmIGluc3RlYWQuXG4gIHNlbGYuX2lzU2VuZGluZyA9IHRydWU7XG5cbiAgLy8gSWYgdGhpcyBpcyB0cnVlLCBkb24ndCBzdGFydCBhIG5ld2x5LWNyZWF0ZWQgdW5pdmVyc2FsIHB1Ymxpc2hlciBvbiB0aGlzXG4gIC8vIHNlc3Npb24uIFRoZSBzZXNzaW9uIHdpbGwgdGFrZSBjYXJlIG9mIHN0YXJ0aW5nIGl0IHdoZW4gYXBwcm9wcmlhdGUuXG4gIHNlbGYuX2RvbnRTdGFydE5ld1VuaXZlcnNhbFN1YnMgPSBmYWxzZTtcblxuICAvLyB3aGVuIHdlIGFyZSByZXJ1bm5pbmcgc3Vic2NyaXB0aW9ucywgYW55IHJlYWR5IG1lc3NhZ2VzXG4gIC8vIHdlIHdhbnQgdG8gYnVmZmVyIHVwIGZvciB3aGVuIHdlIGFyZSBkb25lIHJlcnVubmluZyBzdWJzY3JpcHRpb25zXG4gIHNlbGYuX3BlbmRpbmdSZWFkeSA9IFtdO1xuXG4gIC8vIExpc3Qgb2YgY2FsbGJhY2tzIHRvIGNhbGwgd2hlbiB0aGlzIGNvbm5lY3Rpb24gaXMgY2xvc2VkLlxuICBzZWxmLl9jbG9zZUNhbGxiYWNrcyA9IFtdO1xuXG5cbiAgLy8gWFhYIEhBQ0s6IElmIGEgc29ja2pzIGNvbm5lY3Rpb24sIHNhdmUgb2ZmIHRoZSBVUkwuIFRoaXMgaXNcbiAgLy8gdGVtcG9yYXJ5IGFuZCB3aWxsIGdvIGF3YXkgaW4gdGhlIG5lYXIgZnV0dXJlLlxuICBzZWxmLl9zb2NrZXRVcmwgPSBzb2NrZXQudXJsO1xuXG4gIC8vIEFsbG93IHRlc3RzIHRvIGRpc2FibGUgcmVzcG9uZGluZyB0byBwaW5ncy5cbiAgc2VsZi5fcmVzcG9uZFRvUGluZ3MgPSBvcHRpb25zLnJlc3BvbmRUb1BpbmdzO1xuXG4gIC8vIFRoaXMgb2JqZWN0IGlzIHRoZSBwdWJsaWMgaW50ZXJmYWNlIHRvIHRoZSBzZXNzaW9uLiBJbiB0aGUgcHVibGljXG4gIC8vIEFQSSwgaXQgaXMgY2FsbGVkIHRoZSBgY29ubmVjdGlvbmAgb2JqZWN0LiAgSW50ZXJuYWxseSB3ZSBjYWxsIGl0XG4gIC8vIGEgYGNvbm5lY3Rpb25IYW5kbGVgIHRvIGF2b2lkIGFtYmlndWl0eS5cbiAgc2VsZi5jb25uZWN0aW9uSGFuZGxlID0ge1xuICAgIGlkOiBzZWxmLmlkLFxuICAgIGNsb3NlOiBmdW5jdGlvbiAoKSB7XG4gICAgICBzZWxmLmNsb3NlKCk7XG4gICAgfSxcbiAgICBvbkNsb3NlOiBmdW5jdGlvbiAoZm4pIHtcbiAgICAgIHZhciBjYiA9IE1ldGVvci5iaW5kRW52aXJvbm1lbnQoZm4sIFwiY29ubmVjdGlvbiBvbkNsb3NlIGNhbGxiYWNrXCIpO1xuICAgICAgaWYgKHNlbGYuaW5RdWV1ZSkge1xuICAgICAgICBzZWxmLl9jbG9zZUNhbGxiYWNrcy5wdXNoKGNiKTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIC8vIGlmIHdlJ3JlIGFscmVhZHkgY2xvc2VkLCBjYWxsIHRoZSBjYWxsYmFjay5cbiAgICAgICAgTWV0ZW9yLmRlZmVyKGNiKTtcbiAgICAgIH1cbiAgICB9LFxuICAgIGNsaWVudEFkZHJlc3M6IHNlbGYuX2NsaWVudEFkZHJlc3MoKSxcbiAgICBodHRwSGVhZGVyczogc2VsZi5zb2NrZXQuaGVhZGVyc1xuICB9O1xuXG4gIHNlbGYuc2VuZCh7IG1zZzogJ2Nvbm5lY3RlZCcsIHNlc3Npb246IHNlbGYuaWQgfSk7XG5cbiAgLy8gT24gaW5pdGlhbCBjb25uZWN0LCBzcGluIHVwIGFsbCB0aGUgdW5pdmVyc2FsIHB1Ymxpc2hlcnMuXG4gIEZpYmVyKGZ1bmN0aW9uICgpIHtcbiAgICBzZWxmLnN0YXJ0VW5pdmVyc2FsU3VicygpO1xuICB9KS5ydW4oKTtcblxuICBpZiAodmVyc2lvbiAhPT0gJ3ByZTEnICYmIG9wdGlvbnMuaGVhcnRiZWF0SW50ZXJ2YWwgIT09IDApIHtcbiAgICAvLyBXZSBubyBsb25nZXIgbmVlZCB0aGUgbG93IGxldmVsIHRpbWVvdXQgYmVjYXVzZSB3ZSBoYXZlIGhlYXJ0YmVhdGluZy5cbiAgICBzb2NrZXQuc2V0V2Vic29ja2V0VGltZW91dCgwKTtcblxuICAgIHNlbGYuaGVhcnRiZWF0ID0gbmV3IEREUENvbW1vbi5IZWFydGJlYXQoe1xuICAgICAgaGVhcnRiZWF0SW50ZXJ2YWw6IG9wdGlvbnMuaGVhcnRiZWF0SW50ZXJ2YWwsXG4gICAgICBoZWFydGJlYXRUaW1lb3V0OiBvcHRpb25zLmhlYXJ0YmVhdFRpbWVvdXQsXG4gICAgICBvblRpbWVvdXQ6IGZ1bmN0aW9uICgpIHtcbiAgICAgICAgc2VsZi5jbG9zZSgpO1xuICAgICAgfSxcbiAgICAgIHNlbmRQaW5nOiBmdW5jdGlvbiAoKSB7XG4gICAgICAgIHNlbGYuc2VuZCh7bXNnOiAncGluZyd9KTtcbiAgICAgIH1cbiAgICB9KTtcbiAgICBzZWxmLmhlYXJ0YmVhdC5zdGFydCgpO1xuICB9XG5cbiAgUGFja2FnZVsnZmFjdHMtYmFzZSddICYmIFBhY2thZ2VbJ2ZhY3RzLWJhc2UnXS5GYWN0cy5pbmNyZW1lbnRTZXJ2ZXJGYWN0KFxuICAgIFwibGl2ZWRhdGFcIiwgXCJzZXNzaW9uc1wiLCAxKTtcbn07XG5cbl8uZXh0ZW5kKFNlc3Npb24ucHJvdG90eXBlLCB7XG5cbiAgc2VuZFJlYWR5OiBmdW5jdGlvbiAoc3Vic2NyaXB0aW9uSWRzKSB7XG4gICAgdmFyIHNlbGYgPSB0aGlzO1xuICAgIGlmIChzZWxmLl9pc1NlbmRpbmcpXG4gICAgICBzZWxmLnNlbmQoe21zZzogXCJyZWFkeVwiLCBzdWJzOiBzdWJzY3JpcHRpb25JZHN9KTtcbiAgICBlbHNlIHtcbiAgICAgIF8uZWFjaChzdWJzY3JpcHRpb25JZHMsIGZ1bmN0aW9uIChzdWJzY3JpcHRpb25JZCkge1xuICAgICAgICBzZWxmLl9wZW5kaW5nUmVhZHkucHVzaChzdWJzY3JpcHRpb25JZCk7XG4gICAgICB9KTtcbiAgICB9XG4gIH0sXG5cbiAgc2VuZEFkZGVkOiBmdW5jdGlvbiAoY29sbGVjdGlvbk5hbWUsIGlkLCBmaWVsZHMpIHtcbiAgICB2YXIgc2VsZiA9IHRoaXM7XG4gICAgaWYgKHNlbGYuX2lzU2VuZGluZylcbiAgICAgIHNlbGYuc2VuZCh7bXNnOiBcImFkZGVkXCIsIGNvbGxlY3Rpb246IGNvbGxlY3Rpb25OYW1lLCBpZDogaWQsIGZpZWxkczogZmllbGRzfSk7XG4gIH0sXG5cbiAgc2VuZENoYW5nZWQ6IGZ1bmN0aW9uIChjb2xsZWN0aW9uTmFtZSwgaWQsIGZpZWxkcykge1xuICAgIHZhciBzZWxmID0gdGhpcztcbiAgICBpZiAoXy5pc0VtcHR5KGZpZWxkcykpXG4gICAgICByZXR1cm47XG5cbiAgICBpZiAoc2VsZi5faXNTZW5kaW5nKSB7XG4gICAgICBzZWxmLnNlbmQoe1xuICAgICAgICBtc2c6IFwiY2hhbmdlZFwiLFxuICAgICAgICBjb2xsZWN0aW9uOiBjb2xsZWN0aW9uTmFtZSxcbiAgICAgICAgaWQ6IGlkLFxuICAgICAgICBmaWVsZHM6IGZpZWxkc1xuICAgICAgfSk7XG4gICAgfVxuICB9LFxuXG4gIHNlbmRSZW1vdmVkOiBmdW5jdGlvbiAoY29sbGVjdGlvbk5hbWUsIGlkKSB7XG4gICAgdmFyIHNlbGYgPSB0aGlzO1xuICAgIGlmIChzZWxmLl9pc1NlbmRpbmcpXG4gICAgICBzZWxmLnNlbmQoe21zZzogXCJyZW1vdmVkXCIsIGNvbGxlY3Rpb246IGNvbGxlY3Rpb25OYW1lLCBpZDogaWR9KTtcbiAgfSxcblxuICBnZXRTZW5kQ2FsbGJhY2tzOiBmdW5jdGlvbiAoKSB7XG4gICAgdmFyIHNlbGYgPSB0aGlzO1xuICAgIHJldHVybiB7XG4gICAgICBhZGRlZDogXy5iaW5kKHNlbGYuc2VuZEFkZGVkLCBzZWxmKSxcbiAgICAgIGNoYW5nZWQ6IF8uYmluZChzZWxmLnNlbmRDaGFuZ2VkLCBzZWxmKSxcbiAgICAgIHJlbW92ZWQ6IF8uYmluZChzZWxmLnNlbmRSZW1vdmVkLCBzZWxmKVxuICAgIH07XG4gIH0sXG5cbiAgZ2V0Q29sbGVjdGlvblZpZXc6IGZ1bmN0aW9uIChjb2xsZWN0aW9uTmFtZSkge1xuICAgIHZhciBzZWxmID0gdGhpcztcbiAgICB2YXIgcmV0ID0gc2VsZi5jb2xsZWN0aW9uVmlld3MuZ2V0KGNvbGxlY3Rpb25OYW1lKTtcbiAgICBpZiAoIXJldCkge1xuICAgICAgcmV0ID0gbmV3IFNlc3Npb25Db2xsZWN0aW9uVmlldyhjb2xsZWN0aW9uTmFtZSxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBzZWxmLmdldFNlbmRDYWxsYmFja3MoKSk7XG4gICAgICBzZWxmLmNvbGxlY3Rpb25WaWV3cy5zZXQoY29sbGVjdGlvbk5hbWUsIHJldCk7XG4gICAgfVxuICAgIHJldHVybiByZXQ7XG4gIH0sXG5cbiAgYWRkZWQ6IGZ1bmN0aW9uIChzdWJzY3JpcHRpb25IYW5kbGUsIGNvbGxlY3Rpb25OYW1lLCBpZCwgZmllbGRzKSB7XG4gICAgdmFyIHNlbGYgPSB0aGlzO1xuICAgIHZhciB2aWV3ID0gc2VsZi5nZXRDb2xsZWN0aW9uVmlldyhjb2xsZWN0aW9uTmFtZSk7XG4gICAgdmlldy5hZGRlZChzdWJzY3JpcHRpb25IYW5kbGUsIGlkLCBmaWVsZHMpO1xuICB9LFxuXG4gIHJlbW92ZWQ6IGZ1bmN0aW9uIChzdWJzY3JpcHRpb25IYW5kbGUsIGNvbGxlY3Rpb25OYW1lLCBpZCkge1xuICAgIHZhciBzZWxmID0gdGhpcztcbiAgICB2YXIgdmlldyA9IHNlbGYuZ2V0Q29sbGVjdGlvblZpZXcoY29sbGVjdGlvbk5hbWUpO1xuICAgIHZpZXcucmVtb3ZlZChzdWJzY3JpcHRpb25IYW5kbGUsIGlkKTtcbiAgICBpZiAodmlldy5pc0VtcHR5KCkpIHtcbiAgICAgICBzZWxmLmNvbGxlY3Rpb25WaWV3cy5kZWxldGUoY29sbGVjdGlvbk5hbWUpO1xuICAgIH1cbiAgfSxcblxuICBjaGFuZ2VkOiBmdW5jdGlvbiAoc3Vic2NyaXB0aW9uSGFuZGxlLCBjb2xsZWN0aW9uTmFtZSwgaWQsIGZpZWxkcykge1xuICAgIHZhciBzZWxmID0gdGhpcztcbiAgICB2YXIgdmlldyA9IHNlbGYuZ2V0Q29sbGVjdGlvblZpZXcoY29sbGVjdGlvbk5hbWUpO1xuICAgIHZpZXcuY2hhbmdlZChzdWJzY3JpcHRpb25IYW5kbGUsIGlkLCBmaWVsZHMpO1xuICB9LFxuXG4gIHN0YXJ0VW5pdmVyc2FsU3ViczogZnVuY3Rpb24gKCkge1xuICAgIHZhciBzZWxmID0gdGhpcztcbiAgICAvLyBNYWtlIGEgc2hhbGxvdyBjb3B5IG9mIHRoZSBzZXQgb2YgdW5pdmVyc2FsIGhhbmRsZXJzIGFuZCBzdGFydCB0aGVtLiBJZlxuICAgIC8vIGFkZGl0aW9uYWwgdW5pdmVyc2FsIHB1Ymxpc2hlcnMgc3RhcnQgd2hpbGUgd2UncmUgcnVubmluZyB0aGVtIChkdWUgdG9cbiAgICAvLyB5aWVsZGluZyksIHRoZXkgd2lsbCBydW4gc2VwYXJhdGVseSBhcyBwYXJ0IG9mIFNlcnZlci5wdWJsaXNoLlxuICAgIHZhciBoYW5kbGVycyA9IF8uY2xvbmUoc2VsZi5zZXJ2ZXIudW5pdmVyc2FsX3B1Ymxpc2hfaGFuZGxlcnMpO1xuICAgIF8uZWFjaChoYW5kbGVycywgZnVuY3Rpb24gKGhhbmRsZXIpIHtcbiAgICAgIHNlbGYuX3N0YXJ0U3Vic2NyaXB0aW9uKGhhbmRsZXIpO1xuICAgIH0pO1xuICB9LFxuXG4gIC8vIERlc3Ryb3kgdGhpcyBzZXNzaW9uIGFuZCB1bnJlZ2lzdGVyIGl0IGF0IHRoZSBzZXJ2ZXIuXG4gIGNsb3NlOiBmdW5jdGlvbiAoKSB7XG4gICAgdmFyIHNlbGYgPSB0aGlzO1xuXG4gICAgLy8gRGVzdHJveSB0aGlzIHNlc3Npb24sIGV2ZW4gaWYgaXQncyBub3QgcmVnaXN0ZXJlZCBhdCB0aGVcbiAgICAvLyBzZXJ2ZXIuIFN0b3AgYWxsIHByb2Nlc3NpbmcgYW5kIHRlYXIgZXZlcnl0aGluZyBkb3duLiBJZiBhIHNvY2tldFxuICAgIC8vIHdhcyBhdHRhY2hlZCwgY2xvc2UgaXQuXG5cbiAgICAvLyBBbHJlYWR5IGRlc3Ryb3llZC5cbiAgICBpZiAoISBzZWxmLmluUXVldWUpXG4gICAgICByZXR1cm47XG5cbiAgICAvLyBEcm9wIHRoZSBtZXJnZSBib3ggZGF0YSBpbW1lZGlhdGVseS5cbiAgICBzZWxmLmluUXVldWUgPSBudWxsO1xuICAgIHNlbGYuY29sbGVjdGlvblZpZXdzID0gbmV3IE1hcCgpO1xuXG4gICAgaWYgKHNlbGYuaGVhcnRiZWF0KSB7XG4gICAgICBzZWxmLmhlYXJ0YmVhdC5zdG9wKCk7XG4gICAgICBzZWxmLmhlYXJ0YmVhdCA9IG51bGw7XG4gICAgfVxuXG4gICAgaWYgKHNlbGYuc29ja2V0KSB7XG4gICAgICBzZWxmLnNvY2tldC5jbG9zZSgpO1xuICAgICAgc2VsZi5zb2NrZXQuX21ldGVvclNlc3Npb24gPSBudWxsO1xuICAgIH1cblxuICAgIFBhY2thZ2VbJ2ZhY3RzLWJhc2UnXSAmJiBQYWNrYWdlWydmYWN0cy1iYXNlJ10uRmFjdHMuaW5jcmVtZW50U2VydmVyRmFjdChcbiAgICAgIFwibGl2ZWRhdGFcIiwgXCJzZXNzaW9uc1wiLCAtMSk7XG5cbiAgICBNZXRlb3IuZGVmZXIoZnVuY3Rpb24gKCkge1xuICAgICAgLy8gc3RvcCBjYWxsYmFja3MgY2FuIHlpZWxkLCBzbyB3ZSBkZWZlciB0aGlzIG9uIGNsb3NlLlxuICAgICAgLy8gc3ViLl9pc0RlYWN0aXZhdGVkKCkgZGV0ZWN0cyB0aGF0IHdlIHNldCBpblF1ZXVlIHRvIG51bGwgYW5kXG4gICAgICAvLyB0cmVhdHMgaXQgYXMgc2VtaS1kZWFjdGl2YXRlZCAoaXQgd2lsbCBpZ25vcmUgaW5jb21pbmcgY2FsbGJhY2tzLCBldGMpLlxuICAgICAgc2VsZi5fZGVhY3RpdmF0ZUFsbFN1YnNjcmlwdGlvbnMoKTtcblxuICAgICAgLy8gRGVmZXIgY2FsbGluZyB0aGUgY2xvc2UgY2FsbGJhY2tzLCBzbyB0aGF0IHRoZSBjYWxsZXIgY2xvc2luZ1xuICAgICAgLy8gdGhlIHNlc3Npb24gaXNuJ3Qgd2FpdGluZyBmb3IgYWxsIHRoZSBjYWxsYmFja3MgdG8gY29tcGxldGUuXG4gICAgICBfLmVhY2goc2VsZi5fY2xvc2VDYWxsYmFja3MsIGZ1bmN0aW9uIChjYWxsYmFjaykge1xuICAgICAgICBjYWxsYmFjaygpO1xuICAgICAgfSk7XG4gICAgfSk7XG5cbiAgICAvLyBVbnJlZ2lzdGVyIHRoZSBzZXNzaW9uLlxuICAgIHNlbGYuc2VydmVyLl9yZW1vdmVTZXNzaW9uKHNlbGYpO1xuICB9LFxuXG4gIC8vIFNlbmQgYSBtZXNzYWdlIChkb2luZyBub3RoaW5nIGlmIG5vIHNvY2tldCBpcyBjb25uZWN0ZWQgcmlnaHQgbm93LilcbiAgLy8gSXQgc2hvdWxkIGJlIGEgSlNPTiBvYmplY3QgKGl0IHdpbGwgYmUgc3RyaW5naWZpZWQuKVxuICBzZW5kOiBmdW5jdGlvbiAobXNnKSB7XG4gICAgdmFyIHNlbGYgPSB0aGlzO1xuICAgIGlmIChzZWxmLnNvY2tldCkge1xuICAgICAgaWYgKE1ldGVvci5fcHJpbnRTZW50RERQKVxuICAgICAgICBNZXRlb3IuX2RlYnVnKFwiU2VudCBERFBcIiwgRERQQ29tbW9uLnN0cmluZ2lmeUREUChtc2cpKTtcbiAgICAgIHNlbGYuc29ja2V0LnNlbmQoRERQQ29tbW9uLnN0cmluZ2lmeUREUChtc2cpKTtcbiAgICB9XG4gIH0sXG5cbiAgLy8gU2VuZCBhIGNvbm5lY3Rpb24gZXJyb3IuXG4gIHNlbmRFcnJvcjogZnVuY3Rpb24gKHJlYXNvbiwgb2ZmZW5kaW5nTWVzc2FnZSkge1xuICAgIHZhciBzZWxmID0gdGhpcztcbiAgICB2YXIgbXNnID0ge21zZzogJ2Vycm9yJywgcmVhc29uOiByZWFzb259O1xuICAgIGlmIChvZmZlbmRpbmdNZXNzYWdlKVxuICAgICAgbXNnLm9mZmVuZGluZ01lc3NhZ2UgPSBvZmZlbmRpbmdNZXNzYWdlO1xuICAgIHNlbGYuc2VuZChtc2cpO1xuICB9LFxuXG4gIC8vIFByb2Nlc3MgJ21zZycgYXMgYW4gaW5jb21pbmcgbWVzc2FnZS4gKEJ1dCBhcyBhIGd1YXJkIGFnYWluc3RcbiAgLy8gcmFjZSBjb25kaXRpb25zIGR1cmluZyByZWNvbm5lY3Rpb24sIGlnbm9yZSB0aGUgbWVzc2FnZSBpZlxuICAvLyAnc29ja2V0JyBpcyBub3QgdGhlIGN1cnJlbnRseSBjb25uZWN0ZWQgc29ja2V0LilcbiAgLy9cbiAgLy8gV2UgcnVuIHRoZSBtZXNzYWdlcyBmcm9tIHRoZSBjbGllbnQgb25lIGF0IGEgdGltZSwgaW4gdGhlIG9yZGVyXG4gIC8vIGdpdmVuIGJ5IHRoZSBjbGllbnQuIFRoZSBtZXNzYWdlIGhhbmRsZXIgaXMgcGFzc2VkIGFuIGlkZW1wb3RlbnRcbiAgLy8gZnVuY3Rpb24gJ3VuYmxvY2snIHdoaWNoIGl0IG1heSBjYWxsIHRvIGFsbG93IG90aGVyIG1lc3NhZ2VzIHRvXG4gIC8vIGJlZ2luIHJ1bm5pbmcgaW4gcGFyYWxsZWwgaW4gYW5vdGhlciBmaWJlciAoZm9yIGV4YW1wbGUsIGEgbWV0aG9kXG4gIC8vIHRoYXQgd2FudHMgdG8geWllbGQuKSBPdGhlcndpc2UsIGl0IGlzIGF1dG9tYXRpY2FsbHkgdW5ibG9ja2VkXG4gIC8vIHdoZW4gaXQgcmV0dXJucy5cbiAgLy9cbiAgLy8gQWN0dWFsbHksIHdlIGRvbid0IGhhdmUgdG8gJ3RvdGFsbHkgb3JkZXInIHRoZSBtZXNzYWdlcyBpbiB0aGlzXG4gIC8vIHdheSwgYnV0IGl0J3MgdGhlIGVhc2llc3QgdGhpbmcgdGhhdCdzIGNvcnJlY3QuICh1bnN1YiBuZWVkcyB0b1xuICAvLyBiZSBvcmRlcmVkIGFnYWluc3Qgc3ViLCBtZXRob2RzIG5lZWQgdG8gYmUgb3JkZXJlZCBhZ2FpbnN0IGVhY2hcbiAgLy8gb3RoZXIuKVxuICBwcm9jZXNzTWVzc2FnZTogZnVuY3Rpb24gKG1zZ19pbikge1xuICAgIHZhciBzZWxmID0gdGhpcztcbiAgICBpZiAoIXNlbGYuaW5RdWV1ZSkgLy8gd2UgaGF2ZSBiZWVuIGRlc3Ryb3llZC5cbiAgICAgIHJldHVybjtcblxuICAgIC8vIFJlc3BvbmQgdG8gcGluZyBhbmQgcG9uZyBtZXNzYWdlcyBpbW1lZGlhdGVseSB3aXRob3V0IHF1ZXVpbmcuXG4gICAgLy8gSWYgdGhlIG5lZ290aWF0ZWQgRERQIHZlcnNpb24gaXMgXCJwcmUxXCIgd2hpY2ggZGlkbid0IHN1cHBvcnRcbiAgICAvLyBwaW5ncywgcHJlc2VydmUgdGhlIFwicHJlMVwiIGJlaGF2aW9yIG9mIHJlc3BvbmRpbmcgd2l0aCBhIFwiYmFkXG4gICAgLy8gcmVxdWVzdFwiIGZvciB0aGUgdW5rbm93biBtZXNzYWdlcy5cbiAgICAvL1xuICAgIC8vIEZpYmVycyBhcmUgbmVlZGVkIGJlY2F1c2UgaGVhcnRiZWF0IHVzZXMgTWV0ZW9yLnNldFRpbWVvdXQsIHdoaWNoXG4gICAgLy8gbmVlZHMgYSBGaWJlci4gV2UgY291bGQgYWN0dWFsbHkgdXNlIHJlZ3VsYXIgc2V0VGltZW91dCBhbmQgYXZvaWRcbiAgICAvLyB0aGVzZSBuZXcgZmliZXJzLCBidXQgaXQgaXMgZWFzaWVyIHRvIGp1c3QgbWFrZSBldmVyeXRoaW5nIHVzZVxuICAgIC8vIE1ldGVvci5zZXRUaW1lb3V0IGFuZCBub3QgdGhpbmsgdG9vIGhhcmQuXG4gICAgLy9cbiAgICAvLyBBbnkgbWVzc2FnZSBjb3VudHMgYXMgcmVjZWl2aW5nIGEgcG9uZywgYXMgaXQgZGVtb25zdHJhdGVzIHRoYXRcbiAgICAvLyB0aGUgY2xpZW50IGlzIHN0aWxsIGFsaXZlLlxuICAgIGlmIChzZWxmLmhlYXJ0YmVhdCkge1xuICAgICAgRmliZXIoZnVuY3Rpb24gKCkge1xuICAgICAgICBzZWxmLmhlYXJ0YmVhdC5tZXNzYWdlUmVjZWl2ZWQoKTtcbiAgICAgIH0pLnJ1bigpO1xuICAgIH1cblxuICAgIGlmIChzZWxmLnZlcnNpb24gIT09ICdwcmUxJyAmJiBtc2dfaW4ubXNnID09PSAncGluZycpIHtcbiAgICAgIGlmIChzZWxmLl9yZXNwb25kVG9QaW5ncylcbiAgICAgICAgc2VsZi5zZW5kKHttc2c6IFwicG9uZ1wiLCBpZDogbXNnX2luLmlkfSk7XG4gICAgICByZXR1cm47XG4gICAgfVxuICAgIGlmIChzZWxmLnZlcnNpb24gIT09ICdwcmUxJyAmJiBtc2dfaW4ubXNnID09PSAncG9uZycpIHtcbiAgICAgIC8vIFNpbmNlIGV2ZXJ5dGhpbmcgaXMgYSBwb25nLCBub3RoaW5nIHRvIGRvXG4gICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgc2VsZi5pblF1ZXVlLnB1c2gobXNnX2luKTtcbiAgICBpZiAoc2VsZi53b3JrZXJSdW5uaW5nKVxuICAgICAgcmV0dXJuO1xuICAgIHNlbGYud29ya2VyUnVubmluZyA9IHRydWU7XG5cbiAgICB2YXIgcHJvY2Vzc05leHQgPSBmdW5jdGlvbiAoKSB7XG4gICAgICB2YXIgbXNnID0gc2VsZi5pblF1ZXVlICYmIHNlbGYuaW5RdWV1ZS5zaGlmdCgpO1xuICAgICAgaWYgKCFtc2cpIHtcbiAgICAgICAgc2VsZi53b3JrZXJSdW5uaW5nID0gZmFsc2U7XG4gICAgICAgIHJldHVybjtcbiAgICAgIH1cblxuICAgICAgRmliZXIoZnVuY3Rpb24gKCkge1xuICAgICAgICB2YXIgYmxvY2tlZCA9IHRydWU7XG5cbiAgICAgICAgdmFyIHVuYmxvY2sgPSBmdW5jdGlvbiAoKSB7XG4gICAgICAgICAgaWYgKCFibG9ja2VkKVxuICAgICAgICAgICAgcmV0dXJuOyAvLyBpZGVtcG90ZW50XG4gICAgICAgICAgYmxvY2tlZCA9IGZhbHNlO1xuICAgICAgICAgIHByb2Nlc3NOZXh0KCk7XG4gICAgICAgIH07XG5cbiAgICAgICAgc2VsZi5zZXJ2ZXIub25NZXNzYWdlSG9vay5lYWNoKGZ1bmN0aW9uIChjYWxsYmFjaykge1xuICAgICAgICAgIGNhbGxiYWNrKG1zZywgc2VsZik7XG4gICAgICAgICAgcmV0dXJuIHRydWU7XG4gICAgICAgIH0pO1xuXG4gICAgICAgIGlmIChfLmhhcyhzZWxmLnByb3RvY29sX2hhbmRsZXJzLCBtc2cubXNnKSlcbiAgICAgICAgICBzZWxmLnByb3RvY29sX2hhbmRsZXJzW21zZy5tc2ddLmNhbGwoc2VsZiwgbXNnLCB1bmJsb2NrKTtcbiAgICAgICAgZWxzZVxuICAgICAgICAgIHNlbGYuc2VuZEVycm9yKCdCYWQgcmVxdWVzdCcsIG1zZyk7XG4gICAgICAgIHVuYmxvY2soKTsgLy8gaW4gY2FzZSB0aGUgaGFuZGxlciBkaWRuJ3QgYWxyZWFkeSBkbyBpdFxuICAgICAgfSkucnVuKCk7XG4gICAgfTtcblxuICAgIHByb2Nlc3NOZXh0KCk7XG4gIH0sXG5cbiAgcHJvdG9jb2xfaGFuZGxlcnM6IHtcbiAgICBzdWI6IGZ1bmN0aW9uIChtc2cpIHtcbiAgICAgIHZhciBzZWxmID0gdGhpcztcblxuICAgICAgLy8gcmVqZWN0IG1hbGZvcm1lZCBtZXNzYWdlc1xuICAgICAgaWYgKHR5cGVvZiAobXNnLmlkKSAhPT0gXCJzdHJpbmdcIiB8fFxuICAgICAgICAgIHR5cGVvZiAobXNnLm5hbWUpICE9PSBcInN0cmluZ1wiIHx8XG4gICAgICAgICAgKCgncGFyYW1zJyBpbiBtc2cpICYmICEobXNnLnBhcmFtcyBpbnN0YW5jZW9mIEFycmF5KSkpIHtcbiAgICAgICAgc2VsZi5zZW5kRXJyb3IoXCJNYWxmb3JtZWQgc3Vic2NyaXB0aW9uXCIsIG1zZyk7XG4gICAgICAgIHJldHVybjtcbiAgICAgIH1cblxuICAgICAgaWYgKCFzZWxmLnNlcnZlci5wdWJsaXNoX2hhbmRsZXJzW21zZy5uYW1lXSkge1xuICAgICAgICBzZWxmLnNlbmQoe1xuICAgICAgICAgIG1zZzogJ25vc3ViJywgaWQ6IG1zZy5pZCxcbiAgICAgICAgICBlcnJvcjogbmV3IE1ldGVvci5FcnJvcig0MDQsIGBTdWJzY3JpcHRpb24gJyR7bXNnLm5hbWV9JyBub3QgZm91bmRgKX0pO1xuICAgICAgICByZXR1cm47XG4gICAgICB9XG5cbiAgICAgIGlmIChzZWxmLl9uYW1lZFN1YnMuaGFzKG1zZy5pZCkpXG4gICAgICAgIC8vIHN1YnMgYXJlIGlkZW1wb3RlbnQsIG9yIHJhdGhlciwgdGhleSBhcmUgaWdub3JlZCBpZiBhIHN1YlxuICAgICAgICAvLyB3aXRoIHRoYXQgaWQgYWxyZWFkeSBleGlzdHMuIHRoaXMgaXMgaW1wb3J0YW50IGR1cmluZ1xuICAgICAgICAvLyByZWNvbm5lY3QuXG4gICAgICAgIHJldHVybjtcblxuICAgICAgLy8gWFhYIEl0J2QgYmUgbXVjaCBiZXR0ZXIgaWYgd2UgaGFkIGdlbmVyaWMgaG9va3Mgd2hlcmUgYW55IHBhY2thZ2UgY2FuXG4gICAgICAvLyBob29rIGludG8gc3Vic2NyaXB0aW9uIGhhbmRsaW5nLCBidXQgaW4gdGhlIG1lYW4gd2hpbGUgd2Ugc3BlY2lhbCBjYXNlXG4gICAgICAvLyBkZHAtcmF0ZS1saW1pdGVyIHBhY2thZ2UuIFRoaXMgaXMgYWxzbyBkb25lIGZvciB3ZWFrIHJlcXVpcmVtZW50cyB0b1xuICAgICAgLy8gYWRkIHRoZSBkZHAtcmF0ZS1saW1pdGVyIHBhY2thZ2UgaW4gY2FzZSB3ZSBkb24ndCBoYXZlIEFjY291bnRzLiBBXG4gICAgICAvLyB1c2VyIHRyeWluZyB0byB1c2UgdGhlIGRkcC1yYXRlLWxpbWl0ZXIgbXVzdCBleHBsaWNpdGx5IHJlcXVpcmUgaXQuXG4gICAgICBpZiAoUGFja2FnZVsnZGRwLXJhdGUtbGltaXRlciddKSB7XG4gICAgICAgIHZhciBERFBSYXRlTGltaXRlciA9IFBhY2thZ2VbJ2RkcC1yYXRlLWxpbWl0ZXInXS5ERFBSYXRlTGltaXRlcjtcbiAgICAgICAgdmFyIHJhdGVMaW1pdGVySW5wdXQgPSB7XG4gICAgICAgICAgdXNlcklkOiBzZWxmLnVzZXJJZCxcbiAgICAgICAgICBjbGllbnRBZGRyZXNzOiBzZWxmLmNvbm5lY3Rpb25IYW5kbGUuY2xpZW50QWRkcmVzcyxcbiAgICAgICAgICB0eXBlOiBcInN1YnNjcmlwdGlvblwiLFxuICAgICAgICAgIG5hbWU6IG1zZy5uYW1lLFxuICAgICAgICAgIGNvbm5lY3Rpb25JZDogc2VsZi5pZFxuICAgICAgICB9O1xuXG4gICAgICAgIEREUFJhdGVMaW1pdGVyLl9pbmNyZW1lbnQocmF0ZUxpbWl0ZXJJbnB1dCk7XG4gICAgICAgIHZhciByYXRlTGltaXRSZXN1bHQgPSBERFBSYXRlTGltaXRlci5fY2hlY2socmF0ZUxpbWl0ZXJJbnB1dCk7XG4gICAgICAgIGlmICghcmF0ZUxpbWl0UmVzdWx0LmFsbG93ZWQpIHtcbiAgICAgICAgICBzZWxmLnNlbmQoe1xuICAgICAgICAgICAgbXNnOiAnbm9zdWInLCBpZDogbXNnLmlkLFxuICAgICAgICAgICAgZXJyb3I6IG5ldyBNZXRlb3IuRXJyb3IoXG4gICAgICAgICAgICAgICd0b28tbWFueS1yZXF1ZXN0cycsXG4gICAgICAgICAgICAgIEREUFJhdGVMaW1pdGVyLmdldEVycm9yTWVzc2FnZShyYXRlTGltaXRSZXN1bHQpLFxuICAgICAgICAgICAgICB7dGltZVRvUmVzZXQ6IHJhdGVMaW1pdFJlc3VsdC50aW1lVG9SZXNldH0pXG4gICAgICAgICAgfSk7XG4gICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG4gICAgICB9XG5cbiAgICAgIHZhciBoYW5kbGVyID0gc2VsZi5zZXJ2ZXIucHVibGlzaF9oYW5kbGVyc1ttc2cubmFtZV07XG5cbiAgICAgIHNlbGYuX3N0YXJ0U3Vic2NyaXB0aW9uKGhhbmRsZXIsIG1zZy5pZCwgbXNnLnBhcmFtcywgbXNnLm5hbWUpO1xuXG4gICAgfSxcblxuICAgIHVuc3ViOiBmdW5jdGlvbiAobXNnKSB7XG4gICAgICB2YXIgc2VsZiA9IHRoaXM7XG5cbiAgICAgIHNlbGYuX3N0b3BTdWJzY3JpcHRpb24obXNnLmlkKTtcbiAgICB9LFxuXG4gICAgbWV0aG9kOiBmdW5jdGlvbiAobXNnLCB1bmJsb2NrKSB7XG4gICAgICB2YXIgc2VsZiA9IHRoaXM7XG5cbiAgICAgIC8vIHJlamVjdCBtYWxmb3JtZWQgbWVzc2FnZXNcbiAgICAgIC8vIEZvciBub3csIHdlIHNpbGVudGx5IGlnbm9yZSB1bmtub3duIGF0dHJpYnV0ZXMsXG4gICAgICAvLyBmb3IgZm9yd2FyZHMgY29tcGF0aWJpbGl0eS5cbiAgICAgIGlmICh0eXBlb2YgKG1zZy5pZCkgIT09IFwic3RyaW5nXCIgfHxcbiAgICAgICAgICB0eXBlb2YgKG1zZy5tZXRob2QpICE9PSBcInN0cmluZ1wiIHx8XG4gICAgICAgICAgKCgncGFyYW1zJyBpbiBtc2cpICYmICEobXNnLnBhcmFtcyBpbnN0YW5jZW9mIEFycmF5KSkgfHxcbiAgICAgICAgICAoKCdyYW5kb21TZWVkJyBpbiBtc2cpICYmICh0eXBlb2YgbXNnLnJhbmRvbVNlZWQgIT09IFwic3RyaW5nXCIpKSkge1xuICAgICAgICBzZWxmLnNlbmRFcnJvcihcIk1hbGZvcm1lZCBtZXRob2QgaW52b2NhdGlvblwiLCBtc2cpO1xuICAgICAgICByZXR1cm47XG4gICAgICB9XG5cbiAgICAgIHZhciByYW5kb21TZWVkID0gbXNnLnJhbmRvbVNlZWQgfHwgbnVsbDtcblxuICAgICAgLy8gc2V0IHVwIHRvIG1hcmsgdGhlIG1ldGhvZCBhcyBzYXRpc2ZpZWQgb25jZSBhbGwgb2JzZXJ2ZXJzXG4gICAgICAvLyAoYW5kIHN1YnNjcmlwdGlvbnMpIGhhdmUgcmVhY3RlZCB0byBhbnkgd3JpdGVzIHRoYXQgd2VyZVxuICAgICAgLy8gZG9uZS5cbiAgICAgIHZhciBmZW5jZSA9IG5ldyBERFBTZXJ2ZXIuX1dyaXRlRmVuY2U7XG4gICAgICBmZW5jZS5vbkFsbENvbW1pdHRlZChmdW5jdGlvbiAoKSB7XG4gICAgICAgIC8vIFJldGlyZSB0aGUgZmVuY2Ugc28gdGhhdCBmdXR1cmUgd3JpdGVzIGFyZSBhbGxvd2VkLlxuICAgICAgICAvLyBUaGlzIG1lYW5zIHRoYXQgY2FsbGJhY2tzIGxpa2UgdGltZXJzIGFyZSBmcmVlIHRvIHVzZVxuICAgICAgICAvLyB0aGUgZmVuY2UsIGFuZCBpZiB0aGV5IGZpcmUgYmVmb3JlIGl0J3MgYXJtZWQgKGZvclxuICAgICAgICAvLyBleGFtcGxlLCBiZWNhdXNlIHRoZSBtZXRob2Qgd2FpdHMgZm9yIHRoZW0pIHRoZWlyXG4gICAgICAgIC8vIHdyaXRlcyB3aWxsIGJlIGluY2x1ZGVkIGluIHRoZSBmZW5jZS5cbiAgICAgICAgZmVuY2UucmV0aXJlKCk7XG4gICAgICAgIHNlbGYuc2VuZCh7XG4gICAgICAgICAgbXNnOiAndXBkYXRlZCcsIG1ldGhvZHM6IFttc2cuaWRdfSk7XG4gICAgICB9KTtcblxuICAgICAgLy8gZmluZCB0aGUgaGFuZGxlclxuICAgICAgdmFyIGhhbmRsZXIgPSBzZWxmLnNlcnZlci5tZXRob2RfaGFuZGxlcnNbbXNnLm1ldGhvZF07XG4gICAgICBpZiAoIWhhbmRsZXIpIHtcbiAgICAgICAgc2VsZi5zZW5kKHtcbiAgICAgICAgICBtc2c6ICdyZXN1bHQnLCBpZDogbXNnLmlkLFxuICAgICAgICAgIGVycm9yOiBuZXcgTWV0ZW9yLkVycm9yKDQwNCwgYE1ldGhvZCAnJHttc2cubWV0aG9kfScgbm90IGZvdW5kYCl9KTtcbiAgICAgICAgZmVuY2UuYXJtKCk7XG4gICAgICAgIHJldHVybjtcbiAgICAgIH1cblxuICAgICAgdmFyIHNldFVzZXJJZCA9IGZ1bmN0aW9uKHVzZXJJZCkge1xuICAgICAgICBzZWxmLl9zZXRVc2VySWQodXNlcklkKTtcbiAgICAgIH07XG5cbiAgICAgIHZhciBpbnZvY2F0aW9uID0gbmV3IEREUENvbW1vbi5NZXRob2RJbnZvY2F0aW9uKHtcbiAgICAgICAgaXNTaW11bGF0aW9uOiBmYWxzZSxcbiAgICAgICAgdXNlcklkOiBzZWxmLnVzZXJJZCxcbiAgICAgICAgc2V0VXNlcklkOiBzZXRVc2VySWQsXG4gICAgICAgIHVuYmxvY2s6IHVuYmxvY2ssXG4gICAgICAgIGNvbm5lY3Rpb246IHNlbGYuY29ubmVjdGlvbkhhbmRsZSxcbiAgICAgICAgcmFuZG9tU2VlZDogcmFuZG9tU2VlZFxuICAgICAgfSk7XG5cbiAgICAgIGNvbnN0IHByb21pc2UgPSBuZXcgUHJvbWlzZSgocmVzb2x2ZSwgcmVqZWN0KSA9PiB7XG4gICAgICAgIC8vIFhYWCBJdCdkIGJlIGJldHRlciBpZiB3ZSBjb3VsZCBob29rIGludG8gbWV0aG9kIGhhbmRsZXJzIGJldHRlciBidXRcbiAgICAgICAgLy8gZm9yIG5vdywgd2UgbmVlZCB0byBjaGVjayBpZiB0aGUgZGRwLXJhdGUtbGltaXRlciBleGlzdHMgc2luY2Ugd2VcbiAgICAgICAgLy8gaGF2ZSBhIHdlYWsgcmVxdWlyZW1lbnQgZm9yIHRoZSBkZHAtcmF0ZS1saW1pdGVyIHBhY2thZ2UgdG8gYmUgYWRkZWRcbiAgICAgICAgLy8gdG8gb3VyIGFwcGxpY2F0aW9uLlxuICAgICAgICBpZiAoUGFja2FnZVsnZGRwLXJhdGUtbGltaXRlciddKSB7XG4gICAgICAgICAgdmFyIEREUFJhdGVMaW1pdGVyID0gUGFja2FnZVsnZGRwLXJhdGUtbGltaXRlciddLkREUFJhdGVMaW1pdGVyO1xuICAgICAgICAgIHZhciByYXRlTGltaXRlcklucHV0ID0ge1xuICAgICAgICAgICAgdXNlcklkOiBzZWxmLnVzZXJJZCxcbiAgICAgICAgICAgIGNsaWVudEFkZHJlc3M6IHNlbGYuY29ubmVjdGlvbkhhbmRsZS5jbGllbnRBZGRyZXNzLFxuICAgICAgICAgICAgdHlwZTogXCJtZXRob2RcIixcbiAgICAgICAgICAgIG5hbWU6IG1zZy5tZXRob2QsXG4gICAgICAgICAgICBjb25uZWN0aW9uSWQ6IHNlbGYuaWRcbiAgICAgICAgICB9O1xuICAgICAgICAgIEREUFJhdGVMaW1pdGVyLl9pbmNyZW1lbnQocmF0ZUxpbWl0ZXJJbnB1dCk7XG4gICAgICAgICAgdmFyIHJhdGVMaW1pdFJlc3VsdCA9IEREUFJhdGVMaW1pdGVyLl9jaGVjayhyYXRlTGltaXRlcklucHV0KVxuICAgICAgICAgIGlmICghcmF0ZUxpbWl0UmVzdWx0LmFsbG93ZWQpIHtcbiAgICAgICAgICAgIHJlamVjdChuZXcgTWV0ZW9yLkVycm9yKFxuICAgICAgICAgICAgICBcInRvby1tYW55LXJlcXVlc3RzXCIsXG4gICAgICAgICAgICAgIEREUFJhdGVMaW1pdGVyLmdldEVycm9yTWVzc2FnZShyYXRlTGltaXRSZXN1bHQpLFxuICAgICAgICAgICAgICB7dGltZVRvUmVzZXQ6IHJhdGVMaW1pdFJlc3VsdC50aW1lVG9SZXNldH1cbiAgICAgICAgICAgICkpO1xuICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICAgIH1cbiAgICAgICAgfVxuXG4gICAgICAgIHJlc29sdmUoRERQU2VydmVyLl9DdXJyZW50V3JpdGVGZW5jZS53aXRoVmFsdWUoXG4gICAgICAgICAgZmVuY2UsXG4gICAgICAgICAgKCkgPT4gRERQLl9DdXJyZW50TWV0aG9kSW52b2NhdGlvbi53aXRoVmFsdWUoXG4gICAgICAgICAgICBpbnZvY2F0aW9uLFxuICAgICAgICAgICAgKCkgPT4gbWF5YmVBdWRpdEFyZ3VtZW50Q2hlY2tzKFxuICAgICAgICAgICAgICBoYW5kbGVyLCBpbnZvY2F0aW9uLCBtc2cucGFyYW1zLFxuICAgICAgICAgICAgICBcImNhbGwgdG8gJ1wiICsgbXNnLm1ldGhvZCArIFwiJ1wiXG4gICAgICAgICAgICApXG4gICAgICAgICAgKVxuICAgICAgICApKTtcbiAgICAgIH0pO1xuXG4gICAgICBmdW5jdGlvbiBmaW5pc2goKSB7XG4gICAgICAgIGZlbmNlLmFybSgpO1xuICAgICAgICB1bmJsb2NrKCk7XG4gICAgICB9XG5cbiAgICAgIGNvbnN0IHBheWxvYWQgPSB7XG4gICAgICAgIG1zZzogXCJyZXN1bHRcIixcbiAgICAgICAgaWQ6IG1zZy5pZFxuICAgICAgfTtcblxuICAgICAgcHJvbWlzZS50aGVuKChyZXN1bHQpID0+IHtcbiAgICAgICAgZmluaXNoKCk7XG4gICAgICAgIGlmIChyZXN1bHQgIT09IHVuZGVmaW5lZCkge1xuICAgICAgICAgIHBheWxvYWQucmVzdWx0ID0gcmVzdWx0O1xuICAgICAgICB9XG4gICAgICAgIHNlbGYuc2VuZChwYXlsb2FkKTtcbiAgICAgIH0sIChleGNlcHRpb24pID0+IHtcbiAgICAgICAgZmluaXNoKCk7XG4gICAgICAgIHBheWxvYWQuZXJyb3IgPSB3cmFwSW50ZXJuYWxFeGNlcHRpb24oXG4gICAgICAgICAgZXhjZXB0aW9uLFxuICAgICAgICAgIGB3aGlsZSBpbnZva2luZyBtZXRob2QgJyR7bXNnLm1ldGhvZH0nYFxuICAgICAgICApO1xuICAgICAgICBzZWxmLnNlbmQocGF5bG9hZCk7XG4gICAgICB9KTtcbiAgICB9XG4gIH0sXG5cbiAgX2VhY2hTdWI6IGZ1bmN0aW9uIChmKSB7XG4gICAgdmFyIHNlbGYgPSB0aGlzO1xuICAgIHNlbGYuX25hbWVkU3Vicy5mb3JFYWNoKGYpO1xuICAgIHNlbGYuX3VuaXZlcnNhbFN1YnMuZm9yRWFjaChmKTtcbiAgfSxcblxuICBfZGlmZkNvbGxlY3Rpb25WaWV3czogZnVuY3Rpb24gKGJlZm9yZUNWcykge1xuICAgIHZhciBzZWxmID0gdGhpcztcbiAgICBEaWZmU2VxdWVuY2UuZGlmZk1hcHMoYmVmb3JlQ1ZzLCBzZWxmLmNvbGxlY3Rpb25WaWV3cywge1xuICAgICAgYm90aDogZnVuY3Rpb24gKGNvbGxlY3Rpb25OYW1lLCBsZWZ0VmFsdWUsIHJpZ2h0VmFsdWUpIHtcbiAgICAgICAgcmlnaHRWYWx1ZS5kaWZmKGxlZnRWYWx1ZSk7XG4gICAgICB9LFxuICAgICAgcmlnaHRPbmx5OiBmdW5jdGlvbiAoY29sbGVjdGlvbk5hbWUsIHJpZ2h0VmFsdWUpIHtcbiAgICAgICAgcmlnaHRWYWx1ZS5kb2N1bWVudHMuZm9yRWFjaChmdW5jdGlvbiAoZG9jVmlldywgaWQpIHtcbiAgICAgICAgICBzZWxmLnNlbmRBZGRlZChjb2xsZWN0aW9uTmFtZSwgaWQsIGRvY1ZpZXcuZ2V0RmllbGRzKCkpO1xuICAgICAgICB9KTtcbiAgICAgIH0sXG4gICAgICBsZWZ0T25seTogZnVuY3Rpb24gKGNvbGxlY3Rpb25OYW1lLCBsZWZ0VmFsdWUpIHtcbiAgICAgICAgbGVmdFZhbHVlLmRvY3VtZW50cy5mb3JFYWNoKGZ1bmN0aW9uIChkb2MsIGlkKSB7XG4gICAgICAgICAgc2VsZi5zZW5kUmVtb3ZlZChjb2xsZWN0aW9uTmFtZSwgaWQpO1xuICAgICAgICB9KTtcbiAgICAgIH1cbiAgICB9KTtcbiAgfSxcblxuICAvLyBTZXRzIHRoZSBjdXJyZW50IHVzZXIgaWQgaW4gYWxsIGFwcHJvcHJpYXRlIGNvbnRleHRzIGFuZCByZXJ1bnNcbiAgLy8gYWxsIHN1YnNjcmlwdGlvbnNcbiAgX3NldFVzZXJJZDogZnVuY3Rpb24odXNlcklkKSB7XG4gICAgdmFyIHNlbGYgPSB0aGlzO1xuXG4gICAgaWYgKHVzZXJJZCAhPT0gbnVsbCAmJiB0eXBlb2YgdXNlcklkICE9PSBcInN0cmluZ1wiKVxuICAgICAgdGhyb3cgbmV3IEVycm9yKFwic2V0VXNlcklkIG11c3QgYmUgY2FsbGVkIG9uIHN0cmluZyBvciBudWxsLCBub3QgXCIgK1xuICAgICAgICAgICAgICAgICAgICAgIHR5cGVvZiB1c2VySWQpO1xuXG4gICAgLy8gUHJldmVudCBuZXdseS1jcmVhdGVkIHVuaXZlcnNhbCBzdWJzY3JpcHRpb25zIGZyb20gYmVpbmcgYWRkZWQgdG8gb3VyXG4gICAgLy8gc2Vzc2lvbjsgdGhleSB3aWxsIGJlIGZvdW5kIGJlbG93IHdoZW4gd2UgY2FsbCBzdGFydFVuaXZlcnNhbFN1YnMuXG4gICAgLy9cbiAgICAvLyAoV2UgZG9uJ3QgaGF2ZSB0byB3b3JyeSBhYm91dCBuYW1lZCBzdWJzY3JpcHRpb25zLCBiZWNhdXNlIHdlIG9ubHkgYWRkXG4gICAgLy8gdGhlbSB3aGVuIHdlIHByb2Nlc3MgYSAnc3ViJyBtZXNzYWdlLiBXZSBhcmUgY3VycmVudGx5IHByb2Nlc3NpbmcgYVxuICAgIC8vICdtZXRob2QnIG1lc3NhZ2UsIGFuZCB0aGUgbWV0aG9kIGRpZCBub3QgdW5ibG9jaywgYmVjYXVzZSBpdCBpcyBpbGxlZ2FsXG4gICAgLy8gdG8gY2FsbCBzZXRVc2VySWQgYWZ0ZXIgdW5ibG9jay4gVGh1cyB3ZSBjYW5ub3QgYmUgY29uY3VycmVudGx5IGFkZGluZyBhXG4gICAgLy8gbmV3IG5hbWVkIHN1YnNjcmlwdGlvbi4pXG4gICAgc2VsZi5fZG9udFN0YXJ0TmV3VW5pdmVyc2FsU3VicyA9IHRydWU7XG5cbiAgICAvLyBQcmV2ZW50IGN1cnJlbnQgc3VicyBmcm9tIHVwZGF0aW5nIG91ciBjb2xsZWN0aW9uVmlld3MgYW5kIGNhbGwgdGhlaXJcbiAgICAvLyBzdG9wIGNhbGxiYWNrcy4gVGhpcyBtYXkgeWllbGQuXG4gICAgc2VsZi5fZWFjaFN1YihmdW5jdGlvbiAoc3ViKSB7XG4gICAgICBzdWIuX2RlYWN0aXZhdGUoKTtcbiAgICB9KTtcblxuICAgIC8vIEFsbCBzdWJzIHNob3VsZCBub3cgYmUgZGVhY3RpdmF0ZWQuIFN0b3Agc2VuZGluZyBtZXNzYWdlcyB0byB0aGUgY2xpZW50LFxuICAgIC8vIHNhdmUgdGhlIHN0YXRlIG9mIHRoZSBwdWJsaXNoZWQgY29sbGVjdGlvbnMsIHJlc2V0IHRvIGFuIGVtcHR5IHZpZXcsIGFuZFxuICAgIC8vIHVwZGF0ZSB0aGUgdXNlcklkLlxuICAgIHNlbGYuX2lzU2VuZGluZyA9IGZhbHNlO1xuICAgIHZhciBiZWZvcmVDVnMgPSBzZWxmLmNvbGxlY3Rpb25WaWV3cztcbiAgICBzZWxmLmNvbGxlY3Rpb25WaWV3cyA9IG5ldyBNYXAoKTtcbiAgICBzZWxmLnVzZXJJZCA9IHVzZXJJZDtcblxuICAgIC8vIF9zZXRVc2VySWQgaXMgbm9ybWFsbHkgY2FsbGVkIGZyb20gYSBNZXRlb3IgbWV0aG9kIHdpdGhcbiAgICAvLyBERFAuX0N1cnJlbnRNZXRob2RJbnZvY2F0aW9uIHNldC4gQnV0IEREUC5fQ3VycmVudE1ldGhvZEludm9jYXRpb24gaXMgbm90XG4gICAgLy8gZXhwZWN0ZWQgdG8gYmUgc2V0IGluc2lkZSBhIHB1Ymxpc2ggZnVuY3Rpb24sIHNvIHdlIHRlbXBvcmFyeSB1bnNldCBpdC5cbiAgICAvLyBJbnNpZGUgYSBwdWJsaXNoIGZ1bmN0aW9uIEREUC5fQ3VycmVudFB1YmxpY2F0aW9uSW52b2NhdGlvbiBpcyBzZXQuXG4gICAgRERQLl9DdXJyZW50TWV0aG9kSW52b2NhdGlvbi53aXRoVmFsdWUodW5kZWZpbmVkLCBmdW5jdGlvbiAoKSB7XG4gICAgICAvLyBTYXZlIHRoZSBvbGQgbmFtZWQgc3VicywgYW5kIHJlc2V0IHRvIGhhdmluZyBubyBzdWJzY3JpcHRpb25zLlxuICAgICAgdmFyIG9sZE5hbWVkU3VicyA9IHNlbGYuX25hbWVkU3VicztcbiAgICAgIHNlbGYuX25hbWVkU3VicyA9IG5ldyBNYXAoKTtcbiAgICAgIHNlbGYuX3VuaXZlcnNhbFN1YnMgPSBbXTtcblxuICAgICAgb2xkTmFtZWRTdWJzLmZvckVhY2goZnVuY3Rpb24gKHN1Yiwgc3Vic2NyaXB0aW9uSWQpIHtcbiAgICAgICAgdmFyIG5ld1N1YiA9IHN1Yi5fcmVjcmVhdGUoKTtcbiAgICAgICAgc2VsZi5fbmFtZWRTdWJzLnNldChzdWJzY3JpcHRpb25JZCwgbmV3U3ViKTtcbiAgICAgICAgLy8gbmI6IGlmIHRoZSBoYW5kbGVyIHRocm93cyBvciBjYWxscyB0aGlzLmVycm9yKCksIGl0IHdpbGwgaW4gZmFjdFxuICAgICAgICAvLyBpbW1lZGlhdGVseSBzZW5kIGl0cyAnbm9zdWInLiBUaGlzIGlzIE9LLCB0aG91Z2guXG4gICAgICAgIG5ld1N1Yi5fcnVuSGFuZGxlcigpO1xuICAgICAgfSk7XG5cbiAgICAgIC8vIEFsbG93IG5ld2x5LWNyZWF0ZWQgdW5pdmVyc2FsIHN1YnMgdG8gYmUgc3RhcnRlZCBvbiBvdXIgY29ubmVjdGlvbiBpblxuICAgICAgLy8gcGFyYWxsZWwgd2l0aCB0aGUgb25lcyB3ZSdyZSBzcGlubmluZyB1cCBoZXJlLCBhbmQgc3BpbiB1cCB1bml2ZXJzYWxcbiAgICAgIC8vIHN1YnMuXG4gICAgICBzZWxmLl9kb250U3RhcnROZXdVbml2ZXJzYWxTdWJzID0gZmFsc2U7XG4gICAgICBzZWxmLnN0YXJ0VW5pdmVyc2FsU3VicygpO1xuICAgIH0pO1xuXG4gICAgLy8gU3RhcnQgc2VuZGluZyBtZXNzYWdlcyBhZ2FpbiwgYmVnaW5uaW5nIHdpdGggdGhlIGRpZmYgZnJvbSB0aGUgcHJldmlvdXNcbiAgICAvLyBzdGF0ZSBvZiB0aGUgd29ybGQgdG8gdGhlIGN1cnJlbnQgc3RhdGUuIE5vIHlpZWxkcyBhcmUgYWxsb3dlZCBkdXJpbmdcbiAgICAvLyB0aGlzIGRpZmYsIHNvIHRoYXQgb3RoZXIgY2hhbmdlcyBjYW5ub3QgaW50ZXJsZWF2ZS5cbiAgICBNZXRlb3IuX25vWWllbGRzQWxsb3dlZChmdW5jdGlvbiAoKSB7XG4gICAgICBzZWxmLl9pc1NlbmRpbmcgPSB0cnVlO1xuICAgICAgc2VsZi5fZGlmZkNvbGxlY3Rpb25WaWV3cyhiZWZvcmVDVnMpO1xuICAgICAgaWYgKCFfLmlzRW1wdHkoc2VsZi5fcGVuZGluZ1JlYWR5KSkge1xuICAgICAgICBzZWxmLnNlbmRSZWFkeShzZWxmLl9wZW5kaW5nUmVhZHkpO1xuICAgICAgICBzZWxmLl9wZW5kaW5nUmVhZHkgPSBbXTtcbiAgICAgIH1cbiAgICB9KTtcbiAgfSxcblxuICBfc3RhcnRTdWJzY3JpcHRpb246IGZ1bmN0aW9uIChoYW5kbGVyLCBzdWJJZCwgcGFyYW1zLCBuYW1lKSB7XG4gICAgdmFyIHNlbGYgPSB0aGlzO1xuXG4gICAgdmFyIHN1YiA9IG5ldyBTdWJzY3JpcHRpb24oXG4gICAgICBzZWxmLCBoYW5kbGVyLCBzdWJJZCwgcGFyYW1zLCBuYW1lKTtcbiAgICBpZiAoc3ViSWQpXG4gICAgICBzZWxmLl9uYW1lZFN1YnMuc2V0KHN1YklkLCBzdWIpO1xuICAgIGVsc2VcbiAgICAgIHNlbGYuX3VuaXZlcnNhbFN1YnMucHVzaChzdWIpO1xuXG4gICAgc3ViLl9ydW5IYW5kbGVyKCk7XG4gIH0sXG5cbiAgLy8gdGVhciBkb3duIHNwZWNpZmllZCBzdWJzY3JpcHRpb25cbiAgX3N0b3BTdWJzY3JpcHRpb246IGZ1bmN0aW9uIChzdWJJZCwgZXJyb3IpIHtcbiAgICB2YXIgc2VsZiA9IHRoaXM7XG5cbiAgICB2YXIgc3ViTmFtZSA9IG51bGw7XG4gICAgaWYgKHN1YklkKSB7XG4gICAgICB2YXIgbWF5YmVTdWIgPSBzZWxmLl9uYW1lZFN1YnMuZ2V0KHN1YklkKTtcbiAgICAgIGlmIChtYXliZVN1Yikge1xuICAgICAgICBzdWJOYW1lID0gbWF5YmVTdWIuX25hbWU7XG4gICAgICAgIG1heWJlU3ViLl9yZW1vdmVBbGxEb2N1bWVudHMoKTtcbiAgICAgICAgbWF5YmVTdWIuX2RlYWN0aXZhdGUoKTtcbiAgICAgICAgc2VsZi5fbmFtZWRTdWJzLmRlbGV0ZShzdWJJZCk7XG4gICAgICB9XG4gICAgfVxuXG4gICAgdmFyIHJlc3BvbnNlID0ge21zZzogJ25vc3ViJywgaWQ6IHN1YklkfTtcblxuICAgIGlmIChlcnJvcikge1xuICAgICAgcmVzcG9uc2UuZXJyb3IgPSB3cmFwSW50ZXJuYWxFeGNlcHRpb24oXG4gICAgICAgIGVycm9yLFxuICAgICAgICBzdWJOYW1lID8gKFwiZnJvbSBzdWIgXCIgKyBzdWJOYW1lICsgXCIgaWQgXCIgKyBzdWJJZClcbiAgICAgICAgICA6IChcImZyb20gc3ViIGlkIFwiICsgc3ViSWQpKTtcbiAgICB9XG5cbiAgICBzZWxmLnNlbmQocmVzcG9uc2UpO1xuICB9LFxuXG4gIC8vIHRlYXIgZG93biBhbGwgc3Vic2NyaXB0aW9ucy4gTm90ZSB0aGF0IHRoaXMgZG9lcyBOT1Qgc2VuZCByZW1vdmVkIG9yIG5vc3ViXG4gIC8vIG1lc3NhZ2VzLCBzaW5jZSB3ZSBhc3N1bWUgdGhlIGNsaWVudCBpcyBnb25lLlxuICBfZGVhY3RpdmF0ZUFsbFN1YnNjcmlwdGlvbnM6IGZ1bmN0aW9uICgpIHtcbiAgICB2YXIgc2VsZiA9IHRoaXM7XG5cbiAgICBzZWxmLl9uYW1lZFN1YnMuZm9yRWFjaChmdW5jdGlvbiAoc3ViLCBpZCkge1xuICAgICAgc3ViLl9kZWFjdGl2YXRlKCk7XG4gICAgfSk7XG4gICAgc2VsZi5fbmFtZWRTdWJzID0gbmV3IE1hcCgpO1xuXG4gICAgc2VsZi5fdW5pdmVyc2FsU3Vicy5mb3JFYWNoKGZ1bmN0aW9uIChzdWIpIHtcbiAgICAgIHN1Yi5fZGVhY3RpdmF0ZSgpO1xuICAgIH0pO1xuICAgIHNlbGYuX3VuaXZlcnNhbFN1YnMgPSBbXTtcbiAgfSxcblxuICAvLyBEZXRlcm1pbmUgdGhlIHJlbW90ZSBjbGllbnQncyBJUCBhZGRyZXNzLCBiYXNlZCBvbiB0aGVcbiAgLy8gSFRUUF9GT1JXQVJERURfQ09VTlQgZW52aXJvbm1lbnQgdmFyaWFibGUgcmVwcmVzZW50aW5nIGhvdyBtYW55XG4gIC8vIHByb3hpZXMgdGhlIHNlcnZlciBpcyBiZWhpbmQuXG4gIF9jbGllbnRBZGRyZXNzOiBmdW5jdGlvbiAoKSB7XG4gICAgdmFyIHNlbGYgPSB0aGlzO1xuXG4gICAgLy8gRm9yIHRoZSByZXBvcnRlZCBjbGllbnQgYWRkcmVzcyBmb3IgYSBjb25uZWN0aW9uIHRvIGJlIGNvcnJlY3QsXG4gICAgLy8gdGhlIGRldmVsb3BlciBtdXN0IHNldCB0aGUgSFRUUF9GT1JXQVJERURfQ09VTlQgZW52aXJvbm1lbnRcbiAgICAvLyB2YXJpYWJsZSB0byBhbiBpbnRlZ2VyIHJlcHJlc2VudGluZyB0aGUgbnVtYmVyIG9mIGhvcHMgdGhleVxuICAgIC8vIGV4cGVjdCBpbiB0aGUgYHgtZm9yd2FyZGVkLWZvcmAgaGVhZGVyLiBFLmcuLCBzZXQgdG8gXCIxXCIgaWYgdGhlXG4gICAgLy8gc2VydmVyIGlzIGJlaGluZCBvbmUgcHJveHkuXG4gICAgLy9cbiAgICAvLyBUaGlzIGNvdWxkIGJlIGNvbXB1dGVkIG9uY2UgYXQgc3RhcnR1cCBpbnN0ZWFkIG9mIGV2ZXJ5IHRpbWUuXG4gICAgdmFyIGh0dHBGb3J3YXJkZWRDb3VudCA9IHBhcnNlSW50KHByb2Nlc3MuZW52WydIVFRQX0ZPUldBUkRFRF9DT1VOVCddKSB8fCAwO1xuXG4gICAgaWYgKGh0dHBGb3J3YXJkZWRDb3VudCA9PT0gMClcbiAgICAgIHJldHVybiBzZWxmLnNvY2tldC5yZW1vdGVBZGRyZXNzO1xuXG4gICAgdmFyIGZvcndhcmRlZEZvciA9IHNlbGYuc29ja2V0LmhlYWRlcnNbXCJ4LWZvcndhcmRlZC1mb3JcIl07XG4gICAgaWYgKCEgXy5pc1N0cmluZyhmb3J3YXJkZWRGb3IpKVxuICAgICAgcmV0dXJuIG51bGw7XG4gICAgZm9yd2FyZGVkRm9yID0gZm9yd2FyZGVkRm9yLnRyaW0oKS5zcGxpdCgvXFxzKixcXHMqLyk7XG5cbiAgICAvLyBUeXBpY2FsbHkgdGhlIGZpcnN0IHZhbHVlIGluIHRoZSBgeC1mb3J3YXJkZWQtZm9yYCBoZWFkZXIgaXNcbiAgICAvLyB0aGUgb3JpZ2luYWwgSVAgYWRkcmVzcyBvZiB0aGUgY2xpZW50IGNvbm5lY3RpbmcgdG8gdGhlIGZpcnN0XG4gICAgLy8gcHJveHkuICBIb3dldmVyLCB0aGUgZW5kIHVzZXIgY2FuIGVhc2lseSBzcG9vZiB0aGUgaGVhZGVyLCBpblxuICAgIC8vIHdoaWNoIGNhc2UgdGhlIGZpcnN0IHZhbHVlKHMpIHdpbGwgYmUgdGhlIGZha2UgSVAgYWRkcmVzcyBmcm9tXG4gICAgLy8gdGhlIHVzZXIgcHJldGVuZGluZyB0byBiZSBhIHByb3h5IHJlcG9ydGluZyB0aGUgb3JpZ2luYWwgSVBcbiAgICAvLyBhZGRyZXNzIHZhbHVlLiAgQnkgY291bnRpbmcgSFRUUF9GT1JXQVJERURfQ09VTlQgYmFjayBmcm9tIHRoZVxuICAgIC8vIGVuZCBvZiB0aGUgbGlzdCwgd2UgZW5zdXJlIHRoYXQgd2UgZ2V0IHRoZSBJUCBhZGRyZXNzIGJlaW5nXG4gICAgLy8gcmVwb3J0ZWQgYnkgKm91ciogZmlyc3QgcHJveHkuXG5cbiAgICBpZiAoaHR0cEZvcndhcmRlZENvdW50IDwgMCB8fCBodHRwRm9yd2FyZGVkQ291bnQgPiBmb3J3YXJkZWRGb3IubGVuZ3RoKVxuICAgICAgcmV0dXJuIG51bGw7XG5cbiAgICByZXR1cm4gZm9yd2FyZGVkRm9yW2ZvcndhcmRlZEZvci5sZW5ndGggLSBodHRwRm9yd2FyZGVkQ291bnRdO1xuICB9XG59KTtcblxuLyoqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKi9cbi8qIFN1YnNjcmlwdGlvbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICovXG4vKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqL1xuXG4vLyBjdG9yIGZvciBhIHN1YiBoYW5kbGU6IHRoZSBpbnB1dCB0byBlYWNoIHB1Ymxpc2ggZnVuY3Rpb25cblxuLy8gSW5zdGFuY2UgbmFtZSBpcyB0aGlzIGJlY2F1c2UgaXQncyB1c3VhbGx5IHJlZmVycmVkIHRvIGFzIHRoaXMgaW5zaWRlIGFcbi8vIHB1Ymxpc2hcbi8qKlxuICogQHN1bW1hcnkgVGhlIHNlcnZlcidzIHNpZGUgb2YgYSBzdWJzY3JpcHRpb25cbiAqIEBjbGFzcyBTdWJzY3JpcHRpb25cbiAqIEBpbnN0YW5jZU5hbWUgdGhpc1xuICogQHNob3dJbnN0YW5jZU5hbWUgdHJ1ZVxuICovXG52YXIgU3Vic2NyaXB0aW9uID0gZnVuY3Rpb24gKFxuICAgIHNlc3Npb24sIGhhbmRsZXIsIHN1YnNjcmlwdGlvbklkLCBwYXJhbXMsIG5hbWUpIHtcbiAgdmFyIHNlbGYgPSB0aGlzO1xuICBzZWxmLl9zZXNzaW9uID0gc2Vzc2lvbjsgLy8gdHlwZSBpcyBTZXNzaW9uXG5cbiAgLyoqXG4gICAqIEBzdW1tYXJ5IEFjY2VzcyBpbnNpZGUgdGhlIHB1Ymxpc2ggZnVuY3Rpb24uIFRoZSBpbmNvbWluZyBbY29ubmVjdGlvbl0oI21ldGVvcl9vbmNvbm5lY3Rpb24pIGZvciB0aGlzIHN1YnNjcmlwdGlvbi5cbiAgICogQGxvY3VzIFNlcnZlclxuICAgKiBAbmFtZSAgY29ubmVjdGlvblxuICAgKiBAbWVtYmVyT2YgU3Vic2NyaXB0aW9uXG4gICAqIEBpbnN0YW5jZVxuICAgKi9cbiAgc2VsZi5jb25uZWN0aW9uID0gc2Vzc2lvbi5jb25uZWN0aW9uSGFuZGxlOyAvLyBwdWJsaWMgQVBJIG9iamVjdFxuXG4gIHNlbGYuX2hhbmRsZXIgPSBoYW5kbGVyO1xuXG4gIC8vIG15IHN1YnNjcmlwdGlvbiBJRCAoZ2VuZXJhdGVkIGJ5IGNsaWVudCwgdW5kZWZpbmVkIGZvciB1bml2ZXJzYWwgc3VicykuXG4gIHNlbGYuX3N1YnNjcmlwdGlvbklkID0gc3Vic2NyaXB0aW9uSWQ7XG4gIC8vIHVuZGVmaW5lZCBmb3IgdW5pdmVyc2FsIHN1YnNcbiAgc2VsZi5fbmFtZSA9IG5hbWU7XG5cbiAgc2VsZi5fcGFyYW1zID0gcGFyYW1zIHx8IFtdO1xuXG4gIC8vIE9ubHkgbmFtZWQgc3Vic2NyaXB0aW9ucyBoYXZlIElEcywgYnV0IHdlIG5lZWQgc29tZSBzb3J0IG9mIHN0cmluZ1xuICAvLyBpbnRlcm5hbGx5IHRvIGtlZXAgdHJhY2sgb2YgYWxsIHN1YnNjcmlwdGlvbnMgaW5zaWRlXG4gIC8vIFNlc3Npb25Eb2N1bWVudFZpZXdzLiBXZSB1c2UgdGhpcyBzdWJzY3JpcHRpb25IYW5kbGUgZm9yIHRoYXQuXG4gIGlmIChzZWxmLl9zdWJzY3JpcHRpb25JZCkge1xuICAgIHNlbGYuX3N1YnNjcmlwdGlvbkhhbmRsZSA9ICdOJyArIHNlbGYuX3N1YnNjcmlwdGlvbklkO1xuICB9IGVsc2Uge1xuICAgIHNlbGYuX3N1YnNjcmlwdGlvbkhhbmRsZSA9ICdVJyArIFJhbmRvbS5pZCgpO1xuICB9XG5cbiAgLy8gaGFzIF9kZWFjdGl2YXRlIGJlZW4gY2FsbGVkP1xuICBzZWxmLl9kZWFjdGl2YXRlZCA9IGZhbHNlO1xuXG4gIC8vIHN0b3AgY2FsbGJhY2tzIHRvIGcvYyB0aGlzIHN1Yi4gIGNhbGxlZCB3LyB6ZXJvIGFyZ3VtZW50cy5cbiAgc2VsZi5fc3RvcENhbGxiYWNrcyA9IFtdO1xuXG4gIC8vIHRoZSBzZXQgb2YgKGNvbGxlY3Rpb24sIGRvY3VtZW50aWQpIHRoYXQgdGhpcyBzdWJzY3JpcHRpb24gaGFzXG4gIC8vIGFuIG9waW5pb24gYWJvdXRcbiAgc2VsZi5fZG9jdW1lbnRzID0gbmV3IE1hcCgpO1xuXG4gIC8vIHJlbWVtYmVyIGlmIHdlIGFyZSByZWFkeS5cbiAgc2VsZi5fcmVhZHkgPSBmYWxzZTtcblxuICAvLyBQYXJ0IG9mIHRoZSBwdWJsaWMgQVBJOiB0aGUgdXNlciBvZiB0aGlzIHN1Yi5cblxuICAvKipcbiAgICogQHN1bW1hcnkgQWNjZXNzIGluc2lkZSB0aGUgcHVibGlzaCBmdW5jdGlvbi4gVGhlIGlkIG9mIHRoZSBsb2dnZWQtaW4gdXNlciwgb3IgYG51bGxgIGlmIG5vIHVzZXIgaXMgbG9nZ2VkIGluLlxuICAgKiBAbG9jdXMgU2VydmVyXG4gICAqIEBtZW1iZXJPZiBTdWJzY3JpcHRpb25cbiAgICogQG5hbWUgIHVzZXJJZFxuICAgKiBAaW5zdGFuY2VcbiAgICovXG4gIHNlbGYudXNlcklkID0gc2Vzc2lvbi51c2VySWQ7XG5cbiAgLy8gRm9yIG5vdywgdGhlIGlkIGZpbHRlciBpcyBnb2luZyB0byBkZWZhdWx0IHRvXG4gIC8vIHRoZSB0by9mcm9tIEREUCBtZXRob2RzIG9uIE1vbmdvSUQsIHRvXG4gIC8vIHNwZWNpZmljYWxseSBkZWFsIHdpdGggbW9uZ28vbWluaW1vbmdvIE9iamVjdElkcy5cblxuICAvLyBMYXRlciwgeW91IHdpbGwgYmUgYWJsZSB0byBtYWtlIHRoaXMgYmUgXCJyYXdcIlxuICAvLyBpZiB5b3Ugd2FudCB0byBwdWJsaXNoIGEgY29sbGVjdGlvbiB0aGF0IHlvdSBrbm93XG4gIC8vIGp1c3QgaGFzIHN0cmluZ3MgZm9yIGtleXMgYW5kIG5vIGZ1bm55IGJ1c2luZXNzLCB0b1xuICAvLyBhIGRkcCBjb25zdW1lciB0aGF0IGlzbid0IG1pbmltb25nb1xuXG4gIHNlbGYuX2lkRmlsdGVyID0ge1xuICAgIGlkU3RyaW5naWZ5OiBNb25nb0lELmlkU3RyaW5naWZ5LFxuICAgIGlkUGFyc2U6IE1vbmdvSUQuaWRQYXJzZVxuICB9O1xuXG4gIFBhY2thZ2VbJ2ZhY3RzLWJhc2UnXSAmJiBQYWNrYWdlWydmYWN0cy1iYXNlJ10uRmFjdHMuaW5jcmVtZW50U2VydmVyRmFjdChcbiAgICBcImxpdmVkYXRhXCIsIFwic3Vic2NyaXB0aW9uc1wiLCAxKTtcbn07XG5cbl8uZXh0ZW5kKFN1YnNjcmlwdGlvbi5wcm90b3R5cGUsIHtcbiAgX3J1bkhhbmRsZXI6IGZ1bmN0aW9uICgpIHtcbiAgICAvLyBYWFggc2hvdWxkIHdlIHVuYmxvY2soKSBoZXJlPyBFaXRoZXIgYmVmb3JlIHJ1bm5pbmcgdGhlIHB1Ymxpc2hcbiAgICAvLyBmdW5jdGlvbiwgb3IgYmVmb3JlIHJ1bm5pbmcgX3B1Ymxpc2hDdXJzb3IuXG4gICAgLy9cbiAgICAvLyBSaWdodCBub3csIGVhY2ggcHVibGlzaCBmdW5jdGlvbiBibG9ja3MgYWxsIGZ1dHVyZSBwdWJsaXNoZXMgYW5kXG4gICAgLy8gbWV0aG9kcyB3YWl0aW5nIG9uIGRhdGEgZnJvbSBNb25nbyAob3Igd2hhdGV2ZXIgZWxzZSB0aGUgZnVuY3Rpb25cbiAgICAvLyBibG9ja3Mgb24pLiBUaGlzIHByb2JhYmx5IHNsb3dzIHBhZ2UgbG9hZCBpbiBjb21tb24gY2FzZXMuXG5cbiAgICB2YXIgc2VsZiA9IHRoaXM7XG4gICAgdHJ5IHtcbiAgICAgIHZhciByZXMgPSBERFAuX0N1cnJlbnRQdWJsaWNhdGlvbkludm9jYXRpb24ud2l0aFZhbHVlKFxuICAgICAgICBzZWxmLFxuICAgICAgICAoKSA9PiBtYXliZUF1ZGl0QXJndW1lbnRDaGVja3MoXG4gICAgICAgICAgc2VsZi5faGFuZGxlciwgc2VsZiwgRUpTT04uY2xvbmUoc2VsZi5fcGFyYW1zKSxcbiAgICAgICAgICAvLyBJdCdzIE9LIHRoYXQgdGhpcyB3b3VsZCBsb29rIHdlaXJkIGZvciB1bml2ZXJzYWwgc3Vic2NyaXB0aW9ucyxcbiAgICAgICAgICAvLyBiZWNhdXNlIHRoZXkgaGF2ZSBubyBhcmd1bWVudHMgc28gdGhlcmUgY2FuIG5ldmVyIGJlIGFuXG4gICAgICAgICAgLy8gYXVkaXQtYXJndW1lbnQtY2hlY2tzIGZhaWx1cmUuXG4gICAgICAgICAgXCJwdWJsaXNoZXIgJ1wiICsgc2VsZi5fbmFtZSArIFwiJ1wiXG4gICAgICAgIClcbiAgICAgICk7XG4gICAgfSBjYXRjaCAoZSkge1xuICAgICAgc2VsZi5lcnJvcihlKTtcbiAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICAvLyBEaWQgdGhlIGhhbmRsZXIgY2FsbCB0aGlzLmVycm9yIG9yIHRoaXMuc3RvcD9cbiAgICBpZiAoc2VsZi5faXNEZWFjdGl2YXRlZCgpKVxuICAgICAgcmV0dXJuO1xuXG4gICAgc2VsZi5fcHVibGlzaEhhbmRsZXJSZXN1bHQocmVzKTtcbiAgfSxcblxuICBfcHVibGlzaEhhbmRsZXJSZXN1bHQ6IGZ1bmN0aW9uIChyZXMpIHtcbiAgICAvLyBTUEVDSUFMIENBU0U6IEluc3RlYWQgb2Ygd3JpdGluZyB0aGVpciBvd24gY2FsbGJhY2tzIHRoYXQgaW52b2tlXG4gICAgLy8gdGhpcy5hZGRlZC9jaGFuZ2VkL3JlYWR5L2V0YywgdGhlIHVzZXIgY2FuIGp1c3QgcmV0dXJuIGEgY29sbGVjdGlvblxuICAgIC8vIGN1cnNvciBvciBhcnJheSBvZiBjdXJzb3JzIGZyb20gdGhlIHB1Ymxpc2ggZnVuY3Rpb247IHdlIGNhbGwgdGhlaXJcbiAgICAvLyBfcHVibGlzaEN1cnNvciBtZXRob2Qgd2hpY2ggc3RhcnRzIG9ic2VydmluZyB0aGUgY3Vyc29yIGFuZCBwdWJsaXNoZXMgdGhlXG4gICAgLy8gcmVzdWx0cy4gTm90ZSB0aGF0IF9wdWJsaXNoQ3Vyc29yIGRvZXMgTk9UIGNhbGwgcmVhZHkoKS5cbiAgICAvL1xuICAgIC8vIFhYWCBUaGlzIHVzZXMgYW4gdW5kb2N1bWVudGVkIGludGVyZmFjZSB3aGljaCBvbmx5IHRoZSBNb25nbyBjdXJzb3JcbiAgICAvLyBpbnRlcmZhY2UgcHVibGlzaGVzLiBTaG91bGQgd2UgbWFrZSB0aGlzIGludGVyZmFjZSBwdWJsaWMgYW5kIGVuY291cmFnZVxuICAgIC8vIHVzZXJzIHRvIGltcGxlbWVudCBpdCB0aGVtc2VsdmVzPyBBcmd1YWJseSwgaXQncyB1bm5lY2Vzc2FyeTsgdXNlcnMgY2FuXG4gICAgLy8gYWxyZWFkeSB3cml0ZSB0aGVpciBvd24gZnVuY3Rpb25zIGxpa2VcbiAgICAvLyAgIHZhciBwdWJsaXNoTXlSZWFjdGl2ZVRoaW5neSA9IGZ1bmN0aW9uIChuYW1lLCBoYW5kbGVyKSB7XG4gICAgLy8gICAgIE1ldGVvci5wdWJsaXNoKG5hbWUsIGZ1bmN0aW9uICgpIHtcbiAgICAvLyAgICAgICB2YXIgcmVhY3RpdmVUaGluZ3kgPSBoYW5kbGVyKCk7XG4gICAgLy8gICAgICAgcmVhY3RpdmVUaGluZ3kucHVibGlzaE1lKCk7XG4gICAgLy8gICAgIH0pO1xuICAgIC8vICAgfTtcblxuICAgIHZhciBzZWxmID0gdGhpcztcbiAgICB2YXIgaXNDdXJzb3IgPSBmdW5jdGlvbiAoYykge1xuICAgICAgcmV0dXJuIGMgJiYgYy5fcHVibGlzaEN1cnNvcjtcbiAgICB9O1xuICAgIGlmIChpc0N1cnNvcihyZXMpKSB7XG4gICAgICB0cnkge1xuICAgICAgICByZXMuX3B1Ymxpc2hDdXJzb3Ioc2VsZik7XG4gICAgICB9IGNhdGNoIChlKSB7XG4gICAgICAgIHNlbGYuZXJyb3IoZSk7XG4gICAgICAgIHJldHVybjtcbiAgICAgIH1cbiAgICAgIC8vIF9wdWJsaXNoQ3Vyc29yIG9ubHkgcmV0dXJucyBhZnRlciB0aGUgaW5pdGlhbCBhZGRlZCBjYWxsYmFja3MgaGF2ZSBydW4uXG4gICAgICAvLyBtYXJrIHN1YnNjcmlwdGlvbiBhcyByZWFkeS5cbiAgICAgIHNlbGYucmVhZHkoKTtcbiAgICB9IGVsc2UgaWYgKF8uaXNBcnJheShyZXMpKSB7XG4gICAgICAvLyBjaGVjayBhbGwgdGhlIGVsZW1lbnRzIGFyZSBjdXJzb3JzXG4gICAgICBpZiAoISBfLmFsbChyZXMsIGlzQ3Vyc29yKSkge1xuICAgICAgICBzZWxmLmVycm9yKG5ldyBFcnJvcihcIlB1Ymxpc2ggZnVuY3Rpb24gcmV0dXJuZWQgYW4gYXJyYXkgb2Ygbm9uLUN1cnNvcnNcIikpO1xuICAgICAgICByZXR1cm47XG4gICAgICB9XG4gICAgICAvLyBmaW5kIGR1cGxpY2F0ZSBjb2xsZWN0aW9uIG5hbWVzXG4gICAgICAvLyBYWFggd2Ugc2hvdWxkIHN1cHBvcnQgb3ZlcmxhcHBpbmcgY3Vyc29ycywgYnV0IHRoYXQgd291bGQgcmVxdWlyZSB0aGVcbiAgICAgIC8vIG1lcmdlIGJveCB0byBhbGxvdyBvdmVybGFwIHdpdGhpbiBhIHN1YnNjcmlwdGlvblxuICAgICAgdmFyIGNvbGxlY3Rpb25OYW1lcyA9IHt9O1xuICAgICAgZm9yICh2YXIgaSA9IDA7IGkgPCByZXMubGVuZ3RoOyArK2kpIHtcbiAgICAgICAgdmFyIGNvbGxlY3Rpb25OYW1lID0gcmVzW2ldLl9nZXRDb2xsZWN0aW9uTmFtZSgpO1xuICAgICAgICBpZiAoXy5oYXMoY29sbGVjdGlvbk5hbWVzLCBjb2xsZWN0aW9uTmFtZSkpIHtcbiAgICAgICAgICBzZWxmLmVycm9yKG5ldyBFcnJvcihcbiAgICAgICAgICAgIFwiUHVibGlzaCBmdW5jdGlvbiByZXR1cm5lZCBtdWx0aXBsZSBjdXJzb3JzIGZvciBjb2xsZWN0aW9uIFwiICtcbiAgICAgICAgICAgICAgY29sbGVjdGlvbk5hbWUpKTtcbiAgICAgICAgICByZXR1cm47XG4gICAgICAgIH1cbiAgICAgICAgY29sbGVjdGlvbk5hbWVzW2NvbGxlY3Rpb25OYW1lXSA9IHRydWU7XG4gICAgICB9O1xuXG4gICAgICB0cnkge1xuICAgICAgICBfLmVhY2gocmVzLCBmdW5jdGlvbiAoY3VyKSB7XG4gICAgICAgICAgY3VyLl9wdWJsaXNoQ3Vyc29yKHNlbGYpO1xuICAgICAgICB9KTtcbiAgICAgIH0gY2F0Y2ggKGUpIHtcbiAgICAgICAgc2VsZi5lcnJvcihlKTtcbiAgICAgICAgcmV0dXJuO1xuICAgICAgfVxuICAgICAgc2VsZi5yZWFkeSgpO1xuICAgIH0gZWxzZSBpZiAocmVzKSB7XG4gICAgICAvLyB0cnV0aHkgdmFsdWVzIG90aGVyIHRoYW4gY3Vyc29ycyBvciBhcnJheXMgYXJlIHByb2JhYmx5IGFcbiAgICAgIC8vIHVzZXIgbWlzdGFrZSAocG9zc2libGUgcmV0dXJuaW5nIGEgTW9uZ28gZG9jdW1lbnQgdmlhLCBzYXksXG4gICAgICAvLyBgY29sbC5maW5kT25lKClgKS5cbiAgICAgIHNlbGYuZXJyb3IobmV3IEVycm9yKFwiUHVibGlzaCBmdW5jdGlvbiBjYW4gb25seSByZXR1cm4gYSBDdXJzb3Igb3IgXCJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICsgXCJhbiBhcnJheSBvZiBDdXJzb3JzXCIpKTtcbiAgICB9XG4gIH0sXG5cbiAgLy8gVGhpcyBjYWxscyBhbGwgc3RvcCBjYWxsYmFja3MgYW5kIHByZXZlbnRzIHRoZSBoYW5kbGVyIGZyb20gdXBkYXRpbmcgYW55XG4gIC8vIFNlc3Npb25Db2xsZWN0aW9uVmlld3MgZnVydGhlci4gSXQncyB1c2VkIHdoZW4gdGhlIHVzZXIgdW5zdWJzY3JpYmVzIG9yXG4gIC8vIGRpc2Nvbm5lY3RzLCBhcyB3ZWxsIGFzIGR1cmluZyBzZXRVc2VySWQgcmUtcnVucy4gSXQgZG9lcyAqTk9UKiBzZW5kXG4gIC8vIHJlbW92ZWQgbWVzc2FnZXMgZm9yIHRoZSBwdWJsaXNoZWQgb2JqZWN0czsgaWYgdGhhdCBpcyBuZWNlc3NhcnksIGNhbGxcbiAgLy8gX3JlbW92ZUFsbERvY3VtZW50cyBmaXJzdC5cbiAgX2RlYWN0aXZhdGU6IGZ1bmN0aW9uKCkge1xuICAgIHZhciBzZWxmID0gdGhpcztcbiAgICBpZiAoc2VsZi5fZGVhY3RpdmF0ZWQpXG4gICAgICByZXR1cm47XG4gICAgc2VsZi5fZGVhY3RpdmF0ZWQgPSB0cnVlO1xuICAgIHNlbGYuX2NhbGxTdG9wQ2FsbGJhY2tzKCk7XG4gICAgUGFja2FnZVsnZmFjdHMtYmFzZSddICYmIFBhY2thZ2VbJ2ZhY3RzLWJhc2UnXS5GYWN0cy5pbmNyZW1lbnRTZXJ2ZXJGYWN0KFxuICAgICAgXCJsaXZlZGF0YVwiLCBcInN1YnNjcmlwdGlvbnNcIiwgLTEpO1xuICB9LFxuXG4gIF9jYWxsU3RvcENhbGxiYWNrczogZnVuY3Rpb24gKCkge1xuICAgIHZhciBzZWxmID0gdGhpcztcbiAgICAvLyB0ZWxsIGxpc3RlbmVycywgc28gdGhleSBjYW4gY2xlYW4gdXBcbiAgICB2YXIgY2FsbGJhY2tzID0gc2VsZi5fc3RvcENhbGxiYWNrcztcbiAgICBzZWxmLl9zdG9wQ2FsbGJhY2tzID0gW107XG4gICAgXy5lYWNoKGNhbGxiYWNrcywgZnVuY3Rpb24gKGNhbGxiYWNrKSB7XG4gICAgICBjYWxsYmFjaygpO1xuICAgIH0pO1xuICB9LFxuXG4gIC8vIFNlbmQgcmVtb3ZlIG1lc3NhZ2VzIGZvciBldmVyeSBkb2N1bWVudC5cbiAgX3JlbW92ZUFsbERvY3VtZW50czogZnVuY3Rpb24gKCkge1xuICAgIHZhciBzZWxmID0gdGhpcztcbiAgICBNZXRlb3IuX25vWWllbGRzQWxsb3dlZChmdW5jdGlvbiAoKSB7XG4gICAgICBzZWxmLl9kb2N1bWVudHMuZm9yRWFjaChmdW5jdGlvbiAoY29sbGVjdGlvbkRvY3MsIGNvbGxlY3Rpb25OYW1lKSB7XG4gICAgICAgIGNvbGxlY3Rpb25Eb2NzLmZvckVhY2goZnVuY3Rpb24gKHN0cklkKSB7XG4gICAgICAgICAgc2VsZi5yZW1vdmVkKGNvbGxlY3Rpb25OYW1lLCBzZWxmLl9pZEZpbHRlci5pZFBhcnNlKHN0cklkKSk7XG4gICAgICAgIH0pO1xuICAgICAgfSk7XG4gICAgfSk7XG4gIH0sXG5cbiAgLy8gUmV0dXJucyBhIG5ldyBTdWJzY3JpcHRpb24gZm9yIHRoZSBzYW1lIHNlc3Npb24gd2l0aCB0aGUgc2FtZVxuICAvLyBpbml0aWFsIGNyZWF0aW9uIHBhcmFtZXRlcnMuIFRoaXMgaXNuJ3QgYSBjbG9uZTogaXQgZG9lc24ndCBoYXZlXG4gIC8vIHRoZSBzYW1lIF9kb2N1bWVudHMgY2FjaGUsIHN0b3BwZWQgc3RhdGUgb3IgY2FsbGJhY2tzOyBtYXkgaGF2ZSBhXG4gIC8vIGRpZmZlcmVudCBfc3Vic2NyaXB0aW9uSGFuZGxlLCBhbmQgZ2V0cyBpdHMgdXNlcklkIGZyb20gdGhlXG4gIC8vIHNlc3Npb24sIG5vdCBmcm9tIHRoaXMgb2JqZWN0LlxuICBfcmVjcmVhdGU6IGZ1bmN0aW9uICgpIHtcbiAgICB2YXIgc2VsZiA9IHRoaXM7XG4gICAgcmV0dXJuIG5ldyBTdWJzY3JpcHRpb24oXG4gICAgICBzZWxmLl9zZXNzaW9uLCBzZWxmLl9oYW5kbGVyLCBzZWxmLl9zdWJzY3JpcHRpb25JZCwgc2VsZi5fcGFyYW1zLFxuICAgICAgc2VsZi5fbmFtZSk7XG4gIH0sXG5cbiAgLyoqXG4gICAqIEBzdW1tYXJ5IENhbGwgaW5zaWRlIHRoZSBwdWJsaXNoIGZ1bmN0aW9uLiAgU3RvcHMgdGhpcyBjbGllbnQncyBzdWJzY3JpcHRpb24sIHRyaWdnZXJpbmcgYSBjYWxsIG9uIHRoZSBjbGllbnQgdG8gdGhlIGBvblN0b3BgIGNhbGxiYWNrIHBhc3NlZCB0byBbYE1ldGVvci5zdWJzY3JpYmVgXSgjbWV0ZW9yX3N1YnNjcmliZSksIGlmIGFueS4gSWYgYGVycm9yYCBpcyBub3QgYSBbYE1ldGVvci5FcnJvcmBdKCNtZXRlb3JfZXJyb3IpLCBpdCB3aWxsIGJlIFtzYW5pdGl6ZWRdKCNtZXRlb3JfZXJyb3IpLlxuICAgKiBAbG9jdXMgU2VydmVyXG4gICAqIEBwYXJhbSB7RXJyb3J9IGVycm9yIFRoZSBlcnJvciB0byBwYXNzIHRvIHRoZSBjbGllbnQuXG4gICAqIEBpbnN0YW5jZVxuICAgKiBAbWVtYmVyT2YgU3Vic2NyaXB0aW9uXG4gICAqL1xuICBlcnJvcjogZnVuY3Rpb24gKGVycm9yKSB7XG4gICAgdmFyIHNlbGYgPSB0aGlzO1xuICAgIGlmIChzZWxmLl9pc0RlYWN0aXZhdGVkKCkpXG4gICAgICByZXR1cm47XG4gICAgc2VsZi5fc2Vzc2lvbi5fc3RvcFN1YnNjcmlwdGlvbihzZWxmLl9zdWJzY3JpcHRpb25JZCwgZXJyb3IpO1xuICB9LFxuXG4gIC8vIE5vdGUgdGhhdCB3aGlsZSBvdXIgRERQIGNsaWVudCB3aWxsIG5vdGljZSB0aGF0IHlvdSd2ZSBjYWxsZWQgc3RvcCgpIG9uIHRoZVxuICAvLyBzZXJ2ZXIgKGFuZCBjbGVhbiB1cCBpdHMgX3N1YnNjcmlwdGlvbnMgdGFibGUpIHdlIGRvbid0IGFjdHVhbGx5IHByb3ZpZGUgYVxuICAvLyBtZWNoYW5pc20gZm9yIGFuIGFwcCB0byBub3RpY2UgdGhpcyAodGhlIHN1YnNjcmliZSBvbkVycm9yIGNhbGxiYWNrIG9ubHlcbiAgLy8gdHJpZ2dlcnMgaWYgdGhlcmUgaXMgYW4gZXJyb3IpLlxuXG4gIC8qKlxuICAgKiBAc3VtbWFyeSBDYWxsIGluc2lkZSB0aGUgcHVibGlzaCBmdW5jdGlvbi4gIFN0b3BzIHRoaXMgY2xpZW50J3Mgc3Vic2NyaXB0aW9uIGFuZCBpbnZva2VzIHRoZSBjbGllbnQncyBgb25TdG9wYCBjYWxsYmFjayB3aXRoIG5vIGVycm9yLlxuICAgKiBAbG9jdXMgU2VydmVyXG4gICAqIEBpbnN0YW5jZVxuICAgKiBAbWVtYmVyT2YgU3Vic2NyaXB0aW9uXG4gICAqL1xuICBzdG9wOiBmdW5jdGlvbiAoKSB7XG4gICAgdmFyIHNlbGYgPSB0aGlzO1xuICAgIGlmIChzZWxmLl9pc0RlYWN0aXZhdGVkKCkpXG4gICAgICByZXR1cm47XG4gICAgc2VsZi5fc2Vzc2lvbi5fc3RvcFN1YnNjcmlwdGlvbihzZWxmLl9zdWJzY3JpcHRpb25JZCk7XG4gIH0sXG5cbiAgLyoqXG4gICAqIEBzdW1tYXJ5IENhbGwgaW5zaWRlIHRoZSBwdWJsaXNoIGZ1bmN0aW9uLiAgUmVnaXN0ZXJzIGEgY2FsbGJhY2sgZnVuY3Rpb24gdG8gcnVuIHdoZW4gdGhlIHN1YnNjcmlwdGlvbiBpcyBzdG9wcGVkLlxuICAgKiBAbG9jdXMgU2VydmVyXG4gICAqIEBtZW1iZXJPZiBTdWJzY3JpcHRpb25cbiAgICogQGluc3RhbmNlXG4gICAqIEBwYXJhbSB7RnVuY3Rpb259IGZ1bmMgVGhlIGNhbGxiYWNrIGZ1bmN0aW9uXG4gICAqL1xuICBvblN0b3A6IGZ1bmN0aW9uIChjYWxsYmFjaykge1xuICAgIHZhciBzZWxmID0gdGhpcztcbiAgICBjYWxsYmFjayA9IE1ldGVvci5iaW5kRW52aXJvbm1lbnQoY2FsbGJhY2ssICdvblN0b3AgY2FsbGJhY2snLCBzZWxmKTtcbiAgICBpZiAoc2VsZi5faXNEZWFjdGl2YXRlZCgpKVxuICAgICAgY2FsbGJhY2soKTtcbiAgICBlbHNlXG4gICAgICBzZWxmLl9zdG9wQ2FsbGJhY2tzLnB1c2goY2FsbGJhY2spO1xuICB9LFxuXG4gIC8vIFRoaXMgcmV0dXJucyB0cnVlIGlmIHRoZSBzdWIgaGFzIGJlZW4gZGVhY3RpdmF0ZWQsICpPUiogaWYgdGhlIHNlc3Npb24gd2FzXG4gIC8vIGRlc3Ryb3llZCBidXQgdGhlIGRlZmVycmVkIGNhbGwgdG8gX2RlYWN0aXZhdGVBbGxTdWJzY3JpcHRpb25zIGhhc24ndFxuICAvLyBoYXBwZW5lZCB5ZXQuXG4gIF9pc0RlYWN0aXZhdGVkOiBmdW5jdGlvbiAoKSB7XG4gICAgdmFyIHNlbGYgPSB0aGlzO1xuICAgIHJldHVybiBzZWxmLl9kZWFjdGl2YXRlZCB8fCBzZWxmLl9zZXNzaW9uLmluUXVldWUgPT09IG51bGw7XG4gIH0sXG5cbiAgLyoqXG4gICAqIEBzdW1tYXJ5IENhbGwgaW5zaWRlIHRoZSBwdWJsaXNoIGZ1bmN0aW9uLiAgSW5mb3JtcyB0aGUgc3Vic2NyaWJlciB0aGF0IGEgZG9jdW1lbnQgaGFzIGJlZW4gYWRkZWQgdG8gdGhlIHJlY29yZCBzZXQuXG4gICAqIEBsb2N1cyBTZXJ2ZXJcbiAgICogQG1lbWJlck9mIFN1YnNjcmlwdGlvblxuICAgKiBAaW5zdGFuY2VcbiAgICogQHBhcmFtIHtTdHJpbmd9IGNvbGxlY3Rpb24gVGhlIG5hbWUgb2YgdGhlIGNvbGxlY3Rpb24gdGhhdCBjb250YWlucyB0aGUgbmV3IGRvY3VtZW50LlxuICAgKiBAcGFyYW0ge1N0cmluZ30gaWQgVGhlIG5ldyBkb2N1bWVudCdzIElELlxuICAgKiBAcGFyYW0ge09iamVjdH0gZmllbGRzIFRoZSBmaWVsZHMgaW4gdGhlIG5ldyBkb2N1bWVudC4gIElmIGBfaWRgIGlzIHByZXNlbnQgaXQgaXMgaWdub3JlZC5cbiAgICovXG4gIGFkZGVkOiBmdW5jdGlvbiAoY29sbGVjdGlvbk5hbWUsIGlkLCBmaWVsZHMpIHtcbiAgICB2YXIgc2VsZiA9IHRoaXM7XG4gICAgaWYgKHNlbGYuX2lzRGVhY3RpdmF0ZWQoKSlcbiAgICAgIHJldHVybjtcbiAgICBpZCA9IHNlbGYuX2lkRmlsdGVyLmlkU3RyaW5naWZ5KGlkKTtcbiAgICBsZXQgaWRzID0gc2VsZi5fZG9jdW1lbnRzLmdldChjb2xsZWN0aW9uTmFtZSk7XG4gICAgaWYgKGlkcyA9PSBudWxsKSB7XG4gICAgICBpZHMgPSBuZXcgU2V0KCk7XG4gICAgICBzZWxmLl9kb2N1bWVudHMuc2V0KGNvbGxlY3Rpb25OYW1lLCBpZHMpO1xuICAgIH1cbiAgICBpZHMuYWRkKGlkKTtcbiAgICBzZWxmLl9zZXNzaW9uLmFkZGVkKHNlbGYuX3N1YnNjcmlwdGlvbkhhbmRsZSwgY29sbGVjdGlvbk5hbWUsIGlkLCBmaWVsZHMpO1xuICB9LFxuXG4gIC8qKlxuICAgKiBAc3VtbWFyeSBDYWxsIGluc2lkZSB0aGUgcHVibGlzaCBmdW5jdGlvbi4gIEluZm9ybXMgdGhlIHN1YnNjcmliZXIgdGhhdCBhIGRvY3VtZW50IGluIHRoZSByZWNvcmQgc2V0IGhhcyBiZWVuIG1vZGlmaWVkLlxuICAgKiBAbG9jdXMgU2VydmVyXG4gICAqIEBtZW1iZXJPZiBTdWJzY3JpcHRpb25cbiAgICogQGluc3RhbmNlXG4gICAqIEBwYXJhbSB7U3RyaW5nfSBjb2xsZWN0aW9uIFRoZSBuYW1lIG9mIHRoZSBjb2xsZWN0aW9uIHRoYXQgY29udGFpbnMgdGhlIGNoYW5nZWQgZG9jdW1lbnQuXG4gICAqIEBwYXJhbSB7U3RyaW5nfSBpZCBUaGUgY2hhbmdlZCBkb2N1bWVudCdzIElELlxuICAgKiBAcGFyYW0ge09iamVjdH0gZmllbGRzIFRoZSBmaWVsZHMgaW4gdGhlIGRvY3VtZW50IHRoYXQgaGF2ZSBjaGFuZ2VkLCB0b2dldGhlciB3aXRoIHRoZWlyIG5ldyB2YWx1ZXMuICBJZiBhIGZpZWxkIGlzIG5vdCBwcmVzZW50IGluIGBmaWVsZHNgIGl0IHdhcyBsZWZ0IHVuY2hhbmdlZDsgaWYgaXQgaXMgcHJlc2VudCBpbiBgZmllbGRzYCBhbmQgaGFzIGEgdmFsdWUgb2YgYHVuZGVmaW5lZGAgaXQgd2FzIHJlbW92ZWQgZnJvbSB0aGUgZG9jdW1lbnQuICBJZiBgX2lkYCBpcyBwcmVzZW50IGl0IGlzIGlnbm9yZWQuXG4gICAqL1xuICBjaGFuZ2VkOiBmdW5jdGlvbiAoY29sbGVjdGlvbk5hbWUsIGlkLCBmaWVsZHMpIHtcbiAgICB2YXIgc2VsZiA9IHRoaXM7XG4gICAgaWYgKHNlbGYuX2lzRGVhY3RpdmF0ZWQoKSlcbiAgICAgIHJldHVybjtcbiAgICBpZCA9IHNlbGYuX2lkRmlsdGVyLmlkU3RyaW5naWZ5KGlkKTtcbiAgICBzZWxmLl9zZXNzaW9uLmNoYW5nZWQoc2VsZi5fc3Vic2NyaXB0aW9uSGFuZGxlLCBjb2xsZWN0aW9uTmFtZSwgaWQsIGZpZWxkcyk7XG4gIH0sXG5cbiAgLyoqXG4gICAqIEBzdW1tYXJ5IENhbGwgaW5zaWRlIHRoZSBwdWJsaXNoIGZ1bmN0aW9uLiAgSW5mb3JtcyB0aGUgc3Vic2NyaWJlciB0aGF0IGEgZG9jdW1lbnQgaGFzIGJlZW4gcmVtb3ZlZCBmcm9tIHRoZSByZWNvcmQgc2V0LlxuICAgKiBAbG9jdXMgU2VydmVyXG4gICAqIEBtZW1iZXJPZiBTdWJzY3JpcHRpb25cbiAgICogQGluc3RhbmNlXG4gICAqIEBwYXJhbSB7U3RyaW5nfSBjb2xsZWN0aW9uIFRoZSBuYW1lIG9mIHRoZSBjb2xsZWN0aW9uIHRoYXQgdGhlIGRvY3VtZW50IGhhcyBiZWVuIHJlbW92ZWQgZnJvbS5cbiAgICogQHBhcmFtIHtTdHJpbmd9IGlkIFRoZSBJRCBvZiB0aGUgZG9jdW1lbnQgdGhhdCBoYXMgYmVlbiByZW1vdmVkLlxuICAgKi9cbiAgcmVtb3ZlZDogZnVuY3Rpb24gKGNvbGxlY3Rpb25OYW1lLCBpZCkge1xuICAgIHZhciBzZWxmID0gdGhpcztcbiAgICBpZiAoc2VsZi5faXNEZWFjdGl2YXRlZCgpKVxuICAgICAgcmV0dXJuO1xuICAgIGlkID0gc2VsZi5faWRGaWx0ZXIuaWRTdHJpbmdpZnkoaWQpO1xuICAgIC8vIFdlIGRvbid0IGJvdGhlciB0byBkZWxldGUgc2V0cyBvZiB0aGluZ3MgaW4gYSBjb2xsZWN0aW9uIGlmIHRoZVxuICAgIC8vIGNvbGxlY3Rpb24gaXMgZW1wdHkuICBJdCBjb3VsZCBicmVhayBfcmVtb3ZlQWxsRG9jdW1lbnRzLlxuICAgIHNlbGYuX2RvY3VtZW50cy5nZXQoY29sbGVjdGlvbk5hbWUpLmRlbGV0ZShpZCk7XG4gICAgc2VsZi5fc2Vzc2lvbi5yZW1vdmVkKHNlbGYuX3N1YnNjcmlwdGlvbkhhbmRsZSwgY29sbGVjdGlvbk5hbWUsIGlkKTtcbiAgfSxcblxuICAvKipcbiAgICogQHN1bW1hcnkgQ2FsbCBpbnNpZGUgdGhlIHB1Ymxpc2ggZnVuY3Rpb24uICBJbmZvcm1zIHRoZSBzdWJzY3JpYmVyIHRoYXQgYW4gaW5pdGlhbCwgY29tcGxldGUgc25hcHNob3Qgb2YgdGhlIHJlY29yZCBzZXQgaGFzIGJlZW4gc2VudC4gIFRoaXMgd2lsbCB0cmlnZ2VyIGEgY2FsbCBvbiB0aGUgY2xpZW50IHRvIHRoZSBgb25SZWFkeWAgY2FsbGJhY2sgcGFzc2VkIHRvICBbYE1ldGVvci5zdWJzY3JpYmVgXSgjbWV0ZW9yX3N1YnNjcmliZSksIGlmIGFueS5cbiAgICogQGxvY3VzIFNlcnZlclxuICAgKiBAbWVtYmVyT2YgU3Vic2NyaXB0aW9uXG4gICAqIEBpbnN0YW5jZVxuICAgKi9cbiAgcmVhZHk6IGZ1bmN0aW9uICgpIHtcbiAgICB2YXIgc2VsZiA9IHRoaXM7XG4gICAgaWYgKHNlbGYuX2lzRGVhY3RpdmF0ZWQoKSlcbiAgICAgIHJldHVybjtcbiAgICBpZiAoIXNlbGYuX3N1YnNjcmlwdGlvbklkKVxuICAgICAgcmV0dXJuOyAgLy8gdW5uZWNlc3NhcnkgYnV0IGlnbm9yZWQgZm9yIHVuaXZlcnNhbCBzdWJcbiAgICBpZiAoIXNlbGYuX3JlYWR5KSB7XG4gICAgICBzZWxmLl9zZXNzaW9uLnNlbmRSZWFkeShbc2VsZi5fc3Vic2NyaXB0aW9uSWRdKTtcbiAgICAgIHNlbGYuX3JlYWR5ID0gdHJ1ZTtcbiAgICB9XG4gIH1cbn0pO1xuXG4vKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqL1xuLyogU2VydmVyICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgKi9cbi8qKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKiovXG5cblNlcnZlciA9IGZ1bmN0aW9uIChvcHRpb25zKSB7XG4gIHZhciBzZWxmID0gdGhpcztcblxuICAvLyBUaGUgZGVmYXVsdCBoZWFydGJlYXQgaW50ZXJ2YWwgaXMgMzAgc2Vjb25kcyBvbiB0aGUgc2VydmVyIGFuZCAzNVxuICAvLyBzZWNvbmRzIG9uIHRoZSBjbGllbnQuICBTaW5jZSB0aGUgY2xpZW50IGRvZXNuJ3QgbmVlZCB0byBzZW5kIGFcbiAgLy8gcGluZyBhcyBsb25nIGFzIGl0IGlzIHJlY2VpdmluZyBwaW5ncywgdGhpcyBtZWFucyB0aGF0IHBpbmdzXG4gIC8vIG5vcm1hbGx5IGdvIGZyb20gdGhlIHNlcnZlciB0byB0aGUgY2xpZW50LlxuICAvL1xuICAvLyBOb3RlOiBUcm9wb3NwaGVyZSBkZXBlbmRzIG9uIHRoZSBhYmlsaXR5IHRvIG11dGF0ZVxuICAvLyBNZXRlb3Iuc2VydmVyLm9wdGlvbnMuaGVhcnRiZWF0VGltZW91dCEgVGhpcyBpcyBhIGhhY2ssIGJ1dCBpdCdzIGxpZmUuXG4gIHNlbGYub3B0aW9ucyA9IF8uZGVmYXVsdHMob3B0aW9ucyB8fCB7fSwge1xuICAgIGhlYXJ0YmVhdEludGVydmFsOiAxNTAwMCxcbiAgICBoZWFydGJlYXRUaW1lb3V0OiAxNTAwMCxcbiAgICAvLyBGb3IgdGVzdGluZywgYWxsb3cgcmVzcG9uZGluZyB0byBwaW5ncyB0byBiZSBkaXNhYmxlZC5cbiAgICByZXNwb25kVG9QaW5nczogdHJ1ZVxuICB9KTtcblxuICAvLyBNYXAgb2YgY2FsbGJhY2tzIHRvIGNhbGwgd2hlbiBhIG5ldyBjb25uZWN0aW9uIGNvbWVzIGluIHRvIHRoZVxuICAvLyBzZXJ2ZXIgYW5kIGNvbXBsZXRlcyBERFAgdmVyc2lvbiBuZWdvdGlhdGlvbi4gVXNlIGFuIG9iamVjdCBpbnN0ZWFkXG4gIC8vIG9mIGFuIGFycmF5IHNvIHdlIGNhbiBzYWZlbHkgcmVtb3ZlIG9uZSBmcm9tIHRoZSBsaXN0IHdoaWxlXG4gIC8vIGl0ZXJhdGluZyBvdmVyIGl0LlxuICBzZWxmLm9uQ29ubmVjdGlvbkhvb2sgPSBuZXcgSG9vayh7XG4gICAgZGVidWdQcmludEV4Y2VwdGlvbnM6IFwib25Db25uZWN0aW9uIGNhbGxiYWNrXCJcbiAgfSk7XG5cbiAgLy8gTWFwIG9mIGNhbGxiYWNrcyB0byBjYWxsIHdoZW4gYSBuZXcgbWVzc2FnZSBjb21lcyBpbi5cbiAgc2VsZi5vbk1lc3NhZ2VIb29rID0gbmV3IEhvb2soe1xuICAgIGRlYnVnUHJpbnRFeGNlcHRpb25zOiBcIm9uTWVzc2FnZSBjYWxsYmFja1wiXG4gIH0pO1xuXG4gIHNlbGYucHVibGlzaF9oYW5kbGVycyA9IHt9O1xuICBzZWxmLnVuaXZlcnNhbF9wdWJsaXNoX2hhbmRsZXJzID0gW107XG5cbiAgc2VsZi5tZXRob2RfaGFuZGxlcnMgPSB7fTtcblxuICBzZWxmLnNlc3Npb25zID0gbmV3IE1hcCgpOyAvLyBtYXAgZnJvbSBpZCB0byBzZXNzaW9uXG5cbiAgc2VsZi5zdHJlYW1fc2VydmVyID0gbmV3IFN0cmVhbVNlcnZlcjtcblxuICBzZWxmLnN0cmVhbV9zZXJ2ZXIucmVnaXN0ZXIoZnVuY3Rpb24gKHNvY2tldCkge1xuICAgIC8vIHNvY2tldCBpbXBsZW1lbnRzIHRoZSBTb2NrSlNDb25uZWN0aW9uIGludGVyZmFjZVxuICAgIHNvY2tldC5fbWV0ZW9yU2Vzc2lvbiA9IG51bGw7XG5cbiAgICB2YXIgc2VuZEVycm9yID0gZnVuY3Rpb24gKHJlYXNvbiwgb2ZmZW5kaW5nTWVzc2FnZSkge1xuICAgICAgdmFyIG1zZyA9IHttc2c6ICdlcnJvcicsIHJlYXNvbjogcmVhc29ufTtcbiAgICAgIGlmIChvZmZlbmRpbmdNZXNzYWdlKVxuICAgICAgICBtc2cub2ZmZW5kaW5nTWVzc2FnZSA9IG9mZmVuZGluZ01lc3NhZ2U7XG4gICAgICBzb2NrZXQuc2VuZChERFBDb21tb24uc3RyaW5naWZ5RERQKG1zZykpO1xuICAgIH07XG5cbiAgICBzb2NrZXQub24oJ2RhdGEnLCBmdW5jdGlvbiAocmF3X21zZykge1xuICAgICAgaWYgKE1ldGVvci5fcHJpbnRSZWNlaXZlZEREUCkge1xuICAgICAgICBNZXRlb3IuX2RlYnVnKFwiUmVjZWl2ZWQgRERQXCIsIHJhd19tc2cpO1xuICAgICAgfVxuICAgICAgdHJ5IHtcbiAgICAgICAgdHJ5IHtcbiAgICAgICAgICB2YXIgbXNnID0gRERQQ29tbW9uLnBhcnNlRERQKHJhd19tc2cpO1xuICAgICAgICB9IGNhdGNoIChlcnIpIHtcbiAgICAgICAgICBzZW5kRXJyb3IoJ1BhcnNlIGVycm9yJyk7XG4gICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG4gICAgICAgIGlmIChtc2cgPT09IG51bGwgfHwgIW1zZy5tc2cpIHtcbiAgICAgICAgICBzZW5kRXJyb3IoJ0JhZCByZXF1ZXN0JywgbXNnKTtcbiAgICAgICAgICByZXR1cm47XG4gICAgICAgIH1cblxuICAgICAgICBpZiAobXNnLm1zZyA9PT0gJ2Nvbm5lY3QnKSB7XG4gICAgICAgICAgaWYgKHNvY2tldC5fbWV0ZW9yU2Vzc2lvbikge1xuICAgICAgICAgICAgc2VuZEVycm9yKFwiQWxyZWFkeSBjb25uZWN0ZWRcIiwgbXNnKTtcbiAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgICB9XG4gICAgICAgICAgRmliZXIoZnVuY3Rpb24gKCkge1xuICAgICAgICAgICAgc2VsZi5faGFuZGxlQ29ubmVjdChzb2NrZXQsIG1zZyk7XG4gICAgICAgICAgfSkucnVuKCk7XG4gICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG5cbiAgICAgICAgaWYgKCFzb2NrZXQuX21ldGVvclNlc3Npb24pIHtcbiAgICAgICAgICBzZW5kRXJyb3IoJ011c3QgY29ubmVjdCBmaXJzdCcsIG1zZyk7XG4gICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG4gICAgICAgIHNvY2tldC5fbWV0ZW9yU2Vzc2lvbi5wcm9jZXNzTWVzc2FnZShtc2cpO1xuICAgICAgfSBjYXRjaCAoZSkge1xuICAgICAgICAvLyBYWFggcHJpbnQgc3RhY2sgbmljZWx5XG4gICAgICAgIE1ldGVvci5fZGVidWcoXCJJbnRlcm5hbCBleGNlcHRpb24gd2hpbGUgcHJvY2Vzc2luZyBtZXNzYWdlXCIsIG1zZywgZSk7XG4gICAgICB9XG4gICAgfSk7XG5cbiAgICBzb2NrZXQub24oJ2Nsb3NlJywgZnVuY3Rpb24gKCkge1xuICAgICAgaWYgKHNvY2tldC5fbWV0ZW9yU2Vzc2lvbikge1xuICAgICAgICBGaWJlcihmdW5jdGlvbiAoKSB7XG4gICAgICAgICAgc29ja2V0Ll9tZXRlb3JTZXNzaW9uLmNsb3NlKCk7XG4gICAgICAgIH0pLnJ1bigpO1xuICAgICAgfVxuICAgIH0pO1xuICB9KTtcbn07XG5cbl8uZXh0ZW5kKFNlcnZlci5wcm90b3R5cGUsIHtcblxuICAvKipcbiAgICogQHN1bW1hcnkgUmVnaXN0ZXIgYSBjYWxsYmFjayB0byBiZSBjYWxsZWQgd2hlbiBhIG5ldyBERFAgY29ubmVjdGlvbiBpcyBtYWRlIHRvIHRoZSBzZXJ2ZXIuXG4gICAqIEBsb2N1cyBTZXJ2ZXJcbiAgICogQHBhcmFtIHtmdW5jdGlvbn0gY2FsbGJhY2sgVGhlIGZ1bmN0aW9uIHRvIGNhbGwgd2hlbiBhIG5ldyBERFAgY29ubmVjdGlvbiBpcyBlc3RhYmxpc2hlZC5cbiAgICogQG1lbWJlck9mIE1ldGVvclxuICAgKiBAaW1wb3J0RnJvbVBhY2thZ2UgbWV0ZW9yXG4gICAqL1xuICBvbkNvbm5lY3Rpb246IGZ1bmN0aW9uIChmbikge1xuICAgIHZhciBzZWxmID0gdGhpcztcbiAgICByZXR1cm4gc2VsZi5vbkNvbm5lY3Rpb25Ib29rLnJlZ2lzdGVyKGZuKTtcbiAgfSxcblxuICAvKipcbiAgICogQHN1bW1hcnkgUmVnaXN0ZXIgYSBjYWxsYmFjayB0byBiZSBjYWxsZWQgd2hlbiBhIG5ldyBERFAgbWVzc2FnZSBpcyByZWNlaXZlZC5cbiAgICogQGxvY3VzIFNlcnZlclxuICAgKiBAcGFyYW0ge2Z1bmN0aW9ufSBjYWxsYmFjayBUaGUgZnVuY3Rpb24gdG8gY2FsbCB3aGVuIGEgbmV3IEREUCBtZXNzYWdlIGlzIHJlY2VpdmVkLlxuICAgKiBAbWVtYmVyT2YgTWV0ZW9yXG4gICAqIEBpbXBvcnRGcm9tUGFja2FnZSBtZXRlb3JcbiAgICovXG4gIG9uTWVzc2FnZTogZnVuY3Rpb24gKGZuKSB7XG4gICAgdmFyIHNlbGYgPSB0aGlzO1xuICAgIHJldHVybiBzZWxmLm9uTWVzc2FnZUhvb2sucmVnaXN0ZXIoZm4pO1xuICB9LFxuXG4gIF9oYW5kbGVDb25uZWN0OiBmdW5jdGlvbiAoc29ja2V0LCBtc2cpIHtcbiAgICB2YXIgc2VsZiA9IHRoaXM7XG5cbiAgICAvLyBUaGUgY29ubmVjdCBtZXNzYWdlIG11c3Qgc3BlY2lmeSBhIHZlcnNpb24gYW5kIGFuIGFycmF5IG9mIHN1cHBvcnRlZFxuICAgIC8vIHZlcnNpb25zLCBhbmQgaXQgbXVzdCBjbGFpbSB0byBzdXBwb3J0IHdoYXQgaXQgaXMgcHJvcG9zaW5nLlxuICAgIGlmICghKHR5cGVvZiAobXNnLnZlcnNpb24pID09PSAnc3RyaW5nJyAmJlxuICAgICAgICAgIF8uaXNBcnJheShtc2cuc3VwcG9ydCkgJiZcbiAgICAgICAgICBfLmFsbChtc2cuc3VwcG9ydCwgXy5pc1N0cmluZykgJiZcbiAgICAgICAgICBfLmNvbnRhaW5zKG1zZy5zdXBwb3J0LCBtc2cudmVyc2lvbikpKSB7XG4gICAgICBzb2NrZXQuc2VuZChERFBDb21tb24uc3RyaW5naWZ5RERQKHttc2c6ICdmYWlsZWQnLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB2ZXJzaW9uOiBERFBDb21tb24uU1VQUE9SVEVEX0REUF9WRVJTSU9OU1swXX0pKTtcbiAgICAgIHNvY2tldC5jbG9zZSgpO1xuICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIC8vIEluIHRoZSBmdXR1cmUsIGhhbmRsZSBzZXNzaW9uIHJlc3VtcHRpb246IHNvbWV0aGluZyBsaWtlOlxuICAgIC8vICBzb2NrZXQuX21ldGVvclNlc3Npb24gPSBzZWxmLnNlc3Npb25zW21zZy5zZXNzaW9uXVxuICAgIHZhciB2ZXJzaW9uID0gY2FsY3VsYXRlVmVyc2lvbihtc2cuc3VwcG9ydCwgRERQQ29tbW9uLlNVUFBPUlRFRF9ERFBfVkVSU0lPTlMpO1xuXG4gICAgaWYgKG1zZy52ZXJzaW9uICE9PSB2ZXJzaW9uKSB7XG4gICAgICAvLyBUaGUgYmVzdCB2ZXJzaW9uIHRvIHVzZSAoYWNjb3JkaW5nIHRvIHRoZSBjbGllbnQncyBzdGF0ZWQgcHJlZmVyZW5jZXMpXG4gICAgICAvLyBpcyBub3QgdGhlIG9uZSB0aGUgY2xpZW50IGlzIHRyeWluZyB0byB1c2UuIEluZm9ybSB0aGVtIGFib3V0IHRoZSBiZXN0XG4gICAgICAvLyB2ZXJzaW9uIHRvIHVzZS5cbiAgICAgIHNvY2tldC5zZW5kKEREUENvbW1vbi5zdHJpbmdpZnlERFAoe21zZzogJ2ZhaWxlZCcsIHZlcnNpb246IHZlcnNpb259KSk7XG4gICAgICBzb2NrZXQuY2xvc2UoKTtcbiAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICAvLyBZYXksIHZlcnNpb24gbWF0Y2hlcyEgQ3JlYXRlIGEgbmV3IHNlc3Npb24uXG4gICAgLy8gTm90ZTogVHJvcG9zcGhlcmUgZGVwZW5kcyBvbiB0aGUgYWJpbGl0eSB0byBtdXRhdGVcbiAgICAvLyBNZXRlb3Iuc2VydmVyLm9wdGlvbnMuaGVhcnRiZWF0VGltZW91dCEgVGhpcyBpcyBhIGhhY2ssIGJ1dCBpdCdzIGxpZmUuXG4gICAgc29ja2V0Ll9tZXRlb3JTZXNzaW9uID0gbmV3IFNlc3Npb24oc2VsZiwgdmVyc2lvbiwgc29ja2V0LCBzZWxmLm9wdGlvbnMpO1xuICAgIHNlbGYuc2Vzc2lvbnMuc2V0KHNvY2tldC5fbWV0ZW9yU2Vzc2lvbi5pZCwgc29ja2V0Ll9tZXRlb3JTZXNzaW9uKTtcbiAgICBzZWxmLm9uQ29ubmVjdGlvbkhvb2suZWFjaChmdW5jdGlvbiAoY2FsbGJhY2spIHtcbiAgICAgIGlmIChzb2NrZXQuX21ldGVvclNlc3Npb24pXG4gICAgICAgIGNhbGxiYWNrKHNvY2tldC5fbWV0ZW9yU2Vzc2lvbi5jb25uZWN0aW9uSGFuZGxlKTtcbiAgICAgIHJldHVybiB0cnVlO1xuICAgIH0pO1xuICB9LFxuICAvKipcbiAgICogUmVnaXN0ZXIgYSBwdWJsaXNoIGhhbmRsZXIgZnVuY3Rpb24uXG4gICAqXG4gICAqIEBwYXJhbSBuYW1lIHtTdHJpbmd9IGlkZW50aWZpZXIgZm9yIHF1ZXJ5XG4gICAqIEBwYXJhbSBoYW5kbGVyIHtGdW5jdGlvbn0gcHVibGlzaCBoYW5kbGVyXG4gICAqIEBwYXJhbSBvcHRpb25zIHtPYmplY3R9XG4gICAqXG4gICAqIFNlcnZlciB3aWxsIGNhbGwgaGFuZGxlciBmdW5jdGlvbiBvbiBlYWNoIG5ldyBzdWJzY3JpcHRpb24sXG4gICAqIGVpdGhlciB3aGVuIHJlY2VpdmluZyBERFAgc3ViIG1lc3NhZ2UgZm9yIGEgbmFtZWQgc3Vic2NyaXB0aW9uLCBvciBvblxuICAgKiBERFAgY29ubmVjdCBmb3IgYSB1bml2ZXJzYWwgc3Vic2NyaXB0aW9uLlxuICAgKlxuICAgKiBJZiBuYW1lIGlzIG51bGwsIHRoaXMgd2lsbCBiZSBhIHN1YnNjcmlwdGlvbiB0aGF0IGlzXG4gICAqIGF1dG9tYXRpY2FsbHkgZXN0YWJsaXNoZWQgYW5kIHBlcm1hbmVudGx5IG9uIGZvciBhbGwgY29ubmVjdGVkXG4gICAqIGNsaWVudCwgaW5zdGVhZCBvZiBhIHN1YnNjcmlwdGlvbiB0aGF0IGNhbiBiZSB0dXJuZWQgb24gYW5kIG9mZlxuICAgKiB3aXRoIHN1YnNjcmliZSgpLlxuICAgKlxuICAgKiBvcHRpb25zIHRvIGNvbnRhaW46XG4gICAqICAtIChtb3N0bHkgaW50ZXJuYWwpIGlzX2F1dG86IHRydWUgaWYgZ2VuZXJhdGVkIGF1dG9tYXRpY2FsbHlcbiAgICogICAgZnJvbSBhbiBhdXRvcHVibGlzaCBob29rLiB0aGlzIGlzIGZvciBjb3NtZXRpYyBwdXJwb3NlcyBvbmx5XG4gICAqICAgIChpdCBsZXRzIHVzIGRldGVybWluZSB3aGV0aGVyIHRvIHByaW50IGEgd2FybmluZyBzdWdnZXN0aW5nXG4gICAqICAgIHRoYXQgeW91IHR1cm4gb2ZmIGF1dG9wdWJsaXNoLilcbiAgICovXG5cbiAgLyoqXG4gICAqIEBzdW1tYXJ5IFB1Ymxpc2ggYSByZWNvcmQgc2V0LlxuICAgKiBAbWVtYmVyT2YgTWV0ZW9yXG4gICAqIEBpbXBvcnRGcm9tUGFja2FnZSBtZXRlb3JcbiAgICogQGxvY3VzIFNlcnZlclxuICAgKiBAcGFyYW0ge1N0cmluZ3xPYmplY3R9IG5hbWUgSWYgU3RyaW5nLCBuYW1lIG9mIHRoZSByZWNvcmQgc2V0LiAgSWYgT2JqZWN0LCBwdWJsaWNhdGlvbnMgRGljdGlvbmFyeSBvZiBwdWJsaXNoIGZ1bmN0aW9ucyBieSBuYW1lLiAgSWYgYG51bGxgLCB0aGUgc2V0IGhhcyBubyBuYW1lLCBhbmQgdGhlIHJlY29yZCBzZXQgaXMgYXV0b21hdGljYWxseSBzZW50IHRvIGFsbCBjb25uZWN0ZWQgY2xpZW50cy5cbiAgICogQHBhcmFtIHtGdW5jdGlvbn0gZnVuYyBGdW5jdGlvbiBjYWxsZWQgb24gdGhlIHNlcnZlciBlYWNoIHRpbWUgYSBjbGllbnQgc3Vic2NyaWJlcy4gIEluc2lkZSB0aGUgZnVuY3Rpb24sIGB0aGlzYCBpcyB0aGUgcHVibGlzaCBoYW5kbGVyIG9iamVjdCwgZGVzY3JpYmVkIGJlbG93LiAgSWYgdGhlIGNsaWVudCBwYXNzZWQgYXJndW1lbnRzIHRvIGBzdWJzY3JpYmVgLCB0aGUgZnVuY3Rpb24gaXMgY2FsbGVkIHdpdGggdGhlIHNhbWUgYXJndW1lbnRzLlxuICAgKi9cbiAgcHVibGlzaDogZnVuY3Rpb24gKG5hbWUsIGhhbmRsZXIsIG9wdGlvbnMpIHtcbiAgICB2YXIgc2VsZiA9IHRoaXM7XG5cbiAgICBpZiAoISBfLmlzT2JqZWN0KG5hbWUpKSB7XG4gICAgICBvcHRpb25zID0gb3B0aW9ucyB8fCB7fTtcblxuICAgICAgaWYgKG5hbWUgJiYgbmFtZSBpbiBzZWxmLnB1Ymxpc2hfaGFuZGxlcnMpIHtcbiAgICAgICAgTWV0ZW9yLl9kZWJ1ZyhcIklnbm9yaW5nIGR1cGxpY2F0ZSBwdWJsaXNoIG5hbWVkICdcIiArIG5hbWUgKyBcIidcIik7XG4gICAgICAgIHJldHVybjtcbiAgICAgIH1cblxuICAgICAgaWYgKFBhY2thZ2UuYXV0b3B1Ymxpc2ggJiYgIW9wdGlvbnMuaXNfYXV0bykge1xuICAgICAgICAvLyBUaGV5IGhhdmUgYXV0b3B1Ymxpc2ggb24sIHlldCB0aGV5J3JlIHRyeWluZyB0byBtYW51YWxseVxuICAgICAgICAvLyBwaWNraW5nIHN0dWZmIHRvIHB1Ymxpc2guIFRoZXkgcHJvYmFibHkgc2hvdWxkIHR1cm4gb2ZmXG4gICAgICAgIC8vIGF1dG9wdWJsaXNoLiAoVGhpcyBjaGVjayBpc24ndCBwZXJmZWN0IC0tIGlmIHlvdSBjcmVhdGUgYVxuICAgICAgICAvLyBwdWJsaXNoIGJlZm9yZSB5b3UgdHVybiBvbiBhdXRvcHVibGlzaCwgaXQgd29uJ3QgY2F0Y2hcbiAgICAgICAgLy8gaXQuIEJ1dCB0aGlzIHdpbGwgZGVmaW5pdGVseSBoYW5kbGUgdGhlIHNpbXBsZSBjYXNlIHdoZXJlXG4gICAgICAgIC8vIHlvdSd2ZSBhZGRlZCB0aGUgYXV0b3B1Ymxpc2ggcGFja2FnZSB0byB5b3VyIGFwcCwgYW5kIGFyZVxuICAgICAgICAvLyBjYWxsaW5nIHB1Ymxpc2ggZnJvbSB5b3VyIGFwcCBjb2RlLilcbiAgICAgICAgaWYgKCFzZWxmLndhcm5lZF9hYm91dF9hdXRvcHVibGlzaCkge1xuICAgICAgICAgIHNlbGYud2FybmVkX2Fib3V0X2F1dG9wdWJsaXNoID0gdHJ1ZTtcbiAgICAgICAgICBNZXRlb3IuX2RlYnVnKFxuICAgIFwiKiogWW91J3ZlIHNldCB1cCBzb21lIGRhdGEgc3Vic2NyaXB0aW9ucyB3aXRoIE1ldGVvci5wdWJsaXNoKCksIGJ1dFxcblwiICtcbiAgICBcIioqIHlvdSBzdGlsbCBoYXZlIGF1dG9wdWJsaXNoIHR1cm5lZCBvbi4gQmVjYXVzZSBhdXRvcHVibGlzaCBpcyBzdGlsbFxcblwiICtcbiAgICBcIioqIG9uLCB5b3VyIE1ldGVvci5wdWJsaXNoKCkgY2FsbHMgd29uJ3QgaGF2ZSBtdWNoIGVmZmVjdC4gQWxsIGRhdGFcXG5cIiArXG4gICAgXCIqKiB3aWxsIHN0aWxsIGJlIHNlbnQgdG8gYWxsIGNsaWVudHMuXFxuXCIgK1xuICAgIFwiKipcXG5cIiArXG4gICAgXCIqKiBUdXJuIG9mZiBhdXRvcHVibGlzaCBieSByZW1vdmluZyB0aGUgYXV0b3B1Ymxpc2ggcGFja2FnZTpcXG5cIiArXG4gICAgXCIqKlxcblwiICtcbiAgICBcIioqICAgJCBtZXRlb3IgcmVtb3ZlIGF1dG9wdWJsaXNoXFxuXCIgK1xuICAgIFwiKipcXG5cIiArXG4gICAgXCIqKiAuLiBhbmQgbWFrZSBzdXJlIHlvdSBoYXZlIE1ldGVvci5wdWJsaXNoKCkgYW5kIE1ldGVvci5zdWJzY3JpYmUoKSBjYWxsc1xcblwiICtcbiAgICBcIioqIGZvciBlYWNoIGNvbGxlY3Rpb24gdGhhdCB5b3Ugd2FudCBjbGllbnRzIHRvIHNlZS5cXG5cIik7XG4gICAgICAgIH1cbiAgICAgIH1cblxuICAgICAgaWYgKG5hbWUpXG4gICAgICAgIHNlbGYucHVibGlzaF9oYW5kbGVyc1tuYW1lXSA9IGhhbmRsZXI7XG4gICAgICBlbHNlIHtcbiAgICAgICAgc2VsZi51bml2ZXJzYWxfcHVibGlzaF9oYW5kbGVycy5wdXNoKGhhbmRsZXIpO1xuICAgICAgICAvLyBTcGluIHVwIHRoZSBuZXcgcHVibGlzaGVyIG9uIGFueSBleGlzdGluZyBzZXNzaW9uIHRvby4gUnVuIGVhY2hcbiAgICAgICAgLy8gc2Vzc2lvbidzIHN1YnNjcmlwdGlvbiBpbiBhIG5ldyBGaWJlciwgc28gdGhhdCB0aGVyZSdzIG5vIGNoYW5nZSBmb3JcbiAgICAgICAgLy8gc2VsZi5zZXNzaW9ucyB0byBjaGFuZ2Ugd2hpbGUgd2UncmUgcnVubmluZyB0aGlzIGxvb3AuXG4gICAgICAgIHNlbGYuc2Vzc2lvbnMuZm9yRWFjaChmdW5jdGlvbiAoc2Vzc2lvbikge1xuICAgICAgICAgIGlmICghc2Vzc2lvbi5fZG9udFN0YXJ0TmV3VW5pdmVyc2FsU3Vicykge1xuICAgICAgICAgICAgRmliZXIoZnVuY3Rpb24oKSB7XG4gICAgICAgICAgICAgIHNlc3Npb24uX3N0YXJ0U3Vic2NyaXB0aW9uKGhhbmRsZXIpO1xuICAgICAgICAgICAgfSkucnVuKCk7XG4gICAgICAgICAgfVxuICAgICAgICB9KTtcbiAgICAgIH1cbiAgICB9XG4gICAgZWxzZXtcbiAgICAgIF8uZWFjaChuYW1lLCBmdW5jdGlvbih2YWx1ZSwga2V5KSB7XG4gICAgICAgIHNlbGYucHVibGlzaChrZXksIHZhbHVlLCB7fSk7XG4gICAgICB9KTtcbiAgICB9XG4gIH0sXG5cbiAgX3JlbW92ZVNlc3Npb246IGZ1bmN0aW9uIChzZXNzaW9uKSB7XG4gICAgdmFyIHNlbGYgPSB0aGlzO1xuICAgIHNlbGYuc2Vzc2lvbnMuZGVsZXRlKHNlc3Npb24uaWQpO1xuICB9LFxuXG4gIC8qKlxuICAgKiBAc3VtbWFyeSBEZWZpbmVzIGZ1bmN0aW9ucyB0aGF0IGNhbiBiZSBpbnZva2VkIG92ZXIgdGhlIG5ldHdvcmsgYnkgY2xpZW50cy5cbiAgICogQGxvY3VzIEFueXdoZXJlXG4gICAqIEBwYXJhbSB7T2JqZWN0fSBtZXRob2RzIERpY3Rpb25hcnkgd2hvc2Uga2V5cyBhcmUgbWV0aG9kIG5hbWVzIGFuZCB2YWx1ZXMgYXJlIGZ1bmN0aW9ucy5cbiAgICogQG1lbWJlck9mIE1ldGVvclxuICAgKiBAaW1wb3J0RnJvbVBhY2thZ2UgbWV0ZW9yXG4gICAqL1xuICBtZXRob2RzOiBmdW5jdGlvbiAobWV0aG9kcykge1xuICAgIHZhciBzZWxmID0gdGhpcztcbiAgICBfLmVhY2gobWV0aG9kcywgZnVuY3Rpb24gKGZ1bmMsIG5hbWUpIHtcbiAgICAgIGlmICh0eXBlb2YgZnVuYyAhPT0gJ2Z1bmN0aW9uJylcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKFwiTWV0aG9kICdcIiArIG5hbWUgKyBcIicgbXVzdCBiZSBhIGZ1bmN0aW9uXCIpO1xuICAgICAgaWYgKHNlbGYubWV0aG9kX2hhbmRsZXJzW25hbWVdKVxuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoXCJBIG1ldGhvZCBuYW1lZCAnXCIgKyBuYW1lICsgXCInIGlzIGFscmVhZHkgZGVmaW5lZFwiKTtcbiAgICAgIHNlbGYubWV0aG9kX2hhbmRsZXJzW25hbWVdID0gZnVuYztcbiAgICB9KTtcbiAgfSxcblxuICBjYWxsOiBmdW5jdGlvbiAobmFtZSwgLi4uYXJncykge1xuICAgIGlmIChhcmdzLmxlbmd0aCAmJiB0eXBlb2YgYXJnc1thcmdzLmxlbmd0aCAtIDFdID09PSBcImZ1bmN0aW9uXCIpIHtcbiAgICAgIC8vIElmIGl0J3MgYSBmdW5jdGlvbiwgdGhlIGxhc3QgYXJndW1lbnQgaXMgdGhlIHJlc3VsdCBjYWxsYmFjaywgbm90XG4gICAgICAvLyBhIHBhcmFtZXRlciB0byB0aGUgcmVtb3RlIG1ldGhvZC5cbiAgICAgIHZhciBjYWxsYmFjayA9IGFyZ3MucG9wKCk7XG4gICAgfVxuXG4gICAgcmV0dXJuIHRoaXMuYXBwbHkobmFtZSwgYXJncywgY2FsbGJhY2spO1xuICB9LFxuXG4gIC8vIEEgdmVyc2lvbiBvZiB0aGUgY2FsbCBtZXRob2QgdGhhdCBhbHdheXMgcmV0dXJucyBhIFByb21pc2UuXG4gIGNhbGxBc3luYzogZnVuY3Rpb24gKG5hbWUsIC4uLmFyZ3MpIHtcbiAgICByZXR1cm4gdGhpcy5hcHBseUFzeW5jKG5hbWUsIGFyZ3MpO1xuICB9LFxuXG4gIGFwcGx5OiBmdW5jdGlvbiAobmFtZSwgYXJncywgb3B0aW9ucywgY2FsbGJhY2spIHtcbiAgICAvLyBXZSB3ZXJlIHBhc3NlZCAzIGFyZ3VtZW50cy4gVGhleSBtYXkgYmUgZWl0aGVyIChuYW1lLCBhcmdzLCBvcHRpb25zKVxuICAgIC8vIG9yIChuYW1lLCBhcmdzLCBjYWxsYmFjaylcbiAgICBpZiAoISBjYWxsYmFjayAmJiB0eXBlb2Ygb3B0aW9ucyA9PT0gJ2Z1bmN0aW9uJykge1xuICAgICAgY2FsbGJhY2sgPSBvcHRpb25zO1xuICAgICAgb3B0aW9ucyA9IHt9O1xuICAgIH0gZWxzZSB7XG4gICAgICBvcHRpb25zID0gb3B0aW9ucyB8fCB7fTtcbiAgICB9XG5cbiAgICBjb25zdCBwcm9taXNlID0gdGhpcy5hcHBseUFzeW5jKG5hbWUsIGFyZ3MsIG9wdGlvbnMpO1xuXG4gICAgLy8gUmV0dXJuIHRoZSByZXN1bHQgaW4gd2hpY2hldmVyIHdheSB0aGUgY2FsbGVyIGFza2VkIGZvciBpdC4gTm90ZSB0aGF0IHdlXG4gICAgLy8gZG8gTk9UIGJsb2NrIG9uIHRoZSB3cml0ZSBmZW5jZSBpbiBhbiBhbmFsb2dvdXMgd2F5IHRvIGhvdyB0aGUgY2xpZW50XG4gICAgLy8gYmxvY2tzIG9uIHRoZSByZWxldmFudCBkYXRhIGJlaW5nIHZpc2libGUsIHNvIHlvdSBhcmUgTk9UIGd1YXJhbnRlZWQgdGhhdFxuICAgIC8vIGN1cnNvciBvYnNlcnZlIGNhbGxiYWNrcyBoYXZlIGZpcmVkIHdoZW4geW91ciBjYWxsYmFjayBpcyBpbnZva2VkLiAoV2VcbiAgICAvLyBjYW4gY2hhbmdlIHRoaXMgaWYgdGhlcmUncyBhIHJlYWwgdXNlIGNhc2UuKVxuICAgIGlmIChjYWxsYmFjaykge1xuICAgICAgcHJvbWlzZS50aGVuKFxuICAgICAgICByZXN1bHQgPT4gY2FsbGJhY2sodW5kZWZpbmVkLCByZXN1bHQpLFxuICAgICAgICBleGNlcHRpb24gPT4gY2FsbGJhY2soZXhjZXB0aW9uKVxuICAgICAgKTtcbiAgICB9IGVsc2Uge1xuICAgICAgcmV0dXJuIHByb21pc2UuYXdhaXQoKTtcbiAgICB9XG4gIH0sXG5cbiAgLy8gQHBhcmFtIG9wdGlvbnMge09wdGlvbmFsIE9iamVjdH1cbiAgYXBwbHlBc3luYzogZnVuY3Rpb24gKG5hbWUsIGFyZ3MsIG9wdGlvbnMpIHtcbiAgICAvLyBSdW4gdGhlIGhhbmRsZXJcbiAgICB2YXIgaGFuZGxlciA9IHRoaXMubWV0aG9kX2hhbmRsZXJzW25hbWVdO1xuICAgIGlmICghIGhhbmRsZXIpIHtcbiAgICAgIHJldHVybiBQcm9taXNlLnJlamVjdChcbiAgICAgICAgbmV3IE1ldGVvci5FcnJvcig0MDQsIGBNZXRob2QgJyR7bmFtZX0nIG5vdCBmb3VuZGApXG4gICAgICApO1xuICAgIH1cblxuICAgIC8vIElmIHRoaXMgaXMgYSBtZXRob2QgY2FsbCBmcm9tIHdpdGhpbiBhbm90aGVyIG1ldGhvZCBvciBwdWJsaXNoIGZ1bmN0aW9uLFxuICAgIC8vIGdldCB0aGUgdXNlciBzdGF0ZSBmcm9tIHRoZSBvdXRlciBtZXRob2Qgb3IgcHVibGlzaCBmdW5jdGlvbiwgb3RoZXJ3aXNlXG4gICAgLy8gZG9uJ3QgYWxsb3cgc2V0VXNlcklkIHRvIGJlIGNhbGxlZFxuICAgIHZhciB1c2VySWQgPSBudWxsO1xuICAgIHZhciBzZXRVc2VySWQgPSBmdW5jdGlvbigpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihcIkNhbid0IGNhbGwgc2V0VXNlcklkIG9uIGEgc2VydmVyIGluaXRpYXRlZCBtZXRob2QgY2FsbFwiKTtcbiAgICB9O1xuICAgIHZhciBjb25uZWN0aW9uID0gbnVsbDtcbiAgICB2YXIgY3VycmVudE1ldGhvZEludm9jYXRpb24gPSBERFAuX0N1cnJlbnRNZXRob2RJbnZvY2F0aW9uLmdldCgpO1xuICAgIHZhciBjdXJyZW50UHVibGljYXRpb25JbnZvY2F0aW9uID0gRERQLl9DdXJyZW50UHVibGljYXRpb25JbnZvY2F0aW9uLmdldCgpO1xuICAgIHZhciByYW5kb21TZWVkID0gbnVsbDtcbiAgICBpZiAoY3VycmVudE1ldGhvZEludm9jYXRpb24pIHtcbiAgICAgIHVzZXJJZCA9IGN1cnJlbnRNZXRob2RJbnZvY2F0aW9uLnVzZXJJZDtcbiAgICAgIHNldFVzZXJJZCA9IGZ1bmN0aW9uKHVzZXJJZCkge1xuICAgICAgICBjdXJyZW50TWV0aG9kSW52b2NhdGlvbi5zZXRVc2VySWQodXNlcklkKTtcbiAgICAgIH07XG4gICAgICBjb25uZWN0aW9uID0gY3VycmVudE1ldGhvZEludm9jYXRpb24uY29ubmVjdGlvbjtcbiAgICAgIHJhbmRvbVNlZWQgPSBERFBDb21tb24ubWFrZVJwY1NlZWQoY3VycmVudE1ldGhvZEludm9jYXRpb24sIG5hbWUpO1xuICAgIH0gZWxzZSBpZiAoY3VycmVudFB1YmxpY2F0aW9uSW52b2NhdGlvbikge1xuICAgICAgdXNlcklkID0gY3VycmVudFB1YmxpY2F0aW9uSW52b2NhdGlvbi51c2VySWQ7XG4gICAgICBzZXRVc2VySWQgPSBmdW5jdGlvbih1c2VySWQpIHtcbiAgICAgICAgY3VycmVudFB1YmxpY2F0aW9uSW52b2NhdGlvbi5fc2Vzc2lvbi5fc2V0VXNlcklkKHVzZXJJZCk7XG4gICAgICB9O1xuICAgICAgY29ubmVjdGlvbiA9IGN1cnJlbnRQdWJsaWNhdGlvbkludm9jYXRpb24uY29ubmVjdGlvbjtcbiAgICB9XG5cbiAgICB2YXIgaW52b2NhdGlvbiA9IG5ldyBERFBDb21tb24uTWV0aG9kSW52b2NhdGlvbih7XG4gICAgICBpc1NpbXVsYXRpb246IGZhbHNlLFxuICAgICAgdXNlcklkLFxuICAgICAgc2V0VXNlcklkLFxuICAgICAgY29ubmVjdGlvbixcbiAgICAgIHJhbmRvbVNlZWRcbiAgICB9KTtcblxuICAgIHJldHVybiBuZXcgUHJvbWlzZShyZXNvbHZlID0+IHJlc29sdmUoXG4gICAgICBERFAuX0N1cnJlbnRNZXRob2RJbnZvY2F0aW9uLndpdGhWYWx1ZShcbiAgICAgICAgaW52b2NhdGlvbixcbiAgICAgICAgKCkgPT4gbWF5YmVBdWRpdEFyZ3VtZW50Q2hlY2tzKFxuICAgICAgICAgIGhhbmRsZXIsIGludm9jYXRpb24sIEVKU09OLmNsb25lKGFyZ3MpLFxuICAgICAgICAgIFwiaW50ZXJuYWwgY2FsbCB0byAnXCIgKyBuYW1lICsgXCInXCJcbiAgICAgICAgKVxuICAgICAgKVxuICAgICkpLnRoZW4oRUpTT04uY2xvbmUpO1xuICB9LFxuXG4gIF91cmxGb3JTZXNzaW9uOiBmdW5jdGlvbiAoc2Vzc2lvbklkKSB7XG4gICAgdmFyIHNlbGYgPSB0aGlzO1xuICAgIHZhciBzZXNzaW9uID0gc2VsZi5zZXNzaW9ucy5nZXQoc2Vzc2lvbklkKTtcbiAgICBpZiAoc2Vzc2lvbilcbiAgICAgIHJldHVybiBzZXNzaW9uLl9zb2NrZXRVcmw7XG4gICAgZWxzZVxuICAgICAgcmV0dXJuIG51bGw7XG4gIH1cbn0pO1xuXG52YXIgY2FsY3VsYXRlVmVyc2lvbiA9IGZ1bmN0aW9uIChjbGllbnRTdXBwb3J0ZWRWZXJzaW9ucyxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHNlcnZlclN1cHBvcnRlZFZlcnNpb25zKSB7XG4gIHZhciBjb3JyZWN0VmVyc2lvbiA9IF8uZmluZChjbGllbnRTdXBwb3J0ZWRWZXJzaW9ucywgZnVuY3Rpb24gKHZlcnNpb24pIHtcbiAgICByZXR1cm4gXy5jb250YWlucyhzZXJ2ZXJTdXBwb3J0ZWRWZXJzaW9ucywgdmVyc2lvbik7XG4gIH0pO1xuICBpZiAoIWNvcnJlY3RWZXJzaW9uKSB7XG4gICAgY29ycmVjdFZlcnNpb24gPSBzZXJ2ZXJTdXBwb3J0ZWRWZXJzaW9uc1swXTtcbiAgfVxuICByZXR1cm4gY29ycmVjdFZlcnNpb247XG59O1xuXG5ERFBTZXJ2ZXIuX2NhbGN1bGF0ZVZlcnNpb24gPSBjYWxjdWxhdGVWZXJzaW9uO1xuXG5cbi8vIFwiYmxpbmRcIiBleGNlcHRpb25zIG90aGVyIHRoYW4gdGhvc2UgdGhhdCB3ZXJlIGRlbGliZXJhdGVseSB0aHJvd24gdG8gc2lnbmFsXG4vLyBlcnJvcnMgdG8gdGhlIGNsaWVudFxudmFyIHdyYXBJbnRlcm5hbEV4Y2VwdGlvbiA9IGZ1bmN0aW9uIChleGNlcHRpb24sIGNvbnRleHQpIHtcbiAgaWYgKCFleGNlcHRpb24pIHJldHVybiBleGNlcHRpb247XG5cbiAgLy8gVG8gYWxsb3cgcGFja2FnZXMgdG8gdGhyb3cgZXJyb3JzIGludGVuZGVkIGZvciB0aGUgY2xpZW50IGJ1dCBub3QgaGF2ZSB0b1xuICAvLyBkZXBlbmQgb24gdGhlIE1ldGVvci5FcnJvciBjbGFzcywgYGlzQ2xpZW50U2FmZWAgY2FuIGJlIHNldCB0byB0cnVlIG9uIGFueVxuICAvLyBlcnJvciBiZWZvcmUgaXQgaXMgdGhyb3duLlxuICBpZiAoZXhjZXB0aW9uLmlzQ2xpZW50U2FmZSkge1xuICAgIGlmICghKGV4Y2VwdGlvbiBpbnN0YW5jZW9mIE1ldGVvci5FcnJvcikpIHtcbiAgICAgIGNvbnN0IG9yaWdpbmFsTWVzc2FnZSA9IGV4Y2VwdGlvbi5tZXNzYWdlO1xuICAgICAgZXhjZXB0aW9uID0gbmV3IE1ldGVvci5FcnJvcihleGNlcHRpb24uZXJyb3IsIGV4Y2VwdGlvbi5yZWFzb24sIGV4Y2VwdGlvbi5kZXRhaWxzKTtcbiAgICAgIGV4Y2VwdGlvbi5tZXNzYWdlID0gb3JpZ2luYWxNZXNzYWdlO1xuICAgIH1cbiAgICByZXR1cm4gZXhjZXB0aW9uO1xuICB9XG5cbiAgLy8gVGVzdHMgY2FuIHNldCB0aGUgJ19leHBlY3RlZEJ5VGVzdCcgZmxhZyBvbiBhbiBleGNlcHRpb24gc28gaXQgd29uJ3QgZ28gdG9cbiAgLy8gdGhlIHNlcnZlciBsb2cuXG4gIGlmICghZXhjZXB0aW9uLl9leHBlY3RlZEJ5VGVzdCkge1xuICAgIE1ldGVvci5fZGVidWcoXCJFeGNlcHRpb24gXCIgKyBjb250ZXh0LCBleGNlcHRpb24pO1xuICAgIGlmIChleGNlcHRpb24uc2FuaXRpemVkRXJyb3IpIHtcbiAgICAgIE1ldGVvci5fZGVidWcoXCJTYW5pdGl6ZWQgYW5kIHJlcG9ydGVkIHRvIHRoZSBjbGllbnQgYXM6XCIsIGV4Y2VwdGlvbi5zYW5pdGl6ZWRFcnJvcik7XG4gICAgICBNZXRlb3IuX2RlYnVnKCk7XG4gICAgfVxuICB9XG5cbiAgLy8gRGlkIHRoZSBlcnJvciBjb250YWluIG1vcmUgZGV0YWlscyB0aGF0IGNvdWxkIGhhdmUgYmVlbiB1c2VmdWwgaWYgY2F1Z2h0IGluXG4gIC8vIHNlcnZlciBjb2RlIChvciBpZiB0aHJvd24gZnJvbSBub24tY2xpZW50LW9yaWdpbmF0ZWQgY29kZSksIGJ1dCBhbHNvXG4gIC8vIHByb3ZpZGVkIGEgXCJzYW5pdGl6ZWRcIiB2ZXJzaW9uIHdpdGggbW9yZSBjb250ZXh0IHRoYW4gNTAwIEludGVybmFsIHNlcnZlclxuICAvLyBlcnJvcj8gVXNlIHRoYXQuXG4gIGlmIChleGNlcHRpb24uc2FuaXRpemVkRXJyb3IpIHtcbiAgICBpZiAoZXhjZXB0aW9uLnNhbml0aXplZEVycm9yLmlzQ2xpZW50U2FmZSlcbiAgICAgIHJldHVybiBleGNlcHRpb24uc2FuaXRpemVkRXJyb3I7XG4gICAgTWV0ZW9yLl9kZWJ1ZyhcIkV4Y2VwdGlvbiBcIiArIGNvbnRleHQgKyBcIiBwcm92aWRlcyBhIHNhbml0aXplZEVycm9yIHRoYXQgXCIgK1xuICAgICAgICAgICAgICAgICAgXCJkb2VzIG5vdCBoYXZlIGlzQ2xpZW50U2FmZSBwcm9wZXJ0eSBzZXQ7IGlnbm9yaW5nXCIpO1xuICB9XG5cbiAgcmV0dXJuIG5ldyBNZXRlb3IuRXJyb3IoNTAwLCBcIkludGVybmFsIHNlcnZlciBlcnJvclwiKTtcbn07XG5cblxuLy8gQXVkaXQgYXJndW1lbnQgY2hlY2tzLCBpZiB0aGUgYXVkaXQtYXJndW1lbnQtY2hlY2tzIHBhY2thZ2UgZXhpc3RzIChpdCBpcyBhXG4vLyB3ZWFrIGRlcGVuZGVuY3kgb2YgdGhpcyBwYWNrYWdlKS5cbnZhciBtYXliZUF1ZGl0QXJndW1lbnRDaGVja3MgPSBmdW5jdGlvbiAoZiwgY29udGV4dCwgYXJncywgZGVzY3JpcHRpb24pIHtcbiAgYXJncyA9IGFyZ3MgfHwgW107XG4gIGlmIChQYWNrYWdlWydhdWRpdC1hcmd1bWVudC1jaGVja3MnXSkge1xuICAgIHJldHVybiBNYXRjaC5fZmFpbElmQXJndW1lbnRzQXJlTm90QWxsQ2hlY2tlZChcbiAgICAgIGYsIGNvbnRleHQsIGFyZ3MsIGRlc2NyaXB0aW9uKTtcbiAgfVxuICByZXR1cm4gZi5hcHBseShjb250ZXh0LCBhcmdzKTtcbn07XG4iLCJ2YXIgRnV0dXJlID0gTnBtLnJlcXVpcmUoJ2ZpYmVycy9mdXR1cmUnKTtcblxuLy8gQSB3cml0ZSBmZW5jZSBjb2xsZWN0cyBhIGdyb3VwIG9mIHdyaXRlcywgYW5kIHByb3ZpZGVzIGEgY2FsbGJhY2tcbi8vIHdoZW4gYWxsIG9mIHRoZSB3cml0ZXMgYXJlIGZ1bGx5IGNvbW1pdHRlZCBhbmQgcHJvcGFnYXRlZCAoYWxsXG4vLyBvYnNlcnZlcnMgaGF2ZSBiZWVuIG5vdGlmaWVkIG9mIHRoZSB3cml0ZSBhbmQgYWNrbm93bGVkZ2VkIGl0Lilcbi8vXG5ERFBTZXJ2ZXIuX1dyaXRlRmVuY2UgPSBmdW5jdGlvbiAoKSB7XG4gIHZhciBzZWxmID0gdGhpcztcblxuICBzZWxmLmFybWVkID0gZmFsc2U7XG4gIHNlbGYuZmlyZWQgPSBmYWxzZTtcbiAgc2VsZi5yZXRpcmVkID0gZmFsc2U7XG4gIHNlbGYub3V0c3RhbmRpbmdfd3JpdGVzID0gMDtcbiAgc2VsZi5iZWZvcmVfZmlyZV9jYWxsYmFja3MgPSBbXTtcbiAgc2VsZi5jb21wbGV0aW9uX2NhbGxiYWNrcyA9IFtdO1xufTtcblxuLy8gVGhlIGN1cnJlbnQgd3JpdGUgZmVuY2UuIFdoZW4gdGhlcmUgaXMgYSBjdXJyZW50IHdyaXRlIGZlbmNlLCBjb2RlXG4vLyB0aGF0IHdyaXRlcyB0byBkYXRhYmFzZXMgc2hvdWxkIHJlZ2lzdGVyIHRoZWlyIHdyaXRlcyB3aXRoIGl0IHVzaW5nXG4vLyBiZWdpbldyaXRlKCkuXG4vL1xuRERQU2VydmVyLl9DdXJyZW50V3JpdGVGZW5jZSA9IG5ldyBNZXRlb3IuRW52aXJvbm1lbnRWYXJpYWJsZTtcblxuXy5leHRlbmQoRERQU2VydmVyLl9Xcml0ZUZlbmNlLnByb3RvdHlwZSwge1xuICAvLyBTdGFydCB0cmFja2luZyBhIHdyaXRlLCBhbmQgcmV0dXJuIGFuIG9iamVjdCB0byByZXByZXNlbnQgaXQuIFRoZVxuICAvLyBvYmplY3QgaGFzIGEgc2luZ2xlIG1ldGhvZCwgY29tbWl0dGVkKCkuIFRoaXMgbWV0aG9kIHNob3VsZCBiZVxuICAvLyBjYWxsZWQgd2hlbiB0aGUgd3JpdGUgaXMgZnVsbHkgY29tbWl0dGVkIGFuZCBwcm9wYWdhdGVkLiBZb3UgY2FuXG4gIC8vIGNvbnRpbnVlIHRvIGFkZCB3cml0ZXMgdG8gdGhlIFdyaXRlRmVuY2UgdXAgdW50aWwgaXQgaXMgdHJpZ2dlcmVkXG4gIC8vIChjYWxscyBpdHMgY2FsbGJhY2tzIGJlY2F1c2UgYWxsIHdyaXRlcyBoYXZlIGNvbW1pdHRlZC4pXG4gIGJlZ2luV3JpdGU6IGZ1bmN0aW9uICgpIHtcbiAgICB2YXIgc2VsZiA9IHRoaXM7XG5cbiAgICBpZiAoc2VsZi5yZXRpcmVkKVxuICAgICAgcmV0dXJuIHsgY29tbWl0dGVkOiBmdW5jdGlvbiAoKSB7fSB9O1xuXG4gICAgaWYgKHNlbGYuZmlyZWQpXG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXCJmZW5jZSBoYXMgYWxyZWFkeSBhY3RpdmF0ZWQgLS0gdG9vIGxhdGUgdG8gYWRkIHdyaXRlc1wiKTtcblxuICAgIHNlbGYub3V0c3RhbmRpbmdfd3JpdGVzKys7XG4gICAgdmFyIGNvbW1pdHRlZCA9IGZhbHNlO1xuICAgIHJldHVybiB7XG4gICAgICBjb21taXR0ZWQ6IGZ1bmN0aW9uICgpIHtcbiAgICAgICAgaWYgKGNvbW1pdHRlZClcbiAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoXCJjb21taXR0ZWQgY2FsbGVkIHR3aWNlIG9uIHRoZSBzYW1lIHdyaXRlXCIpO1xuICAgICAgICBjb21taXR0ZWQgPSB0cnVlO1xuICAgICAgICBzZWxmLm91dHN0YW5kaW5nX3dyaXRlcy0tO1xuICAgICAgICBzZWxmLl9tYXliZUZpcmUoKTtcbiAgICAgIH1cbiAgICB9O1xuICB9LFxuXG4gIC8vIEFybSB0aGUgZmVuY2UuIE9uY2UgdGhlIGZlbmNlIGlzIGFybWVkLCBhbmQgdGhlcmUgYXJlIG5vIG1vcmVcbiAgLy8gdW5jb21taXR0ZWQgd3JpdGVzLCBpdCB3aWxsIGFjdGl2YXRlLlxuICBhcm06IGZ1bmN0aW9uICgpIHtcbiAgICB2YXIgc2VsZiA9IHRoaXM7XG4gICAgaWYgKHNlbGYgPT09IEREUFNlcnZlci5fQ3VycmVudFdyaXRlRmVuY2UuZ2V0KCkpXG4gICAgICB0aHJvdyBFcnJvcihcIkNhbid0IGFybSB0aGUgY3VycmVudCBmZW5jZVwiKTtcbiAgICBzZWxmLmFybWVkID0gdHJ1ZTtcbiAgICBzZWxmLl9tYXliZUZpcmUoKTtcbiAgfSxcblxuICAvLyBSZWdpc3RlciBhIGZ1bmN0aW9uIHRvIGJlIGNhbGxlZCBvbmNlIGJlZm9yZSBmaXJpbmcgdGhlIGZlbmNlLlxuICAvLyBDYWxsYmFjayBmdW5jdGlvbiBjYW4gYWRkIG5ldyB3cml0ZXMgdG8gdGhlIGZlbmNlLCBpbiB3aGljaCBjYXNlXG4gIC8vIGl0IHdvbid0IGZpcmUgdW50aWwgdGhvc2Ugd3JpdGVzIGFyZSBkb25lIGFzIHdlbGwuXG4gIG9uQmVmb3JlRmlyZTogZnVuY3Rpb24gKGZ1bmMpIHtcbiAgICB2YXIgc2VsZiA9IHRoaXM7XG4gICAgaWYgKHNlbGYuZmlyZWQpXG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXCJmZW5jZSBoYXMgYWxyZWFkeSBhY3RpdmF0ZWQgLS0gdG9vIGxhdGUgdG8gXCIgK1xuICAgICAgICAgICAgICAgICAgICAgIFwiYWRkIGEgY2FsbGJhY2tcIik7XG4gICAgc2VsZi5iZWZvcmVfZmlyZV9jYWxsYmFja3MucHVzaChmdW5jKTtcbiAgfSxcblxuICAvLyBSZWdpc3RlciBhIGZ1bmN0aW9uIHRvIGJlIGNhbGxlZCB3aGVuIHRoZSBmZW5jZSBmaXJlcy5cbiAgb25BbGxDb21taXR0ZWQ6IGZ1bmN0aW9uIChmdW5jKSB7XG4gICAgdmFyIHNlbGYgPSB0aGlzO1xuICAgIGlmIChzZWxmLmZpcmVkKVxuICAgICAgdGhyb3cgbmV3IEVycm9yKFwiZmVuY2UgaGFzIGFscmVhZHkgYWN0aXZhdGVkIC0tIHRvbyBsYXRlIHRvIFwiICtcbiAgICAgICAgICAgICAgICAgICAgICBcImFkZCBhIGNhbGxiYWNrXCIpO1xuICAgIHNlbGYuY29tcGxldGlvbl9jYWxsYmFja3MucHVzaChmdW5jKTtcbiAgfSxcblxuICAvLyBDb252ZW5pZW5jZSBmdW5jdGlvbi4gQXJtcyB0aGUgZmVuY2UsIHRoZW4gYmxvY2tzIHVudGlsIGl0IGZpcmVzLlxuICBhcm1BbmRXYWl0OiBmdW5jdGlvbiAoKSB7XG4gICAgdmFyIHNlbGYgPSB0aGlzO1xuICAgIHZhciBmdXR1cmUgPSBuZXcgRnV0dXJlO1xuICAgIHNlbGYub25BbGxDb21taXR0ZWQoZnVuY3Rpb24gKCkge1xuICAgICAgZnV0dXJlWydyZXR1cm4nXSgpO1xuICAgIH0pO1xuICAgIHNlbGYuYXJtKCk7XG4gICAgZnV0dXJlLndhaXQoKTtcbiAgfSxcblxuICBfbWF5YmVGaXJlOiBmdW5jdGlvbiAoKSB7XG4gICAgdmFyIHNlbGYgPSB0aGlzO1xuICAgIGlmIChzZWxmLmZpcmVkKVxuICAgICAgdGhyb3cgbmV3IEVycm9yKFwid3JpdGUgZmVuY2UgYWxyZWFkeSBhY3RpdmF0ZWQ/XCIpO1xuICAgIGlmIChzZWxmLmFybWVkICYmICFzZWxmLm91dHN0YW5kaW5nX3dyaXRlcykge1xuICAgICAgZnVuY3Rpb24gaW52b2tlQ2FsbGJhY2sgKGZ1bmMpIHtcbiAgICAgICAgdHJ5IHtcbiAgICAgICAgICBmdW5jKHNlbGYpO1xuICAgICAgICB9IGNhdGNoIChlcnIpIHtcbiAgICAgICAgICBNZXRlb3IuX2RlYnVnKFwiZXhjZXB0aW9uIGluIHdyaXRlIGZlbmNlIGNhbGxiYWNrXCIsIGVycik7XG4gICAgICAgIH1cbiAgICAgIH1cblxuICAgICAgc2VsZi5vdXRzdGFuZGluZ193cml0ZXMrKztcbiAgICAgIHdoaWxlIChzZWxmLmJlZm9yZV9maXJlX2NhbGxiYWNrcy5sZW5ndGggPiAwKSB7XG4gICAgICAgIHZhciBjYWxsYmFja3MgPSBzZWxmLmJlZm9yZV9maXJlX2NhbGxiYWNrcztcbiAgICAgICAgc2VsZi5iZWZvcmVfZmlyZV9jYWxsYmFja3MgPSBbXTtcbiAgICAgICAgXy5lYWNoKGNhbGxiYWNrcywgaW52b2tlQ2FsbGJhY2spO1xuICAgICAgfVxuICAgICAgc2VsZi5vdXRzdGFuZGluZ193cml0ZXMtLTtcblxuICAgICAgaWYgKCFzZWxmLm91dHN0YW5kaW5nX3dyaXRlcykge1xuICAgICAgICBzZWxmLmZpcmVkID0gdHJ1ZTtcbiAgICAgICAgdmFyIGNhbGxiYWNrcyA9IHNlbGYuY29tcGxldGlvbl9jYWxsYmFja3M7XG4gICAgICAgIHNlbGYuY29tcGxldGlvbl9jYWxsYmFja3MgPSBbXTtcbiAgICAgICAgXy5lYWNoKGNhbGxiYWNrcywgaW52b2tlQ2FsbGJhY2spO1xuICAgICAgfVxuICAgIH1cbiAgfSxcblxuICAvLyBEZWFjdGl2YXRlIHRoaXMgZmVuY2Ugc28gdGhhdCBhZGRpbmcgbW9yZSB3cml0ZXMgaGFzIG5vIGVmZmVjdC5cbiAgLy8gVGhlIGZlbmNlIG11c3QgaGF2ZSBhbHJlYWR5IGZpcmVkLlxuICByZXRpcmU6IGZ1bmN0aW9uICgpIHtcbiAgICB2YXIgc2VsZiA9IHRoaXM7XG4gICAgaWYgKCEgc2VsZi5maXJlZClcbiAgICAgIHRocm93IG5ldyBFcnJvcihcIkNhbid0IHJldGlyZSBhIGZlbmNlIHRoYXQgaGFzbid0IGZpcmVkLlwiKTtcbiAgICBzZWxmLnJldGlyZWQgPSB0cnVlO1xuICB9XG59KTtcbiIsIi8vIEEgXCJjcm9zc2JhclwiIGlzIGEgY2xhc3MgdGhhdCBwcm92aWRlcyBzdHJ1Y3R1cmVkIG5vdGlmaWNhdGlvbiByZWdpc3RyYXRpb24uXG4vLyBTZWUgX21hdGNoIGZvciB0aGUgZGVmaW5pdGlvbiBvZiBob3cgYSBub3RpZmljYXRpb24gbWF0Y2hlcyBhIHRyaWdnZXIuXG4vLyBBbGwgbm90aWZpY2F0aW9ucyBhbmQgdHJpZ2dlcnMgbXVzdCBoYXZlIGEgc3RyaW5nIGtleSBuYW1lZCAnY29sbGVjdGlvbicuXG5cbkREUFNlcnZlci5fQ3Jvc3NiYXIgPSBmdW5jdGlvbiAob3B0aW9ucykge1xuICB2YXIgc2VsZiA9IHRoaXM7XG4gIG9wdGlvbnMgPSBvcHRpb25zIHx8IHt9O1xuXG4gIHNlbGYubmV4dElkID0gMTtcbiAgLy8gbWFwIGZyb20gY29sbGVjdGlvbiBuYW1lIChzdHJpbmcpIC0+IGxpc3RlbmVyIGlkIC0+IG9iamVjdC4gZWFjaCBvYmplY3QgaGFzXG4gIC8vIGtleXMgJ3RyaWdnZXInLCAnY2FsbGJhY2snLiAgQXMgYSBoYWNrLCB0aGUgZW1wdHkgc3RyaW5nIG1lYW5zIFwibm9cbiAgLy8gY29sbGVjdGlvblwiLlxuICBzZWxmLmxpc3RlbmVyc0J5Q29sbGVjdGlvbiA9IHt9O1xuICBzZWxmLmxpc3RlbmVyc0J5Q29sbGVjdGlvbkNvdW50ID0ge307XG4gIHNlbGYuZmFjdFBhY2thZ2UgPSBvcHRpb25zLmZhY3RQYWNrYWdlIHx8IFwibGl2ZWRhdGFcIjtcbiAgc2VsZi5mYWN0TmFtZSA9IG9wdGlvbnMuZmFjdE5hbWUgfHwgbnVsbDtcbn07XG5cbl8uZXh0ZW5kKEREUFNlcnZlci5fQ3Jvc3NiYXIucHJvdG90eXBlLCB7XG4gIC8vIG1zZyBpcyBhIHRyaWdnZXIgb3IgYSBub3RpZmljYXRpb25cbiAgX2NvbGxlY3Rpb25Gb3JNZXNzYWdlOiBmdW5jdGlvbiAobXNnKSB7XG4gICAgdmFyIHNlbGYgPSB0aGlzO1xuICAgIGlmICghIF8uaGFzKG1zZywgJ2NvbGxlY3Rpb24nKSkge1xuICAgICAgcmV0dXJuICcnO1xuICAgIH0gZWxzZSBpZiAodHlwZW9mKG1zZy5jb2xsZWN0aW9uKSA9PT0gJ3N0cmluZycpIHtcbiAgICAgIGlmIChtc2cuY29sbGVjdGlvbiA9PT0gJycpXG4gICAgICAgIHRocm93IEVycm9yKFwiTWVzc2FnZSBoYXMgZW1wdHkgY29sbGVjdGlvbiFcIik7XG4gICAgICByZXR1cm4gbXNnLmNvbGxlY3Rpb247XG4gICAgfSBlbHNlIHtcbiAgICAgIHRocm93IEVycm9yKFwiTWVzc2FnZSBoYXMgbm9uLXN0cmluZyBjb2xsZWN0aW9uIVwiKTtcbiAgICB9XG4gIH0sXG5cbiAgLy8gTGlzdGVuIGZvciBub3RpZmljYXRpb24gdGhhdCBtYXRjaCAndHJpZ2dlcicuIEEgbm90aWZpY2F0aW9uXG4gIC8vIG1hdGNoZXMgaWYgaXQgaGFzIHRoZSBrZXktdmFsdWUgcGFpcnMgaW4gdHJpZ2dlciBhcyBhXG4gIC8vIHN1YnNldC4gV2hlbiBhIG5vdGlmaWNhdGlvbiBtYXRjaGVzLCBjYWxsICdjYWxsYmFjaycsIHBhc3NpbmdcbiAgLy8gdGhlIGFjdHVhbCBub3RpZmljYXRpb24uXG4gIC8vXG4gIC8vIFJldHVybnMgYSBsaXN0ZW4gaGFuZGxlLCB3aGljaCBpcyBhbiBvYmplY3Qgd2l0aCBhIG1ldGhvZFxuICAvLyBzdG9wKCkuIENhbGwgc3RvcCgpIHRvIHN0b3AgbGlzdGVuaW5nLlxuICAvL1xuICAvLyBYWFggSXQgc2hvdWxkIGJlIGxlZ2FsIHRvIGNhbGwgZmlyZSgpIGZyb20gaW5zaWRlIGEgbGlzdGVuKClcbiAgLy8gY2FsbGJhY2s/XG4gIGxpc3RlbjogZnVuY3Rpb24gKHRyaWdnZXIsIGNhbGxiYWNrKSB7XG4gICAgdmFyIHNlbGYgPSB0aGlzO1xuICAgIHZhciBpZCA9IHNlbGYubmV4dElkKys7XG5cbiAgICB2YXIgY29sbGVjdGlvbiA9IHNlbGYuX2NvbGxlY3Rpb25Gb3JNZXNzYWdlKHRyaWdnZXIpO1xuICAgIHZhciByZWNvcmQgPSB7dHJpZ2dlcjogRUpTT04uY2xvbmUodHJpZ2dlciksIGNhbGxiYWNrOiBjYWxsYmFja307XG4gICAgaWYgKCEgXy5oYXMoc2VsZi5saXN0ZW5lcnNCeUNvbGxlY3Rpb24sIGNvbGxlY3Rpb24pKSB7XG4gICAgICBzZWxmLmxpc3RlbmVyc0J5Q29sbGVjdGlvbltjb2xsZWN0aW9uXSA9IHt9O1xuICAgICAgc2VsZi5saXN0ZW5lcnNCeUNvbGxlY3Rpb25Db3VudFtjb2xsZWN0aW9uXSA9IDA7XG4gICAgfVxuICAgIHNlbGYubGlzdGVuZXJzQnlDb2xsZWN0aW9uW2NvbGxlY3Rpb25dW2lkXSA9IHJlY29yZDtcbiAgICBzZWxmLmxpc3RlbmVyc0J5Q29sbGVjdGlvbkNvdW50W2NvbGxlY3Rpb25dKys7XG5cbiAgICBpZiAoc2VsZi5mYWN0TmFtZSAmJiBQYWNrYWdlWydmYWN0cy1iYXNlJ10pIHtcbiAgICAgIFBhY2thZ2VbJ2ZhY3RzLWJhc2UnXS5GYWN0cy5pbmNyZW1lbnRTZXJ2ZXJGYWN0KFxuICAgICAgICBzZWxmLmZhY3RQYWNrYWdlLCBzZWxmLmZhY3ROYW1lLCAxKTtcbiAgICB9XG5cbiAgICByZXR1cm4ge1xuICAgICAgc3RvcDogZnVuY3Rpb24gKCkge1xuICAgICAgICBpZiAoc2VsZi5mYWN0TmFtZSAmJiBQYWNrYWdlWydmYWN0cy1iYXNlJ10pIHtcbiAgICAgICAgICBQYWNrYWdlWydmYWN0cy1iYXNlJ10uRmFjdHMuaW5jcmVtZW50U2VydmVyRmFjdChcbiAgICAgICAgICAgIHNlbGYuZmFjdFBhY2thZ2UsIHNlbGYuZmFjdE5hbWUsIC0xKTtcbiAgICAgICAgfVxuICAgICAgICBkZWxldGUgc2VsZi5saXN0ZW5lcnNCeUNvbGxlY3Rpb25bY29sbGVjdGlvbl1baWRdO1xuICAgICAgICBzZWxmLmxpc3RlbmVyc0J5Q29sbGVjdGlvbkNvdW50W2NvbGxlY3Rpb25dLS07XG4gICAgICAgIGlmIChzZWxmLmxpc3RlbmVyc0J5Q29sbGVjdGlvbkNvdW50W2NvbGxlY3Rpb25dID09PSAwKSB7XG4gICAgICAgICAgZGVsZXRlIHNlbGYubGlzdGVuZXJzQnlDb2xsZWN0aW9uW2NvbGxlY3Rpb25dO1xuICAgICAgICAgIGRlbGV0ZSBzZWxmLmxpc3RlbmVyc0J5Q29sbGVjdGlvbkNvdW50W2NvbGxlY3Rpb25dO1xuICAgICAgICB9XG4gICAgICB9XG4gICAgfTtcbiAgfSxcblxuICAvLyBGaXJlIHRoZSBwcm92aWRlZCAnbm90aWZpY2F0aW9uJyAoYW4gb2JqZWN0IHdob3NlIGF0dHJpYnV0ZVxuICAvLyB2YWx1ZXMgYXJlIGFsbCBKU09OLWNvbXBhdGliaWxlKSAtLSBpbmZvcm0gYWxsIG1hdGNoaW5nIGxpc3RlbmVyc1xuICAvLyAocmVnaXN0ZXJlZCB3aXRoIGxpc3RlbigpKS5cbiAgLy9cbiAgLy8gSWYgZmlyZSgpIGlzIGNhbGxlZCBpbnNpZGUgYSB3cml0ZSBmZW5jZSwgdGhlbiBlYWNoIG9mIHRoZVxuICAvLyBsaXN0ZW5lciBjYWxsYmFja3Mgd2lsbCBiZSBjYWxsZWQgaW5zaWRlIHRoZSB3cml0ZSBmZW5jZSBhcyB3ZWxsLlxuICAvL1xuICAvLyBUaGUgbGlzdGVuZXJzIG1heSBiZSBpbnZva2VkIGluIHBhcmFsbGVsLCByYXRoZXIgdGhhbiBzZXJpYWxseS5cbiAgZmlyZTogZnVuY3Rpb24gKG5vdGlmaWNhdGlvbikge1xuICAgIHZhciBzZWxmID0gdGhpcztcblxuICAgIHZhciBjb2xsZWN0aW9uID0gc2VsZi5fY29sbGVjdGlvbkZvck1lc3NhZ2Uobm90aWZpY2F0aW9uKTtcblxuICAgIGlmICghIF8uaGFzKHNlbGYubGlzdGVuZXJzQnlDb2xsZWN0aW9uLCBjb2xsZWN0aW9uKSkge1xuICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIHZhciBsaXN0ZW5lcnNGb3JDb2xsZWN0aW9uID0gc2VsZi5saXN0ZW5lcnNCeUNvbGxlY3Rpb25bY29sbGVjdGlvbl07XG4gICAgdmFyIGNhbGxiYWNrSWRzID0gW107XG4gICAgXy5lYWNoKGxpc3RlbmVyc0ZvckNvbGxlY3Rpb24sIGZ1bmN0aW9uIChsLCBpZCkge1xuICAgICAgaWYgKHNlbGYuX21hdGNoZXMobm90aWZpY2F0aW9uLCBsLnRyaWdnZXIpKSB7XG4gICAgICAgIGNhbGxiYWNrSWRzLnB1c2goaWQpO1xuICAgICAgfVxuICAgIH0pO1xuXG4gICAgLy8gTGlzdGVuZXIgY2FsbGJhY2tzIGNhbiB5aWVsZCwgc28gd2UgbmVlZCB0byBmaXJzdCBmaW5kIGFsbCB0aGUgb25lcyB0aGF0XG4gICAgLy8gbWF0Y2ggaW4gYSBzaW5nbGUgaXRlcmF0aW9uIG92ZXIgc2VsZi5saXN0ZW5lcnNCeUNvbGxlY3Rpb24gKHdoaWNoIGNhbid0XG4gICAgLy8gYmUgbXV0YXRlZCBkdXJpbmcgdGhpcyBpdGVyYXRpb24pLCBhbmQgdGhlbiBpbnZva2UgdGhlIG1hdGNoaW5nXG4gICAgLy8gY2FsbGJhY2tzLCBjaGVja2luZyBiZWZvcmUgZWFjaCBjYWxsIHRvIGVuc3VyZSB0aGV5IGhhdmVuJ3Qgc3RvcHBlZC5cbiAgICAvLyBOb3RlIHRoYXQgd2UgZG9uJ3QgaGF2ZSB0byBjaGVjayB0aGF0XG4gICAgLy8gc2VsZi5saXN0ZW5lcnNCeUNvbGxlY3Rpb25bY29sbGVjdGlvbl0gc3RpbGwgPT09IGxpc3RlbmVyc0ZvckNvbGxlY3Rpb24sXG4gICAgLy8gYmVjYXVzZSB0aGUgb25seSB3YXkgdGhhdCBzdG9wcyBiZWluZyB0cnVlIGlzIGlmIGxpc3RlbmVyc0ZvckNvbGxlY3Rpb25cbiAgICAvLyBmaXJzdCBnZXRzIHJlZHVjZWQgZG93biB0byB0aGUgZW1wdHkgb2JqZWN0IChhbmQgdGhlbiBuZXZlciBnZXRzXG4gICAgLy8gaW5jcmVhc2VkIGFnYWluKS5cbiAgICBfLmVhY2goY2FsbGJhY2tJZHMsIGZ1bmN0aW9uIChpZCkge1xuICAgICAgaWYgKF8uaGFzKGxpc3RlbmVyc0ZvckNvbGxlY3Rpb24sIGlkKSkge1xuICAgICAgICBsaXN0ZW5lcnNGb3JDb2xsZWN0aW9uW2lkXS5jYWxsYmFjayhub3RpZmljYXRpb24pO1xuICAgICAgfVxuICAgIH0pO1xuICB9LFxuXG4gIC8vIEEgbm90aWZpY2F0aW9uIG1hdGNoZXMgYSB0cmlnZ2VyIGlmIGFsbCBrZXlzIHRoYXQgZXhpc3QgaW4gYm90aCBhcmUgZXF1YWwuXG4gIC8vXG4gIC8vIEV4YW1wbGVzOlxuICAvLyAgTjp7Y29sbGVjdGlvbjogXCJDXCJ9IG1hdGNoZXMgVDp7Y29sbGVjdGlvbjogXCJDXCJ9XG4gIC8vICAgIChhIG5vbi10YXJnZXRlZCB3cml0ZSB0byBhIGNvbGxlY3Rpb24gbWF0Y2hlcyBhXG4gIC8vICAgICBub24tdGFyZ2V0ZWQgcXVlcnkpXG4gIC8vICBOOntjb2xsZWN0aW9uOiBcIkNcIiwgaWQ6IFwiWFwifSBtYXRjaGVzIFQ6e2NvbGxlY3Rpb246IFwiQ1wifVxuICAvLyAgICAoYSB0YXJnZXRlZCB3cml0ZSB0byBhIGNvbGxlY3Rpb24gbWF0Y2hlcyBhIG5vbi10YXJnZXRlZCBxdWVyeSlcbiAgLy8gIE46e2NvbGxlY3Rpb246IFwiQ1wifSBtYXRjaGVzIFQ6e2NvbGxlY3Rpb246IFwiQ1wiLCBpZDogXCJYXCJ9XG4gIC8vICAgIChhIG5vbi10YXJnZXRlZCB3cml0ZSB0byBhIGNvbGxlY3Rpb24gbWF0Y2hlcyBhXG4gIC8vICAgICB0YXJnZXRlZCBxdWVyeSlcbiAgLy8gIE46e2NvbGxlY3Rpb246IFwiQ1wiLCBpZDogXCJYXCJ9IG1hdGNoZXMgVDp7Y29sbGVjdGlvbjogXCJDXCIsIGlkOiBcIlhcIn1cbiAgLy8gICAgKGEgdGFyZ2V0ZWQgd3JpdGUgdG8gYSBjb2xsZWN0aW9uIG1hdGNoZXMgYSB0YXJnZXRlZCBxdWVyeSB0YXJnZXRlZFxuICAvLyAgICAgYXQgdGhlIHNhbWUgZG9jdW1lbnQpXG4gIC8vICBOOntjb2xsZWN0aW9uOiBcIkNcIiwgaWQ6IFwiWFwifSBkb2VzIG5vdCBtYXRjaCBUOntjb2xsZWN0aW9uOiBcIkNcIiwgaWQ6IFwiWVwifVxuICAvLyAgICAoYSB0YXJnZXRlZCB3cml0ZSB0byBhIGNvbGxlY3Rpb24gZG9lcyBub3QgbWF0Y2ggYSB0YXJnZXRlZCBxdWVyeVxuICAvLyAgICAgdGFyZ2V0ZWQgYXQgYSBkaWZmZXJlbnQgZG9jdW1lbnQpXG4gIF9tYXRjaGVzOiBmdW5jdGlvbiAobm90aWZpY2F0aW9uLCB0cmlnZ2VyKSB7XG4gICAgLy8gTW9zdCBub3RpZmljYXRpb25zIHRoYXQgdXNlIHRoZSBjcm9zc2JhciBoYXZlIGEgc3RyaW5nIGBjb2xsZWN0aW9uYCBhbmRcbiAgICAvLyBtYXliZSBhbiBgaWRgIHRoYXQgaXMgYSBzdHJpbmcgb3IgT2JqZWN0SUQuIFdlJ3JlIGFscmVhZHkgZGl2aWRpbmcgdXBcbiAgICAvLyB0cmlnZ2VycyBieSBjb2xsZWN0aW9uLCBidXQgbGV0J3MgZmFzdC10cmFjayBcIm5vcGUsIGRpZmZlcmVudCBJRFwiIChhbmRcbiAgICAvLyBhdm9pZCB0aGUgb3Zlcmx5IGdlbmVyaWMgRUpTT04uZXF1YWxzKS4gVGhpcyBtYWtlcyBhIG5vdGljZWFibGVcbiAgICAvLyBwZXJmb3JtYW5jZSBkaWZmZXJlbmNlOyBzZWUgaHR0cHM6Ly9naXRodWIuY29tL21ldGVvci9tZXRlb3IvcHVsbC8zNjk3XG4gICAgaWYgKHR5cGVvZihub3RpZmljYXRpb24uaWQpID09PSAnc3RyaW5nJyAmJlxuICAgICAgICB0eXBlb2YodHJpZ2dlci5pZCkgPT09ICdzdHJpbmcnICYmXG4gICAgICAgIG5vdGlmaWNhdGlvbi5pZCAhPT0gdHJpZ2dlci5pZCkge1xuICAgICAgcmV0dXJuIGZhbHNlO1xuICAgIH1cbiAgICBpZiAobm90aWZpY2F0aW9uLmlkIGluc3RhbmNlb2YgTW9uZ29JRC5PYmplY3RJRCAmJlxuICAgICAgICB0cmlnZ2VyLmlkIGluc3RhbmNlb2YgTW9uZ29JRC5PYmplY3RJRCAmJlxuICAgICAgICAhIG5vdGlmaWNhdGlvbi5pZC5lcXVhbHModHJpZ2dlci5pZCkpIHtcbiAgICAgIHJldHVybiBmYWxzZTtcbiAgICB9XG5cbiAgICByZXR1cm4gXy5hbGwodHJpZ2dlciwgZnVuY3Rpb24gKHRyaWdnZXJWYWx1ZSwga2V5KSB7XG4gICAgICByZXR1cm4gIV8uaGFzKG5vdGlmaWNhdGlvbiwga2V5KSB8fFxuICAgICAgICBFSlNPTi5lcXVhbHModHJpZ2dlclZhbHVlLCBub3RpZmljYXRpb25ba2V5XSk7XG4gICAgfSk7XG4gIH1cbn0pO1xuXG4vLyBUaGUgXCJpbnZhbGlkYXRpb24gY3Jvc3NiYXJcIiBpcyBhIHNwZWNpZmljIGluc3RhbmNlIHVzZWQgYnkgdGhlIEREUCBzZXJ2ZXIgdG9cbi8vIGltcGxlbWVudCB3cml0ZSBmZW5jZSBub3RpZmljYXRpb25zLiBMaXN0ZW5lciBjYWxsYmFja3Mgb24gdGhpcyBjcm9zc2JhclxuLy8gc2hvdWxkIGNhbGwgYmVnaW5Xcml0ZSBvbiB0aGUgY3VycmVudCB3cml0ZSBmZW5jZSBiZWZvcmUgdGhleSByZXR1cm4sIGlmIHRoZXlcbi8vIHdhbnQgdG8gZGVsYXkgdGhlIHdyaXRlIGZlbmNlIGZyb20gZmlyaW5nIChpZSwgdGhlIEREUCBtZXRob2QtZGF0YS11cGRhdGVkXG4vLyBtZXNzYWdlIGZyb20gYmVpbmcgc2VudCkuXG5ERFBTZXJ2ZXIuX0ludmFsaWRhdGlvbkNyb3NzYmFyID0gbmV3IEREUFNlcnZlci5fQ3Jvc3NiYXIoe1xuICBmYWN0TmFtZTogXCJpbnZhbGlkYXRpb24tY3Jvc3NiYXItbGlzdGVuZXJzXCJcbn0pO1xuIiwiaWYgKHByb2Nlc3MuZW52LkREUF9ERUZBVUxUX0NPTk5FQ1RJT05fVVJMKSB7XG4gIF9fbWV0ZW9yX3J1bnRpbWVfY29uZmlnX18uRERQX0RFRkFVTFRfQ09OTkVDVElPTl9VUkwgPVxuICAgIHByb2Nlc3MuZW52LkREUF9ERUZBVUxUX0NPTk5FQ1RJT05fVVJMO1xufVxuXG5NZXRlb3Iuc2VydmVyID0gbmV3IFNlcnZlcjtcblxuTWV0ZW9yLnJlZnJlc2ggPSBmdW5jdGlvbiAobm90aWZpY2F0aW9uKSB7XG4gIEREUFNlcnZlci5fSW52YWxpZGF0aW9uQ3Jvc3NiYXIuZmlyZShub3RpZmljYXRpb24pO1xufTtcblxuLy8gUHJveHkgdGhlIHB1YmxpYyBtZXRob2RzIG9mIE1ldGVvci5zZXJ2ZXIgc28gdGhleSBjYW5cbi8vIGJlIGNhbGxlZCBkaXJlY3RseSBvbiBNZXRlb3IuXG5fLmVhY2goWydwdWJsaXNoJywgJ21ldGhvZHMnLCAnY2FsbCcsICdhcHBseScsICdvbkNvbm5lY3Rpb24nLCAnb25NZXNzYWdlJ10sXG4gICAgICAgZnVuY3Rpb24gKG5hbWUpIHtcbiAgICAgICAgIE1ldGVvcltuYW1lXSA9IF8uYmluZChNZXRlb3Iuc2VydmVyW25hbWVdLCBNZXRlb3Iuc2VydmVyKTtcbiAgICAgICB9KTtcblxuLy8gTWV0ZW9yLnNlcnZlciB1c2VkIHRvIGJlIGNhbGxlZCBNZXRlb3IuZGVmYXVsdF9zZXJ2ZXIuIFByb3ZpZGVcbi8vIGJhY2tjb21wYXQgYXMgYSBjb3VydGVzeSBldmVuIHRob3VnaCBpdCB3YXMgbmV2ZXIgZG9jdW1lbnRlZC5cbi8vIFhYWCBDT01QQVQgV0lUSCAwLjYuNFxuTWV0ZW9yLmRlZmF1bHRfc2VydmVyID0gTWV0ZW9yLnNlcnZlcjtcbiJdfQ==
