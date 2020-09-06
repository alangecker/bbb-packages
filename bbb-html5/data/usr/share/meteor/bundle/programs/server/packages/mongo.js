(function () {

/* Imports */
var Meteor = Package.meteor.Meteor;
var global = Package.meteor.global;
var meteorEnv = Package.meteor.meteorEnv;
var NpmModuleMongodb = Package['npm-mongo'].NpmModuleMongodb;
var NpmModuleMongodbVersion = Package['npm-mongo'].NpmModuleMongodbVersion;
var AllowDeny = Package['allow-deny'].AllowDeny;
var Random = Package.random.Random;
var EJSON = Package.ejson.EJSON;
var LocalCollection = Package.minimongo.LocalCollection;
var Minimongo = Package.minimongo.Minimongo;
var DDP = Package['ddp-client'].DDP;
var DDPServer = Package['ddp-server'].DDPServer;
var Tracker = Package.tracker.Tracker;
var Deps = Package.tracker.Deps;
var DiffSequence = Package['diff-sequence'].DiffSequence;
var MongoID = Package['mongo-id'].MongoID;
var check = Package.check.check;
var Match = Package.check.Match;
var ECMAScript = Package.ecmascript.ECMAScript;
var Decimal = Package['mongo-decimal'].Decimal;
var _ = Package.underscore._;
var MaxHeap = Package['binary-heap'].MaxHeap;
var MinHeap = Package['binary-heap'].MinHeap;
var MinMaxHeap = Package['binary-heap'].MinMaxHeap;
var Hook = Package['callback-hook'].Hook;
var meteorInstall = Package.modules.meteorInstall;
var Promise = Package.promise.Promise;

/* Package-scope variables */
var MongoInternals, MongoConnection, CursorDescription, Cursor, listenAll, forEachTrigger, OPLOG_COLLECTION, idForOp, OplogHandle, ObserveMultiplexer, ObserveHandle, PollingObserveDriver, OplogObserveDriver, Mongo, selector, callback, options;

var require = meteorInstall({"node_modules":{"meteor":{"mongo":{"mongo_driver.js":function module(require,exports,module){

/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
//                                                                                                                     //
// packages/mongo/mongo_driver.js                                                                                      //
//                                                                                                                     //
/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
                                                                                                                       //
!function (module1) {
  let _objectSpread;

  module1.link("@babel/runtime/helpers/objectSpread2", {
    default(v) {
      _objectSpread = v;
    }

  }, 0);
  let DocFetcher;
  module1.link("./doc_fetcher.js", {
    DocFetcher(v) {
      DocFetcher = v;
    }

  }, 0);

  /**
   * Provide a synchronous Collection API using fibers, backed by
   * MongoDB.  This is only for use on the server, and mostly identical
   * to the client API.
   *
   * NOTE: the public API methods must be run within a fiber. If you call
   * these outside of a fiber they will explode!
   */
  const path = require("path");

  var MongoDB = NpmModuleMongodb;

  var Future = Npm.require('fibers/future');

  MongoInternals = {};
  MongoInternals.NpmModules = {
    mongodb: {
      version: NpmModuleMongodbVersion,
      module: MongoDB
    }
  }; // Older version of what is now available via
  // MongoInternals.NpmModules.mongodb.module.  It was never documented, but
  // people do use it.
  // XXX COMPAT WITH 1.0.3.2

  MongoInternals.NpmModule = MongoDB;
  const FILE_ASSET_SUFFIX = 'Asset';
  const ASSETS_FOLDER = 'assets';
  const APP_FOLDER = 'app'; // This is used to add or remove EJSON from the beginning of everything nested
  // inside an EJSON custom type. It should only be called on pure JSON!

  var replaceNames = function (filter, thing) {
    if (typeof thing === "object" && thing !== null) {
      if (_.isArray(thing)) {
        return _.map(thing, _.bind(replaceNames, null, filter));
      }

      var ret = {};

      _.each(thing, function (value, key) {
        ret[filter(key)] = replaceNames(filter, value);
      });

      return ret;
    }

    return thing;
  }; // Ensure that EJSON.clone keeps a Timestamp as a Timestamp (instead of just
  // doing a structural clone).
  // XXX how ok is this? what if there are multiple copies of MongoDB loaded?


  MongoDB.Timestamp.prototype.clone = function () {
    // Timestamps should be immutable.
    return this;
  };

  var makeMongoLegal = function (name) {
    return "EJSON" + name;
  };

  var unmakeMongoLegal = function (name) {
    return name.substr(5);
  };

  var replaceMongoAtomWithMeteor = function (document) {
    if (document instanceof MongoDB.Binary) {
      var buffer = document.value(true);
      return new Uint8Array(buffer);
    }

    if (document instanceof MongoDB.ObjectID) {
      return new Mongo.ObjectID(document.toHexString());
    }

    if (document instanceof MongoDB.Decimal128) {
      return Decimal(document.toString());
    }

    if (document["EJSON$type"] && document["EJSON$value"] && _.size(document) === 2) {
      return EJSON.fromJSONValue(replaceNames(unmakeMongoLegal, document));
    }

    if (document instanceof MongoDB.Timestamp) {
      // For now, the Meteor representation of a Mongo timestamp type (not a date!
      // this is a weird internal thing used in the oplog!) is the same as the
      // Mongo representation. We need to do this explicitly or else we would do a
      // structural clone and lose the prototype.
      return document;
    }

    return undefined;
  };

  var replaceMeteorAtomWithMongo = function (document) {
    if (EJSON.isBinary(document)) {
      // This does more copies than we'd like, but is necessary because
      // MongoDB.BSON only looks like it takes a Uint8Array (and doesn't actually
      // serialize it correctly).
      return new MongoDB.Binary(Buffer.from(document));
    }

    if (document instanceof Mongo.ObjectID) {
      return new MongoDB.ObjectID(document.toHexString());
    }

    if (document instanceof MongoDB.Timestamp) {
      // For now, the Meteor representation of a Mongo timestamp type (not a date!
      // this is a weird internal thing used in the oplog!) is the same as the
      // Mongo representation. We need to do this explicitly or else we would do a
      // structural clone and lose the prototype.
      return document;
    }

    if (document instanceof Decimal) {
      return MongoDB.Decimal128.fromString(document.toString());
    }

    if (EJSON._isCustomType(document)) {
      return replaceNames(makeMongoLegal, EJSON.toJSONValue(document));
    } // It is not ordinarily possible to stick dollar-sign keys into mongo
    // so we don't bother checking for things that need escaping at this time.


    return undefined;
  };

  var replaceTypes = function (document, atomTransformer) {
    if (typeof document !== 'object' || document === null) return document;
    var replacedTopLevelAtom = atomTransformer(document);
    if (replacedTopLevelAtom !== undefined) return replacedTopLevelAtom;
    var ret = document;

    _.each(document, function (val, key) {
      var valReplaced = replaceTypes(val, atomTransformer);

      if (val !== valReplaced) {
        // Lazy clone. Shallow copy.
        if (ret === document) ret = _.clone(document);
        ret[key] = valReplaced;
      }
    });

    return ret;
  };

  MongoConnection = function (url, options) {
    var _Meteor$settings, _Meteor$settings$pack, _Meteor$settings$pack2;

    var self = this;
    options = options || {};
    self._observeMultiplexers = {};
    self._onFailoverHook = new Hook();

    const userOptions = _objectSpread({}, Mongo._connectionOptions || {}, {}, ((_Meteor$settings = Meteor.settings) === null || _Meteor$settings === void 0 ? void 0 : (_Meteor$settings$pack = _Meteor$settings.packages) === null || _Meteor$settings$pack === void 0 ? void 0 : (_Meteor$settings$pack2 = _Meteor$settings$pack.mongo) === null || _Meteor$settings$pack2 === void 0 ? void 0 : _Meteor$settings$pack2.options) || {});

    var mongoOptions = Object.assign({
      ignoreUndefined: true,
      // See https://github.com/meteor/meteor/issues/10925 for discussion of
      // why this option is not the default.
      useUnifiedTopology: !!options.useUnifiedTopology
    }, userOptions); // The autoReconnect and reconnectTries options are incompatible with
    // useUnifiedTopology: https://github.com/meteor/meteor/pull/10861#commitcomment-37525845

    if (!mongoOptions.useUnifiedTopology) {
      // Reconnect on error. This defaults to true, but it never hurts to be
      // explicit about it.
      mongoOptions.autoReconnect = true; // Try to reconnect forever, instead of stopping after 30 tries (the
      // default), with each attempt separated by 1000ms.

      mongoOptions.reconnectTries = Infinity;
    } // Disable the native parser by default, unless specifically enabled
    // in the mongo URL.
    // - The native driver can cause errors which normally would be
    //   thrown, caught, and handled into segfaults that take down the
    //   whole app.
    // - Binary modules don't yet work when you bundle and move the bundle
    //   to a different platform (aka deploy)
    // We should revisit this after binary npm module support lands.


    if (!/[\?&]native_?[pP]arser=/.test(url)) {
      mongoOptions.native_parser = false;
    } // Internally the oplog connections specify their own poolSize
    // which we don't want to overwrite with any user defined value


    if (_.has(options, 'poolSize')) {
      // If we just set this for "server", replSet will override it. If we just
      // set it for replSet, it will be ignored if we're not using a replSet.
      mongoOptions.poolSize = options.poolSize;
    } // Transform options like "tlsCAFileAsset": "filename.pem" into
    // "tlsCAFile": "/<fullpath>/filename.pem"


    Object.entries(mongoOptions || {}).filter((_ref) => {
      let [key] = _ref;
      return key && key.endsWith(FILE_ASSET_SUFFIX);
    }).forEach((_ref2) => {
      let [key, value] = _ref2;
      const optionName = key.replace(FILE_ASSET_SUFFIX, '');
      mongoOptions[optionName] = path.join(Assets.getServerDir(), ASSETS_FOLDER, APP_FOLDER, value);
      delete mongoOptions[key];
    });
    self.db = null; // We keep track of the ReplSet's primary, so that we can trigger hooks when
    // it changes.  The Node driver's joined callback seems to fire way too
    // often, which is why we need to track it ourselves.

    self._primary = null;
    self._oplogHandle = null;
    self._docFetcher = null;
    var connectFuture = new Future();
    MongoDB.connect(url, mongoOptions, Meteor.bindEnvironment(function (err, client) {
      if (err) {
        throw err;
      }

      var db = client.db(); // First, figure out what the current primary is, if any.

      if (db.serverConfig.isMasterDoc) {
        self._primary = db.serverConfig.isMasterDoc.primary;
      }

      db.serverConfig.on('joined', Meteor.bindEnvironment(function (kind, doc) {
        if (kind === 'primary') {
          if (doc.primary !== self._primary) {
            self._primary = doc.primary;

            self._onFailoverHook.each(function (callback) {
              callback();
              return true;
            });
          }
        } else if (doc.me === self._primary) {
          // The thing we thought was primary is now something other than
          // primary.  Forget that we thought it was primary.  (This means
          // that if a server stops being primary and then starts being
          // primary again without another server becoming primary in the
          // middle, we'll correctly count it as a failover.)
          self._primary = null;
        }
      })); // Allow the constructor to return.

      connectFuture['return']({
        client,
        db
      });
    }, connectFuture.resolver() // onException
    )); // Wait for the connection to be successful (throws on failure) and assign the
    // results (`client` and `db`) to `self`.

    Object.assign(self, connectFuture.wait());

    if (options.oplogUrl && !Package['disable-oplog']) {
      self._oplogHandle = new OplogHandle(options.oplogUrl, self.db.databaseName);
      self._docFetcher = new DocFetcher(self);
    }
  };

  MongoConnection.prototype.close = function () {
    var self = this;
    if (!self.db) throw Error("close called before Connection created?"); // XXX probably untested

    var oplogHandle = self._oplogHandle;
    self._oplogHandle = null;
    if (oplogHandle) oplogHandle.stop(); // Use Future.wrap so that errors get thrown. This happens to
    // work even outside a fiber since the 'close' method is not
    // actually asynchronous.

    Future.wrap(_.bind(self.client.close, self.client))(true).wait();
  }; // Returns the Mongo Collection object; may yield.


  MongoConnection.prototype.rawCollection = function (collectionName) {
    var self = this;
    if (!self.db) throw Error("rawCollection called before Connection created?");
    var future = new Future();
    self.db.collection(collectionName, future.resolver());
    return future.wait();
  };

  MongoConnection.prototype._createCappedCollection = function (collectionName, byteSize, maxDocuments) {
    var self = this;
    if (!self.db) throw Error("_createCappedCollection called before Connection created?");
    var future = new Future();
    self.db.createCollection(collectionName, {
      capped: true,
      size: byteSize,
      max: maxDocuments
    }, future.resolver());
    future.wait();
  }; // This should be called synchronously with a write, to create a
  // transaction on the current write fence, if any. After we can read
  // the write, and after observers have been notified (or at least,
  // after the observer notifiers have added themselves to the write
  // fence), you should call 'committed()' on the object returned.


  MongoConnection.prototype._maybeBeginWrite = function () {
    var fence = DDPServer._CurrentWriteFence.get();

    if (fence) {
      return fence.beginWrite();
    } else {
      return {
        committed: function () {}
      };
    }
  }; // Internal interface: adds a callback which is called when the Mongo primary
  // changes. Returns a stop handle.


  MongoConnection.prototype._onFailover = function (callback) {
    return this._onFailoverHook.register(callback);
  }; //////////// Public API //////////
  // The write methods block until the database has confirmed the write (it may
  // not be replicated or stable on disk, but one server has confirmed it) if no
  // callback is provided. If a callback is provided, then they call the callback
  // when the write is confirmed. They return nothing on success, and raise an
  // exception on failure.
  //
  // After making a write (with insert, update, remove), observers are
  // notified asynchronously. If you want to receive a callback once all
  // of the observer notifications have landed for your write, do the
  // writes inside a write fence (set DDPServer._CurrentWriteFence to a new
  // _WriteFence, and then set a callback on the write fence.)
  //
  // Since our execution environment is single-threaded, this is
  // well-defined -- a write "has been made" if it's returned, and an
  // observer "has been notified" if its callback has returned.


  var writeCallback = function (write, refresh, callback) {
    return function (err, result) {
      if (!err) {
        // XXX We don't have to run this on error, right?
        try {
          refresh();
        } catch (refreshErr) {
          if (callback) {
            callback(refreshErr);
            return;
          } else {
            throw refreshErr;
          }
        }
      }

      write.committed();

      if (callback) {
        callback(err, result);
      } else if (err) {
        throw err;
      }
    };
  };

  var bindEnvironmentForWrite = function (callback) {
    return Meteor.bindEnvironment(callback, "Mongo write");
  };

  MongoConnection.prototype._insert = function (collection_name, document, callback) {
    var self = this;

    var sendError = function (e) {
      if (callback) return callback(e);
      throw e;
    };

    if (collection_name === "___meteor_failure_test_collection") {
      var e = new Error("Failure test");
      e._expectedByTest = true;
      sendError(e);
      return;
    }

    if (!(LocalCollection._isPlainObject(document) && !EJSON._isCustomType(document))) {
      sendError(new Error("Only plain objects may be inserted into MongoDB"));
      return;
    }

    var write = self._maybeBeginWrite();

    var refresh = function () {
      Meteor.refresh({
        collection: collection_name,
        id: document._id
      });
    };

    callback = bindEnvironmentForWrite(writeCallback(write, refresh, callback));

    try {
      var collection = self.rawCollection(collection_name);
      collection.insert(replaceTypes(document, replaceMeteorAtomWithMongo), {
        safe: true
      }, callback);
    } catch (err) {
      write.committed();
      throw err;
    }
  }; // Cause queries that may be affected by the selector to poll in this write
  // fence.


  MongoConnection.prototype._refresh = function (collectionName, selector) {
    var refreshKey = {
      collection: collectionName
    }; // If we know which documents we're removing, don't poll queries that are
    // specific to other documents. (Note that multiple notifications here should
    // not cause multiple polls, since all our listener is doing is enqueueing a
    // poll.)

    var specificIds = LocalCollection._idsMatchedBySelector(selector);

    if (specificIds) {
      _.each(specificIds, function (id) {
        Meteor.refresh(_.extend({
          id: id
        }, refreshKey));
      });
    } else {
      Meteor.refresh(refreshKey);
    }
  };

  MongoConnection.prototype._remove = function (collection_name, selector, callback) {
    var self = this;

    if (collection_name === "___meteor_failure_test_collection") {
      var e = new Error("Failure test");
      e._expectedByTest = true;

      if (callback) {
        return callback(e);
      } else {
        throw e;
      }
    }

    var write = self._maybeBeginWrite();

    var refresh = function () {
      self._refresh(collection_name, selector);
    };

    callback = bindEnvironmentForWrite(writeCallback(write, refresh, callback));

    try {
      var collection = self.rawCollection(collection_name);

      var wrappedCallback = function (err, driverResult) {
        callback(err, transformResult(driverResult).numberAffected);
      };

      collection.remove(replaceTypes(selector, replaceMeteorAtomWithMongo), {
        safe: true
      }, wrappedCallback);
    } catch (err) {
      write.committed();
      throw err;
    }
  };

  MongoConnection.prototype._dropCollection = function (collectionName, cb) {
    var self = this;

    var write = self._maybeBeginWrite();

    var refresh = function () {
      Meteor.refresh({
        collection: collectionName,
        id: null,
        dropCollection: true
      });
    };

    cb = bindEnvironmentForWrite(writeCallback(write, refresh, cb));

    try {
      var collection = self.rawCollection(collectionName);
      collection.drop(cb);
    } catch (e) {
      write.committed();
      throw e;
    }
  }; // For testing only.  Slightly better than `c.rawDatabase().dropDatabase()`
  // because it lets the test's fence wait for it to be complete.


  MongoConnection.prototype._dropDatabase = function (cb) {
    var self = this;

    var write = self._maybeBeginWrite();

    var refresh = function () {
      Meteor.refresh({
        dropDatabase: true
      });
    };

    cb = bindEnvironmentForWrite(writeCallback(write, refresh, cb));

    try {
      self.db.dropDatabase(cb);
    } catch (e) {
      write.committed();
      throw e;
    }
  };

  MongoConnection.prototype._update = function (collection_name, selector, mod, options, callback) {
    var self = this;

    if (!callback && options instanceof Function) {
      callback = options;
      options = null;
    }

    if (collection_name === "___meteor_failure_test_collection") {
      var e = new Error("Failure test");
      e._expectedByTest = true;

      if (callback) {
        return callback(e);
      } else {
        throw e;
      }
    } // explicit safety check. null and undefined can crash the mongo
    // driver. Although the node driver and minimongo do 'support'
    // non-object modifier in that they don't crash, they are not
    // meaningful operations and do not do anything. Defensively throw an
    // error here.


    if (!mod || typeof mod !== 'object') throw new Error("Invalid modifier. Modifier must be an object.");

    if (!(LocalCollection._isPlainObject(mod) && !EJSON._isCustomType(mod))) {
      throw new Error("Only plain objects may be used as replacement" + " documents in MongoDB");
    }

    if (!options) options = {};

    var write = self._maybeBeginWrite();

    var refresh = function () {
      self._refresh(collection_name, selector);
    };

    callback = writeCallback(write, refresh, callback);

    try {
      var collection = self.rawCollection(collection_name);
      var mongoOpts = {
        safe: true
      }; // Add support for filtered positional operator

      if (options.arrayFilters !== undefined) mongoOpts.arrayFilters = options.arrayFilters; // explictly enumerate options that minimongo supports

      if (options.upsert) mongoOpts.upsert = true;
      if (options.multi) mongoOpts.multi = true; // Lets you get a more more full result from MongoDB. Use with caution:
      // might not work with C.upsert (as opposed to C.update({upsert:true}) or
      // with simulated upsert.

      if (options.fullResult) mongoOpts.fullResult = true;
      var mongoSelector = replaceTypes(selector, replaceMeteorAtomWithMongo);
      var mongoMod = replaceTypes(mod, replaceMeteorAtomWithMongo);

      var isModify = LocalCollection._isModificationMod(mongoMod);

      if (options._forbidReplace && !isModify) {
        var err = new Error("Invalid modifier. Replacements are forbidden.");

        if (callback) {
          return callback(err);
        } else {
          throw err;
        }
      } // We've already run replaceTypes/replaceMeteorAtomWithMongo on
      // selector and mod.  We assume it doesn't matter, as far as
      // the behavior of modifiers is concerned, whether `_modify`
      // is run on EJSON or on mongo-converted EJSON.
      // Run this code up front so that it fails fast if someone uses
      // a Mongo update operator we don't support.


      let knownId;

      if (options.upsert) {
        try {
          let newDoc = LocalCollection._createUpsertDocument(selector, mod);

          knownId = newDoc._id;
        } catch (err) {
          if (callback) {
            return callback(err);
          } else {
            throw err;
          }
        }
      }

      if (options.upsert && !isModify && !knownId && options.insertedId && !(options.insertedId instanceof Mongo.ObjectID && options.generatedId)) {
        // In case of an upsert with a replacement, where there is no _id defined
        // in either the query or the replacement doc, mongo will generate an id itself.
        // Therefore we need this special strategy if we want to control the id ourselves.
        // We don't need to do this when:
        // - This is not a replacement, so we can add an _id to $setOnInsert
        // - The id is defined by query or mod we can just add it to the replacement doc
        // - The user did not specify any id preference and the id is a Mongo ObjectId,
        //     then we can just let Mongo generate the id
        simulateUpsertWithInsertedId(collection, mongoSelector, mongoMod, options, // This callback does not need to be bindEnvironment'ed because
        // simulateUpsertWithInsertedId() wraps it and then passes it through
        // bindEnvironmentForWrite.
        function (error, result) {
          // If we got here via a upsert() call, then options._returnObject will
          // be set and we should return the whole object. Otherwise, we should
          // just return the number of affected docs to match the mongo API.
          if (result && !options._returnObject) {
            callback(error, result.numberAffected);
          } else {
            callback(error, result);
          }
        });
      } else {
        if (options.upsert && !knownId && options.insertedId && isModify) {
          if (!mongoMod.hasOwnProperty('$setOnInsert')) {
            mongoMod.$setOnInsert = {};
          }

          knownId = options.insertedId;
          Object.assign(mongoMod.$setOnInsert, replaceTypes({
            _id: options.insertedId
          }, replaceMeteorAtomWithMongo));
        }

        collection.update(mongoSelector, mongoMod, mongoOpts, bindEnvironmentForWrite(function (err, result) {
          if (!err) {
            var meteorResult = transformResult(result);

            if (meteorResult && options._returnObject) {
              // If this was an upsert() call, and we ended up
              // inserting a new doc and we know its id, then
              // return that id as well.
              if (options.upsert && meteorResult.insertedId) {
                if (knownId) {
                  meteorResult.insertedId = knownId;
                } else if (meteorResult.insertedId instanceof MongoDB.ObjectID) {
                  meteorResult.insertedId = new Mongo.ObjectID(meteorResult.insertedId.toHexString());
                }
              }

              callback(err, meteorResult);
            } else {
              callback(err, meteorResult.numberAffected);
            }
          } else {
            callback(err);
          }
        }));
      }
    } catch (e) {
      write.committed();
      throw e;
    }
  };

  var transformResult = function (driverResult) {
    var meteorResult = {
      numberAffected: 0
    };

    if (driverResult) {
      var mongoResult = driverResult.result; // On updates with upsert:true, the inserted values come as a list of
      // upserted values -- even with options.multi, when the upsert does insert,
      // it only inserts one element.

      if (mongoResult.upserted) {
        meteorResult.numberAffected += mongoResult.upserted.length;

        if (mongoResult.upserted.length == 1) {
          meteorResult.insertedId = mongoResult.upserted[0]._id;
        }
      } else {
        meteorResult.numberAffected = mongoResult.n;
      }
    }

    return meteorResult;
  };

  var NUM_OPTIMISTIC_TRIES = 3; // exposed for testing

  MongoConnection._isCannotChangeIdError = function (err) {
    // Mongo 3.2.* returns error as next Object:
    // {name: String, code: Number, errmsg: String}
    // Older Mongo returns:
    // {name: String, code: Number, err: String}
    var error = err.errmsg || err.err; // We don't use the error code here
    // because the error code we observed it producing (16837) appears to be
    // a far more generic error code based on examining the source.

    if (error.indexOf('The _id field cannot be changed') === 0 || error.indexOf("the (immutable) field '_id' was found to have been altered to _id") !== -1) {
      return true;
    }

    return false;
  };

  var simulateUpsertWithInsertedId = function (collection, selector, mod, options, callback) {
    // STRATEGY: First try doing an upsert with a generated ID.
    // If this throws an error about changing the ID on an existing document
    // then without affecting the database, we know we should probably try
    // an update without the generated ID. If it affected 0 documents,
    // then without affecting the database, we the document that first
    // gave the error is probably removed and we need to try an insert again
    // We go back to step one and repeat.
    // Like all "optimistic write" schemes, we rely on the fact that it's
    // unlikely our writes will continue to be interfered with under normal
    // circumstances (though sufficiently heavy contention with writers
    // disagreeing on the existence of an object will cause writes to fail
    // in theory).
    var insertedId = options.insertedId; // must exist

    var mongoOptsForUpdate = {
      safe: true,
      multi: options.multi
    };
    var mongoOptsForInsert = {
      safe: true,
      upsert: true
    };
    var replacementWithId = Object.assign(replaceTypes({
      _id: insertedId
    }, replaceMeteorAtomWithMongo), mod);
    var tries = NUM_OPTIMISTIC_TRIES;

    var doUpdate = function () {
      tries--;

      if (!tries) {
        callback(new Error("Upsert failed after " + NUM_OPTIMISTIC_TRIES + " tries."));
      } else {
        collection.update(selector, mod, mongoOptsForUpdate, bindEnvironmentForWrite(function (err, result) {
          if (err) {
            callback(err);
          } else if (result && result.result.n != 0) {
            callback(null, {
              numberAffected: result.result.n
            });
          } else {
            doConditionalInsert();
          }
        }));
      }
    };

    var doConditionalInsert = function () {
      collection.update(selector, replacementWithId, mongoOptsForInsert, bindEnvironmentForWrite(function (err, result) {
        if (err) {
          // figure out if this is a
          // "cannot change _id of document" error, and
          // if so, try doUpdate() again, up to 3 times.
          if (MongoConnection._isCannotChangeIdError(err)) {
            doUpdate();
          } else {
            callback(err);
          }
        } else {
          callback(null, {
            numberAffected: result.result.upserted.length,
            insertedId: insertedId
          });
        }
      }));
    };

    doUpdate();
  };

  _.each(["insert", "update", "remove", "dropCollection", "dropDatabase"], function (method) {
    MongoConnection.prototype[method] = function ()
    /* arguments */
    {
      var self = this;
      return Meteor.wrapAsync(self["_" + method]).apply(self, arguments);
    };
  }); // XXX MongoConnection.upsert() does not return the id of the inserted document
  // unless you set it explicitly in the selector or modifier (as a replacement
  // doc).


  MongoConnection.prototype.upsert = function (collectionName, selector, mod, options, callback) {
    var self = this;

    if (typeof options === "function" && !callback) {
      callback = options;
      options = {};
    }

    return self.update(collectionName, selector, mod, _.extend({}, options, {
      upsert: true,
      _returnObject: true
    }), callback);
  };

  MongoConnection.prototype.find = function (collectionName, selector, options) {
    var self = this;
    if (arguments.length === 1) selector = {};
    return new Cursor(self, new CursorDescription(collectionName, selector, options));
  };

  MongoConnection.prototype.findOne = function (collection_name, selector, options) {
    var self = this;
    if (arguments.length === 1) selector = {};
    options = options || {};
    options.limit = 1;
    return self.find(collection_name, selector, options).fetch()[0];
  }; // We'll actually design an index API later. For now, we just pass through to
  // Mongo's, but make it synchronous.


  MongoConnection.prototype._ensureIndex = function (collectionName, index, options) {
    var self = this; // We expect this function to be called at startup, not from within a method,
    // so we don't interact with the write fence.

    var collection = self.rawCollection(collectionName);
    var future = new Future();
    var indexName = collection.ensureIndex(index, options, future.resolver());
    future.wait();
  };

  MongoConnection.prototype._dropIndex = function (collectionName, index) {
    var self = this; // This function is only used by test code, not within a method, so we don't
    // interact with the write fence.

    var collection = self.rawCollection(collectionName);
    var future = new Future();
    var indexName = collection.dropIndex(index, future.resolver());
    future.wait();
  }; // CURSORS
  // There are several classes which relate to cursors:
  //
  // CursorDescription represents the arguments used to construct a cursor:
  // collectionName, selector, and (find) options.  Because it is used as a key
  // for cursor de-dup, everything in it should either be JSON-stringifiable or
  // not affect observeChanges output (eg, options.transform functions are not
  // stringifiable but do not affect observeChanges).
  //
  // SynchronousCursor is a wrapper around a MongoDB cursor
  // which includes fully-synchronous versions of forEach, etc.
  //
  // Cursor is the cursor object returned from find(), which implements the
  // documented Mongo.Collection cursor API.  It wraps a CursorDescription and a
  // SynchronousCursor (lazily: it doesn't contact Mongo until you call a method
  // like fetch or forEach on it).
  //
  // ObserveHandle is the "observe handle" returned from observeChanges. It has a
  // reference to an ObserveMultiplexer.
  //
  // ObserveMultiplexer allows multiple identical ObserveHandles to be driven by a
  // single observe driver.
  //
  // There are two "observe drivers" which drive ObserveMultiplexers:
  //   - PollingObserveDriver caches the results of a query and reruns it when
  //     necessary.
  //   - OplogObserveDriver follows the Mongo operation log to directly observe
  //     database changes.
  // Both implementations follow the same simple interface: when you create them,
  // they start sending observeChanges callbacks (and a ready() invocation) to
  // their ObserveMultiplexer, and you stop them by calling their stop() method.


  CursorDescription = function (collectionName, selector, options) {
    var self = this;
    self.collectionName = collectionName;
    self.selector = Mongo.Collection._rewriteSelector(selector);
    self.options = options || {};
  };

  Cursor = function (mongo, cursorDescription) {
    var self = this;
    self._mongo = mongo;
    self._cursorDescription = cursorDescription;
    self._synchronousCursor = null;
  };

  _.each(['forEach', 'map', 'fetch', 'count', Symbol.iterator], function (method) {
    Cursor.prototype[method] = function () {
      var self = this; // You can only observe a tailable cursor.

      if (self._cursorDescription.options.tailable) throw new Error("Cannot call " + method + " on a tailable cursor");

      if (!self._synchronousCursor) {
        self._synchronousCursor = self._mongo._createSynchronousCursor(self._cursorDescription, {
          // Make sure that the "self" argument to forEach/map callbacks is the
          // Cursor, not the SynchronousCursor.
          selfForIteration: self,
          useTransform: true
        });
      }

      return self._synchronousCursor[method].apply(self._synchronousCursor, arguments);
    };
  }); // Since we don't actually have a "nextObject" interface, there's really no
  // reason to have a "rewind" interface.  All it did was make multiple calls
  // to fetch/map/forEach return nothing the second time.
  // XXX COMPAT WITH 0.8.1


  Cursor.prototype.rewind = function () {};

  Cursor.prototype.getTransform = function () {
    return this._cursorDescription.options.transform;
  }; // When you call Meteor.publish() with a function that returns a Cursor, we need
  // to transmute it into the equivalent subscription.  This is the function that
  // does that.


  Cursor.prototype._publishCursor = function (sub) {
    var self = this;
    var collection = self._cursorDescription.collectionName;
    return Mongo.Collection._publishCursor(self, sub, collection);
  }; // Used to guarantee that publish functions return at most one cursor per
  // collection. Private, because we might later have cursors that include
  // documents from multiple collections somehow.


  Cursor.prototype._getCollectionName = function () {
    var self = this;
    return self._cursorDescription.collectionName;
  };

  Cursor.prototype.observe = function (callbacks) {
    var self = this;
    return LocalCollection._observeFromObserveChanges(self, callbacks);
  };

  Cursor.prototype.observeChanges = function (callbacks) {
    let options = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : {};
    var self = this;
    var methods = ['addedAt', 'added', 'changedAt', 'changed', 'removedAt', 'removed', 'movedTo'];

    var ordered = LocalCollection._observeChangesCallbacksAreOrdered(callbacks);

    let exceptionName = callbacks._fromObserve ? 'observe' : 'observeChanges';
    exceptionName += ' callback';
    methods.forEach(function (method) {
      if (callbacks[method] && typeof callbacks[method] == "function") {
        callbacks[method] = Meteor.bindEnvironment(callbacks[method], method + exceptionName);
      }
    });
    return self._mongo._observeChanges(self._cursorDescription, ordered, callbacks, options.nonMutatingCallbacks);
  };

  MongoConnection.prototype._createSynchronousCursor = function (cursorDescription, options) {
    var self = this;
    options = _.pick(options || {}, 'selfForIteration', 'useTransform');
    var collection = self.rawCollection(cursorDescription.collectionName);
    var cursorOptions = cursorDescription.options;
    var mongoOptions = {
      sort: cursorOptions.sort,
      limit: cursorOptions.limit,
      skip: cursorOptions.skip,
      projection: cursorOptions.fields
    }; // Do we want a tailable cursor (which only works on capped collections)?

    if (cursorOptions.tailable) {
      // We want a tailable cursor...
      mongoOptions.tailable = true; // ... and for the server to wait a bit if any getMore has no data (rather
      // than making us put the relevant sleeps in the client)...

      mongoOptions.awaitdata = true; // ... and to keep querying the server indefinitely rather than just 5 times
      // if there's no more data.

      mongoOptions.numberOfRetries = -1; // And if this is on the oplog collection and the cursor specifies a 'ts',
      // then set the undocumented oplog replay flag, which does a special scan to
      // find the first document (instead of creating an index on ts). This is a
      // very hard-coded Mongo flag which only works on the oplog collection and
      // only works with the ts field.

      if (cursorDescription.collectionName === OPLOG_COLLECTION && cursorDescription.selector.ts) {
        mongoOptions.oplogReplay = true;
      }
    }

    var dbCursor = collection.find(replaceTypes(cursorDescription.selector, replaceMeteorAtomWithMongo), mongoOptions);

    if (typeof cursorOptions.maxTimeMs !== 'undefined') {
      dbCursor = dbCursor.maxTimeMS(cursorOptions.maxTimeMs);
    }

    if (typeof cursorOptions.hint !== 'undefined') {
      dbCursor = dbCursor.hint(cursorOptions.hint);
    }

    return new SynchronousCursor(dbCursor, cursorDescription, options);
  };

  var SynchronousCursor = function (dbCursor, cursorDescription, options) {
    var self = this;
    options = _.pick(options || {}, 'selfForIteration', 'useTransform');
    self._dbCursor = dbCursor;
    self._cursorDescription = cursorDescription; // The "self" argument passed to forEach/map callbacks. If we're wrapped
    // inside a user-visible Cursor, we want to provide the outer cursor!

    self._selfForIteration = options.selfForIteration || self;

    if (options.useTransform && cursorDescription.options.transform) {
      self._transform = LocalCollection.wrapTransform(cursorDescription.options.transform);
    } else {
      self._transform = null;
    }

    self._synchronousCount = Future.wrap(dbCursor.count.bind(dbCursor));
    self._visitedIds = new LocalCollection._IdMap();
  };

  _.extend(SynchronousCursor.prototype, {
    // Returns a Promise for the next object from the underlying cursor (before
    // the Mongo->Meteor type replacement).
    _rawNextObjectPromise: function () {
      const self = this;
      return new Promise((resolve, reject) => {
        self._dbCursor.next((err, doc) => {
          if (err) {
            reject(err);
          } else {
            resolve(doc);
          }
        });
      });
    },
    // Returns a Promise for the next object from the cursor, skipping those whose
    // IDs we've already seen and replacing Mongo atoms with Meteor atoms.
    _nextObjectPromise: function () {
      return Promise.asyncApply(() => {
        var self = this;

        while (true) {
          var doc = Promise.await(self._rawNextObjectPromise());
          if (!doc) return null;
          doc = replaceTypes(doc, replaceMongoAtomWithMeteor);

          if (!self._cursorDescription.options.tailable && _.has(doc, '_id')) {
            // Did Mongo give us duplicate documents in the same cursor? If so,
            // ignore this one. (Do this before the transform, since transform might
            // return some unrelated value.) We don't do this for tailable cursors,
            // because we want to maintain O(1) memory usage. And if there isn't _id
            // for some reason (maybe it's the oplog), then we don't do this either.
            // (Be careful to do this for falsey but existing _id, though.)
            if (self._visitedIds.has(doc._id)) continue;

            self._visitedIds.set(doc._id, true);
          }

          if (self._transform) doc = self._transform(doc);
          return doc;
        }
      });
    },
    // Returns a promise which is resolved with the next object (like with
    // _nextObjectPromise) or rejected if the cursor doesn't return within
    // timeoutMS ms.
    _nextObjectPromiseWithTimeout: function (timeoutMS) {
      const self = this;

      if (!timeoutMS) {
        return self._nextObjectPromise();
      }

      const nextObjectPromise = self._nextObjectPromise();

      const timeoutErr = new Error('Client-side timeout waiting for next object');
      const timeoutPromise = new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          reject(timeoutErr);
        }, timeoutMS);
      });
      return Promise.race([nextObjectPromise, timeoutPromise]).catch(err => {
        if (err === timeoutErr) {
          self.close();
        }

        throw err;
      });
    },
    _nextObject: function () {
      var self = this;
      return self._nextObjectPromise().await();
    },
    forEach: function (callback, thisArg) {
      var self = this; // Get back to the beginning.

      self._rewind(); // We implement the loop ourself instead of using self._dbCursor.each,
      // because "each" will call its callback outside of a fiber which makes it
      // much more complex to make this function synchronous.


      var index = 0;

      while (true) {
        var doc = self._nextObject();

        if (!doc) return;
        callback.call(thisArg, doc, index++, self._selfForIteration);
      }
    },
    // XXX Allow overlapping callback executions if callback yields.
    map: function (callback, thisArg) {
      var self = this;
      var res = [];
      self.forEach(function (doc, index) {
        res.push(callback.call(thisArg, doc, index, self._selfForIteration));
      });
      return res;
    },
    _rewind: function () {
      var self = this; // known to be synchronous

      self._dbCursor.rewind();

      self._visitedIds = new LocalCollection._IdMap();
    },
    // Mostly usable for tailable cursors.
    close: function () {
      var self = this;

      self._dbCursor.close();
    },
    fetch: function () {
      var self = this;
      return self.map(_.identity);
    },
    count: function () {
      let applySkipLimit = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : false;
      var self = this;
      return self._synchronousCount(applySkipLimit).wait();
    },
    // This method is NOT wrapped in Cursor.
    getRawObjects: function (ordered) {
      var self = this;

      if (ordered) {
        return self.fetch();
      } else {
        var results = new LocalCollection._IdMap();
        self.forEach(function (doc) {
          results.set(doc._id, doc);
        });
        return results;
      }
    }
  });

  SynchronousCursor.prototype[Symbol.iterator] = function () {
    var self = this; // Get back to the beginning.

    self._rewind();

    return {
      next() {
        const doc = self._nextObject();

        return doc ? {
          value: doc
        } : {
          done: true
        };
      }

    };
  }; // Tails the cursor described by cursorDescription, most likely on the
  // oplog. Calls docCallback with each document found. Ignores errors and just
  // restarts the tail on error.
  //
  // If timeoutMS is set, then if we don't get a new document every timeoutMS,
  // kill and restart the cursor. This is primarily a workaround for #8598.


  MongoConnection.prototype.tail = function (cursorDescription, docCallback, timeoutMS) {
    var self = this;
    if (!cursorDescription.options.tailable) throw new Error("Can only tail a tailable cursor");

    var cursor = self._createSynchronousCursor(cursorDescription);

    var stopped = false;
    var lastTS;

    var loop = function () {
      var doc = null;

      while (true) {
        if (stopped) return;

        try {
          doc = cursor._nextObjectPromiseWithTimeout(timeoutMS).await();
        } catch (err) {
          // There's no good way to figure out if this was actually an error from
          // Mongo, or just client-side (including our own timeout error). Ah
          // well. But either way, we need to retry the cursor (unless the failure
          // was because the observe got stopped).
          doc = null;
        } // Since we awaited a promise above, we need to check again to see if
        // we've been stopped before calling the callback.


        if (stopped) return;

        if (doc) {
          // If a tailable cursor contains a "ts" field, use it to recreate the
          // cursor on error. ("ts" is a standard that Mongo uses internally for
          // the oplog, and there's a special flag that lets you do binary search
          // on it instead of needing to use an index.)
          lastTS = doc.ts;
          docCallback(doc);
        } else {
          var newSelector = _.clone(cursorDescription.selector);

          if (lastTS) {
            newSelector.ts = {
              $gt: lastTS
            };
          }

          cursor = self._createSynchronousCursor(new CursorDescription(cursorDescription.collectionName, newSelector, cursorDescription.options)); // Mongo failover takes many seconds.  Retry in a bit.  (Without this
          // setTimeout, we peg the CPU at 100% and never notice the actual
          // failover.

          Meteor.setTimeout(loop, 100);
          break;
        }
      }
    };

    Meteor.defer(loop);
    return {
      stop: function () {
        stopped = true;
        cursor.close();
      }
    };
  };

  MongoConnection.prototype._observeChanges = function (cursorDescription, ordered, callbacks, nonMutatingCallbacks) {
    var self = this;

    if (cursorDescription.options.tailable) {
      return self._observeChangesTailable(cursorDescription, ordered, callbacks);
    } // You may not filter out _id when observing changes, because the id is a core
    // part of the observeChanges API.


    if (cursorDescription.options.fields && (cursorDescription.options.fields._id === 0 || cursorDescription.options.fields._id === false)) {
      throw Error("You may not observe a cursor with {fields: {_id: 0}}");
    }

    var observeKey = EJSON.stringify(_.extend({
      ordered: ordered
    }, cursorDescription));
    var multiplexer, observeDriver;
    var firstHandle = false; // Find a matching ObserveMultiplexer, or create a new one. This next block is
    // guaranteed to not yield (and it doesn't call anything that can observe a
    // new query), so no other calls to this function can interleave with it.

    Meteor._noYieldsAllowed(function () {
      if (_.has(self._observeMultiplexers, observeKey)) {
        multiplexer = self._observeMultiplexers[observeKey];
      } else {
        firstHandle = true; // Create a new ObserveMultiplexer.

        multiplexer = new ObserveMultiplexer({
          ordered: ordered,
          onStop: function () {
            delete self._observeMultiplexers[observeKey];
            observeDriver.stop();
          }
        });
        self._observeMultiplexers[observeKey] = multiplexer;
      }
    });

    var observeHandle = new ObserveHandle(multiplexer, callbacks, nonMutatingCallbacks);

    if (firstHandle) {
      var matcher, sorter;

      var canUseOplog = _.all([function () {
        // At a bare minimum, using the oplog requires us to have an oplog, to
        // want unordered callbacks, and to not want a callback on the polls
        // that won't happen.
        return self._oplogHandle && !ordered && !callbacks._testOnlyPollCallback;
      }, function () {
        // We need to be able to compile the selector. Fall back to polling for
        // some newfangled $selector that minimongo doesn't support yet.
        try {
          matcher = new Minimongo.Matcher(cursorDescription.selector);
          return true;
        } catch (e) {
          // XXX make all compilation errors MinimongoError or something
          //     so that this doesn't ignore unrelated exceptions
          return false;
        }
      }, function () {
        // ... and the selector itself needs to support oplog.
        return OplogObserveDriver.cursorSupported(cursorDescription, matcher);
      }, function () {
        // And we need to be able to compile the sort, if any.  eg, can't be
        // {$natural: 1}.
        if (!cursorDescription.options.sort) return true;

        try {
          sorter = new Minimongo.Sorter(cursorDescription.options.sort);
          return true;
        } catch (e) {
          // XXX make all compilation errors MinimongoError or something
          //     so that this doesn't ignore unrelated exceptions
          return false;
        }
      }], function (f) {
        return f();
      }); // invoke each function


      var driverClass = canUseOplog ? OplogObserveDriver : PollingObserveDriver;
      observeDriver = new driverClass({
        cursorDescription: cursorDescription,
        mongoHandle: self,
        multiplexer: multiplexer,
        ordered: ordered,
        matcher: matcher,
        // ignored by polling
        sorter: sorter,
        // ignored by polling
        _testOnlyPollCallback: callbacks._testOnlyPollCallback
      }); // This field is only set for use in tests.

      multiplexer._observeDriver = observeDriver;
    } // Blocks until the initial adds have been sent.


    multiplexer.addHandleAndSendInitialAdds(observeHandle);
    return observeHandle;
  }; // Listen for the invalidation messages that will trigger us to poll the
  // database for changes. If this selector specifies specific IDs, specify them
  // here, so that updates to different specific IDs don't cause us to poll.
  // listenCallback is the same kind of (notification, complete) callback passed
  // to InvalidationCrossbar.listen.


  listenAll = function (cursorDescription, listenCallback) {
    var listeners = [];
    forEachTrigger(cursorDescription, function (trigger) {
      listeners.push(DDPServer._InvalidationCrossbar.listen(trigger, listenCallback));
    });
    return {
      stop: function () {
        _.each(listeners, function (listener) {
          listener.stop();
        });
      }
    };
  };

  forEachTrigger = function (cursorDescription, triggerCallback) {
    var key = {
      collection: cursorDescription.collectionName
    };

    var specificIds = LocalCollection._idsMatchedBySelector(cursorDescription.selector);

    if (specificIds) {
      _.each(specificIds, function (id) {
        triggerCallback(_.extend({
          id: id
        }, key));
      });

      triggerCallback(_.extend({
        dropCollection: true,
        id: null
      }, key));
    } else {
      triggerCallback(key);
    } // Everyone cares about the database being dropped.


    triggerCallback({
      dropDatabase: true
    });
  }; // observeChanges for tailable cursors on capped collections.
  //
  // Some differences from normal cursors:
  //   - Will never produce anything other than 'added' or 'addedBefore'. If you
  //     do update a document that has already been produced, this will not notice
  //     it.
  //   - If you disconnect and reconnect from Mongo, it will essentially restart
  //     the query, which will lead to duplicate results. This is pretty bad,
  //     but if you include a field called 'ts' which is inserted as
  //     new MongoInternals.MongoTimestamp(0, 0) (which is initialized to the
  //     current Mongo-style timestamp), we'll be able to find the place to
  //     restart properly. (This field is specifically understood by Mongo with an
  //     optimization which allows it to find the right place to start without
  //     an index on ts. It's how the oplog works.)
  //   - No callbacks are triggered synchronously with the call (there's no
  //     differentiation between "initial data" and "later changes"; everything
  //     that matches the query gets sent asynchronously).
  //   - De-duplication is not implemented.
  //   - Does not yet interact with the write fence. Probably, this should work by
  //     ignoring removes (which don't work on capped collections) and updates
  //     (which don't affect tailable cursors), and just keeping track of the ID
  //     of the inserted object, and closing the write fence once you get to that
  //     ID (or timestamp?).  This doesn't work well if the document doesn't match
  //     the query, though.  On the other hand, the write fence can close
  //     immediately if it does not match the query. So if we trust minimongo
  //     enough to accurately evaluate the query against the write fence, we
  //     should be able to do this...  Of course, minimongo doesn't even support
  //     Mongo Timestamps yet.


  MongoConnection.prototype._observeChangesTailable = function (cursorDescription, ordered, callbacks) {
    var self = this; // Tailable cursors only ever call added/addedBefore callbacks, so it's an
    // error if you didn't provide them.

    if (ordered && !callbacks.addedBefore || !ordered && !callbacks.added) {
      throw new Error("Can't observe an " + (ordered ? "ordered" : "unordered") + " tailable cursor without a " + (ordered ? "addedBefore" : "added") + " callback");
    }

    return self.tail(cursorDescription, function (doc) {
      var id = doc._id;
      delete doc._id; // The ts is an implementation detail. Hide it.

      delete doc.ts;

      if (ordered) {
        callbacks.addedBefore(id, doc, null);
      } else {
        callbacks.added(id, doc);
      }
    });
  }; // XXX We probably need to find a better way to expose this. Right now
  // it's only used by tests, but in fact you need it in normal
  // operation to interact with capped collections.


  MongoInternals.MongoTimestamp = MongoDB.Timestamp;
  MongoInternals.Connection = MongoConnection;
}.call(this, module);
/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

},"oplog_tailing.js":function module(require,exports,module){

/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
//                                                                                                                     //
// packages/mongo/oplog_tailing.js                                                                                     //
//                                                                                                                     //
/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
                                                                                                                       //
let NpmModuleMongodb;
module.link("meteor/npm-mongo", {
  NpmModuleMongodb(v) {
    NpmModuleMongodb = v;
  }

}, 0);

var Future = Npm.require('fibers/future');

const {
  Timestamp
} = NpmModuleMongodb;
OPLOG_COLLECTION = 'oplog.rs';
var TOO_FAR_BEHIND = process.env.METEOR_OPLOG_TOO_FAR_BEHIND || 2000;
var TAIL_TIMEOUT = +process.env.METEOR_OPLOG_TAIL_TIMEOUT || 30000;

var showTS = function (ts) {
  return "Timestamp(" + ts.getHighBits() + ", " + ts.getLowBits() + ")";
};

idForOp = function (op) {
  if (op.op === 'd') return op.o._id;else if (op.op === 'i') return op.o._id;else if (op.op === 'u') return op.o2._id;else if (op.op === 'c') throw Error("Operator 'c' doesn't supply an object with id: " + EJSON.stringify(op));else throw Error("Unknown op: " + EJSON.stringify(op));
};

OplogHandle = function (oplogUrl, dbName) {
  var self = this;
  self._oplogUrl = oplogUrl;
  self._dbName = dbName;
  self._oplogLastEntryConnection = null;
  self._oplogTailConnection = null;
  self._stopped = false;
  self._tailHandle = null;
  self._readyFuture = new Future();
  self._crossbar = new DDPServer._Crossbar({
    factPackage: "mongo-livedata",
    factName: "oplog-watchers"
  });
  self._baseOplogSelector = {
    ns: new RegExp("^(?:" + [Meteor._escapeRegExp(self._dbName + "."), Meteor._escapeRegExp("admin.$cmd")].join("|") + ")"),
    $or: [{
      op: {
        $in: ['i', 'u', 'd']
      }
    }, // drop collection
    {
      op: 'c',
      'o.drop': {
        $exists: true
      }
    }, {
      op: 'c',
      'o.dropDatabase': 1
    }, {
      op: 'c',
      'o.applyOps': {
        $exists: true
      }
    }]
  }; // Data structures to support waitUntilCaughtUp(). Each oplog entry has a
  // MongoTimestamp object on it (which is not the same as a Date --- it's a
  // combination of time and an incrementing counter; see
  // http://docs.mongodb.org/manual/reference/bson-types/#timestamps).
  //
  // _catchingUpFutures is an array of {ts: MongoTimestamp, future: Future}
  // objects, sorted by ascending timestamp. _lastProcessedTS is the
  // MongoTimestamp of the last oplog entry we've processed.
  //
  // Each time we call waitUntilCaughtUp, we take a peek at the final oplog
  // entry in the db.  If we've already processed it (ie, it is not greater than
  // _lastProcessedTS), waitUntilCaughtUp immediately returns. Otherwise,
  // waitUntilCaughtUp makes a new Future and inserts it along with the final
  // timestamp entry that it read, into _catchingUpFutures. waitUntilCaughtUp
  // then waits on that future, which is resolved once _lastProcessedTS is
  // incremented to be past its timestamp by the worker fiber.
  //
  // XXX use a priority queue or something else that's faster than an array

  self._catchingUpFutures = [];
  self._lastProcessedTS = null;
  self._onSkippedEntriesHook = new Hook({
    debugPrintExceptions: "onSkippedEntries callback"
  });
  self._entryQueue = new Meteor._DoubleEndedQueue();
  self._workerActive = false;

  self._startTailing();
};

_.extend(OplogHandle.prototype, {
  stop: function () {
    var self = this;
    if (self._stopped) return;
    self._stopped = true;
    if (self._tailHandle) self._tailHandle.stop(); // XXX should close connections too
  },
  onOplogEntry: function (trigger, callback) {
    var self = this;
    if (self._stopped) throw new Error("Called onOplogEntry on stopped handle!"); // Calling onOplogEntry requires us to wait for the tailing to be ready.

    self._readyFuture.wait();

    var originalCallback = callback;
    callback = Meteor.bindEnvironment(function (notification) {
      originalCallback(notification);
    }, function (err) {
      Meteor._debug("Error in oplog callback", err);
    });

    var listenHandle = self._crossbar.listen(trigger, callback);

    return {
      stop: function () {
        listenHandle.stop();
      }
    };
  },
  // Register a callback to be invoked any time we skip oplog entries (eg,
  // because we are too far behind).
  onSkippedEntries: function (callback) {
    var self = this;
    if (self._stopped) throw new Error("Called onSkippedEntries on stopped handle!");
    return self._onSkippedEntriesHook.register(callback);
  },
  // Calls `callback` once the oplog has been processed up to a point that is
  // roughly "now": specifically, once we've processed all ops that are
  // currently visible.
  // XXX become convinced that this is actually safe even if oplogConnection
  // is some kind of pool
  waitUntilCaughtUp: function () {
    var self = this;
    if (self._stopped) throw new Error("Called waitUntilCaughtUp on stopped handle!"); // Calling waitUntilCaughtUp requries us to wait for the oplog connection to
    // be ready.

    self._readyFuture.wait();

    var lastEntry;

    while (!self._stopped) {
      // We need to make the selector at least as restrictive as the actual
      // tailing selector (ie, we need to specify the DB name) or else we might
      // find a TS that won't show up in the actual tail stream.
      try {
        lastEntry = self._oplogLastEntryConnection.findOne(OPLOG_COLLECTION, self._baseOplogSelector, {
          fields: {
            ts: 1
          },
          sort: {
            $natural: -1
          }
        });
        break;
      } catch (e) {
        // During failover (eg) if we get an exception we should log and retry
        // instead of crashing.
        Meteor._debug("Got exception while reading last entry", e);

        Meteor._sleepForMs(100);
      }
    }

    if (self._stopped) return;

    if (!lastEntry) {
      // Really, nothing in the oplog? Well, we've processed everything.
      return;
    }

    var ts = lastEntry.ts;
    if (!ts) throw Error("oplog entry without ts: " + EJSON.stringify(lastEntry));

    if (self._lastProcessedTS && ts.lessThanOrEqual(self._lastProcessedTS)) {
      // We've already caught up to here.
      return;
    } // Insert the future into our list. Almost always, this will be at the end,
    // but it's conceivable that if we fail over from one primary to another,
    // the oplog entries we see will go backwards.


    var insertAfter = self._catchingUpFutures.length;

    while (insertAfter - 1 > 0 && self._catchingUpFutures[insertAfter - 1].ts.greaterThan(ts)) {
      insertAfter--;
    }

    var f = new Future();

    self._catchingUpFutures.splice(insertAfter, 0, {
      ts: ts,
      future: f
    });

    f.wait();
  },
  _startTailing: function () {
    var self = this; // First, make sure that we're talking to the local database.

    var mongodbUri = Npm.require('mongodb-uri');

    if (mongodbUri.parse(self._oplogUrl).database !== 'local') {
      throw Error("$MONGO_OPLOG_URL must be set to the 'local' database of " + "a Mongo replica set");
    } // We make two separate connections to Mongo. The Node Mongo driver
    // implements a naive round-robin connection pool: each "connection" is a
    // pool of several (5 by default) TCP connections, and each request is
    // rotated through the pools. Tailable cursor queries block on the server
    // until there is some data to return (or until a few seconds have
    // passed). So if the connection pool used for tailing cursors is the same
    // pool used for other queries, the other queries will be delayed by seconds
    // 1/5 of the time.
    //
    // The tail connection will only ever be running a single tail command, so
    // it only needs to make one underlying TCP connection.


    self._oplogTailConnection = new MongoConnection(self._oplogUrl, {
      poolSize: 1
    }); // XXX better docs, but: it's to get monotonic results
    // XXX is it safe to say "if there's an in flight query, just use its
    //     results"? I don't think so but should consider that

    self._oplogLastEntryConnection = new MongoConnection(self._oplogUrl, {
      poolSize: 1
    }); // Now, make sure that there actually is a repl set here. If not, oplog
    // tailing won't ever find anything!
    // More on the isMasterDoc
    // https://docs.mongodb.com/manual/reference/command/isMaster/

    var f = new Future();

    self._oplogLastEntryConnection.db.admin().command({
      ismaster: 1
    }, f.resolver());

    var isMasterDoc = f.wait();

    if (!(isMasterDoc && isMasterDoc.setName)) {
      throw Error("$MONGO_OPLOG_URL must be set to the 'local' database of " + "a Mongo replica set");
    } // Find the last oplog entry.


    var lastOplogEntry = self._oplogLastEntryConnection.findOne(OPLOG_COLLECTION, {}, {
      sort: {
        $natural: -1
      },
      fields: {
        ts: 1
      }
    });

    var oplogSelector = _.clone(self._baseOplogSelector);

    if (lastOplogEntry) {
      // Start after the last entry that currently exists.
      oplogSelector.ts = {
        $gt: lastOplogEntry.ts
      }; // If there are any calls to callWhenProcessedLatest before any other
      // oplog entries show up, allow callWhenProcessedLatest to call its
      // callback immediately.

      self._lastProcessedTS = lastOplogEntry.ts;
    }

    var cursorDescription = new CursorDescription(OPLOG_COLLECTION, oplogSelector, {
      tailable: true
    }); // Start tailing the oplog.
    //
    // We restart the low-level oplog query every 30 seconds if we didn't get a
    // doc. This is a workaround for #8598: the Node Mongo driver has at least
    // one bug that can lead to query callbacks never getting called (even with
    // an error) when leadership failover occur.

    self._tailHandle = self._oplogTailConnection.tail(cursorDescription, function (doc) {
      self._entryQueue.push(doc);

      self._maybeStartWorker();
    }, TAIL_TIMEOUT);

    self._readyFuture.return();
  },
  _maybeStartWorker: function () {
    var self = this;
    if (self._workerActive) return;
    self._workerActive = true;
    Meteor.defer(function () {
      // May be called recursively in case of transactions.
      function handleDoc(doc) {
        if (doc.ns === "admin.$cmd") {
          if (doc.o.applyOps) {
            // This was a successful transaction, so we need to apply the
            // operations that were involved.
            let nextTimestamp = doc.ts;
            doc.o.applyOps.forEach(op => {
              // See https://github.com/meteor/meteor/issues/10420.
              if (!op.ts) {
                op.ts = nextTimestamp;
                nextTimestamp = nextTimestamp.add(Timestamp.ONE);
              }

              handleDoc(op);
            });
            return;
          }

          throw new Error("Unknown command " + EJSON.stringify(doc));
        }

        const trigger = {
          dropCollection: false,
          dropDatabase: false,
          op: doc
        };

        if (typeof doc.ns === "string" && doc.ns.startsWith(self._dbName + ".")) {
          trigger.collection = doc.ns.slice(self._dbName.length + 1);
        } // Is it a special command and the collection name is hidden
        // somewhere in operator?


        if (trigger.collection === "$cmd") {
          if (doc.o.dropDatabase) {
            delete trigger.collection;
            trigger.dropDatabase = true;
          } else if (_.has(doc.o, "drop")) {
            trigger.collection = doc.o.drop;
            trigger.dropCollection = true;
            trigger.id = null;
          } else {
            throw Error("Unknown command " + EJSON.stringify(doc));
          }
        } else {
          // All other ops have an id.
          trigger.id = idForOp(doc);
        }

        self._crossbar.fire(trigger);
      }

      try {
        while (!self._stopped && !self._entryQueue.isEmpty()) {
          // Are we too far behind? Just tell our observers that they need to
          // repoll, and drop our queue.
          if (self._entryQueue.length > TOO_FAR_BEHIND) {
            var lastEntry = self._entryQueue.pop();

            self._entryQueue.clear();

            self._onSkippedEntriesHook.each(function (callback) {
              callback();
              return true;
            }); // Free any waitUntilCaughtUp() calls that were waiting for us to
            // pass something that we just skipped.


            self._setLastProcessedTS(lastEntry.ts);

            continue;
          }

          const doc = self._entryQueue.shift(); // Fire trigger(s) for this doc.


          handleDoc(doc); // Now that we've processed this operation, process pending
          // sequencers.

          if (doc.ts) {
            self._setLastProcessedTS(doc.ts);
          } else {
            throw Error("oplog entry without ts: " + EJSON.stringify(doc));
          }
        }
      } finally {
        self._workerActive = false;
      }
    });
  },
  _setLastProcessedTS: function (ts) {
    var self = this;
    self._lastProcessedTS = ts;

    while (!_.isEmpty(self._catchingUpFutures) && self._catchingUpFutures[0].ts.lessThanOrEqual(self._lastProcessedTS)) {
      var sequencer = self._catchingUpFutures.shift();

      sequencer.future.return();
    }
  },
  //Methods used on tests to dinamically change TOO_FAR_BEHIND
  _defineTooFarBehind: function (value) {
    TOO_FAR_BEHIND = value;
  },
  _resetTooFarBehind: function () {
    TOO_FAR_BEHIND = process.env.METEOR_OPLOG_TOO_FAR_BEHIND || 2000;
  }
});
/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

},"observe_multiplex.js":function module(require,exports,module){

/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
//                                                                                                                     //
// packages/mongo/observe_multiplex.js                                                                                 //
//                                                                                                                     //
/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
                                                                                                                       //
let _objectWithoutProperties;

module.link("@babel/runtime/helpers/objectWithoutProperties", {
  default(v) {
    _objectWithoutProperties = v;
  }

}, 0);

var Future = Npm.require('fibers/future');

ObserveMultiplexer = function (options) {
  var self = this;
  if (!options || !_.has(options, 'ordered')) throw Error("must specified ordered");
  Package['facts-base'] && Package['facts-base'].Facts.incrementServerFact("mongo-livedata", "observe-multiplexers", 1);
  self._ordered = options.ordered;

  self._onStop = options.onStop || function () {};

  self._queue = new Meteor._SynchronousQueue();
  self._handles = {};
  self._readyFuture = new Future();
  self._cache = new LocalCollection._CachingChangeObserver({
    ordered: options.ordered
  }); // Number of addHandleAndSendInitialAdds tasks scheduled but not yet
  // running. removeHandle uses this to know if it's time to call the onStop
  // callback.

  self._addHandleTasksScheduledButNotPerformed = 0;

  _.each(self.callbackNames(), function (callbackName) {
    self[callbackName] = function ()
    /* ... */
    {
      self._applyCallback(callbackName, _.toArray(arguments));
    };
  });
};

_.extend(ObserveMultiplexer.prototype, {
  addHandleAndSendInitialAdds: function (handle) {
    var self = this; // Check this before calling runTask (even though runTask does the same
    // check) so that we don't leak an ObserveMultiplexer on error by
    // incrementing _addHandleTasksScheduledButNotPerformed and never
    // decrementing it.

    if (!self._queue.safeToRunTask()) throw new Error("Can't call observeChanges from an observe callback on the same query");
    ++self._addHandleTasksScheduledButNotPerformed;
    Package['facts-base'] && Package['facts-base'].Facts.incrementServerFact("mongo-livedata", "observe-handles", 1);

    self._queue.runTask(function () {
      self._handles[handle._id] = handle; // Send out whatever adds we have so far (whether or not we the
      // multiplexer is ready).

      self._sendAdds(handle);

      --self._addHandleTasksScheduledButNotPerformed;
    }); // *outside* the task, since otherwise we'd deadlock


    self._readyFuture.wait();
  },
  // Remove an observe handle. If it was the last observe handle, call the
  // onStop callback; you cannot add any more observe handles after this.
  //
  // This is not synchronized with polls and handle additions: this means that
  // you can safely call it from within an observe callback, but it also means
  // that we have to be careful when we iterate over _handles.
  removeHandle: function (id) {
    var self = this; // This should not be possible: you can only call removeHandle by having
    // access to the ObserveHandle, which isn't returned to user code until the
    // multiplex is ready.

    if (!self._ready()) throw new Error("Can't remove handles until the multiplex is ready");
    delete self._handles[id];
    Package['facts-base'] && Package['facts-base'].Facts.incrementServerFact("mongo-livedata", "observe-handles", -1);

    if (_.isEmpty(self._handles) && self._addHandleTasksScheduledButNotPerformed === 0) {
      self._stop();
    }
  },
  _stop: function (options) {
    var self = this;
    options = options || {}; // It shouldn't be possible for us to stop when all our handles still
    // haven't been returned from observeChanges!

    if (!self._ready() && !options.fromQueryError) throw Error("surprising _stop: not ready"); // Call stop callback (which kills the underlying process which sends us
    // callbacks and removes us from the connection's dictionary).

    self._onStop();

    Package['facts-base'] && Package['facts-base'].Facts.incrementServerFact("mongo-livedata", "observe-multiplexers", -1); // Cause future addHandleAndSendInitialAdds calls to throw (but the onStop
    // callback should make our connection forget about us).

    self._handles = null;
  },
  // Allows all addHandleAndSendInitialAdds calls to return, once all preceding
  // adds have been processed. Does not block.
  ready: function () {
    var self = this;

    self._queue.queueTask(function () {
      if (self._ready()) throw Error("can't make ObserveMultiplex ready twice!");

      self._readyFuture.return();
    });
  },
  // If trying to execute the query results in an error, call this. This is
  // intended for permanent errors, not transient network errors that could be
  // fixed. It should only be called before ready(), because if you called ready
  // that meant that you managed to run the query once. It will stop this
  // ObserveMultiplex and cause addHandleAndSendInitialAdds calls (and thus
  // observeChanges calls) to throw the error.
  queryError: function (err) {
    var self = this;

    self._queue.runTask(function () {
      if (self._ready()) throw Error("can't claim query has an error after it worked!");

      self._stop({
        fromQueryError: true
      });

      self._readyFuture.throw(err);
    });
  },
  // Calls "cb" once the effects of all "ready", "addHandleAndSendInitialAdds"
  // and observe callbacks which came before this call have been propagated to
  // all handles. "ready" must have already been called on this multiplexer.
  onFlush: function (cb) {
    var self = this;

    self._queue.queueTask(function () {
      if (!self._ready()) throw Error("only call onFlush on a multiplexer that will be ready");
      cb();
    });
  },
  callbackNames: function () {
    var self = this;
    if (self._ordered) return ["addedBefore", "changed", "movedBefore", "removed"];else return ["added", "changed", "removed"];
  },
  _ready: function () {
    return this._readyFuture.isResolved();
  },
  _applyCallback: function (callbackName, args) {
    var self = this;

    self._queue.queueTask(function () {
      // If we stopped in the meantime, do nothing.
      if (!self._handles) return; // First, apply the change to the cache.

      self._cache.applyChange[callbackName].apply(null, args); // If we haven't finished the initial adds, then we should only be getting
      // adds.


      if (!self._ready() && callbackName !== 'added' && callbackName !== 'addedBefore') {
        throw new Error("Got " + callbackName + " during initial adds");
      } // Now multiplex the callbacks out to all observe handles. It's OK if
      // these calls yield; since we're inside a task, no other use of our queue
      // can continue until these are done. (But we do have to be careful to not
      // use a handle that got removed, because removeHandle does not use the
      // queue; thus, we iterate over an array of keys that we control.)


      _.each(_.keys(self._handles), function (handleId) {
        var handle = self._handles && self._handles[handleId];
        if (!handle) return;
        var callback = handle['_' + callbackName]; // clone arguments so that callbacks can mutate their arguments

        callback && callback.apply(null, handle.nonMutatingCallbacks ? args : EJSON.clone(args));
      });
    });
  },
  // Sends initial adds to a handle. It should only be called from within a task
  // (the task that is processing the addHandleAndSendInitialAdds call). It
  // synchronously invokes the handle's added or addedBefore; there's no need to
  // flush the queue afterwards to ensure that the callbacks get out.
  _sendAdds: function (handle) {
    var self = this;
    if (self._queue.safeToRunTask()) throw Error("_sendAdds may only be called from within a task!");
    var add = self._ordered ? handle._addedBefore : handle._added;
    if (!add) return; // note: docs may be an _IdMap or an OrderedDict

    self._cache.docs.forEach(function (doc, id) {
      if (!_.has(self._handles, handle._id)) throw Error("handle got removed before sending initial adds!");

      const _ref = handle.nonMutatingCallbacks ? doc : EJSON.clone(doc),
            {
        _id
      } = _ref,
            fields = _objectWithoutProperties(_ref, ["_id"]);

      if (self._ordered) add(id, fields, null); // we're going in order, so add at end
      else add(id, fields);
    });
  }
});

var nextObserveHandleId = 1; // When the callbacks do not mutate the arguments, we can skip a lot of data clones

ObserveHandle = function (multiplexer, callbacks) {
  let nonMutatingCallbacks = arguments.length > 2 && arguments[2] !== undefined ? arguments[2] : false;
  var self = this; // The end user is only supposed to call stop().  The other fields are
  // accessible to the multiplexer, though.

  self._multiplexer = multiplexer;

  _.each(multiplexer.callbackNames(), function (name) {
    if (callbacks[name]) {
      self['_' + name] = callbacks[name];
    } else if (name === "addedBefore" && callbacks.added) {
      // Special case: if you specify "added" and "movedBefore", you get an
      // ordered observe where for some reason you don't get ordering data on
      // the adds.  I dunno, we wrote tests for it, there must have been a
      // reason.
      self._addedBefore = function (id, fields, before) {
        callbacks.added(id, fields);
      };
    }
  });

  self._stopped = false;
  self._id = nextObserveHandleId++;
  self.nonMutatingCallbacks = nonMutatingCallbacks;
};

ObserveHandle.prototype.stop = function () {
  var self = this;
  if (self._stopped) return;
  self._stopped = true;

  self._multiplexer.removeHandle(self._id);
};
/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

},"doc_fetcher.js":function module(require,exports,module){

/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
//                                                                                                                     //
// packages/mongo/doc_fetcher.js                                                                                       //
//                                                                                                                     //
/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
                                                                                                                       //
module.export({
  DocFetcher: () => DocFetcher
});

var Fiber = Npm.require('fibers');

class DocFetcher {
  constructor(mongoConnection) {
    this._mongoConnection = mongoConnection; // Map from op -> [callback]

    this._callbacksForOp = new Map();
  } // Fetches document "id" from collectionName, returning it or null if not
  // found.
  //
  // If you make multiple calls to fetch() with the same op reference,
  // DocFetcher may assume that they all return the same document. (It does
  // not check to see if collectionName/id match.)
  //
  // You may assume that callback is never called synchronously (and in fact
  // OplogObserveDriver does so).


  fetch(collectionName, id, op, callback) {
    const self = this;
    check(collectionName, String);
    check(op, Object); // If there's already an in-progress fetch for this cache key, yield until
    // it's done and return whatever it returns.

    if (self._callbacksForOp.has(op)) {
      self._callbacksForOp.get(op).push(callback);

      return;
    }

    const callbacks = [callback];

    self._callbacksForOp.set(op, callbacks);

    Fiber(function () {
      try {
        var doc = self._mongoConnection.findOne(collectionName, {
          _id: id
        }) || null; // Return doc to all relevant callbacks. Note that this array can
        // continue to grow during callback excecution.

        while (callbacks.length > 0) {
          // Clone the document so that the various calls to fetch don't return
          // objects that are intertwingled with each other. Clone before
          // popping the future, so that if clone throws, the error gets passed
          // to the next callback.
          callbacks.pop()(null, EJSON.clone(doc));
        }
      } catch (e) {
        while (callbacks.length > 0) {
          callbacks.pop()(e);
        }
      } finally {
        // XXX consider keeping the doc around for a period of time before
        // removing from the cache
        self._callbacksForOp.delete(op);
      }
    }).run();
  }

}
/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

},"polling_observe_driver.js":function module(){

/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
//                                                                                                                     //
// packages/mongo/polling_observe_driver.js                                                                            //
//                                                                                                                     //
/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
                                                                                                                       //
var POLLING_THROTTLE_MS = +process.env.METEOR_POLLING_THROTTLE_MS || 50;
var POLLING_INTERVAL_MS = +process.env.METEOR_POLLING_INTERVAL_MS || 10 * 1000;

PollingObserveDriver = function (options) {
  var self = this;
  self._cursorDescription = options.cursorDescription;
  self._mongoHandle = options.mongoHandle;
  self._ordered = options.ordered;
  self._multiplexer = options.multiplexer;
  self._stopCallbacks = [];
  self._stopped = false;
  self._synchronousCursor = self._mongoHandle._createSynchronousCursor(self._cursorDescription); // previous results snapshot.  on each poll cycle, diffs against
  // results drives the callbacks.

  self._results = null; // The number of _pollMongo calls that have been added to self._taskQueue but
  // have not started running. Used to make sure we never schedule more than one
  // _pollMongo (other than possibly the one that is currently running). It's
  // also used by _suspendPolling to pretend there's a poll scheduled. Usually,
  // it's either 0 (for "no polls scheduled other than maybe one currently
  // running") or 1 (for "a poll scheduled that isn't running yet"), but it can
  // also be 2 if incremented by _suspendPolling.

  self._pollsScheduledButNotStarted = 0;
  self._pendingWrites = []; // people to notify when polling completes
  // Make sure to create a separately throttled function for each
  // PollingObserveDriver object.

  self._ensurePollIsScheduled = _.throttle(self._unthrottledEnsurePollIsScheduled, self._cursorDescription.options.pollingThrottleMs || POLLING_THROTTLE_MS
  /* ms */
  ); // XXX figure out if we still need a queue

  self._taskQueue = new Meteor._SynchronousQueue();
  var listenersHandle = listenAll(self._cursorDescription, function (notification) {
    // When someone does a transaction that might affect us, schedule a poll
    // of the database. If that transaction happens inside of a write fence,
    // block the fence until we've polled and notified observers.
    var fence = DDPServer._CurrentWriteFence.get();

    if (fence) self._pendingWrites.push(fence.beginWrite()); // Ensure a poll is scheduled... but if we already know that one is,
    // don't hit the throttled _ensurePollIsScheduled function (which might
    // lead to us calling it unnecessarily in <pollingThrottleMs> ms).

    if (self._pollsScheduledButNotStarted === 0) self._ensurePollIsScheduled();
  });

  self._stopCallbacks.push(function () {
    listenersHandle.stop();
  }); // every once and a while, poll even if we don't think we're dirty, for
  // eventual consistency with database writes from outside the Meteor
  // universe.
  //
  // For testing, there's an undocumented callback argument to observeChanges
  // which disables time-based polling and gets called at the beginning of each
  // poll.


  if (options._testOnlyPollCallback) {
    self._testOnlyPollCallback = options._testOnlyPollCallback;
  } else {
    var pollingInterval = self._cursorDescription.options.pollingIntervalMs || self._cursorDescription.options._pollingInterval || // COMPAT with 1.2
    POLLING_INTERVAL_MS;
    var intervalHandle = Meteor.setInterval(_.bind(self._ensurePollIsScheduled, self), pollingInterval);

    self._stopCallbacks.push(function () {
      Meteor.clearInterval(intervalHandle);
    });
  } // Make sure we actually poll soon!


  self._unthrottledEnsurePollIsScheduled();

  Package['facts-base'] && Package['facts-base'].Facts.incrementServerFact("mongo-livedata", "observe-drivers-polling", 1);
};

_.extend(PollingObserveDriver.prototype, {
  // This is always called through _.throttle (except once at startup).
  _unthrottledEnsurePollIsScheduled: function () {
    var self = this;
    if (self._pollsScheduledButNotStarted > 0) return;
    ++self._pollsScheduledButNotStarted;

    self._taskQueue.queueTask(function () {
      self._pollMongo();
    });
  },
  // test-only interface for controlling polling.
  //
  // _suspendPolling blocks until any currently running and scheduled polls are
  // done, and prevents any further polls from being scheduled. (new
  // ObserveHandles can be added and receive their initial added callbacks,
  // though.)
  //
  // _resumePolling immediately polls, and allows further polls to occur.
  _suspendPolling: function () {
    var self = this; // Pretend that there's another poll scheduled (which will prevent
    // _ensurePollIsScheduled from queueing any more polls).

    ++self._pollsScheduledButNotStarted; // Now block until all currently running or scheduled polls are done.

    self._taskQueue.runTask(function () {}); // Confirm that there is only one "poll" (the fake one we're pretending to
    // have) scheduled.


    if (self._pollsScheduledButNotStarted !== 1) throw new Error("_pollsScheduledButNotStarted is " + self._pollsScheduledButNotStarted);
  },
  _resumePolling: function () {
    var self = this; // We should be in the same state as in the end of _suspendPolling.

    if (self._pollsScheduledButNotStarted !== 1) throw new Error("_pollsScheduledButNotStarted is " + self._pollsScheduledButNotStarted); // Run a poll synchronously (which will counteract the
    // ++_pollsScheduledButNotStarted from _suspendPolling).

    self._taskQueue.runTask(function () {
      self._pollMongo();
    });
  },
  _pollMongo: function () {
    var self = this;
    --self._pollsScheduledButNotStarted;
    if (self._stopped) return;
    var first = false;
    var newResults;
    var oldResults = self._results;

    if (!oldResults) {
      first = true; // XXX maybe use OrderedDict instead?

      oldResults = self._ordered ? [] : new LocalCollection._IdMap();
    }

    self._testOnlyPollCallback && self._testOnlyPollCallback(); // Save the list of pending writes which this round will commit.

    var writesForCycle = self._pendingWrites;
    self._pendingWrites = []; // Get the new query results. (This yields.)

    try {
      newResults = self._synchronousCursor.getRawObjects(self._ordered);
    } catch (e) {
      if (first && typeof e.code === 'number') {
        // This is an error document sent to us by mongod, not a connection
        // error generated by the client. And we've never seen this query work
        // successfully. Probably it's a bad selector or something, so we should
        // NOT retry. Instead, we should halt the observe (which ends up calling
        // `stop` on us).
        self._multiplexer.queryError(new Error("Exception while polling query " + JSON.stringify(self._cursorDescription) + ": " + e.message));

        return;
      } // getRawObjects can throw if we're having trouble talking to the
      // database.  That's fine --- we will repoll later anyway. But we should
      // make sure not to lose track of this cycle's writes.
      // (It also can throw if there's just something invalid about this query;
      // unfortunately the ObserveDriver API doesn't provide a good way to
      // "cancel" the observe from the inside in this case.


      Array.prototype.push.apply(self._pendingWrites, writesForCycle);

      Meteor._debug("Exception while polling query " + JSON.stringify(self._cursorDescription), e);

      return;
    } // Run diffs.


    if (!self._stopped) {
      LocalCollection._diffQueryChanges(self._ordered, oldResults, newResults, self._multiplexer);
    } // Signals the multiplexer to allow all observeChanges calls that share this
    // multiplexer to return. (This happens asynchronously, via the
    // multiplexer's queue.)


    if (first) self._multiplexer.ready(); // Replace self._results atomically.  (This assignment is what makes `first`
    // stay through on the next cycle, so we've waited until after we've
    // committed to ready-ing the multiplexer.)

    self._results = newResults; // Once the ObserveMultiplexer has processed everything we've done in this
    // round, mark all the writes which existed before this call as
    // commmitted. (If new writes have shown up in the meantime, there'll
    // already be another _pollMongo task scheduled.)

    self._multiplexer.onFlush(function () {
      _.each(writesForCycle, function (w) {
        w.committed();
      });
    });
  },
  stop: function () {
    var self = this;
    self._stopped = true;

    _.each(self._stopCallbacks, function (c) {
      c();
    }); // Release any write fences that are waiting on us.


    _.each(self._pendingWrites, function (w) {
      w.committed();
    });

    Package['facts-base'] && Package['facts-base'].Facts.incrementServerFact("mongo-livedata", "observe-drivers-polling", -1);
  }
});
/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

},"oplog_observe_driver.js":function module(require){

/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
//                                                                                                                     //
// packages/mongo/oplog_observe_driver.js                                                                              //
//                                                                                                                     //
/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
                                                                                                                       //
var Future = Npm.require('fibers/future');

var PHASE = {
  QUERYING: "QUERYING",
  FETCHING: "FETCHING",
  STEADY: "STEADY"
}; // Exception thrown by _needToPollQuery which unrolls the stack up to the
// enclosing call to finishIfNeedToPollQuery.

var SwitchedToQuery = function () {};

var finishIfNeedToPollQuery = function (f) {
  return function () {
    try {
      f.apply(this, arguments);
    } catch (e) {
      if (!(e instanceof SwitchedToQuery)) throw e;
    }
  };
};

var currentId = 0; // OplogObserveDriver is an alternative to PollingObserveDriver which follows
// the Mongo operation log instead of just re-polling the query. It obeys the
// same simple interface: constructing it starts sending observeChanges
// callbacks (and a ready() invocation) to the ObserveMultiplexer, and you stop
// it by calling the stop() method.

OplogObserveDriver = function (options) {
  var self = this;
  self._usesOplog = true; // tests look at this

  self._id = currentId;
  currentId++;
  self._cursorDescription = options.cursorDescription;
  self._mongoHandle = options.mongoHandle;
  self._multiplexer = options.multiplexer;

  if (options.ordered) {
    throw Error("OplogObserveDriver only supports unordered observeChanges");
  }

  var sorter = options.sorter; // We don't support $near and other geo-queries so it's OK to initialize the
  // comparator only once in the constructor.

  var comparator = sorter && sorter.getComparator();

  if (options.cursorDescription.options.limit) {
    // There are several properties ordered driver implements:
    // - _limit is a positive number
    // - _comparator is a function-comparator by which the query is ordered
    // - _unpublishedBuffer is non-null Min/Max Heap,
    //                      the empty buffer in STEADY phase implies that the
    //                      everything that matches the queries selector fits
    //                      into published set.
    // - _published - Max Heap (also implements IdMap methods)
    var heapOptions = {
      IdMap: LocalCollection._IdMap
    };
    self._limit = self._cursorDescription.options.limit;
    self._comparator = comparator;
    self._sorter = sorter;
    self._unpublishedBuffer = new MinMaxHeap(comparator, heapOptions); // We need something that can find Max value in addition to IdMap interface

    self._published = new MaxHeap(comparator, heapOptions);
  } else {
    self._limit = 0;
    self._comparator = null;
    self._sorter = null;
    self._unpublishedBuffer = null;
    self._published = new LocalCollection._IdMap();
  } // Indicates if it is safe to insert a new document at the end of the buffer
  // for this query. i.e. it is known that there are no documents matching the
  // selector those are not in published or buffer.


  self._safeAppendToBuffer = false;
  self._stopped = false;
  self._stopHandles = [];
  Package['facts-base'] && Package['facts-base'].Facts.incrementServerFact("mongo-livedata", "observe-drivers-oplog", 1);

  self._registerPhaseChange(PHASE.QUERYING);

  self._matcher = options.matcher;
  var projection = self._cursorDescription.options.fields || {};
  self._projectionFn = LocalCollection._compileProjection(projection); // Projection function, result of combining important fields for selector and
  // existing fields projection

  self._sharedProjection = self._matcher.combineIntoProjection(projection);
  if (sorter) self._sharedProjection = sorter.combineIntoProjection(self._sharedProjection);
  self._sharedProjectionFn = LocalCollection._compileProjection(self._sharedProjection);
  self._needToFetch = new LocalCollection._IdMap();
  self._currentlyFetching = null;
  self._fetchGeneration = 0;
  self._requeryWhenDoneThisQuery = false;
  self._writesToCommitWhenWeReachSteady = []; // If the oplog handle tells us that it skipped some entries (because it got
  // behind, say), re-poll.

  self._stopHandles.push(self._mongoHandle._oplogHandle.onSkippedEntries(finishIfNeedToPollQuery(function () {
    self._needToPollQuery();
  })));

  forEachTrigger(self._cursorDescription, function (trigger) {
    self._stopHandles.push(self._mongoHandle._oplogHandle.onOplogEntry(trigger, function (notification) {
      Meteor._noYieldsAllowed(finishIfNeedToPollQuery(function () {
        var op = notification.op;

        if (notification.dropCollection || notification.dropDatabase) {
          // Note: this call is not allowed to block on anything (especially
          // on waiting for oplog entries to catch up) because that will block
          // onOplogEntry!
          self._needToPollQuery();
        } else {
          // All other operators should be handled depending on phase
          if (self._phase === PHASE.QUERYING) {
            self._handleOplogEntryQuerying(op);
          } else {
            self._handleOplogEntrySteadyOrFetching(op);
          }
        }
      }));
    }));
  }); // XXX ordering w.r.t. everything else?

  self._stopHandles.push(listenAll(self._cursorDescription, function (notification) {
    // If we're not in a pre-fire write fence, we don't have to do anything.
    var fence = DDPServer._CurrentWriteFence.get();

    if (!fence || fence.fired) return;

    if (fence._oplogObserveDrivers) {
      fence._oplogObserveDrivers[self._id] = self;
      return;
    }

    fence._oplogObserveDrivers = {};
    fence._oplogObserveDrivers[self._id] = self;
    fence.onBeforeFire(function () {
      var drivers = fence._oplogObserveDrivers;
      delete fence._oplogObserveDrivers; // This fence cannot fire until we've caught up to "this point" in the
      // oplog, and all observers made it back to the steady state.

      self._mongoHandle._oplogHandle.waitUntilCaughtUp();

      _.each(drivers, function (driver) {
        if (driver._stopped) return;
        var write = fence.beginWrite();

        if (driver._phase === PHASE.STEADY) {
          // Make sure that all of the callbacks have made it through the
          // multiplexer and been delivered to ObserveHandles before committing
          // writes.
          driver._multiplexer.onFlush(function () {
            write.committed();
          });
        } else {
          driver._writesToCommitWhenWeReachSteady.push(write);
        }
      });
    });
  })); // When Mongo fails over, we need to repoll the query, in case we processed an
  // oplog entry that got rolled back.


  self._stopHandles.push(self._mongoHandle._onFailover(finishIfNeedToPollQuery(function () {
    self._needToPollQuery();
  }))); // Give _observeChanges a chance to add the new ObserveHandle to our
  // multiplexer, so that the added calls get streamed.


  Meteor.defer(finishIfNeedToPollQuery(function () {
    self._runInitialQuery();
  }));
};

_.extend(OplogObserveDriver.prototype, {
  _addPublished: function (id, doc) {
    var self = this;

    Meteor._noYieldsAllowed(function () {
      var fields = _.clone(doc);

      delete fields._id;

      self._published.set(id, self._sharedProjectionFn(doc));

      self._multiplexer.added(id, self._projectionFn(fields)); // After adding this document, the published set might be overflowed
      // (exceeding capacity specified by limit). If so, push the maximum
      // element to the buffer, we might want to save it in memory to reduce the
      // amount of Mongo lookups in the future.


      if (self._limit && self._published.size() > self._limit) {
        // XXX in theory the size of published is no more than limit+1
        if (self._published.size() !== self._limit + 1) {
          throw new Error("After adding to published, " + (self._published.size() - self._limit) + " documents are overflowing the set");
        }

        var overflowingDocId = self._published.maxElementId();

        var overflowingDoc = self._published.get(overflowingDocId);

        if (EJSON.equals(overflowingDocId, id)) {
          throw new Error("The document just added is overflowing the published set");
        }

        self._published.remove(overflowingDocId);

        self._multiplexer.removed(overflowingDocId);

        self._addBuffered(overflowingDocId, overflowingDoc);
      }
    });
  },
  _removePublished: function (id) {
    var self = this;

    Meteor._noYieldsAllowed(function () {
      self._published.remove(id);

      self._multiplexer.removed(id);

      if (!self._limit || self._published.size() === self._limit) return;
      if (self._published.size() > self._limit) throw Error("self._published got too big"); // OK, we are publishing less than the limit. Maybe we should look in the
      // buffer to find the next element past what we were publishing before.

      if (!self._unpublishedBuffer.empty()) {
        // There's something in the buffer; move the first thing in it to
        // _published.
        var newDocId = self._unpublishedBuffer.minElementId();

        var newDoc = self._unpublishedBuffer.get(newDocId);

        self._removeBuffered(newDocId);

        self._addPublished(newDocId, newDoc);

        return;
      } // There's nothing in the buffer.  This could mean one of a few things.
      // (a) We could be in the middle of re-running the query (specifically, we
      // could be in _publishNewResults). In that case, _unpublishedBuffer is
      // empty because we clear it at the beginning of _publishNewResults. In
      // this case, our caller already knows the entire answer to the query and
      // we don't need to do anything fancy here.  Just return.


      if (self._phase === PHASE.QUERYING) return; // (b) We're pretty confident that the union of _published and
      // _unpublishedBuffer contain all documents that match selector. Because
      // _unpublishedBuffer is empty, that means we're confident that _published
      // contains all documents that match selector. So we have nothing to do.

      if (self._safeAppendToBuffer) return; // (c) Maybe there are other documents out there that should be in our
      // buffer. But in that case, when we emptied _unpublishedBuffer in
      // _removeBuffered, we should have called _needToPollQuery, which will
      // either put something in _unpublishedBuffer or set _safeAppendToBuffer
      // (or both), and it will put us in QUERYING for that whole time. So in
      // fact, we shouldn't be able to get here.

      throw new Error("Buffer inexplicably empty");
    });
  },
  _changePublished: function (id, oldDoc, newDoc) {
    var self = this;

    Meteor._noYieldsAllowed(function () {
      self._published.set(id, self._sharedProjectionFn(newDoc));

      var projectedNew = self._projectionFn(newDoc);

      var projectedOld = self._projectionFn(oldDoc);

      var changed = DiffSequence.makeChangedFields(projectedNew, projectedOld);
      if (!_.isEmpty(changed)) self._multiplexer.changed(id, changed);
    });
  },
  _addBuffered: function (id, doc) {
    var self = this;

    Meteor._noYieldsAllowed(function () {
      self._unpublishedBuffer.set(id, self._sharedProjectionFn(doc)); // If something is overflowing the buffer, we just remove it from cache


      if (self._unpublishedBuffer.size() > self._limit) {
        var maxBufferedId = self._unpublishedBuffer.maxElementId();

        self._unpublishedBuffer.remove(maxBufferedId); // Since something matching is removed from cache (both published set and
        // buffer), set flag to false


        self._safeAppendToBuffer = false;
      }
    });
  },
  // Is called either to remove the doc completely from matching set or to move
  // it to the published set later.
  _removeBuffered: function (id) {
    var self = this;

    Meteor._noYieldsAllowed(function () {
      self._unpublishedBuffer.remove(id); // To keep the contract "buffer is never empty in STEADY phase unless the
      // everything matching fits into published" true, we poll everything as
      // soon as we see the buffer becoming empty.


      if (!self._unpublishedBuffer.size() && !self._safeAppendToBuffer) self._needToPollQuery();
    });
  },
  // Called when a document has joined the "Matching" results set.
  // Takes responsibility of keeping _unpublishedBuffer in sync with _published
  // and the effect of limit enforced.
  _addMatching: function (doc) {
    var self = this;

    Meteor._noYieldsAllowed(function () {
      var id = doc._id;
      if (self._published.has(id)) throw Error("tried to add something already published " + id);
      if (self._limit && self._unpublishedBuffer.has(id)) throw Error("tried to add something already existed in buffer " + id);
      var limit = self._limit;
      var comparator = self._comparator;
      var maxPublished = limit && self._published.size() > 0 ? self._published.get(self._published.maxElementId()) : null;
      var maxBuffered = limit && self._unpublishedBuffer.size() > 0 ? self._unpublishedBuffer.get(self._unpublishedBuffer.maxElementId()) : null; // The query is unlimited or didn't publish enough documents yet or the
      // new document would fit into published set pushing the maximum element
      // out, then we need to publish the doc.

      var toPublish = !limit || self._published.size() < limit || comparator(doc, maxPublished) < 0; // Otherwise we might need to buffer it (only in case of limited query).
      // Buffering is allowed if the buffer is not filled up yet and all
      // matching docs are either in the published set or in the buffer.

      var canAppendToBuffer = !toPublish && self._safeAppendToBuffer && self._unpublishedBuffer.size() < limit; // Or if it is small enough to be safely inserted to the middle or the
      // beginning of the buffer.

      var canInsertIntoBuffer = !toPublish && maxBuffered && comparator(doc, maxBuffered) <= 0;
      var toBuffer = canAppendToBuffer || canInsertIntoBuffer;

      if (toPublish) {
        self._addPublished(id, doc);
      } else if (toBuffer) {
        self._addBuffered(id, doc);
      } else {
        // dropping it and not saving to the cache
        self._safeAppendToBuffer = false;
      }
    });
  },
  // Called when a document leaves the "Matching" results set.
  // Takes responsibility of keeping _unpublishedBuffer in sync with _published
  // and the effect of limit enforced.
  _removeMatching: function (id) {
    var self = this;

    Meteor._noYieldsAllowed(function () {
      if (!self._published.has(id) && !self._limit) throw Error("tried to remove something matching but not cached " + id);

      if (self._published.has(id)) {
        self._removePublished(id);
      } else if (self._unpublishedBuffer.has(id)) {
        self._removeBuffered(id);
      }
    });
  },
  _handleDoc: function (id, newDoc) {
    var self = this;

    Meteor._noYieldsAllowed(function () {
      var matchesNow = newDoc && self._matcher.documentMatches(newDoc).result;

      var publishedBefore = self._published.has(id);

      var bufferedBefore = self._limit && self._unpublishedBuffer.has(id);

      var cachedBefore = publishedBefore || bufferedBefore;

      if (matchesNow && !cachedBefore) {
        self._addMatching(newDoc);
      } else if (cachedBefore && !matchesNow) {
        self._removeMatching(id);
      } else if (cachedBefore && matchesNow) {
        var oldDoc = self._published.get(id);

        var comparator = self._comparator;

        var minBuffered = self._limit && self._unpublishedBuffer.size() && self._unpublishedBuffer.get(self._unpublishedBuffer.minElementId());

        var maxBuffered;

        if (publishedBefore) {
          // Unlimited case where the document stays in published once it
          // matches or the case when we don't have enough matching docs to
          // publish or the changed but matching doc will stay in published
          // anyways.
          //
          // XXX: We rely on the emptiness of buffer. Be sure to maintain the
          // fact that buffer can't be empty if there are matching documents not
          // published. Notably, we don't want to schedule repoll and continue
          // relying on this property.
          var staysInPublished = !self._limit || self._unpublishedBuffer.size() === 0 || comparator(newDoc, minBuffered) <= 0;

          if (staysInPublished) {
            self._changePublished(id, oldDoc, newDoc);
          } else {
            // after the change doc doesn't stay in the published, remove it
            self._removePublished(id); // but it can move into buffered now, check it


            maxBuffered = self._unpublishedBuffer.get(self._unpublishedBuffer.maxElementId());
            var toBuffer = self._safeAppendToBuffer || maxBuffered && comparator(newDoc, maxBuffered) <= 0;

            if (toBuffer) {
              self._addBuffered(id, newDoc);
            } else {
              // Throw away from both published set and buffer
              self._safeAppendToBuffer = false;
            }
          }
        } else if (bufferedBefore) {
          oldDoc = self._unpublishedBuffer.get(id); // remove the old version manually instead of using _removeBuffered so
          // we don't trigger the querying immediately.  if we end this block
          // with the buffer empty, we will need to trigger the query poll
          // manually too.

          self._unpublishedBuffer.remove(id);

          var maxPublished = self._published.get(self._published.maxElementId());

          maxBuffered = self._unpublishedBuffer.size() && self._unpublishedBuffer.get(self._unpublishedBuffer.maxElementId()); // the buffered doc was updated, it could move to published

          var toPublish = comparator(newDoc, maxPublished) < 0; // or stays in buffer even after the change

          var staysInBuffer = !toPublish && self._safeAppendToBuffer || !toPublish && maxBuffered && comparator(newDoc, maxBuffered) <= 0;

          if (toPublish) {
            self._addPublished(id, newDoc);
          } else if (staysInBuffer) {
            // stays in buffer but changes
            self._unpublishedBuffer.set(id, newDoc);
          } else {
            // Throw away from both published set and buffer
            self._safeAppendToBuffer = false; // Normally this check would have been done in _removeBuffered but
            // we didn't use it, so we need to do it ourself now.

            if (!self._unpublishedBuffer.size()) {
              self._needToPollQuery();
            }
          }
        } else {
          throw new Error("cachedBefore implies either of publishedBefore or bufferedBefore is true.");
        }
      }
    });
  },
  _fetchModifiedDocuments: function () {
    var self = this;

    Meteor._noYieldsAllowed(function () {
      self._registerPhaseChange(PHASE.FETCHING); // Defer, because nothing called from the oplog entry handler may yield,
      // but fetch() yields.


      Meteor.defer(finishIfNeedToPollQuery(function () {
        while (!self._stopped && !self._needToFetch.empty()) {
          if (self._phase === PHASE.QUERYING) {
            // While fetching, we decided to go into QUERYING mode, and then we
            // saw another oplog entry, so _needToFetch is not empty. But we
            // shouldn't fetch these documents until AFTER the query is done.
            break;
          } // Being in steady phase here would be surprising.


          if (self._phase !== PHASE.FETCHING) throw new Error("phase in fetchModifiedDocuments: " + self._phase);
          self._currentlyFetching = self._needToFetch;
          var thisGeneration = ++self._fetchGeneration;
          self._needToFetch = new LocalCollection._IdMap();
          var waiting = 0;
          var fut = new Future(); // This loop is safe, because _currentlyFetching will not be updated
          // during this loop (in fact, it is never mutated).

          self._currentlyFetching.forEach(function (op, id) {
            waiting++;

            self._mongoHandle._docFetcher.fetch(self._cursorDescription.collectionName, id, op, finishIfNeedToPollQuery(function (err, doc) {
              try {
                if (err) {
                  Meteor._debug("Got exception while fetching documents", err); // If we get an error from the fetcher (eg, trouble
                  // connecting to Mongo), let's just abandon the fetch phase
                  // altogether and fall back to polling. It's not like we're
                  // getting live updates anyway.


                  if (self._phase !== PHASE.QUERYING) {
                    self._needToPollQuery();
                  }
                } else if (!self._stopped && self._phase === PHASE.FETCHING && self._fetchGeneration === thisGeneration) {
                  // We re-check the generation in case we've had an explicit
                  // _pollQuery call (eg, in another fiber) which should
                  // effectively cancel this round of fetches.  (_pollQuery
                  // increments the generation.)
                  self._handleDoc(id, doc);
                }
              } finally {
                waiting--; // Because fetch() never calls its callback synchronously,
                // this is safe (ie, we won't call fut.return() before the
                // forEach is done).

                if (waiting === 0) fut.return();
              }
            }));
          });

          fut.wait(); // Exit now if we've had a _pollQuery call (here or in another fiber).

          if (self._phase === PHASE.QUERYING) return;
          self._currentlyFetching = null;
        } // We're done fetching, so we can be steady, unless we've had a
        // _pollQuery call (here or in another fiber).


        if (self._phase !== PHASE.QUERYING) self._beSteady();
      }));
    });
  },
  _beSteady: function () {
    var self = this;

    Meteor._noYieldsAllowed(function () {
      self._registerPhaseChange(PHASE.STEADY);

      var writes = self._writesToCommitWhenWeReachSteady;
      self._writesToCommitWhenWeReachSteady = [];

      self._multiplexer.onFlush(function () {
        _.each(writes, function (w) {
          w.committed();
        });
      });
    });
  },
  _handleOplogEntryQuerying: function (op) {
    var self = this;

    Meteor._noYieldsAllowed(function () {
      self._needToFetch.set(idForOp(op), op);
    });
  },
  _handleOplogEntrySteadyOrFetching: function (op) {
    var self = this;

    Meteor._noYieldsAllowed(function () {
      var id = idForOp(op); // If we're already fetching this one, or about to, we can't optimize;
      // make sure that we fetch it again if necessary.

      if (self._phase === PHASE.FETCHING && (self._currentlyFetching && self._currentlyFetching.has(id) || self._needToFetch.has(id))) {
        self._needToFetch.set(id, op);

        return;
      }

      if (op.op === 'd') {
        if (self._published.has(id) || self._limit && self._unpublishedBuffer.has(id)) self._removeMatching(id);
      } else if (op.op === 'i') {
        if (self._published.has(id)) throw new Error("insert found for already-existing ID in published");
        if (self._unpublishedBuffer && self._unpublishedBuffer.has(id)) throw new Error("insert found for already-existing ID in buffer"); // XXX what if selector yields?  for now it can't but later it could
        // have $where

        if (self._matcher.documentMatches(op.o).result) self._addMatching(op.o);
      } else if (op.op === 'u') {
        // Is this a modifier ($set/$unset, which may require us to poll the
        // database to figure out if the whole document matches the selector) or
        // a replacement (in which case we can just directly re-evaluate the
        // selector)?
        var isReplace = !_.has(op.o, '$set') && !_.has(op.o, '$unset'); // If this modifier modifies something inside an EJSON custom type (ie,
        // anything with EJSON$), then we can't try to use
        // LocalCollection._modify, since that just mutates the EJSON encoding,
        // not the actual object.

        var canDirectlyModifyDoc = !isReplace && modifierCanBeDirectlyApplied(op.o);

        var publishedBefore = self._published.has(id);

        var bufferedBefore = self._limit && self._unpublishedBuffer.has(id);

        if (isReplace) {
          self._handleDoc(id, _.extend({
            _id: id
          }, op.o));
        } else if ((publishedBefore || bufferedBefore) && canDirectlyModifyDoc) {
          // Oh great, we actually know what the document is, so we can apply
          // this directly.
          var newDoc = self._published.has(id) ? self._published.get(id) : self._unpublishedBuffer.get(id);
          newDoc = EJSON.clone(newDoc);
          newDoc._id = id;

          try {
            LocalCollection._modify(newDoc, op.o);
          } catch (e) {
            if (e.name !== "MinimongoError") throw e; // We didn't understand the modifier.  Re-fetch.

            self._needToFetch.set(id, op);

            if (self._phase === PHASE.STEADY) {
              self._fetchModifiedDocuments();
            }

            return;
          }

          self._handleDoc(id, self._sharedProjectionFn(newDoc));
        } else if (!canDirectlyModifyDoc || self._matcher.canBecomeTrueByModifier(op.o) || self._sorter && self._sorter.affectedByModifier(op.o)) {
          self._needToFetch.set(id, op);

          if (self._phase === PHASE.STEADY) self._fetchModifiedDocuments();
        }
      } else {
        throw Error("XXX SURPRISING OPERATION: " + op);
      }
    });
  },
  // Yields!
  _runInitialQuery: function () {
    var self = this;
    if (self._stopped) throw new Error("oplog stopped surprisingly early");

    self._runQuery({
      initial: true
    }); // yields


    if (self._stopped) return; // can happen on queryError
    // Allow observeChanges calls to return. (After this, it's possible for
    // stop() to be called.)

    self._multiplexer.ready();

    self._doneQuerying(); // yields

  },
  // In various circumstances, we may just want to stop processing the oplog and
  // re-run the initial query, just as if we were a PollingObserveDriver.
  //
  // This function may not block, because it is called from an oplog entry
  // handler.
  //
  // XXX We should call this when we detect that we've been in FETCHING for "too
  // long".
  //
  // XXX We should call this when we detect Mongo failover (since that might
  // mean that some of the oplog entries we have processed have been rolled
  // back). The Node Mongo driver is in the middle of a bunch of huge
  // refactorings, including the way that it notifies you when primary
  // changes. Will put off implementing this until driver 1.4 is out.
  _pollQuery: function () {
    var self = this;

    Meteor._noYieldsAllowed(function () {
      if (self._stopped) return; // Yay, we get to forget about all the things we thought we had to fetch.

      self._needToFetch = new LocalCollection._IdMap();
      self._currentlyFetching = null;
      ++self._fetchGeneration; // ignore any in-flight fetches

      self._registerPhaseChange(PHASE.QUERYING); // Defer so that we don't yield.  We don't need finishIfNeedToPollQuery
      // here because SwitchedToQuery is not thrown in QUERYING mode.


      Meteor.defer(function () {
        self._runQuery();

        self._doneQuerying();
      });
    });
  },
  // Yields!
  _runQuery: function (options) {
    var self = this;
    options = options || {};
    var newResults, newBuffer; // This while loop is just to retry failures.

    while (true) {
      // If we've been stopped, we don't have to run anything any more.
      if (self._stopped) return;
      newResults = new LocalCollection._IdMap();
      newBuffer = new LocalCollection._IdMap(); // Query 2x documents as the half excluded from the original query will go
      // into unpublished buffer to reduce additional Mongo lookups in cases
      // when documents are removed from the published set and need a
      // replacement.
      // XXX needs more thought on non-zero skip
      // XXX 2 is a "magic number" meaning there is an extra chunk of docs for
      // buffer if such is needed.

      var cursor = self._cursorForQuery({
        limit: self._limit * 2
      });

      try {
        cursor.forEach(function (doc, i) {
          // yields
          if (!self._limit || i < self._limit) {
            newResults.set(doc._id, doc);
          } else {
            newBuffer.set(doc._id, doc);
          }
        });
        break;
      } catch (e) {
        if (options.initial && typeof e.code === 'number') {
          // This is an error document sent to us by mongod, not a connection
          // error generated by the client. And we've never seen this query work
          // successfully. Probably it's a bad selector or something, so we
          // should NOT retry. Instead, we should halt the observe (which ends
          // up calling `stop` on us).
          self._multiplexer.queryError(e);

          return;
        } // During failover (eg) if we get an exception we should log and retry
        // instead of crashing.


        Meteor._debug("Got exception while polling query", e);

        Meteor._sleepForMs(100);
      }
    }

    if (self._stopped) return;

    self._publishNewResults(newResults, newBuffer);
  },
  // Transitions to QUERYING and runs another query, or (if already in QUERYING)
  // ensures that we will query again later.
  //
  // This function may not block, because it is called from an oplog entry
  // handler. However, if we were not already in the QUERYING phase, it throws
  // an exception that is caught by the closest surrounding
  // finishIfNeedToPollQuery call; this ensures that we don't continue running
  // close that was designed for another phase inside PHASE.QUERYING.
  //
  // (It's also necessary whenever logic in this file yields to check that other
  // phases haven't put us into QUERYING mode, though; eg,
  // _fetchModifiedDocuments does this.)
  _needToPollQuery: function () {
    var self = this;

    Meteor._noYieldsAllowed(function () {
      if (self._stopped) return; // If we're not already in the middle of a query, we can query now
      // (possibly pausing FETCHING).

      if (self._phase !== PHASE.QUERYING) {
        self._pollQuery();

        throw new SwitchedToQuery();
      } // We're currently in QUERYING. Set a flag to ensure that we run another
      // query when we're done.


      self._requeryWhenDoneThisQuery = true;
    });
  },
  // Yields!
  _doneQuerying: function () {
    var self = this;
    if (self._stopped) return;

    self._mongoHandle._oplogHandle.waitUntilCaughtUp(); // yields


    if (self._stopped) return;
    if (self._phase !== PHASE.QUERYING) throw Error("Phase unexpectedly " + self._phase);

    Meteor._noYieldsAllowed(function () {
      if (self._requeryWhenDoneThisQuery) {
        self._requeryWhenDoneThisQuery = false;

        self._pollQuery();
      } else if (self._needToFetch.empty()) {
        self._beSteady();
      } else {
        self._fetchModifiedDocuments();
      }
    });
  },
  _cursorForQuery: function (optionsOverwrite) {
    var self = this;
    return Meteor._noYieldsAllowed(function () {
      // The query we run is almost the same as the cursor we are observing,
      // with a few changes. We need to read all the fields that are relevant to
      // the selector, not just the fields we are going to publish (that's the
      // "shared" projection). And we don't want to apply any transform in the
      // cursor, because observeChanges shouldn't use the transform.
      var options = _.clone(self._cursorDescription.options); // Allow the caller to modify the options. Useful to specify different
      // skip and limit values.


      _.extend(options, optionsOverwrite);

      options.fields = self._sharedProjection;
      delete options.transform; // We are NOT deep cloning fields or selector here, which should be OK.

      var description = new CursorDescription(self._cursorDescription.collectionName, self._cursorDescription.selector, options);
      return new Cursor(self._mongoHandle, description);
    });
  },
  // Replace self._published with newResults (both are IdMaps), invoking observe
  // callbacks on the multiplexer.
  // Replace self._unpublishedBuffer with newBuffer.
  //
  // XXX This is very similar to LocalCollection._diffQueryUnorderedChanges. We
  // should really: (a) Unify IdMap and OrderedDict into Unordered/OrderedDict
  // (b) Rewrite diff.js to use these classes instead of arrays and objects.
  _publishNewResults: function (newResults, newBuffer) {
    var self = this;

    Meteor._noYieldsAllowed(function () {
      // If the query is limited and there is a buffer, shut down so it doesn't
      // stay in a way.
      if (self._limit) {
        self._unpublishedBuffer.clear();
      } // First remove anything that's gone. Be careful not to modify
      // self._published while iterating over it.


      var idsToRemove = [];

      self._published.forEach(function (doc, id) {
        if (!newResults.has(id)) idsToRemove.push(id);
      });

      _.each(idsToRemove, function (id) {
        self._removePublished(id);
      }); // Now do adds and changes.
      // If self has a buffer and limit, the new fetched result will be
      // limited correctly as the query has sort specifier.


      newResults.forEach(function (doc, id) {
        self._handleDoc(id, doc);
      }); // Sanity-check that everything we tried to put into _published ended up
      // there.
      // XXX if this is slow, remove it later

      if (self._published.size() !== newResults.size()) {
        console.error('The Mongo server and the Meteor query disagree on how ' + 'many documents match your query. Cursor description: ', self._cursorDescription);
        throw Error("The Mongo server and the Meteor query disagree on how " + "many documents match your query. Maybe it is hitting a Mongo " + "edge case? The query is: " + EJSON.stringify(self._cursorDescription.selector));
      }

      self._published.forEach(function (doc, id) {
        if (!newResults.has(id)) throw Error("_published has a doc that newResults doesn't; " + id);
      }); // Finally, replace the buffer


      newBuffer.forEach(function (doc, id) {
        self._addBuffered(id, doc);
      });
      self._safeAppendToBuffer = newBuffer.size() < self._limit;
    });
  },
  // This stop function is invoked from the onStop of the ObserveMultiplexer, so
  // it shouldn't actually be possible to call it until the multiplexer is
  // ready.
  //
  // It's important to check self._stopped after every call in this file that
  // can yield!
  stop: function () {
    var self = this;
    if (self._stopped) return;
    self._stopped = true;

    _.each(self._stopHandles, function (handle) {
      handle.stop();
    }); // Note: we *don't* use multiplexer.onFlush here because this stop
    // callback is actually invoked by the multiplexer itself when it has
    // determined that there are no handles left. So nothing is actually going
    // to get flushed (and it's probably not valid to call methods on the
    // dying multiplexer).


    _.each(self._writesToCommitWhenWeReachSteady, function (w) {
      w.committed(); // maybe yields?
    });

    self._writesToCommitWhenWeReachSteady = null; // Proactively drop references to potentially big things.

    self._published = null;
    self._unpublishedBuffer = null;
    self._needToFetch = null;
    self._currentlyFetching = null;
    self._oplogEntryHandle = null;
    self._listenersHandle = null;
    Package['facts-base'] && Package['facts-base'].Facts.incrementServerFact("mongo-livedata", "observe-drivers-oplog", -1);
  },
  _registerPhaseChange: function (phase) {
    var self = this;

    Meteor._noYieldsAllowed(function () {
      var now = new Date();

      if (self._phase) {
        var timeDiff = now - self._phaseStartTime;
        Package['facts-base'] && Package['facts-base'].Facts.incrementServerFact("mongo-livedata", "time-spent-in-" + self._phase + "-phase", timeDiff);
      }

      self._phase = phase;
      self._phaseStartTime = now;
    });
  }
}); // Does our oplog tailing code support this cursor? For now, we are being very
// conservative and allowing only simple queries with simple options.
// (This is a "static method".)


OplogObserveDriver.cursorSupported = function (cursorDescription, matcher) {
  // First, check the options.
  var options = cursorDescription.options; // Did the user say no explicitly?
  // underscored version of the option is COMPAT with 1.2

  if (options.disableOplog || options._disableOplog) return false; // skip is not supported: to support it we would need to keep track of all
  // "skipped" documents or at least their ids.
  // limit w/o a sort specifier is not supported: current implementation needs a
  // deterministic way to order documents.

  if (options.skip || options.limit && !options.sort) return false; // If a fields projection option is given check if it is supported by
  // minimongo (some operators are not supported).

  if (options.fields) {
    try {
      LocalCollection._checkSupportedProjection(options.fields);
    } catch (e) {
      if (e.name === "MinimongoError") {
        return false;
      } else {
        throw e;
      }
    }
  } // We don't allow the following selectors:
  //   - $where (not confident that we provide the same JS environment
  //             as Mongo, and can yield!)
  //   - $near (has "interesting" properties in MongoDB, like the possibility
  //            of returning an ID multiple times, though even polling maybe
  //            have a bug there)
  //           XXX: once we support it, we would need to think more on how we
  //           initialize the comparators when we create the driver.


  return !matcher.hasWhere() && !matcher.hasGeoQuery();
};

var modifierCanBeDirectlyApplied = function (modifier) {
  return _.all(modifier, function (fields, operation) {
    return _.all(fields, function (value, field) {
      return !/EJSON\$/.test(field);
    });
  });
};

MongoInternals.OplogObserveDriver = OplogObserveDriver;
/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

},"local_collection_driver.js":function module(require,exports,module){

/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
//                                                                                                                     //
// packages/mongo/local_collection_driver.js                                                                           //
//                                                                                                                     //
/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
                                                                                                                       //
module.export({
  LocalCollectionDriver: () => LocalCollectionDriver
});
const LocalCollectionDriver = new class LocalCollectionDriver {
  constructor() {
    this.noConnCollections = Object.create(null);
  }

  open(name, conn) {
    if (!name) {
      return new LocalCollection();
    }

    if (!conn) {
      return ensureCollection(name, this.noConnCollections);
    }

    if (!conn._mongo_livedata_collections) {
      conn._mongo_livedata_collections = Object.create(null);
    } // XXX is there a way to keep track of a connection's collections without
    // dangling it off the connection object?


    return ensureCollection(name, conn._mongo_livedata_collections);
  }

}();

function ensureCollection(name, collections) {
  return name in collections ? collections[name] : collections[name] = new LocalCollection(name);
}
/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

},"remote_collection_driver.js":function module(require){

/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
//                                                                                                                     //
// packages/mongo/remote_collection_driver.js                                                                          //
//                                                                                                                     //
/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
                                                                                                                       //
MongoInternals.RemoteCollectionDriver = function (mongo_url, options) {
  var self = this;
  self.mongo = new MongoConnection(mongo_url, options);
};

_.extend(MongoInternals.RemoteCollectionDriver.prototype, {
  open: function (name) {
    var self = this;
    var ret = {};

    _.each(['find', 'findOne', 'insert', 'update', 'upsert', 'remove', '_ensureIndex', '_dropIndex', '_createCappedCollection', 'dropCollection', 'rawCollection'], function (m) {
      ret[m] = _.bind(self.mongo[m], self.mongo, name);
    });

    return ret;
  }
}); // Create the singleton RemoteCollectionDriver only on demand, so we
// only require Mongo configuration if it's actually used (eg, not if
// you're only trying to receive data from a remote DDP server.)


MongoInternals.defaultRemoteCollectionDriver = _.once(function () {
  var connectionOptions = {};
  var mongoUrl = process.env.MONGO_URL;

  if (process.env.MONGO_OPLOG_URL) {
    connectionOptions.oplogUrl = process.env.MONGO_OPLOG_URL;
  }

  if (!mongoUrl) throw new Error("MONGO_URL must be set in environment");
  return new MongoInternals.RemoteCollectionDriver(mongoUrl, connectionOptions);
});
/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

},"collection.js":function module(require,exports,module){

/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
//                                                                                                                     //
// packages/mongo/collection.js                                                                                        //
//                                                                                                                     //
/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
                                                                                                                       //
!function (module1) {
  let _objectSpread;

  module1.link("@babel/runtime/helpers/objectSpread2", {
    default(v) {
      _objectSpread = v;
    }

  }, 0);
  // options.connection, if given, is a LivedataClient or LivedataServer
  // XXX presently there is no way to destroy/clean up a Collection

  /**
   * @summary Namespace for MongoDB-related items
   * @namespace
   */
  Mongo = {};
  /**
   * @summary Constructor for a Collection
   * @locus Anywhere
   * @instancename collection
   * @class
   * @param {String} name The name of the collection.  If null, creates an unmanaged (unsynchronized) local collection.
   * @param {Object} [options]
   * @param {Object} options.connection The server connection that will manage this collection. Uses the default connection if not specified.  Pass the return value of calling [`DDP.connect`](#ddp_connect) to specify a different server. Pass `null` to specify no connection. Unmanaged (`name` is null) collections cannot specify a connection.
   * @param {String} options.idGeneration The method of generating the `_id` fields of new documents in this collection.  Possible values:
  
   - **`'STRING'`**: random strings
   - **`'MONGO'`**:  random [`Mongo.ObjectID`](#mongo_object_id) values
  
  The default id generation technique is `'STRING'`.
   * @param {Function} options.transform An optional transformation function. Documents will be passed through this function before being returned from `fetch` or `findOne`, and before being passed to callbacks of `observe`, `map`, `forEach`, `allow`, and `deny`. Transforms are *not* applied for the callbacks of `observeChanges` or to cursors returned from publish functions.
   * @param {Boolean} options.defineMutationMethods Set to `false` to skip setting up the mutation methods that enable insert/update/remove from client code. Default `true`.
   */

  Mongo.Collection = function Collection(name, options) {
    if (!name && name !== null) {
      Meteor._debug("Warning: creating anonymous collection. It will not be " + "saved or synchronized over the network. (Pass null for " + "the collection name to turn off this warning.)");

      name = null;
    }

    if (name !== null && typeof name !== "string") {
      throw new Error("First argument to new Mongo.Collection must be a string or null");
    }

    if (options && options.methods) {
      // Backwards compatibility hack with original signature (which passed
      // "connection" directly instead of in options. (Connections must have a "methods"
      // method.)
      // XXX remove before 1.0
      options = {
        connection: options
      };
    } // Backwards compatibility: "connection" used to be called "manager".


    if (options && options.manager && !options.connection) {
      options.connection = options.manager;
    }

    options = _objectSpread({
      connection: undefined,
      idGeneration: 'STRING',
      transform: null,
      _driver: undefined,
      _preventAutopublish: false
    }, options);

    switch (options.idGeneration) {
      case 'MONGO':
        this._makeNewID = function () {
          var src = name ? DDP.randomStream('/collection/' + name) : Random.insecure;
          return new Mongo.ObjectID(src.hexString(24));
        };

        break;

      case 'STRING':
      default:
        this._makeNewID = function () {
          var src = name ? DDP.randomStream('/collection/' + name) : Random.insecure;
          return src.id();
        };

        break;
    }

    this._transform = LocalCollection.wrapTransform(options.transform);
    if (!name || options.connection === null) // note: nameless collections never have a connection
      this._connection = null;else if (options.connection) this._connection = options.connection;else if (Meteor.isClient) this._connection = Meteor.connection;else this._connection = Meteor.server;

    if (!options._driver) {
      // XXX This check assumes that webapp is loaded so that Meteor.server !==
      // null. We should fully support the case of "want to use a Mongo-backed
      // collection from Node code without webapp", but we don't yet.
      // #MeteorServerNull
      if (name && this._connection === Meteor.server && typeof MongoInternals !== "undefined" && MongoInternals.defaultRemoteCollectionDriver) {
        options._driver = MongoInternals.defaultRemoteCollectionDriver();
      } else {
        const {
          LocalCollectionDriver
        } = require("./local_collection_driver.js");

        options._driver = LocalCollectionDriver;
      }
    }

    this._collection = options._driver.open(name, this._connection);
    this._name = name;
    this._driver = options._driver;

    this._maybeSetUpReplication(name, options); // XXX don't define these until allow or deny is actually used for this
    // collection. Could be hard if the security rules are only defined on the
    // server.


    if (options.defineMutationMethods !== false) {
      try {
        this._defineMutationMethods({
          useExisting: options._suppressSameNameError === true
        });
      } catch (error) {
        // Throw a more understandable error on the server for same collection name
        if (error.message === "A method named '/".concat(name, "/insert' is already defined")) throw new Error("There is already a collection named \"".concat(name, "\""));
        throw error;
      }
    } // autopublish


    if (Package.autopublish && !options._preventAutopublish && this._connection && this._connection.publish) {
      this._connection.publish(null, () => this.find(), {
        is_auto: true
      });
    }
  };

  Object.assign(Mongo.Collection.prototype, {
    _maybeSetUpReplication(name, _ref) {
      let {
        _suppressSameNameError = false
      } = _ref;
      const self = this;

      if (!(self._connection && self._connection.registerStore)) {
        return;
      } // OK, we're going to be a slave, replicating some remote
      // database, except possibly with some temporary divergence while
      // we have unacknowledged RPC's.


      const ok = self._connection.registerStore(name, {
        // Called at the beginning of a batch of updates. batchSize is the number
        // of update calls to expect.
        //
        // XXX This interface is pretty janky. reset probably ought to go back to
        // being its own function, and callers shouldn't have to calculate
        // batchSize. The optimization of not calling pause/remove should be
        // delayed until later: the first call to update() should buffer its
        // message, and then we can either directly apply it at endUpdate time if
        // it was the only update, or do pauseObservers/apply/apply at the next
        // update() if there's another one.
        beginUpdate(batchSize, reset) {
          // pause observers so users don't see flicker when updating several
          // objects at once (including the post-reconnect reset-and-reapply
          // stage), and so that a re-sorting of a query can take advantage of the
          // full _diffQuery moved calculation instead of applying change one at a
          // time.
          if (batchSize > 1 || reset) self._collection.pauseObservers();
          if (reset) self._collection.remove({});
        },

        // Apply an update.
        // XXX better specify this interface (not in terms of a wire message)?
        update(msg) {
          var mongoId = MongoID.idParse(msg.id);

          var doc = self._collection._docs.get(mongoId); // Is this a "replace the whole doc" message coming from the quiescence
          // of method writes to an object? (Note that 'undefined' is a valid
          // value meaning "remove it".)


          if (msg.msg === 'replace') {
            var replace = msg.replace;

            if (!replace) {
              if (doc) self._collection.remove(mongoId);
            } else if (!doc) {
              self._collection.insert(replace);
            } else {
              // XXX check that replace has no $ ops
              self._collection.update(mongoId, replace);
            }

            return;
          } else if (msg.msg === 'added') {
            if (doc) {
              throw new Error("Expected not to find a document already present for an add");
            }

            self._collection.insert(_objectSpread({
              _id: mongoId
            }, msg.fields));
          } else if (msg.msg === 'removed') {
            if (!doc) throw new Error("Expected to find a document already present for removed");

            self._collection.remove(mongoId);
          } else if (msg.msg === 'changed') {
            if (!doc) throw new Error("Expected to find a document to change");
            const keys = Object.keys(msg.fields);

            if (keys.length > 0) {
              var modifier = {};
              keys.forEach(key => {
                const value = msg.fields[key];

                if (EJSON.equals(doc[key], value)) {
                  return;
                }

                if (typeof value === "undefined") {
                  if (!modifier.$unset) {
                    modifier.$unset = {};
                  }

                  modifier.$unset[key] = 1;
                } else {
                  if (!modifier.$set) {
                    modifier.$set = {};
                  }

                  modifier.$set[key] = value;
                }
              });

              if (Object.keys(modifier).length > 0) {
                self._collection.update(mongoId, modifier);
              }
            }
          } else {
            throw new Error("I don't know how to deal with this message");
          }
        },

        // Called at the end of a batch of updates.
        endUpdate() {
          self._collection.resumeObservers();
        },

        // Called around method stub invocations to capture the original versions
        // of modified documents.
        saveOriginals() {
          self._collection.saveOriginals();
        },

        retrieveOriginals() {
          return self._collection.retrieveOriginals();
        },

        // Used to preserve current versions of documents across a store reset.
        getDoc(id) {
          return self.findOne(id);
        },

        // To be able to get back to the collection from the store.
        _getCollection() {
          return self;
        }

      });

      if (!ok) {
        const message = "There is already a collection named \"".concat(name, "\"");

        if (_suppressSameNameError === true) {
          // XXX In theory we do not have to throw when `ok` is falsy. The
          // store is already defined for this collection name, but this
          // will simply be another reference to it and everything should
          // work. However, we have historically thrown an error here, so
          // for now we will skip the error only when _suppressSameNameError
          // is `true`, allowing people to opt in and give this some real
          // world testing.
          console.warn ? console.warn(message) : console.log(message);
        } else {
          throw new Error(message);
        }
      }
    },

    ///
    /// Main collection API
    ///
    _getFindSelector(args) {
      if (args.length == 0) return {};else return args[0];
    },

    _getFindOptions(args) {
      var self = this;

      if (args.length < 2) {
        return {
          transform: self._transform
        };
      } else {
        check(args[1], Match.Optional(Match.ObjectIncluding({
          fields: Match.Optional(Match.OneOf(Object, undefined)),
          sort: Match.Optional(Match.OneOf(Object, Array, Function, undefined)),
          limit: Match.Optional(Match.OneOf(Number, undefined)),
          skip: Match.Optional(Match.OneOf(Number, undefined))
        })));
        return _objectSpread({
          transform: self._transform
        }, args[1]);
      }
    },

    /**
     * @summary Find the documents in a collection that match the selector.
     * @locus Anywhere
     * @method find
     * @memberof Mongo.Collection
     * @instance
     * @param {MongoSelector} [selector] A query describing the documents to find
     * @param {Object} [options]
     * @param {MongoSortSpecifier} options.sort Sort order (default: natural order)
     * @param {Number} options.skip Number of results to skip at the beginning
     * @param {Number} options.limit Maximum number of results to return
     * @param {MongoFieldSpecifier} options.fields Dictionary of fields to return or exclude.
     * @param {Boolean} options.reactive (Client only) Default `true`; pass `false` to disable reactivity
     * @param {Function} options.transform Overrides `transform` on the  [`Collection`](#collections) for this cursor.  Pass `null` to disable transformation.
     * @param {Boolean} options.disableOplog (Server only) Pass true to disable oplog-tailing on this query. This affects the way server processes calls to `observe` on this query. Disabling the oplog can be useful when working with data that updates in large batches.
     * @param {Number} options.pollingIntervalMs (Server only) When oplog is disabled (through the use of `disableOplog` or when otherwise not available), the frequency (in milliseconds) of how often to poll this query when observing on the server. Defaults to 10000ms (10 seconds).
     * @param {Number} options.pollingThrottleMs (Server only) When oplog is disabled (through the use of `disableOplog` or when otherwise not available), the minimum time (in milliseconds) to allow between re-polling when observing on the server. Increasing this will save CPU and mongo load at the expense of slower updates to users. Decreasing this is not recommended. Defaults to 50ms.
     * @param {Number} options.maxTimeMs (Server only) If set, instructs MongoDB to set a time limit for this cursor's operations. If the operation reaches the specified time limit (in milliseconds) without the having been completed, an exception will be thrown. Useful to prevent an (accidental or malicious) unoptimized query from causing a full collection scan that would disrupt other database users, at the expense of needing to handle the resulting error.
     * @param {String|Object} options.hint (Server only) Overrides MongoDB's default index selection and query optimization process. Specify an index to force its use, either by its name or index specification. You can also specify `{ $natural : 1 }` to force a forwards collection scan, or `{ $natural : -1 }` for a reverse collection scan. Setting this is only recommended for advanced users.
     * @returns {Mongo.Cursor}
     */
    find() {
      for (var _len = arguments.length, args = new Array(_len), _key = 0; _key < _len; _key++) {
        args[_key] = arguments[_key];
      }

      // Collection.find() (return all docs) behaves differently
      // from Collection.find(undefined) (return 0 docs).  so be
      // careful about the length of arguments.
      return this._collection.find(this._getFindSelector(args), this._getFindOptions(args));
    },

    /**
     * @summary Finds the first document that matches the selector, as ordered by sort and skip options. Returns `undefined` if no matching document is found.
     * @locus Anywhere
     * @method findOne
     * @memberof Mongo.Collection
     * @instance
     * @param {MongoSelector} [selector] A query describing the documents to find
     * @param {Object} [options]
     * @param {MongoSortSpecifier} options.sort Sort order (default: natural order)
     * @param {Number} options.skip Number of results to skip at the beginning
     * @param {MongoFieldSpecifier} options.fields Dictionary of fields to return or exclude.
     * @param {Boolean} options.reactive (Client only) Default true; pass false to disable reactivity
     * @param {Function} options.transform Overrides `transform` on the [`Collection`](#collections) for this cursor.  Pass `null` to disable transformation.
     * @returns {Object}
     */
    findOne() {
      for (var _len2 = arguments.length, args = new Array(_len2), _key2 = 0; _key2 < _len2; _key2++) {
        args[_key2] = arguments[_key2];
      }

      return this._collection.findOne(this._getFindSelector(args), this._getFindOptions(args));
    }

  });
  Object.assign(Mongo.Collection, {
    _publishCursor(cursor, sub, collection) {
      var observeHandle = cursor.observeChanges({
        added: function (id, fields) {
          sub.added(collection, id, fields);
        },
        changed: function (id, fields) {
          sub.changed(collection, id, fields);
        },
        removed: function (id) {
          sub.removed(collection, id);
        }
      }, // Publications don't mutate the documents
      // This is tested by the `livedata - publish callbacks clone` test
      {
        nonMutatingCallbacks: true
      }); // We don't call sub.ready() here: it gets called in livedata_server, after
      // possibly calling _publishCursor on multiple returned cursors.
      // register stop callback (expects lambda w/ no args).

      sub.onStop(function () {
        observeHandle.stop();
      }); // return the observeHandle in case it needs to be stopped early

      return observeHandle;
    },

    // protect against dangerous selectors.  falsey and {_id: falsey} are both
    // likely programmer error, and not what you want, particularly for destructive
    // operations. If a falsey _id is sent in, a new string _id will be
    // generated and returned; if a fallbackId is provided, it will be returned
    // instead.
    _rewriteSelector(selector) {
      let {
        fallbackId
      } = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : {};
      // shorthand -- scalars match _id
      if (LocalCollection._selectorIsId(selector)) selector = {
        _id: selector
      };

      if (Array.isArray(selector)) {
        // This is consistent with the Mongo console itself; if we don't do this
        // check passing an empty array ends up selecting all items
        throw new Error("Mongo selector can't be an array.");
      }

      if (!selector || '_id' in selector && !selector._id) {
        // can't match anything
        return {
          _id: fallbackId || Random.id()
        };
      }

      return selector;
    }

  });
  Object.assign(Mongo.Collection.prototype, {
    // 'insert' immediately returns the inserted document's new _id.
    // The others return values immediately if you are in a stub, an in-memory
    // unmanaged collection, or a mongo-backed collection and you don't pass a
    // callback. 'update' and 'remove' return the number of affected
    // documents. 'upsert' returns an object with keys 'numberAffected' and, if an
    // insert happened, 'insertedId'.
    //
    // Otherwise, the semantics are exactly like other methods: they take
    // a callback as an optional last argument; if no callback is
    // provided, they block until the operation is complete, and throw an
    // exception if it fails; if a callback is provided, then they don't
    // necessarily block, and they call the callback when they finish with error and
    // result arguments.  (The insert method provides the document ID as its result;
    // update and remove provide the number of affected docs as the result; upsert
    // provides an object with numberAffected and maybe insertedId.)
    //
    // On the client, blocking is impossible, so if a callback
    // isn't provided, they just return immediately and any error
    // information is lost.
    //
    // There's one more tweak. On the client, if you don't provide a
    // callback, then if there is an error, a message will be logged with
    // Meteor._debug.
    //
    // The intent (though this is actually determined by the underlying
    // drivers) is that the operations should be done synchronously, not
    // generating their result until the database has acknowledged
    // them. In the future maybe we should provide a flag to turn this
    // off.

    /**
     * @summary Insert a document in the collection.  Returns its unique _id.
     * @locus Anywhere
     * @method  insert
     * @memberof Mongo.Collection
     * @instance
     * @param {Object} doc The document to insert. May not yet have an _id attribute, in which case Meteor will generate one for you.
     * @param {Function} [callback] Optional.  If present, called with an error object as the first argument and, if no error, the _id as the second.
     */
    insert(doc, callback) {
      // Make sure we were passed a document to insert
      if (!doc) {
        throw new Error("insert requires an argument");
      } // Make a shallow clone of the document, preserving its prototype.


      doc = Object.create(Object.getPrototypeOf(doc), Object.getOwnPropertyDescriptors(doc));

      if ('_id' in doc) {
        if (!doc._id || !(typeof doc._id === 'string' || doc._id instanceof Mongo.ObjectID)) {
          throw new Error("Meteor requires document _id fields to be non-empty strings or ObjectIDs");
        }
      } else {
        let generateId = true; // Don't generate the id if we're the client and the 'outermost' call
        // This optimization saves us passing both the randomSeed and the id
        // Passing both is redundant.

        if (this._isRemoteCollection()) {
          const enclosing = DDP._CurrentMethodInvocation.get();

          if (!enclosing) {
            generateId = false;
          }
        }

        if (generateId) {
          doc._id = this._makeNewID();
        }
      } // On inserts, always return the id that we generated; on all other
      // operations, just return the result from the collection.


      var chooseReturnValueFromCollectionResult = function (result) {
        if (doc._id) {
          return doc._id;
        } // XXX what is this for??
        // It's some iteraction between the callback to _callMutatorMethod and
        // the return value conversion


        doc._id = result;
        return result;
      };

      const wrappedCallback = wrapCallback(callback, chooseReturnValueFromCollectionResult);

      if (this._isRemoteCollection()) {
        const result = this._callMutatorMethod("insert", [doc], wrappedCallback);

        return chooseReturnValueFromCollectionResult(result);
      } // it's my collection.  descend into the collection object
      // and propagate any exception.


      try {
        // If the user provided a callback and the collection implements this
        // operation asynchronously, then queryRet will be undefined, and the
        // result will be returned through the callback instead.
        const result = this._collection.insert(doc, wrappedCallback);

        return chooseReturnValueFromCollectionResult(result);
      } catch (e) {
        if (callback) {
          callback(e);
          return null;
        }

        throw e;
      }
    },

    /**
     * @summary Modify one or more documents in the collection. Returns the number of matched documents.
     * @locus Anywhere
     * @method update
     * @memberof Mongo.Collection
     * @instance
     * @param {MongoSelector} selector Specifies which documents to modify
     * @param {MongoModifier} modifier Specifies how to modify the documents
     * @param {Object} [options]
     * @param {Boolean} options.multi True to modify all matching documents; false to only modify one of the matching documents (the default).
     * @param {Boolean} options.upsert True to insert a document if no matching documents are found.
     * @param {Function} [callback] Optional.  If present, called with an error object as the first argument and, if no error, the number of affected documents as the second.
     */
    update(selector, modifier) {
      for (var _len3 = arguments.length, optionsAndCallback = new Array(_len3 > 2 ? _len3 - 2 : 0), _key3 = 2; _key3 < _len3; _key3++) {
        optionsAndCallback[_key3 - 2] = arguments[_key3];
      }

      const callback = popCallbackFromArgs(optionsAndCallback); // We've already popped off the callback, so we are left with an array
      // of one or zero items

      const options = _objectSpread({}, optionsAndCallback[0] || null);

      let insertedId;

      if (options && options.upsert) {
        // set `insertedId` if absent.  `insertedId` is a Meteor extension.
        if (options.insertedId) {
          if (!(typeof options.insertedId === 'string' || options.insertedId instanceof Mongo.ObjectID)) throw new Error("insertedId must be string or ObjectID");
          insertedId = options.insertedId;
        } else if (!selector || !selector._id) {
          insertedId = this._makeNewID();
          options.generatedId = true;
          options.insertedId = insertedId;
        }
      }

      selector = Mongo.Collection._rewriteSelector(selector, {
        fallbackId: insertedId
      });
      const wrappedCallback = wrapCallback(callback);

      if (this._isRemoteCollection()) {
        const args = [selector, modifier, options];
        return this._callMutatorMethod("update", args, wrappedCallback);
      } // it's my collection.  descend into the collection object
      // and propagate any exception.


      try {
        // If the user provided a callback and the collection implements this
        // operation asynchronously, then queryRet will be undefined, and the
        // result will be returned through the callback instead.
        return this._collection.update(selector, modifier, options, wrappedCallback);
      } catch (e) {
        if (callback) {
          callback(e);
          return null;
        }

        throw e;
      }
    },

    /**
     * @summary Remove documents from the collection
     * @locus Anywhere
     * @method remove
     * @memberof Mongo.Collection
     * @instance
     * @param {MongoSelector} selector Specifies which documents to remove
     * @param {Function} [callback] Optional.  If present, called with an error object as its argument.
     */
    remove(selector, callback) {
      selector = Mongo.Collection._rewriteSelector(selector);
      const wrappedCallback = wrapCallback(callback);

      if (this._isRemoteCollection()) {
        return this._callMutatorMethod("remove", [selector], wrappedCallback);
      } // it's my collection.  descend into the collection object
      // and propagate any exception.


      try {
        // If the user provided a callback and the collection implements this
        // operation asynchronously, then queryRet will be undefined, and the
        // result will be returned through the callback instead.
        return this._collection.remove(selector, wrappedCallback);
      } catch (e) {
        if (callback) {
          callback(e);
          return null;
        }

        throw e;
      }
    },

    // Determine if this collection is simply a minimongo representation of a real
    // database on another server
    _isRemoteCollection() {
      // XXX see #MeteorServerNull
      return this._connection && this._connection !== Meteor.server;
    },

    /**
     * @summary Modify one or more documents in the collection, or insert one if no matching documents were found. Returns an object with keys `numberAffected` (the number of documents modified)  and `insertedId` (the unique _id of the document that was inserted, if any).
     * @locus Anywhere
     * @method upsert
     * @memberof Mongo.Collection
     * @instance
     * @param {MongoSelector} selector Specifies which documents to modify
     * @param {MongoModifier} modifier Specifies how to modify the documents
     * @param {Object} [options]
     * @param {Boolean} options.multi True to modify all matching documents; false to only modify one of the matching documents (the default).
     * @param {Function} [callback] Optional.  If present, called with an error object as the first argument and, if no error, the number of affected documents as the second.
     */
    upsert(selector, modifier, options, callback) {
      if (!callback && typeof options === "function") {
        callback = options;
        options = {};
      }

      return this.update(selector, modifier, _objectSpread({}, options, {
        _returnObject: true,
        upsert: true
      }), callback);
    },

    // We'll actually design an index API later. For now, we just pass through to
    // Mongo's, but make it synchronous.
    _ensureIndex(index, options) {
      var self = this;
      if (!self._collection._ensureIndex) throw new Error("Can only call _ensureIndex on server collections");

      self._collection._ensureIndex(index, options);
    },

    _dropIndex(index) {
      var self = this;
      if (!self._collection._dropIndex) throw new Error("Can only call _dropIndex on server collections");

      self._collection._dropIndex(index);
    },

    _dropCollection() {
      var self = this;
      if (!self._collection.dropCollection) throw new Error("Can only call _dropCollection on server collections");

      self._collection.dropCollection();
    },

    _createCappedCollection(byteSize, maxDocuments) {
      var self = this;
      if (!self._collection._createCappedCollection) throw new Error("Can only call _createCappedCollection on server collections");

      self._collection._createCappedCollection(byteSize, maxDocuments);
    },

    /**
     * @summary Returns the [`Collection`](http://mongodb.github.io/node-mongodb-native/3.0/api/Collection.html) object corresponding to this collection from the [npm `mongodb` driver module](https://www.npmjs.com/package/mongodb) which is wrapped by `Mongo.Collection`.
     * @locus Server
     * @memberof Mongo.Collection
     * @instance
     */
    rawCollection() {
      var self = this;

      if (!self._collection.rawCollection) {
        throw new Error("Can only call rawCollection on server collections");
      }

      return self._collection.rawCollection();
    },

    /**
     * @summary Returns the [`Db`](http://mongodb.github.io/node-mongodb-native/3.0/api/Db.html) object corresponding to this collection's database connection from the [npm `mongodb` driver module](https://www.npmjs.com/package/mongodb) which is wrapped by `Mongo.Collection`.
     * @locus Server
     * @memberof Mongo.Collection
     * @instance
     */
    rawDatabase() {
      var self = this;

      if (!(self._driver.mongo && self._driver.mongo.db)) {
        throw new Error("Can only call rawDatabase on server collections");
      }

      return self._driver.mongo.db;
    }

  }); // Convert the callback to not return a result if there is an error

  function wrapCallback(callback, convertResult) {
    return callback && function (error, result) {
      if (error) {
        callback(error);
      } else if (typeof convertResult === "function") {
        callback(error, convertResult(result));
      } else {
        callback(error, result);
      }
    };
  }
  /**
   * @summary Create a Mongo-style `ObjectID`.  If you don't specify a `hexString`, the `ObjectID` will generated randomly (not using MongoDB's ID construction rules).
   * @locus Anywhere
   * @class
   * @param {String} [hexString] Optional.  The 24-character hexadecimal contents of the ObjectID to create
   */


  Mongo.ObjectID = MongoID.ObjectID;
  /**
   * @summary To create a cursor, use find. To access the documents in a cursor, use forEach, map, or fetch.
   * @class
   * @instanceName cursor
   */

  Mongo.Cursor = LocalCollection.Cursor;
  /**
   * @deprecated in 0.9.1
   */

  Mongo.Collection.Cursor = Mongo.Cursor;
  /**
   * @deprecated in 0.9.1
   */

  Mongo.Collection.ObjectID = Mongo.ObjectID;
  /**
   * @deprecated in 0.9.1
   */

  Meteor.Collection = Mongo.Collection; // Allow deny stuff is now in the allow-deny package

  Object.assign(Meteor.Collection.prototype, AllowDeny.CollectionPrototype);

  function popCallbackFromArgs(args) {
    // Pull off any callback (or perhaps a 'callback' variable that was passed
    // in undefined, like how 'upsert' does it).
    if (args.length && (args[args.length - 1] === undefined || args[args.length - 1] instanceof Function)) {
      return args.pop();
    }
  }
}.call(this, module);
/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

},"connection_options.js":function module(){

/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
//                                                                                                                     //
// packages/mongo/connection_options.js                                                                                //
//                                                                                                                     //
/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
                                                                                                                       //
/**
 * @summary Allows for user specified connection options
 * @example http://mongodb.github.io/node-mongodb-native/3.0/reference/connecting/connection-settings/
 * @locus Server
 * @param {Object} options User specified Mongo connection options
 */
Mongo.setConnectionOptions = function setConnectionOptions(options) {
  check(options, Object);
  Mongo._connectionOptions = options;
};
/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

}}}}},{
  "extensions": [
    ".js",
    ".json"
  ]
});

require("/node_modules/meteor/mongo/mongo_driver.js");
require("/node_modules/meteor/mongo/oplog_tailing.js");
require("/node_modules/meteor/mongo/observe_multiplex.js");
require("/node_modules/meteor/mongo/doc_fetcher.js");
require("/node_modules/meteor/mongo/polling_observe_driver.js");
require("/node_modules/meteor/mongo/oplog_observe_driver.js");
require("/node_modules/meteor/mongo/local_collection_driver.js");
require("/node_modules/meteor/mongo/remote_collection_driver.js");
require("/node_modules/meteor/mongo/collection.js");
require("/node_modules/meteor/mongo/connection_options.js");

/* Exports */
Package._define("mongo", {
  MongoInternals: MongoInternals,
  Mongo: Mongo,
  ObserveMultiplexer: ObserveMultiplexer
});

})();

//# sourceURL=meteor://💻app/packages/mongo.js
//# sourceMappingURL=data:application/json;charset=utf8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIm1ldGVvcjovL/CfkrthcHAvcGFja2FnZXMvbW9uZ28vbW9uZ29fZHJpdmVyLmpzIiwibWV0ZW9yOi8v8J+Su2FwcC9wYWNrYWdlcy9tb25nby9vcGxvZ190YWlsaW5nLmpzIiwibWV0ZW9yOi8v8J+Su2FwcC9wYWNrYWdlcy9tb25nby9vYnNlcnZlX211bHRpcGxleC5qcyIsIm1ldGVvcjovL/CfkrthcHAvcGFja2FnZXMvbW9uZ28vZG9jX2ZldGNoZXIuanMiLCJtZXRlb3I6Ly/wn5K7YXBwL3BhY2thZ2VzL21vbmdvL3BvbGxpbmdfb2JzZXJ2ZV9kcml2ZXIuanMiLCJtZXRlb3I6Ly/wn5K7YXBwL3BhY2thZ2VzL21vbmdvL29wbG9nX29ic2VydmVfZHJpdmVyLmpzIiwibWV0ZW9yOi8v8J+Su2FwcC9wYWNrYWdlcy9tb25nby9sb2NhbF9jb2xsZWN0aW9uX2RyaXZlci5qcyIsIm1ldGVvcjovL/CfkrthcHAvcGFja2FnZXMvbW9uZ28vcmVtb3RlX2NvbGxlY3Rpb25fZHJpdmVyLmpzIiwibWV0ZW9yOi8v8J+Su2FwcC9wYWNrYWdlcy9tb25nby9jb2xsZWN0aW9uLmpzIiwibWV0ZW9yOi8v8J+Su2FwcC9wYWNrYWdlcy9tb25nby9jb25uZWN0aW9uX29wdGlvbnMuanMiXSwibmFtZXMiOlsiX29iamVjdFNwcmVhZCIsIm1vZHVsZTEiLCJsaW5rIiwiZGVmYXVsdCIsInYiLCJEb2NGZXRjaGVyIiwicGF0aCIsInJlcXVpcmUiLCJNb25nb0RCIiwiTnBtTW9kdWxlTW9uZ29kYiIsIkZ1dHVyZSIsIk5wbSIsIk1vbmdvSW50ZXJuYWxzIiwiTnBtTW9kdWxlcyIsIm1vbmdvZGIiLCJ2ZXJzaW9uIiwiTnBtTW9kdWxlTW9uZ29kYlZlcnNpb24iLCJtb2R1bGUiLCJOcG1Nb2R1bGUiLCJGSUxFX0FTU0VUX1NVRkZJWCIsIkFTU0VUU19GT0xERVIiLCJBUFBfRk9MREVSIiwicmVwbGFjZU5hbWVzIiwiZmlsdGVyIiwidGhpbmciLCJfIiwiaXNBcnJheSIsIm1hcCIsImJpbmQiLCJyZXQiLCJlYWNoIiwidmFsdWUiLCJrZXkiLCJUaW1lc3RhbXAiLCJwcm90b3R5cGUiLCJjbG9uZSIsIm1ha2VNb25nb0xlZ2FsIiwibmFtZSIsInVubWFrZU1vbmdvTGVnYWwiLCJzdWJzdHIiLCJyZXBsYWNlTW9uZ29BdG9tV2l0aE1ldGVvciIsImRvY3VtZW50IiwiQmluYXJ5IiwiYnVmZmVyIiwiVWludDhBcnJheSIsIk9iamVjdElEIiwiTW9uZ28iLCJ0b0hleFN0cmluZyIsIkRlY2ltYWwxMjgiLCJEZWNpbWFsIiwidG9TdHJpbmciLCJzaXplIiwiRUpTT04iLCJmcm9tSlNPTlZhbHVlIiwidW5kZWZpbmVkIiwicmVwbGFjZU1ldGVvckF0b21XaXRoTW9uZ28iLCJpc0JpbmFyeSIsIkJ1ZmZlciIsImZyb20iLCJmcm9tU3RyaW5nIiwiX2lzQ3VzdG9tVHlwZSIsInRvSlNPTlZhbHVlIiwicmVwbGFjZVR5cGVzIiwiYXRvbVRyYW5zZm9ybWVyIiwicmVwbGFjZWRUb3BMZXZlbEF0b20iLCJ2YWwiLCJ2YWxSZXBsYWNlZCIsIk1vbmdvQ29ubmVjdGlvbiIsInVybCIsIm9wdGlvbnMiLCJzZWxmIiwiX29ic2VydmVNdWx0aXBsZXhlcnMiLCJfb25GYWlsb3Zlckhvb2siLCJIb29rIiwidXNlck9wdGlvbnMiLCJfY29ubmVjdGlvbk9wdGlvbnMiLCJNZXRlb3IiLCJzZXR0aW5ncyIsInBhY2thZ2VzIiwibW9uZ28iLCJtb25nb09wdGlvbnMiLCJPYmplY3QiLCJhc3NpZ24iLCJpZ25vcmVVbmRlZmluZWQiLCJ1c2VVbmlmaWVkVG9wb2xvZ3kiLCJhdXRvUmVjb25uZWN0IiwicmVjb25uZWN0VHJpZXMiLCJJbmZpbml0eSIsInRlc3QiLCJuYXRpdmVfcGFyc2VyIiwiaGFzIiwicG9vbFNpemUiLCJlbnRyaWVzIiwiZW5kc1dpdGgiLCJmb3JFYWNoIiwib3B0aW9uTmFtZSIsInJlcGxhY2UiLCJqb2luIiwiQXNzZXRzIiwiZ2V0U2VydmVyRGlyIiwiZGIiLCJfcHJpbWFyeSIsIl9vcGxvZ0hhbmRsZSIsIl9kb2NGZXRjaGVyIiwiY29ubmVjdEZ1dHVyZSIsImNvbm5lY3QiLCJiaW5kRW52aXJvbm1lbnQiLCJlcnIiLCJjbGllbnQiLCJzZXJ2ZXJDb25maWciLCJpc01hc3RlckRvYyIsInByaW1hcnkiLCJvbiIsImtpbmQiLCJkb2MiLCJjYWxsYmFjayIsIm1lIiwicmVzb2x2ZXIiLCJ3YWl0Iiwib3Bsb2dVcmwiLCJQYWNrYWdlIiwiT3Bsb2dIYW5kbGUiLCJkYXRhYmFzZU5hbWUiLCJjbG9zZSIsIkVycm9yIiwib3Bsb2dIYW5kbGUiLCJzdG9wIiwid3JhcCIsInJhd0NvbGxlY3Rpb24iLCJjb2xsZWN0aW9uTmFtZSIsImZ1dHVyZSIsImNvbGxlY3Rpb24iLCJfY3JlYXRlQ2FwcGVkQ29sbGVjdGlvbiIsImJ5dGVTaXplIiwibWF4RG9jdW1lbnRzIiwiY3JlYXRlQ29sbGVjdGlvbiIsImNhcHBlZCIsIm1heCIsIl9tYXliZUJlZ2luV3JpdGUiLCJmZW5jZSIsIkREUFNlcnZlciIsIl9DdXJyZW50V3JpdGVGZW5jZSIsImdldCIsImJlZ2luV3JpdGUiLCJjb21taXR0ZWQiLCJfb25GYWlsb3ZlciIsInJlZ2lzdGVyIiwid3JpdGVDYWxsYmFjayIsIndyaXRlIiwicmVmcmVzaCIsInJlc3VsdCIsInJlZnJlc2hFcnIiLCJiaW5kRW52aXJvbm1lbnRGb3JXcml0ZSIsIl9pbnNlcnQiLCJjb2xsZWN0aW9uX25hbWUiLCJzZW5kRXJyb3IiLCJlIiwiX2V4cGVjdGVkQnlUZXN0IiwiTG9jYWxDb2xsZWN0aW9uIiwiX2lzUGxhaW5PYmplY3QiLCJpZCIsIl9pZCIsImluc2VydCIsInNhZmUiLCJfcmVmcmVzaCIsInNlbGVjdG9yIiwicmVmcmVzaEtleSIsInNwZWNpZmljSWRzIiwiX2lkc01hdGNoZWRCeVNlbGVjdG9yIiwiZXh0ZW5kIiwiX3JlbW92ZSIsIndyYXBwZWRDYWxsYmFjayIsImRyaXZlclJlc3VsdCIsInRyYW5zZm9ybVJlc3VsdCIsIm51bWJlckFmZmVjdGVkIiwicmVtb3ZlIiwiX2Ryb3BDb2xsZWN0aW9uIiwiY2IiLCJkcm9wQ29sbGVjdGlvbiIsImRyb3AiLCJfZHJvcERhdGFiYXNlIiwiZHJvcERhdGFiYXNlIiwiX3VwZGF0ZSIsIm1vZCIsIkZ1bmN0aW9uIiwibW9uZ29PcHRzIiwiYXJyYXlGaWx0ZXJzIiwidXBzZXJ0IiwibXVsdGkiLCJmdWxsUmVzdWx0IiwibW9uZ29TZWxlY3RvciIsIm1vbmdvTW9kIiwiaXNNb2RpZnkiLCJfaXNNb2RpZmljYXRpb25Nb2QiLCJfZm9yYmlkUmVwbGFjZSIsImtub3duSWQiLCJuZXdEb2MiLCJfY3JlYXRlVXBzZXJ0RG9jdW1lbnQiLCJpbnNlcnRlZElkIiwiZ2VuZXJhdGVkSWQiLCJzaW11bGF0ZVVwc2VydFdpdGhJbnNlcnRlZElkIiwiZXJyb3IiLCJfcmV0dXJuT2JqZWN0IiwiaGFzT3duUHJvcGVydHkiLCIkc2V0T25JbnNlcnQiLCJ1cGRhdGUiLCJtZXRlb3JSZXN1bHQiLCJtb25nb1Jlc3VsdCIsInVwc2VydGVkIiwibGVuZ3RoIiwibiIsIk5VTV9PUFRJTUlTVElDX1RSSUVTIiwiX2lzQ2Fubm90Q2hhbmdlSWRFcnJvciIsImVycm1zZyIsImluZGV4T2YiLCJtb25nb09wdHNGb3JVcGRhdGUiLCJtb25nb09wdHNGb3JJbnNlcnQiLCJyZXBsYWNlbWVudFdpdGhJZCIsInRyaWVzIiwiZG9VcGRhdGUiLCJkb0NvbmRpdGlvbmFsSW5zZXJ0IiwibWV0aG9kIiwid3JhcEFzeW5jIiwiYXBwbHkiLCJhcmd1bWVudHMiLCJmaW5kIiwiQ3Vyc29yIiwiQ3Vyc29yRGVzY3JpcHRpb24iLCJmaW5kT25lIiwibGltaXQiLCJmZXRjaCIsIl9lbnN1cmVJbmRleCIsImluZGV4IiwiaW5kZXhOYW1lIiwiZW5zdXJlSW5kZXgiLCJfZHJvcEluZGV4IiwiZHJvcEluZGV4IiwiQ29sbGVjdGlvbiIsIl9yZXdyaXRlU2VsZWN0b3IiLCJjdXJzb3JEZXNjcmlwdGlvbiIsIl9tb25nbyIsIl9jdXJzb3JEZXNjcmlwdGlvbiIsIl9zeW5jaHJvbm91c0N1cnNvciIsIlN5bWJvbCIsIml0ZXJhdG9yIiwidGFpbGFibGUiLCJfY3JlYXRlU3luY2hyb25vdXNDdXJzb3IiLCJzZWxmRm9ySXRlcmF0aW9uIiwidXNlVHJhbnNmb3JtIiwicmV3aW5kIiwiZ2V0VHJhbnNmb3JtIiwidHJhbnNmb3JtIiwiX3B1Ymxpc2hDdXJzb3IiLCJzdWIiLCJfZ2V0Q29sbGVjdGlvbk5hbWUiLCJvYnNlcnZlIiwiY2FsbGJhY2tzIiwiX29ic2VydmVGcm9tT2JzZXJ2ZUNoYW5nZXMiLCJvYnNlcnZlQ2hhbmdlcyIsIm1ldGhvZHMiLCJvcmRlcmVkIiwiX29ic2VydmVDaGFuZ2VzQ2FsbGJhY2tzQXJlT3JkZXJlZCIsImV4Y2VwdGlvbk5hbWUiLCJfZnJvbU9ic2VydmUiLCJfb2JzZXJ2ZUNoYW5nZXMiLCJub25NdXRhdGluZ0NhbGxiYWNrcyIsInBpY2siLCJjdXJzb3JPcHRpb25zIiwic29ydCIsInNraXAiLCJwcm9qZWN0aW9uIiwiZmllbGRzIiwiYXdhaXRkYXRhIiwibnVtYmVyT2ZSZXRyaWVzIiwiT1BMT0dfQ09MTEVDVElPTiIsInRzIiwib3Bsb2dSZXBsYXkiLCJkYkN1cnNvciIsIm1heFRpbWVNcyIsIm1heFRpbWVNUyIsImhpbnQiLCJTeW5jaHJvbm91c0N1cnNvciIsIl9kYkN1cnNvciIsIl9zZWxmRm9ySXRlcmF0aW9uIiwiX3RyYW5zZm9ybSIsIndyYXBUcmFuc2Zvcm0iLCJfc3luY2hyb25vdXNDb3VudCIsImNvdW50IiwiX3Zpc2l0ZWRJZHMiLCJfSWRNYXAiLCJfcmF3TmV4dE9iamVjdFByb21pc2UiLCJQcm9taXNlIiwicmVzb2x2ZSIsInJlamVjdCIsIm5leHQiLCJfbmV4dE9iamVjdFByb21pc2UiLCJzZXQiLCJfbmV4dE9iamVjdFByb21pc2VXaXRoVGltZW91dCIsInRpbWVvdXRNUyIsIm5leHRPYmplY3RQcm9taXNlIiwidGltZW91dEVyciIsInRpbWVvdXRQcm9taXNlIiwidGltZXIiLCJzZXRUaW1lb3V0IiwicmFjZSIsImNhdGNoIiwiX25leHRPYmplY3QiLCJhd2FpdCIsInRoaXNBcmciLCJfcmV3aW5kIiwiY2FsbCIsInJlcyIsInB1c2giLCJpZGVudGl0eSIsImFwcGx5U2tpcExpbWl0IiwiZ2V0UmF3T2JqZWN0cyIsInJlc3VsdHMiLCJkb25lIiwidGFpbCIsImRvY0NhbGxiYWNrIiwiY3Vyc29yIiwic3RvcHBlZCIsImxhc3RUUyIsImxvb3AiLCJuZXdTZWxlY3RvciIsIiRndCIsImRlZmVyIiwiX29ic2VydmVDaGFuZ2VzVGFpbGFibGUiLCJvYnNlcnZlS2V5Iiwic3RyaW5naWZ5IiwibXVsdGlwbGV4ZXIiLCJvYnNlcnZlRHJpdmVyIiwiZmlyc3RIYW5kbGUiLCJfbm9ZaWVsZHNBbGxvd2VkIiwiT2JzZXJ2ZU11bHRpcGxleGVyIiwib25TdG9wIiwib2JzZXJ2ZUhhbmRsZSIsIk9ic2VydmVIYW5kbGUiLCJtYXRjaGVyIiwic29ydGVyIiwiY2FuVXNlT3Bsb2ciLCJhbGwiLCJfdGVzdE9ubHlQb2xsQ2FsbGJhY2siLCJNaW5pbW9uZ28iLCJNYXRjaGVyIiwiT3Bsb2dPYnNlcnZlRHJpdmVyIiwiY3Vyc29yU3VwcG9ydGVkIiwiU29ydGVyIiwiZiIsImRyaXZlckNsYXNzIiwiUG9sbGluZ09ic2VydmVEcml2ZXIiLCJtb25nb0hhbmRsZSIsIl9vYnNlcnZlRHJpdmVyIiwiYWRkSGFuZGxlQW5kU2VuZEluaXRpYWxBZGRzIiwibGlzdGVuQWxsIiwibGlzdGVuQ2FsbGJhY2siLCJsaXN0ZW5lcnMiLCJmb3JFYWNoVHJpZ2dlciIsInRyaWdnZXIiLCJfSW52YWxpZGF0aW9uQ3Jvc3NiYXIiLCJsaXN0ZW4iLCJsaXN0ZW5lciIsInRyaWdnZXJDYWxsYmFjayIsImFkZGVkQmVmb3JlIiwiYWRkZWQiLCJNb25nb1RpbWVzdGFtcCIsIkNvbm5lY3Rpb24iLCJUT09fRkFSX0JFSElORCIsInByb2Nlc3MiLCJlbnYiLCJNRVRFT1JfT1BMT0dfVE9PX0ZBUl9CRUhJTkQiLCJUQUlMX1RJTUVPVVQiLCJNRVRFT1JfT1BMT0dfVEFJTF9USU1FT1VUIiwic2hvd1RTIiwiZ2V0SGlnaEJpdHMiLCJnZXRMb3dCaXRzIiwiaWRGb3JPcCIsIm9wIiwibyIsIm8yIiwiZGJOYW1lIiwiX29wbG9nVXJsIiwiX2RiTmFtZSIsIl9vcGxvZ0xhc3RFbnRyeUNvbm5lY3Rpb24iLCJfb3Bsb2dUYWlsQ29ubmVjdGlvbiIsIl9zdG9wcGVkIiwiX3RhaWxIYW5kbGUiLCJfcmVhZHlGdXR1cmUiLCJfY3Jvc3NiYXIiLCJfQ3Jvc3NiYXIiLCJmYWN0UGFja2FnZSIsImZhY3ROYW1lIiwiX2Jhc2VPcGxvZ1NlbGVjdG9yIiwibnMiLCJSZWdFeHAiLCJfZXNjYXBlUmVnRXhwIiwiJG9yIiwiJGluIiwiJGV4aXN0cyIsIl9jYXRjaGluZ1VwRnV0dXJlcyIsIl9sYXN0UHJvY2Vzc2VkVFMiLCJfb25Ta2lwcGVkRW50cmllc0hvb2siLCJkZWJ1Z1ByaW50RXhjZXB0aW9ucyIsIl9lbnRyeVF1ZXVlIiwiX0RvdWJsZUVuZGVkUXVldWUiLCJfd29ya2VyQWN0aXZlIiwiX3N0YXJ0VGFpbGluZyIsIm9uT3Bsb2dFbnRyeSIsIm9yaWdpbmFsQ2FsbGJhY2siLCJub3RpZmljYXRpb24iLCJfZGVidWciLCJsaXN0ZW5IYW5kbGUiLCJvblNraXBwZWRFbnRyaWVzIiwid2FpdFVudGlsQ2F1Z2h0VXAiLCJsYXN0RW50cnkiLCIkbmF0dXJhbCIsIl9zbGVlcEZvck1zIiwibGVzc1RoYW5PckVxdWFsIiwiaW5zZXJ0QWZ0ZXIiLCJncmVhdGVyVGhhbiIsInNwbGljZSIsIm1vbmdvZGJVcmkiLCJwYXJzZSIsImRhdGFiYXNlIiwiYWRtaW4iLCJjb21tYW5kIiwiaXNtYXN0ZXIiLCJzZXROYW1lIiwibGFzdE9wbG9nRW50cnkiLCJvcGxvZ1NlbGVjdG9yIiwiX21heWJlU3RhcnRXb3JrZXIiLCJyZXR1cm4iLCJoYW5kbGVEb2MiLCJhcHBseU9wcyIsIm5leHRUaW1lc3RhbXAiLCJhZGQiLCJPTkUiLCJzdGFydHNXaXRoIiwic2xpY2UiLCJmaXJlIiwiaXNFbXB0eSIsInBvcCIsImNsZWFyIiwiX3NldExhc3RQcm9jZXNzZWRUUyIsInNoaWZ0Iiwic2VxdWVuY2VyIiwiX2RlZmluZVRvb0ZhckJlaGluZCIsIl9yZXNldFRvb0ZhckJlaGluZCIsIl9vYmplY3RXaXRob3V0UHJvcGVydGllcyIsIkZhY3RzIiwiaW5jcmVtZW50U2VydmVyRmFjdCIsIl9vcmRlcmVkIiwiX29uU3RvcCIsIl9xdWV1ZSIsIl9TeW5jaHJvbm91c1F1ZXVlIiwiX2hhbmRsZXMiLCJfY2FjaGUiLCJfQ2FjaGluZ0NoYW5nZU9ic2VydmVyIiwiX2FkZEhhbmRsZVRhc2tzU2NoZWR1bGVkQnV0Tm90UGVyZm9ybWVkIiwiY2FsbGJhY2tOYW1lcyIsImNhbGxiYWNrTmFtZSIsIl9hcHBseUNhbGxiYWNrIiwidG9BcnJheSIsImhhbmRsZSIsInNhZmVUb1J1blRhc2siLCJydW5UYXNrIiwiX3NlbmRBZGRzIiwicmVtb3ZlSGFuZGxlIiwiX3JlYWR5IiwiX3N0b3AiLCJmcm9tUXVlcnlFcnJvciIsInJlYWR5IiwicXVldWVUYXNrIiwicXVlcnlFcnJvciIsInRocm93Iiwib25GbHVzaCIsImlzUmVzb2x2ZWQiLCJhcmdzIiwiYXBwbHlDaGFuZ2UiLCJrZXlzIiwiaGFuZGxlSWQiLCJfYWRkZWRCZWZvcmUiLCJfYWRkZWQiLCJkb2NzIiwibmV4dE9ic2VydmVIYW5kbGVJZCIsIl9tdWx0aXBsZXhlciIsImJlZm9yZSIsImV4cG9ydCIsIkZpYmVyIiwiY29uc3RydWN0b3IiLCJtb25nb0Nvbm5lY3Rpb24iLCJfbW9uZ29Db25uZWN0aW9uIiwiX2NhbGxiYWNrc0Zvck9wIiwiTWFwIiwiY2hlY2siLCJTdHJpbmciLCJkZWxldGUiLCJydW4iLCJQT0xMSU5HX1RIUk9UVExFX01TIiwiTUVURU9SX1BPTExJTkdfVEhST1RUTEVfTVMiLCJQT0xMSU5HX0lOVEVSVkFMX01TIiwiTUVURU9SX1BPTExJTkdfSU5URVJWQUxfTVMiLCJfbW9uZ29IYW5kbGUiLCJfc3RvcENhbGxiYWNrcyIsIl9yZXN1bHRzIiwiX3BvbGxzU2NoZWR1bGVkQnV0Tm90U3RhcnRlZCIsIl9wZW5kaW5nV3JpdGVzIiwiX2Vuc3VyZVBvbGxJc1NjaGVkdWxlZCIsInRocm90dGxlIiwiX3VudGhyb3R0bGVkRW5zdXJlUG9sbElzU2NoZWR1bGVkIiwicG9sbGluZ1Rocm90dGxlTXMiLCJfdGFza1F1ZXVlIiwibGlzdGVuZXJzSGFuZGxlIiwicG9sbGluZ0ludGVydmFsIiwicG9sbGluZ0ludGVydmFsTXMiLCJfcG9sbGluZ0ludGVydmFsIiwiaW50ZXJ2YWxIYW5kbGUiLCJzZXRJbnRlcnZhbCIsImNsZWFySW50ZXJ2YWwiLCJfcG9sbE1vbmdvIiwiX3N1c3BlbmRQb2xsaW5nIiwiX3Jlc3VtZVBvbGxpbmciLCJmaXJzdCIsIm5ld1Jlc3VsdHMiLCJvbGRSZXN1bHRzIiwid3JpdGVzRm9yQ3ljbGUiLCJjb2RlIiwiSlNPTiIsIm1lc3NhZ2UiLCJBcnJheSIsIl9kaWZmUXVlcnlDaGFuZ2VzIiwidyIsImMiLCJQSEFTRSIsIlFVRVJZSU5HIiwiRkVUQ0hJTkciLCJTVEVBRFkiLCJTd2l0Y2hlZFRvUXVlcnkiLCJmaW5pc2hJZk5lZWRUb1BvbGxRdWVyeSIsImN1cnJlbnRJZCIsIl91c2VzT3Bsb2ciLCJjb21wYXJhdG9yIiwiZ2V0Q29tcGFyYXRvciIsImhlYXBPcHRpb25zIiwiSWRNYXAiLCJfbGltaXQiLCJfY29tcGFyYXRvciIsIl9zb3J0ZXIiLCJfdW5wdWJsaXNoZWRCdWZmZXIiLCJNaW5NYXhIZWFwIiwiX3B1Ymxpc2hlZCIsIk1heEhlYXAiLCJfc2FmZUFwcGVuZFRvQnVmZmVyIiwiX3N0b3BIYW5kbGVzIiwiX3JlZ2lzdGVyUGhhc2VDaGFuZ2UiLCJfbWF0Y2hlciIsIl9wcm9qZWN0aW9uRm4iLCJfY29tcGlsZVByb2plY3Rpb24iLCJfc2hhcmVkUHJvamVjdGlvbiIsImNvbWJpbmVJbnRvUHJvamVjdGlvbiIsIl9zaGFyZWRQcm9qZWN0aW9uRm4iLCJfbmVlZFRvRmV0Y2giLCJfY3VycmVudGx5RmV0Y2hpbmciLCJfZmV0Y2hHZW5lcmF0aW9uIiwiX3JlcXVlcnlXaGVuRG9uZVRoaXNRdWVyeSIsIl93cml0ZXNUb0NvbW1pdFdoZW5XZVJlYWNoU3RlYWR5IiwiX25lZWRUb1BvbGxRdWVyeSIsIl9waGFzZSIsIl9oYW5kbGVPcGxvZ0VudHJ5UXVlcnlpbmciLCJfaGFuZGxlT3Bsb2dFbnRyeVN0ZWFkeU9yRmV0Y2hpbmciLCJmaXJlZCIsIl9vcGxvZ09ic2VydmVEcml2ZXJzIiwib25CZWZvcmVGaXJlIiwiZHJpdmVycyIsImRyaXZlciIsIl9ydW5Jbml0aWFsUXVlcnkiLCJfYWRkUHVibGlzaGVkIiwib3ZlcmZsb3dpbmdEb2NJZCIsIm1heEVsZW1lbnRJZCIsIm92ZXJmbG93aW5nRG9jIiwiZXF1YWxzIiwicmVtb3ZlZCIsIl9hZGRCdWZmZXJlZCIsIl9yZW1vdmVQdWJsaXNoZWQiLCJlbXB0eSIsIm5ld0RvY0lkIiwibWluRWxlbWVudElkIiwiX3JlbW92ZUJ1ZmZlcmVkIiwiX2NoYW5nZVB1Ymxpc2hlZCIsIm9sZERvYyIsInByb2plY3RlZE5ldyIsInByb2plY3RlZE9sZCIsImNoYW5nZWQiLCJEaWZmU2VxdWVuY2UiLCJtYWtlQ2hhbmdlZEZpZWxkcyIsIm1heEJ1ZmZlcmVkSWQiLCJfYWRkTWF0Y2hpbmciLCJtYXhQdWJsaXNoZWQiLCJtYXhCdWZmZXJlZCIsInRvUHVibGlzaCIsImNhbkFwcGVuZFRvQnVmZmVyIiwiY2FuSW5zZXJ0SW50b0J1ZmZlciIsInRvQnVmZmVyIiwiX3JlbW92ZU1hdGNoaW5nIiwiX2hhbmRsZURvYyIsIm1hdGNoZXNOb3ciLCJkb2N1bWVudE1hdGNoZXMiLCJwdWJsaXNoZWRCZWZvcmUiLCJidWZmZXJlZEJlZm9yZSIsImNhY2hlZEJlZm9yZSIsIm1pbkJ1ZmZlcmVkIiwic3RheXNJblB1Ymxpc2hlZCIsInN0YXlzSW5CdWZmZXIiLCJfZmV0Y2hNb2RpZmllZERvY3VtZW50cyIsInRoaXNHZW5lcmF0aW9uIiwid2FpdGluZyIsImZ1dCIsIl9iZVN0ZWFkeSIsIndyaXRlcyIsImlzUmVwbGFjZSIsImNhbkRpcmVjdGx5TW9kaWZ5RG9jIiwibW9kaWZpZXJDYW5CZURpcmVjdGx5QXBwbGllZCIsIl9tb2RpZnkiLCJjYW5CZWNvbWVUcnVlQnlNb2RpZmllciIsImFmZmVjdGVkQnlNb2RpZmllciIsIl9ydW5RdWVyeSIsImluaXRpYWwiLCJfZG9uZVF1ZXJ5aW5nIiwiX3BvbGxRdWVyeSIsIm5ld0J1ZmZlciIsIl9jdXJzb3JGb3JRdWVyeSIsImkiLCJfcHVibGlzaE5ld1Jlc3VsdHMiLCJvcHRpb25zT3ZlcndyaXRlIiwiZGVzY3JpcHRpb24iLCJpZHNUb1JlbW92ZSIsImNvbnNvbGUiLCJfb3Bsb2dFbnRyeUhhbmRsZSIsIl9saXN0ZW5lcnNIYW5kbGUiLCJwaGFzZSIsIm5vdyIsIkRhdGUiLCJ0aW1lRGlmZiIsIl9waGFzZVN0YXJ0VGltZSIsImRpc2FibGVPcGxvZyIsIl9kaXNhYmxlT3Bsb2ciLCJfY2hlY2tTdXBwb3J0ZWRQcm9qZWN0aW9uIiwiaGFzV2hlcmUiLCJoYXNHZW9RdWVyeSIsIm1vZGlmaWVyIiwib3BlcmF0aW9uIiwiZmllbGQiLCJMb2NhbENvbGxlY3Rpb25Ecml2ZXIiLCJub0Nvbm5Db2xsZWN0aW9ucyIsImNyZWF0ZSIsIm9wZW4iLCJjb25uIiwiZW5zdXJlQ29sbGVjdGlvbiIsIl9tb25nb19saXZlZGF0YV9jb2xsZWN0aW9ucyIsImNvbGxlY3Rpb25zIiwiUmVtb3RlQ29sbGVjdGlvbkRyaXZlciIsIm1vbmdvX3VybCIsIm0iLCJkZWZhdWx0UmVtb3RlQ29sbGVjdGlvbkRyaXZlciIsIm9uY2UiLCJjb25uZWN0aW9uT3B0aW9ucyIsIm1vbmdvVXJsIiwiTU9OR09fVVJMIiwiTU9OR09fT1BMT0dfVVJMIiwiY29ubmVjdGlvbiIsIm1hbmFnZXIiLCJpZEdlbmVyYXRpb24iLCJfZHJpdmVyIiwiX3ByZXZlbnRBdXRvcHVibGlzaCIsIl9tYWtlTmV3SUQiLCJzcmMiLCJERFAiLCJyYW5kb21TdHJlYW0iLCJSYW5kb20iLCJpbnNlY3VyZSIsImhleFN0cmluZyIsIl9jb25uZWN0aW9uIiwiaXNDbGllbnQiLCJzZXJ2ZXIiLCJfY29sbGVjdGlvbiIsIl9uYW1lIiwiX21heWJlU2V0VXBSZXBsaWNhdGlvbiIsImRlZmluZU11dGF0aW9uTWV0aG9kcyIsIl9kZWZpbmVNdXRhdGlvbk1ldGhvZHMiLCJ1c2VFeGlzdGluZyIsIl9zdXBwcmVzc1NhbWVOYW1lRXJyb3IiLCJhdXRvcHVibGlzaCIsInB1Ymxpc2giLCJpc19hdXRvIiwicmVnaXN0ZXJTdG9yZSIsIm9rIiwiYmVnaW5VcGRhdGUiLCJiYXRjaFNpemUiLCJyZXNldCIsInBhdXNlT2JzZXJ2ZXJzIiwibXNnIiwibW9uZ29JZCIsIk1vbmdvSUQiLCJpZFBhcnNlIiwiX2RvY3MiLCIkdW5zZXQiLCIkc2V0IiwiZW5kVXBkYXRlIiwicmVzdW1lT2JzZXJ2ZXJzIiwic2F2ZU9yaWdpbmFscyIsInJldHJpZXZlT3JpZ2luYWxzIiwiZ2V0RG9jIiwiX2dldENvbGxlY3Rpb24iLCJ3YXJuIiwibG9nIiwiX2dldEZpbmRTZWxlY3RvciIsIl9nZXRGaW5kT3B0aW9ucyIsIk1hdGNoIiwiT3B0aW9uYWwiLCJPYmplY3RJbmNsdWRpbmciLCJPbmVPZiIsIk51bWJlciIsImZhbGxiYWNrSWQiLCJfc2VsZWN0b3JJc0lkIiwiZ2V0UHJvdG90eXBlT2YiLCJnZXRPd25Qcm9wZXJ0eURlc2NyaXB0b3JzIiwiZ2VuZXJhdGVJZCIsIl9pc1JlbW90ZUNvbGxlY3Rpb24iLCJlbmNsb3NpbmciLCJfQ3VycmVudE1ldGhvZEludm9jYXRpb24iLCJjaG9vc2VSZXR1cm5WYWx1ZUZyb21Db2xsZWN0aW9uUmVzdWx0Iiwid3JhcENhbGxiYWNrIiwiX2NhbGxNdXRhdG9yTWV0aG9kIiwib3B0aW9uc0FuZENhbGxiYWNrIiwicG9wQ2FsbGJhY2tGcm9tQXJncyIsInJhd0RhdGFiYXNlIiwiY29udmVydFJlc3VsdCIsIkFsbG93RGVueSIsIkNvbGxlY3Rpb25Qcm90b3R5cGUiLCJzZXRDb25uZWN0aW9uT3B0aW9ucyJdLCJtYXBwaW5ncyI6Ijs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7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O0FBRUE7Ozs7QUFHQXBMLE9BQUssQ0FBQytMLFVBQU4sQ0FBaUJoTSxRQUFqQixHQUE0QkMsS0FBSyxDQUFDRCxRQUFsQztBQUVBOzs7O0FBR0ErQixRQUFNLENBQUNpSyxVQUFQLEdBQW9CL0wsS0FBSyxDQUFDK0wsVUFBMUIsQyxDQUVBOztBQUNBNUosUUFBTSxDQUFDQyxNQUFQLENBQ0VOLE1BQU0sQ0FBQ2lLLFVBQVAsQ0FBa0IzTSxTQURwQixFQUVFK3JCLFNBQVMsQ0FBQ0MsbUJBRlo7O0FBS0EsV0FBU0osbUJBQVQsQ0FBNkJqUSxJQUE3QixFQUFtQztBQUNqQztBQUNBO0FBQ0EsUUFBSUEsSUFBSSxDQUFDNVEsTUFBTCxLQUNDNFEsSUFBSSxDQUFDQSxJQUFJLENBQUM1USxNQUFMLEdBQWMsQ0FBZixDQUFKLEtBQTBCM0osU0FBMUIsSUFDQXVhLElBQUksQ0FBQ0EsSUFBSSxDQUFDNVEsTUFBTCxHQUFjLENBQWYsQ0FBSixZQUFpQ3pCLFFBRmxDLENBQUosRUFFaUQ7QUFDL0MsYUFBT3FTLElBQUksQ0FBQ3BDLEdBQUwsRUFBUDtBQUNEO0FBQ0Y7Ozs7Ozs7Ozs7OztBQzV3QkQ7Ozs7OztBQU1BM1ksS0FBSyxDQUFDcXJCLG9CQUFOLEdBQTZCLFNBQVNBLG9CQUFULENBQStCOXBCLE9BQS9CLEVBQXdDO0FBQ25FeWEsT0FBSyxDQUFDemEsT0FBRCxFQUFVWSxNQUFWLENBQUw7QUFDQW5DLE9BQUssQ0FBQzZCLGtCQUFOLEdBQTJCTixPQUEzQjtBQUNELENBSEQsQyIsImZpbGUiOiIvcGFja2FnZXMvbW9uZ28uanMiLCJzb3VyY2VzQ29udGVudCI6WyIvKipcbiAqIFByb3ZpZGUgYSBzeW5jaHJvbm91cyBDb2xsZWN0aW9uIEFQSSB1c2luZyBmaWJlcnMsIGJhY2tlZCBieVxuICogTW9uZ29EQi4gIFRoaXMgaXMgb25seSBmb3IgdXNlIG9uIHRoZSBzZXJ2ZXIsIGFuZCBtb3N0bHkgaWRlbnRpY2FsXG4gKiB0byB0aGUgY2xpZW50IEFQSS5cbiAqXG4gKiBOT1RFOiB0aGUgcHVibGljIEFQSSBtZXRob2RzIG11c3QgYmUgcnVuIHdpdGhpbiBhIGZpYmVyLiBJZiB5b3UgY2FsbFxuICogdGhlc2Ugb3V0c2lkZSBvZiBhIGZpYmVyIHRoZXkgd2lsbCBleHBsb2RlIVxuICovXG5cbmNvbnN0IHBhdGggPSByZXF1aXJlKFwicGF0aFwiKTtcblxudmFyIE1vbmdvREIgPSBOcG1Nb2R1bGVNb25nb2RiO1xudmFyIEZ1dHVyZSA9IE5wbS5yZXF1aXJlKCdmaWJlcnMvZnV0dXJlJyk7XG5pbXBvcnQgeyBEb2NGZXRjaGVyIH0gZnJvbSBcIi4vZG9jX2ZldGNoZXIuanNcIjtcblxuTW9uZ29JbnRlcm5hbHMgPSB7fTtcblxuTW9uZ29JbnRlcm5hbHMuTnBtTW9kdWxlcyA9IHtcbiAgbW9uZ29kYjoge1xuICAgIHZlcnNpb246IE5wbU1vZHVsZU1vbmdvZGJWZXJzaW9uLFxuICAgIG1vZHVsZTogTW9uZ29EQlxuICB9XG59O1xuXG4vLyBPbGRlciB2ZXJzaW9uIG9mIHdoYXQgaXMgbm93IGF2YWlsYWJsZSB2aWFcbi8vIE1vbmdvSW50ZXJuYWxzLk5wbU1vZHVsZXMubW9uZ29kYi5tb2R1bGUuICBJdCB3YXMgbmV2ZXIgZG9jdW1lbnRlZCwgYnV0XG4vLyBwZW9wbGUgZG8gdXNlIGl0LlxuLy8gWFhYIENPTVBBVCBXSVRIIDEuMC4zLjJcbk1vbmdvSW50ZXJuYWxzLk5wbU1vZHVsZSA9IE1vbmdvREI7XG5cbmNvbnN0IEZJTEVfQVNTRVRfU1VGRklYID0gJ0Fzc2V0JztcbmNvbnN0IEFTU0VUU19GT0xERVIgPSAnYXNzZXRzJztcbmNvbnN0IEFQUF9GT0xERVIgPSAnYXBwJztcblxuLy8gVGhpcyBpcyB1c2VkIHRvIGFkZCBvciByZW1vdmUgRUpTT04gZnJvbSB0aGUgYmVnaW5uaW5nIG9mIGV2ZXJ5dGhpbmcgbmVzdGVkXG4vLyBpbnNpZGUgYW4gRUpTT04gY3VzdG9tIHR5cGUuIEl0IHNob3VsZCBvbmx5IGJlIGNhbGxlZCBvbiBwdXJlIEpTT04hXG52YXIgcmVwbGFjZU5hbWVzID0gZnVuY3Rpb24gKGZpbHRlciwgdGhpbmcpIHtcbiAgaWYgKHR5cGVvZiB0aGluZyA9PT0gXCJvYmplY3RcIiAmJiB0aGluZyAhPT0gbnVsbCkge1xuICAgIGlmIChfLmlzQXJyYXkodGhpbmcpKSB7XG4gICAgICByZXR1cm4gXy5tYXAodGhpbmcsIF8uYmluZChyZXBsYWNlTmFtZXMsIG51bGwsIGZpbHRlcikpO1xuICAgIH1cbiAgICB2YXIgcmV0ID0ge307XG4gICAgXy5lYWNoKHRoaW5nLCBmdW5jdGlvbiAodmFsdWUsIGtleSkge1xuICAgICAgcmV0W2ZpbHRlcihrZXkpXSA9IHJlcGxhY2VOYW1lcyhmaWx0ZXIsIHZhbHVlKTtcbiAgICB9KTtcbiAgICByZXR1cm4gcmV0O1xuICB9XG4gIHJldHVybiB0aGluZztcbn07XG5cbi8vIEVuc3VyZSB0aGF0IEVKU09OLmNsb25lIGtlZXBzIGEgVGltZXN0YW1wIGFzIGEgVGltZXN0YW1wIChpbnN0ZWFkIG9mIGp1c3Rcbi8vIGRvaW5nIGEgc3RydWN0dXJhbCBjbG9uZSkuXG4vLyBYWFggaG93IG9rIGlzIHRoaXM/IHdoYXQgaWYgdGhlcmUgYXJlIG11bHRpcGxlIGNvcGllcyBvZiBNb25nb0RCIGxvYWRlZD9cbk1vbmdvREIuVGltZXN0YW1wLnByb3RvdHlwZS5jbG9uZSA9IGZ1bmN0aW9uICgpIHtcbiAgLy8gVGltZXN0YW1wcyBzaG91bGQgYmUgaW1tdXRhYmxlLlxuICByZXR1cm4gdGhpcztcbn07XG5cbnZhciBtYWtlTW9uZ29MZWdhbCA9IGZ1bmN0aW9uIChuYW1lKSB7IHJldHVybiBcIkVKU09OXCIgKyBuYW1lOyB9O1xudmFyIHVubWFrZU1vbmdvTGVnYWwgPSBmdW5jdGlvbiAobmFtZSkgeyByZXR1cm4gbmFtZS5zdWJzdHIoNSk7IH07XG5cbnZhciByZXBsYWNlTW9uZ29BdG9tV2l0aE1ldGVvciA9IGZ1bmN0aW9uIChkb2N1bWVudCkge1xuICBpZiAoZG9jdW1lbnQgaW5zdGFuY2VvZiBNb25nb0RCLkJpbmFyeSkge1xuICAgIHZhciBidWZmZXIgPSBkb2N1bWVudC52YWx1ZSh0cnVlKTtcbiAgICByZXR1cm4gbmV3IFVpbnQ4QXJyYXkoYnVmZmVyKTtcbiAgfVxuICBpZiAoZG9jdW1lbnQgaW5zdGFuY2VvZiBNb25nb0RCLk9iamVjdElEKSB7XG4gICAgcmV0dXJuIG5ldyBNb25nby5PYmplY3RJRChkb2N1bWVudC50b0hleFN0cmluZygpKTtcbiAgfVxuICBpZiAoZG9jdW1lbnQgaW5zdGFuY2VvZiBNb25nb0RCLkRlY2ltYWwxMjgpIHtcbiAgICByZXR1cm4gRGVjaW1hbChkb2N1bWVudC50b1N0cmluZygpKTtcbiAgfVxuICBpZiAoZG9jdW1lbnRbXCJFSlNPTiR0eXBlXCJdICYmIGRvY3VtZW50W1wiRUpTT04kdmFsdWVcIl0gJiYgXy5zaXplKGRvY3VtZW50KSA9PT0gMikge1xuICAgIHJldHVybiBFSlNPTi5mcm9tSlNPTlZhbHVlKHJlcGxhY2VOYW1lcyh1bm1ha2VNb25nb0xlZ2FsLCBkb2N1bWVudCkpO1xuICB9XG4gIGlmIChkb2N1bWVudCBpbnN0YW5jZW9mIE1vbmdvREIuVGltZXN0YW1wKSB7XG4gICAgLy8gRm9yIG5vdywgdGhlIE1ldGVvciByZXByZXNlbnRhdGlvbiBvZiBhIE1vbmdvIHRpbWVzdGFtcCB0eXBlIChub3QgYSBkYXRlIVxuICAgIC8vIHRoaXMgaXMgYSB3ZWlyZCBpbnRlcm5hbCB0aGluZyB1c2VkIGluIHRoZSBvcGxvZyEpIGlzIHRoZSBzYW1lIGFzIHRoZVxuICAgIC8vIE1vbmdvIHJlcHJlc2VudGF0aW9uLiBXZSBuZWVkIHRvIGRvIHRoaXMgZXhwbGljaXRseSBvciBlbHNlIHdlIHdvdWxkIGRvIGFcbiAgICAvLyBzdHJ1Y3R1cmFsIGNsb25lIGFuZCBsb3NlIHRoZSBwcm90b3R5cGUuXG4gICAgcmV0dXJuIGRvY3VtZW50O1xuICB9XG4gIHJldHVybiB1bmRlZmluZWQ7XG59O1xuXG52YXIgcmVwbGFjZU1ldGVvckF0b21XaXRoTW9uZ28gPSBmdW5jdGlvbiAoZG9jdW1lbnQpIHtcbiAgaWYgKEVKU09OLmlzQmluYXJ5KGRvY3VtZW50KSkge1xuICAgIC8vIFRoaXMgZG9lcyBtb3JlIGNvcGllcyB0aGFuIHdlJ2QgbGlrZSwgYnV0IGlzIG5lY2Vzc2FyeSBiZWNhdXNlXG4gICAgLy8gTW9uZ29EQi5CU09OIG9ubHkgbG9va3MgbGlrZSBpdCB0YWtlcyBhIFVpbnQ4QXJyYXkgKGFuZCBkb2Vzbid0IGFjdHVhbGx5XG4gICAgLy8gc2VyaWFsaXplIGl0IGNvcnJlY3RseSkuXG4gICAgcmV0dXJuIG5ldyBNb25nb0RCLkJpbmFyeShCdWZmZXIuZnJvbShkb2N1bWVudCkpO1xuICB9XG4gIGlmIChkb2N1bWVudCBpbnN0YW5jZW9mIE1vbmdvLk9iamVjdElEKSB7XG4gICAgcmV0dXJuIG5ldyBNb25nb0RCLk9iamVjdElEKGRvY3VtZW50LnRvSGV4U3RyaW5nKCkpO1xuICB9XG4gIGlmIChkb2N1bWVudCBpbnN0YW5jZW9mIE1vbmdvREIuVGltZXN0YW1wKSB7XG4gICAgLy8gRm9yIG5vdywgdGhlIE1ldGVvciByZXByZXNlbnRhdGlvbiBvZiBhIE1vbmdvIHRpbWVzdGFtcCB0eXBlIChub3QgYSBkYXRlIVxuICAgIC8vIHRoaXMgaXMgYSB3ZWlyZCBpbnRlcm5hbCB0aGluZyB1c2VkIGluIHRoZSBvcGxvZyEpIGlzIHRoZSBzYW1lIGFzIHRoZVxuICAgIC8vIE1vbmdvIHJlcHJlc2VudGF0aW9uLiBXZSBuZWVkIHRvIGRvIHRoaXMgZXhwbGljaXRseSBvciBlbHNlIHdlIHdvdWxkIGRvIGFcbiAgICAvLyBzdHJ1Y3R1cmFsIGNsb25lIGFuZCBsb3NlIHRoZSBwcm90b3R5cGUuXG4gICAgcmV0dXJuIGRvY3VtZW50O1xuICB9XG4gIGlmIChkb2N1bWVudCBpbnN0YW5jZW9mIERlY2ltYWwpIHtcbiAgICByZXR1cm4gTW9uZ29EQi5EZWNpbWFsMTI4LmZyb21TdHJpbmcoZG9jdW1lbnQudG9TdHJpbmcoKSk7XG4gIH1cbiAgaWYgKEVKU09OLl9pc0N1c3RvbVR5cGUoZG9jdW1lbnQpKSB7XG4gICAgcmV0dXJuIHJlcGxhY2VOYW1lcyhtYWtlTW9uZ29MZWdhbCwgRUpTT04udG9KU09OVmFsdWUoZG9jdW1lbnQpKTtcbiAgfVxuICAvLyBJdCBpcyBub3Qgb3JkaW5hcmlseSBwb3NzaWJsZSB0byBzdGljayBkb2xsYXItc2lnbiBrZXlzIGludG8gbW9uZ29cbiAgLy8gc28gd2UgZG9uJ3QgYm90aGVyIGNoZWNraW5nIGZvciB0aGluZ3MgdGhhdCBuZWVkIGVzY2FwaW5nIGF0IHRoaXMgdGltZS5cbiAgcmV0dXJuIHVuZGVmaW5lZDtcbn07XG5cbnZhciByZXBsYWNlVHlwZXMgPSBmdW5jdGlvbiAoZG9jdW1lbnQsIGF0b21UcmFuc2Zvcm1lcikge1xuICBpZiAodHlwZW9mIGRvY3VtZW50ICE9PSAnb2JqZWN0JyB8fCBkb2N1bWVudCA9PT0gbnVsbClcbiAgICByZXR1cm4gZG9jdW1lbnQ7XG5cbiAgdmFyIHJlcGxhY2VkVG9wTGV2ZWxBdG9tID0gYXRvbVRyYW5zZm9ybWVyKGRvY3VtZW50KTtcbiAgaWYgKHJlcGxhY2VkVG9wTGV2ZWxBdG9tICE9PSB1bmRlZmluZWQpXG4gICAgcmV0dXJuIHJlcGxhY2VkVG9wTGV2ZWxBdG9tO1xuXG4gIHZhciByZXQgPSBkb2N1bWVudDtcbiAgXy5lYWNoKGRvY3VtZW50LCBmdW5jdGlvbiAodmFsLCBrZXkpIHtcbiAgICB2YXIgdmFsUmVwbGFjZWQgPSByZXBsYWNlVHlwZXModmFsLCBhdG9tVHJhbnNmb3JtZXIpO1xuICAgIGlmICh2YWwgIT09IHZhbFJlcGxhY2VkKSB7XG4gICAgICAvLyBMYXp5IGNsb25lLiBTaGFsbG93IGNvcHkuXG4gICAgICBpZiAocmV0ID09PSBkb2N1bWVudClcbiAgICAgICAgcmV0ID0gXy5jbG9uZShkb2N1bWVudCk7XG4gICAgICByZXRba2V5XSA9IHZhbFJlcGxhY2VkO1xuICAgIH1cbiAgfSk7XG4gIHJldHVybiByZXQ7XG59O1xuXG5cbk1vbmdvQ29ubmVjdGlvbiA9IGZ1bmN0aW9uICh1cmwsIG9wdGlvbnMpIHtcbiAgdmFyIHNlbGYgPSB0aGlzO1xuICBvcHRpb25zID0gb3B0aW9ucyB8fCB7fTtcbiAgc2VsZi5fb2JzZXJ2ZU11bHRpcGxleGVycyA9IHt9O1xuICBzZWxmLl9vbkZhaWxvdmVySG9vayA9IG5ldyBIb29rO1xuXG4gIGNvbnN0IHVzZXJPcHRpb25zID0ge1xuICAgIC4uLihNb25nby5fY29ubmVjdGlvbk9wdGlvbnMgfHwge30pLFxuICAgIC4uLihNZXRlb3Iuc2V0dGluZ3M/LnBhY2thZ2VzPy5tb25nbz8ub3B0aW9ucyB8fCB7fSlcbiAgfTtcblxuICB2YXIgbW9uZ29PcHRpb25zID0gT2JqZWN0LmFzc2lnbih7XG4gICAgaWdub3JlVW5kZWZpbmVkOiB0cnVlLFxuICAgIC8vIFNlZSBodHRwczovL2dpdGh1Yi5jb20vbWV0ZW9yL21ldGVvci9pc3N1ZXMvMTA5MjUgZm9yIGRpc2N1c3Npb24gb2ZcbiAgICAvLyB3aHkgdGhpcyBvcHRpb24gaXMgbm90IHRoZSBkZWZhdWx0LlxuICAgIHVzZVVuaWZpZWRUb3BvbG9neTogISFvcHRpb25zLnVzZVVuaWZpZWRUb3BvbG9neSxcbiAgfSwgdXNlck9wdGlvbnMpO1xuXG4gIC8vIFRoZSBhdXRvUmVjb25uZWN0IGFuZCByZWNvbm5lY3RUcmllcyBvcHRpb25zIGFyZSBpbmNvbXBhdGlibGUgd2l0aFxuICAvLyB1c2VVbmlmaWVkVG9wb2xvZ3k6IGh0dHBzOi8vZ2l0aHViLmNvbS9tZXRlb3IvbWV0ZW9yL3B1bGwvMTA4NjEjY29tbWl0Y29tbWVudC0zNzUyNTg0NVxuICBpZiAoIW1vbmdvT3B0aW9ucy51c2VVbmlmaWVkVG9wb2xvZ3kpIHtcbiAgICAvLyBSZWNvbm5lY3Qgb24gZXJyb3IuIFRoaXMgZGVmYXVsdHMgdG8gdHJ1ZSwgYnV0IGl0IG5ldmVyIGh1cnRzIHRvIGJlXG4gICAgLy8gZXhwbGljaXQgYWJvdXQgaXQuXG4gICAgbW9uZ29PcHRpb25zLmF1dG9SZWNvbm5lY3QgPSB0cnVlO1xuICAgIC8vIFRyeSB0byByZWNvbm5lY3QgZm9yZXZlciwgaW5zdGVhZCBvZiBzdG9wcGluZyBhZnRlciAzMCB0cmllcyAodGhlXG4gICAgLy8gZGVmYXVsdCksIHdpdGggZWFjaCBhdHRlbXB0IHNlcGFyYXRlZCBieSAxMDAwbXMuXG4gICAgbW9uZ29PcHRpb25zLnJlY29ubmVjdFRyaWVzID0gSW5maW5pdHk7XG4gIH1cblxuICAvLyBEaXNhYmxlIHRoZSBuYXRpdmUgcGFyc2VyIGJ5IGRlZmF1bHQsIHVubGVzcyBzcGVjaWZpY2FsbHkgZW5hYmxlZFxuICAvLyBpbiB0aGUgbW9uZ28gVVJMLlxuICAvLyAtIFRoZSBuYXRpdmUgZHJpdmVyIGNhbiBjYXVzZSBlcnJvcnMgd2hpY2ggbm9ybWFsbHkgd291bGQgYmVcbiAgLy8gICB0aHJvd24sIGNhdWdodCwgYW5kIGhhbmRsZWQgaW50byBzZWdmYXVsdHMgdGhhdCB0YWtlIGRvd24gdGhlXG4gIC8vICAgd2hvbGUgYXBwLlxuICAvLyAtIEJpbmFyeSBtb2R1bGVzIGRvbid0IHlldCB3b3JrIHdoZW4geW91IGJ1bmRsZSBhbmQgbW92ZSB0aGUgYnVuZGxlXG4gIC8vICAgdG8gYSBkaWZmZXJlbnQgcGxhdGZvcm0gKGFrYSBkZXBsb3kpXG4gIC8vIFdlIHNob3VsZCByZXZpc2l0IHRoaXMgYWZ0ZXIgYmluYXJ5IG5wbSBtb2R1bGUgc3VwcG9ydCBsYW5kcy5cbiAgaWYgKCEoL1tcXD8mXW5hdGl2ZV8/W3BQXWFyc2VyPS8udGVzdCh1cmwpKSkge1xuICAgIG1vbmdvT3B0aW9ucy5uYXRpdmVfcGFyc2VyID0gZmFsc2U7XG4gIH1cblxuICAvLyBJbnRlcm5hbGx5IHRoZSBvcGxvZyBjb25uZWN0aW9ucyBzcGVjaWZ5IHRoZWlyIG93biBwb29sU2l6ZVxuICAvLyB3aGljaCB3ZSBkb24ndCB3YW50IHRvIG92ZXJ3cml0ZSB3aXRoIGFueSB1c2VyIGRlZmluZWQgdmFsdWVcbiAgaWYgKF8uaGFzKG9wdGlvbnMsICdwb29sU2l6ZScpKSB7XG4gICAgLy8gSWYgd2UganVzdCBzZXQgdGhpcyBmb3IgXCJzZXJ2ZXJcIiwgcmVwbFNldCB3aWxsIG92ZXJyaWRlIGl0LiBJZiB3ZSBqdXN0XG4gICAgLy8gc2V0IGl0IGZvciByZXBsU2V0LCBpdCB3aWxsIGJlIGlnbm9yZWQgaWYgd2UncmUgbm90IHVzaW5nIGEgcmVwbFNldC5cbiAgICBtb25nb09wdGlvbnMucG9vbFNpemUgPSBvcHRpb25zLnBvb2xTaXplO1xuICB9XG5cbiAgLy8gVHJhbnNmb3JtIG9wdGlvbnMgbGlrZSBcInRsc0NBRmlsZUFzc2V0XCI6IFwiZmlsZW5hbWUucGVtXCIgaW50b1xuICAvLyBcInRsc0NBRmlsZVwiOiBcIi88ZnVsbHBhdGg+L2ZpbGVuYW1lLnBlbVwiXG4gIE9iamVjdC5lbnRyaWVzKG1vbmdvT3B0aW9ucyB8fCB7fSlcbiAgICAuZmlsdGVyKChba2V5XSkgPT4ga2V5ICYmIGtleS5lbmRzV2l0aChGSUxFX0FTU0VUX1NVRkZJWCkpXG4gICAgLmZvckVhY2goKFtrZXksIHZhbHVlXSkgPT4ge1xuICAgICAgY29uc3Qgb3B0aW9uTmFtZSA9IGtleS5yZXBsYWNlKEZJTEVfQVNTRVRfU1VGRklYLCAnJyk7XG4gICAgICBtb25nb09wdGlvbnNbb3B0aW9uTmFtZV0gPSBwYXRoLmpvaW4oQXNzZXRzLmdldFNlcnZlckRpcigpLFxuICAgICAgICBBU1NFVFNfRk9MREVSLCBBUFBfRk9MREVSLCB2YWx1ZSk7XG4gICAgICBkZWxldGUgbW9uZ29PcHRpb25zW2tleV07XG4gICAgfSk7XG5cbiAgc2VsZi5kYiA9IG51bGw7XG4gIC8vIFdlIGtlZXAgdHJhY2sgb2YgdGhlIFJlcGxTZXQncyBwcmltYXJ5LCBzbyB0aGF0IHdlIGNhbiB0cmlnZ2VyIGhvb2tzIHdoZW5cbiAgLy8gaXQgY2hhbmdlcy4gIFRoZSBOb2RlIGRyaXZlcidzIGpvaW5lZCBjYWxsYmFjayBzZWVtcyB0byBmaXJlIHdheSB0b29cbiAgLy8gb2Z0ZW4sIHdoaWNoIGlzIHdoeSB3ZSBuZWVkIHRvIHRyYWNrIGl0IG91cnNlbHZlcy5cbiAgc2VsZi5fcHJpbWFyeSA9IG51bGw7XG4gIHNlbGYuX29wbG9nSGFuZGxlID0gbnVsbDtcbiAgc2VsZi5fZG9jRmV0Y2hlciA9IG51bGw7XG5cblxuICB2YXIgY29ubmVjdEZ1dHVyZSA9IG5ldyBGdXR1cmU7XG4gIE1vbmdvREIuY29ubmVjdChcbiAgICB1cmwsXG4gICAgbW9uZ29PcHRpb25zLFxuICAgIE1ldGVvci5iaW5kRW52aXJvbm1lbnQoXG4gICAgICBmdW5jdGlvbiAoZXJyLCBjbGllbnQpIHtcbiAgICAgICAgaWYgKGVycikge1xuICAgICAgICAgIHRocm93IGVycjtcbiAgICAgICAgfVxuXG4gICAgICAgIHZhciBkYiA9IGNsaWVudC5kYigpO1xuXG4gICAgICAgIC8vIEZpcnN0LCBmaWd1cmUgb3V0IHdoYXQgdGhlIGN1cnJlbnQgcHJpbWFyeSBpcywgaWYgYW55LlxuICAgICAgICBpZiAoZGIuc2VydmVyQ29uZmlnLmlzTWFzdGVyRG9jKSB7XG4gICAgICAgICAgc2VsZi5fcHJpbWFyeSA9IGRiLnNlcnZlckNvbmZpZy5pc01hc3RlckRvYy5wcmltYXJ5O1xuICAgICAgICB9XG5cbiAgICAgICAgZGIuc2VydmVyQ29uZmlnLm9uKFxuICAgICAgICAgICdqb2luZWQnLCBNZXRlb3IuYmluZEVudmlyb25tZW50KGZ1bmN0aW9uIChraW5kLCBkb2MpIHtcbiAgICAgICAgICAgIGlmIChraW5kID09PSAncHJpbWFyeScpIHtcbiAgICAgICAgICAgICAgaWYgKGRvYy5wcmltYXJ5ICE9PSBzZWxmLl9wcmltYXJ5KSB7XG4gICAgICAgICAgICAgICAgc2VsZi5fcHJpbWFyeSA9IGRvYy5wcmltYXJ5O1xuICAgICAgICAgICAgICAgIHNlbGYuX29uRmFpbG92ZXJIb29rLmVhY2goZnVuY3Rpb24gKGNhbGxiYWNrKSB7XG4gICAgICAgICAgICAgICAgICBjYWxsYmFjaygpO1xuICAgICAgICAgICAgICAgICAgcmV0dXJuIHRydWU7XG4gICAgICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH0gZWxzZSBpZiAoZG9jLm1lID09PSBzZWxmLl9wcmltYXJ5KSB7XG4gICAgICAgICAgICAgIC8vIFRoZSB0aGluZyB3ZSB0aG91Z2h0IHdhcyBwcmltYXJ5IGlzIG5vdyBzb21ldGhpbmcgb3RoZXIgdGhhblxuICAgICAgICAgICAgICAvLyBwcmltYXJ5LiAgRm9yZ2V0IHRoYXQgd2UgdGhvdWdodCBpdCB3YXMgcHJpbWFyeS4gIChUaGlzIG1lYW5zXG4gICAgICAgICAgICAgIC8vIHRoYXQgaWYgYSBzZXJ2ZXIgc3RvcHMgYmVpbmcgcHJpbWFyeSBhbmQgdGhlbiBzdGFydHMgYmVpbmdcbiAgICAgICAgICAgICAgLy8gcHJpbWFyeSBhZ2FpbiB3aXRob3V0IGFub3RoZXIgc2VydmVyIGJlY29taW5nIHByaW1hcnkgaW4gdGhlXG4gICAgICAgICAgICAgIC8vIG1pZGRsZSwgd2UnbGwgY29ycmVjdGx5IGNvdW50IGl0IGFzIGEgZmFpbG92ZXIuKVxuICAgICAgICAgICAgICBzZWxmLl9wcmltYXJ5ID0gbnVsbDtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICB9KSk7XG5cbiAgICAgICAgLy8gQWxsb3cgdGhlIGNvbnN0cnVjdG9yIHRvIHJldHVybi5cbiAgICAgICAgY29ubmVjdEZ1dHVyZVsncmV0dXJuJ10oeyBjbGllbnQsIGRiIH0pO1xuICAgICAgfSxcbiAgICAgIGNvbm5lY3RGdXR1cmUucmVzb2x2ZXIoKSAgLy8gb25FeGNlcHRpb25cbiAgICApXG4gICk7XG5cbiAgLy8gV2FpdCBmb3IgdGhlIGNvbm5lY3Rpb24gdG8gYmUgc3VjY2Vzc2Z1bCAodGhyb3dzIG9uIGZhaWx1cmUpIGFuZCBhc3NpZ24gdGhlXG4gIC8vIHJlc3VsdHMgKGBjbGllbnRgIGFuZCBgZGJgKSB0byBgc2VsZmAuXG4gIE9iamVjdC5hc3NpZ24oc2VsZiwgY29ubmVjdEZ1dHVyZS53YWl0KCkpO1xuXG4gIGlmIChvcHRpb25zLm9wbG9nVXJsICYmICEgUGFja2FnZVsnZGlzYWJsZS1vcGxvZyddKSB7XG4gICAgc2VsZi5fb3Bsb2dIYW5kbGUgPSBuZXcgT3Bsb2dIYW5kbGUob3B0aW9ucy5vcGxvZ1VybCwgc2VsZi5kYi5kYXRhYmFzZU5hbWUpO1xuICAgIHNlbGYuX2RvY0ZldGNoZXIgPSBuZXcgRG9jRmV0Y2hlcihzZWxmKTtcbiAgfVxufTtcblxuTW9uZ29Db25uZWN0aW9uLnByb3RvdHlwZS5jbG9zZSA9IGZ1bmN0aW9uKCkge1xuICB2YXIgc2VsZiA9IHRoaXM7XG5cbiAgaWYgKCEgc2VsZi5kYilcbiAgICB0aHJvdyBFcnJvcihcImNsb3NlIGNhbGxlZCBiZWZvcmUgQ29ubmVjdGlvbiBjcmVhdGVkP1wiKTtcblxuICAvLyBYWFggcHJvYmFibHkgdW50ZXN0ZWRcbiAgdmFyIG9wbG9nSGFuZGxlID0gc2VsZi5fb3Bsb2dIYW5kbGU7XG4gIHNlbGYuX29wbG9nSGFuZGxlID0gbnVsbDtcbiAgaWYgKG9wbG9nSGFuZGxlKVxuICAgIG9wbG9nSGFuZGxlLnN0b3AoKTtcblxuICAvLyBVc2UgRnV0dXJlLndyYXAgc28gdGhhdCBlcnJvcnMgZ2V0IHRocm93bi4gVGhpcyBoYXBwZW5zIHRvXG4gIC8vIHdvcmsgZXZlbiBvdXRzaWRlIGEgZmliZXIgc2luY2UgdGhlICdjbG9zZScgbWV0aG9kIGlzIG5vdFxuICAvLyBhY3R1YWxseSBhc3luY2hyb25vdXMuXG4gIEZ1dHVyZS53cmFwKF8uYmluZChzZWxmLmNsaWVudC5jbG9zZSwgc2VsZi5jbGllbnQpKSh0cnVlKS53YWl0KCk7XG59O1xuXG4vLyBSZXR1cm5zIHRoZSBNb25nbyBDb2xsZWN0aW9uIG9iamVjdDsgbWF5IHlpZWxkLlxuTW9uZ29Db25uZWN0aW9uLnByb3RvdHlwZS5yYXdDb2xsZWN0aW9uID0gZnVuY3Rpb24gKGNvbGxlY3Rpb25OYW1lKSB7XG4gIHZhciBzZWxmID0gdGhpcztcblxuICBpZiAoISBzZWxmLmRiKVxuICAgIHRocm93IEVycm9yKFwicmF3Q29sbGVjdGlvbiBjYWxsZWQgYmVmb3JlIENvbm5lY3Rpb24gY3JlYXRlZD9cIik7XG5cbiAgdmFyIGZ1dHVyZSA9IG5ldyBGdXR1cmU7XG4gIHNlbGYuZGIuY29sbGVjdGlvbihjb2xsZWN0aW9uTmFtZSwgZnV0dXJlLnJlc29sdmVyKCkpO1xuICByZXR1cm4gZnV0dXJlLndhaXQoKTtcbn07XG5cbk1vbmdvQ29ubmVjdGlvbi5wcm90b3R5cGUuX2NyZWF0ZUNhcHBlZENvbGxlY3Rpb24gPSBmdW5jdGlvbiAoXG4gICAgY29sbGVjdGlvbk5hbWUsIGJ5dGVTaXplLCBtYXhEb2N1bWVudHMpIHtcbiAgdmFyIHNlbGYgPSB0aGlzO1xuXG4gIGlmICghIHNlbGYuZGIpXG4gICAgdGhyb3cgRXJyb3IoXCJfY3JlYXRlQ2FwcGVkQ29sbGVjdGlvbiBjYWxsZWQgYmVmb3JlIENvbm5lY3Rpb24gY3JlYXRlZD9cIik7XG5cbiAgdmFyIGZ1dHVyZSA9IG5ldyBGdXR1cmUoKTtcbiAgc2VsZi5kYi5jcmVhdGVDb2xsZWN0aW9uKFxuICAgIGNvbGxlY3Rpb25OYW1lLFxuICAgIHsgY2FwcGVkOiB0cnVlLCBzaXplOiBieXRlU2l6ZSwgbWF4OiBtYXhEb2N1bWVudHMgfSxcbiAgICBmdXR1cmUucmVzb2x2ZXIoKSk7XG4gIGZ1dHVyZS53YWl0KCk7XG59O1xuXG4vLyBUaGlzIHNob3VsZCBiZSBjYWxsZWQgc3luY2hyb25vdXNseSB3aXRoIGEgd3JpdGUsIHRvIGNyZWF0ZSBhXG4vLyB0cmFuc2FjdGlvbiBvbiB0aGUgY3VycmVudCB3cml0ZSBmZW5jZSwgaWYgYW55LiBBZnRlciB3ZSBjYW4gcmVhZFxuLy8gdGhlIHdyaXRlLCBhbmQgYWZ0ZXIgb2JzZXJ2ZXJzIGhhdmUgYmVlbiBub3RpZmllZCAob3IgYXQgbGVhc3QsXG4vLyBhZnRlciB0aGUgb2JzZXJ2ZXIgbm90aWZpZXJzIGhhdmUgYWRkZWQgdGhlbXNlbHZlcyB0byB0aGUgd3JpdGVcbi8vIGZlbmNlKSwgeW91IHNob3VsZCBjYWxsICdjb21taXR0ZWQoKScgb24gdGhlIG9iamVjdCByZXR1cm5lZC5cbk1vbmdvQ29ubmVjdGlvbi5wcm90b3R5cGUuX21heWJlQmVnaW5Xcml0ZSA9IGZ1bmN0aW9uICgpIHtcbiAgdmFyIGZlbmNlID0gRERQU2VydmVyLl9DdXJyZW50V3JpdGVGZW5jZS5nZXQoKTtcbiAgaWYgKGZlbmNlKSB7XG4gICAgcmV0dXJuIGZlbmNlLmJlZ2luV3JpdGUoKTtcbiAgfSBlbHNlIHtcbiAgICByZXR1cm4ge2NvbW1pdHRlZDogZnVuY3Rpb24gKCkge319O1xuICB9XG59O1xuXG4vLyBJbnRlcm5hbCBpbnRlcmZhY2U6IGFkZHMgYSBjYWxsYmFjayB3aGljaCBpcyBjYWxsZWQgd2hlbiB0aGUgTW9uZ28gcHJpbWFyeVxuLy8gY2hhbmdlcy4gUmV0dXJucyBhIHN0b3AgaGFuZGxlLlxuTW9uZ29Db25uZWN0aW9uLnByb3RvdHlwZS5fb25GYWlsb3ZlciA9IGZ1bmN0aW9uIChjYWxsYmFjaykge1xuICByZXR1cm4gdGhpcy5fb25GYWlsb3Zlckhvb2sucmVnaXN0ZXIoY2FsbGJhY2spO1xufTtcblxuXG4vLy8vLy8vLy8vLy8gUHVibGljIEFQSSAvLy8vLy8vLy8vXG5cbi8vIFRoZSB3cml0ZSBtZXRob2RzIGJsb2NrIHVudGlsIHRoZSBkYXRhYmFzZSBoYXMgY29uZmlybWVkIHRoZSB3cml0ZSAoaXQgbWF5XG4vLyBub3QgYmUgcmVwbGljYXRlZCBvciBzdGFibGUgb24gZGlzaywgYnV0IG9uZSBzZXJ2ZXIgaGFzIGNvbmZpcm1lZCBpdCkgaWYgbm9cbi8vIGNhbGxiYWNrIGlzIHByb3ZpZGVkLiBJZiBhIGNhbGxiYWNrIGlzIHByb3ZpZGVkLCB0aGVuIHRoZXkgY2FsbCB0aGUgY2FsbGJhY2tcbi8vIHdoZW4gdGhlIHdyaXRlIGlzIGNvbmZpcm1lZC4gVGhleSByZXR1cm4gbm90aGluZyBvbiBzdWNjZXNzLCBhbmQgcmFpc2UgYW5cbi8vIGV4Y2VwdGlvbiBvbiBmYWlsdXJlLlxuLy9cbi8vIEFmdGVyIG1ha2luZyBhIHdyaXRlICh3aXRoIGluc2VydCwgdXBkYXRlLCByZW1vdmUpLCBvYnNlcnZlcnMgYXJlXG4vLyBub3RpZmllZCBhc3luY2hyb25vdXNseS4gSWYgeW91IHdhbnQgdG8gcmVjZWl2ZSBhIGNhbGxiYWNrIG9uY2UgYWxsXG4vLyBvZiB0aGUgb2JzZXJ2ZXIgbm90aWZpY2F0aW9ucyBoYXZlIGxhbmRlZCBmb3IgeW91ciB3cml0ZSwgZG8gdGhlXG4vLyB3cml0ZXMgaW5zaWRlIGEgd3JpdGUgZmVuY2UgKHNldCBERFBTZXJ2ZXIuX0N1cnJlbnRXcml0ZUZlbmNlIHRvIGEgbmV3XG4vLyBfV3JpdGVGZW5jZSwgYW5kIHRoZW4gc2V0IGEgY2FsbGJhY2sgb24gdGhlIHdyaXRlIGZlbmNlLilcbi8vXG4vLyBTaW5jZSBvdXIgZXhlY3V0aW9uIGVudmlyb25tZW50IGlzIHNpbmdsZS10aHJlYWRlZCwgdGhpcyBpc1xuLy8gd2VsbC1kZWZpbmVkIC0tIGEgd3JpdGUgXCJoYXMgYmVlbiBtYWRlXCIgaWYgaXQncyByZXR1cm5lZCwgYW5kIGFuXG4vLyBvYnNlcnZlciBcImhhcyBiZWVuIG5vdGlmaWVkXCIgaWYgaXRzIGNhbGxiYWNrIGhhcyByZXR1cm5lZC5cblxudmFyIHdyaXRlQ2FsbGJhY2sgPSBmdW5jdGlvbiAod3JpdGUsIHJlZnJlc2gsIGNhbGxiYWNrKSB7XG4gIHJldHVybiBmdW5jdGlvbiAoZXJyLCByZXN1bHQpIHtcbiAgICBpZiAoISBlcnIpIHtcbiAgICAgIC8vIFhYWCBXZSBkb24ndCBoYXZlIHRvIHJ1biB0aGlzIG9uIGVycm9yLCByaWdodD9cbiAgICAgIHRyeSB7XG4gICAgICAgIHJlZnJlc2goKTtcbiAgICAgIH0gY2F0Y2ggKHJlZnJlc2hFcnIpIHtcbiAgICAgICAgaWYgKGNhbGxiYWNrKSB7XG4gICAgICAgICAgY2FsbGJhY2socmVmcmVzaEVycik7XG4gICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIHRocm93IHJlZnJlc2hFcnI7XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9XG4gICAgd3JpdGUuY29tbWl0dGVkKCk7XG4gICAgaWYgKGNhbGxiYWNrKSB7XG4gICAgICBjYWxsYmFjayhlcnIsIHJlc3VsdCk7XG4gICAgfSBlbHNlIGlmIChlcnIpIHtcbiAgICAgIHRocm93IGVycjtcbiAgICB9XG4gIH07XG59O1xuXG52YXIgYmluZEVudmlyb25tZW50Rm9yV3JpdGUgPSBmdW5jdGlvbiAoY2FsbGJhY2spIHtcbiAgcmV0dXJuIE1ldGVvci5iaW5kRW52aXJvbm1lbnQoY2FsbGJhY2ssIFwiTW9uZ28gd3JpdGVcIik7XG59O1xuXG5Nb25nb0Nvbm5lY3Rpb24ucHJvdG90eXBlLl9pbnNlcnQgPSBmdW5jdGlvbiAoY29sbGVjdGlvbl9uYW1lLCBkb2N1bWVudCxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBjYWxsYmFjaykge1xuICB2YXIgc2VsZiA9IHRoaXM7XG5cbiAgdmFyIHNlbmRFcnJvciA9IGZ1bmN0aW9uIChlKSB7XG4gICAgaWYgKGNhbGxiYWNrKVxuICAgICAgcmV0dXJuIGNhbGxiYWNrKGUpO1xuICAgIHRocm93IGU7XG4gIH07XG5cbiAgaWYgKGNvbGxlY3Rpb25fbmFtZSA9PT0gXCJfX19tZXRlb3JfZmFpbHVyZV90ZXN0X2NvbGxlY3Rpb25cIikge1xuICAgIHZhciBlID0gbmV3IEVycm9yKFwiRmFpbHVyZSB0ZXN0XCIpO1xuICAgIGUuX2V4cGVjdGVkQnlUZXN0ID0gdHJ1ZTtcbiAgICBzZW5kRXJyb3IoZSk7XG4gICAgcmV0dXJuO1xuICB9XG5cbiAgaWYgKCEoTG9jYWxDb2xsZWN0aW9uLl9pc1BsYWluT2JqZWN0KGRvY3VtZW50KSAmJlxuICAgICAgICAhRUpTT04uX2lzQ3VzdG9tVHlwZShkb2N1bWVudCkpKSB7XG4gICAgc2VuZEVycm9yKG5ldyBFcnJvcihcbiAgICAgIFwiT25seSBwbGFpbiBvYmplY3RzIG1heSBiZSBpbnNlcnRlZCBpbnRvIE1vbmdvREJcIikpO1xuICAgIHJldHVybjtcbiAgfVxuXG4gIHZhciB3cml0ZSA9IHNlbGYuX21heWJlQmVnaW5Xcml0ZSgpO1xuICB2YXIgcmVmcmVzaCA9IGZ1bmN0aW9uICgpIHtcbiAgICBNZXRlb3IucmVmcmVzaCh7Y29sbGVjdGlvbjogY29sbGVjdGlvbl9uYW1lLCBpZDogZG9jdW1lbnQuX2lkIH0pO1xuICB9O1xuICBjYWxsYmFjayA9IGJpbmRFbnZpcm9ubWVudEZvcldyaXRlKHdyaXRlQ2FsbGJhY2sod3JpdGUsIHJlZnJlc2gsIGNhbGxiYWNrKSk7XG4gIHRyeSB7XG4gICAgdmFyIGNvbGxlY3Rpb24gPSBzZWxmLnJhd0NvbGxlY3Rpb24oY29sbGVjdGlvbl9uYW1lKTtcbiAgICBjb2xsZWN0aW9uLmluc2VydChyZXBsYWNlVHlwZXMoZG9jdW1lbnQsIHJlcGxhY2VNZXRlb3JBdG9tV2l0aE1vbmdvKSxcbiAgICAgICAgICAgICAgICAgICAgICB7c2FmZTogdHJ1ZX0sIGNhbGxiYWNrKTtcbiAgfSBjYXRjaCAoZXJyKSB7XG4gICAgd3JpdGUuY29tbWl0dGVkKCk7XG4gICAgdGhyb3cgZXJyO1xuICB9XG59O1xuXG4vLyBDYXVzZSBxdWVyaWVzIHRoYXQgbWF5IGJlIGFmZmVjdGVkIGJ5IHRoZSBzZWxlY3RvciB0byBwb2xsIGluIHRoaXMgd3JpdGVcbi8vIGZlbmNlLlxuTW9uZ29Db25uZWN0aW9uLnByb3RvdHlwZS5fcmVmcmVzaCA9IGZ1bmN0aW9uIChjb2xsZWN0aW9uTmFtZSwgc2VsZWN0b3IpIHtcbiAgdmFyIHJlZnJlc2hLZXkgPSB7Y29sbGVjdGlvbjogY29sbGVjdGlvbk5hbWV9O1xuICAvLyBJZiB3ZSBrbm93IHdoaWNoIGRvY3VtZW50cyB3ZSdyZSByZW1vdmluZywgZG9uJ3QgcG9sbCBxdWVyaWVzIHRoYXQgYXJlXG4gIC8vIHNwZWNpZmljIHRvIG90aGVyIGRvY3VtZW50cy4gKE5vdGUgdGhhdCBtdWx0aXBsZSBub3RpZmljYXRpb25zIGhlcmUgc2hvdWxkXG4gIC8vIG5vdCBjYXVzZSBtdWx0aXBsZSBwb2xscywgc2luY2UgYWxsIG91ciBsaXN0ZW5lciBpcyBkb2luZyBpcyBlbnF1ZXVlaW5nIGFcbiAgLy8gcG9sbC4pXG4gIHZhciBzcGVjaWZpY0lkcyA9IExvY2FsQ29sbGVjdGlvbi5faWRzTWF0Y2hlZEJ5U2VsZWN0b3Ioc2VsZWN0b3IpO1xuICBpZiAoc3BlY2lmaWNJZHMpIHtcbiAgICBfLmVhY2goc3BlY2lmaWNJZHMsIGZ1bmN0aW9uIChpZCkge1xuICAgICAgTWV0ZW9yLnJlZnJlc2goXy5leHRlbmQoe2lkOiBpZH0sIHJlZnJlc2hLZXkpKTtcbiAgICB9KTtcbiAgfSBlbHNlIHtcbiAgICBNZXRlb3IucmVmcmVzaChyZWZyZXNoS2V5KTtcbiAgfVxufTtcblxuTW9uZ29Db25uZWN0aW9uLnByb3RvdHlwZS5fcmVtb3ZlID0gZnVuY3Rpb24gKGNvbGxlY3Rpb25fbmFtZSwgc2VsZWN0b3IsXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgY2FsbGJhY2spIHtcbiAgdmFyIHNlbGYgPSB0aGlzO1xuXG4gIGlmIChjb2xsZWN0aW9uX25hbWUgPT09IFwiX19fbWV0ZW9yX2ZhaWx1cmVfdGVzdF9jb2xsZWN0aW9uXCIpIHtcbiAgICB2YXIgZSA9IG5ldyBFcnJvcihcIkZhaWx1cmUgdGVzdFwiKTtcbiAgICBlLl9leHBlY3RlZEJ5VGVzdCA9IHRydWU7XG4gICAgaWYgKGNhbGxiYWNrKSB7XG4gICAgICByZXR1cm4gY2FsbGJhY2soZSk7XG4gICAgfSBlbHNlIHtcbiAgICAgIHRocm93IGU7XG4gICAgfVxuICB9XG5cbiAgdmFyIHdyaXRlID0gc2VsZi5fbWF5YmVCZWdpbldyaXRlKCk7XG4gIHZhciByZWZyZXNoID0gZnVuY3Rpb24gKCkge1xuICAgIHNlbGYuX3JlZnJlc2goY29sbGVjdGlvbl9uYW1lLCBzZWxlY3Rvcik7XG4gIH07XG4gIGNhbGxiYWNrID0gYmluZEVudmlyb25tZW50Rm9yV3JpdGUod3JpdGVDYWxsYmFjayh3cml0ZSwgcmVmcmVzaCwgY2FsbGJhY2spKTtcblxuICB0cnkge1xuICAgIHZhciBjb2xsZWN0aW9uID0gc2VsZi5yYXdDb2xsZWN0aW9uKGNvbGxlY3Rpb25fbmFtZSk7XG4gICAgdmFyIHdyYXBwZWRDYWxsYmFjayA9IGZ1bmN0aW9uKGVyciwgZHJpdmVyUmVzdWx0KSB7XG4gICAgICBjYWxsYmFjayhlcnIsIHRyYW5zZm9ybVJlc3VsdChkcml2ZXJSZXN1bHQpLm51bWJlckFmZmVjdGVkKTtcbiAgICB9O1xuICAgIGNvbGxlY3Rpb24ucmVtb3ZlKHJlcGxhY2VUeXBlcyhzZWxlY3RvciwgcmVwbGFjZU1ldGVvckF0b21XaXRoTW9uZ28pLFxuICAgICAgICAgICAgICAgICAgICAgICB7c2FmZTogdHJ1ZX0sIHdyYXBwZWRDYWxsYmFjayk7XG4gIH0gY2F0Y2ggKGVycikge1xuICAgIHdyaXRlLmNvbW1pdHRlZCgpO1xuICAgIHRocm93IGVycjtcbiAgfVxufTtcblxuTW9uZ29Db25uZWN0aW9uLnByb3RvdHlwZS5fZHJvcENvbGxlY3Rpb24gPSBmdW5jdGlvbiAoY29sbGVjdGlvbk5hbWUsIGNiKSB7XG4gIHZhciBzZWxmID0gdGhpcztcblxuICB2YXIgd3JpdGUgPSBzZWxmLl9tYXliZUJlZ2luV3JpdGUoKTtcbiAgdmFyIHJlZnJlc2ggPSBmdW5jdGlvbiAoKSB7XG4gICAgTWV0ZW9yLnJlZnJlc2goe2NvbGxlY3Rpb246IGNvbGxlY3Rpb25OYW1lLCBpZDogbnVsbCxcbiAgICAgICAgICAgICAgICAgICAgZHJvcENvbGxlY3Rpb246IHRydWV9KTtcbiAgfTtcbiAgY2IgPSBiaW5kRW52aXJvbm1lbnRGb3JXcml0ZSh3cml0ZUNhbGxiYWNrKHdyaXRlLCByZWZyZXNoLCBjYikpO1xuXG4gIHRyeSB7XG4gICAgdmFyIGNvbGxlY3Rpb24gPSBzZWxmLnJhd0NvbGxlY3Rpb24oY29sbGVjdGlvbk5hbWUpO1xuICAgIGNvbGxlY3Rpb24uZHJvcChjYik7XG4gIH0gY2F0Y2ggKGUpIHtcbiAgICB3cml0ZS5jb21taXR0ZWQoKTtcbiAgICB0aHJvdyBlO1xuICB9XG59O1xuXG4vLyBGb3IgdGVzdGluZyBvbmx5LiAgU2xpZ2h0bHkgYmV0dGVyIHRoYW4gYGMucmF3RGF0YWJhc2UoKS5kcm9wRGF0YWJhc2UoKWBcbi8vIGJlY2F1c2UgaXQgbGV0cyB0aGUgdGVzdCdzIGZlbmNlIHdhaXQgZm9yIGl0IHRvIGJlIGNvbXBsZXRlLlxuTW9uZ29Db25uZWN0aW9uLnByb3RvdHlwZS5fZHJvcERhdGFiYXNlID0gZnVuY3Rpb24gKGNiKSB7XG4gIHZhciBzZWxmID0gdGhpcztcblxuICB2YXIgd3JpdGUgPSBzZWxmLl9tYXliZUJlZ2luV3JpdGUoKTtcbiAgdmFyIHJlZnJlc2ggPSBmdW5jdGlvbiAoKSB7XG4gICAgTWV0ZW9yLnJlZnJlc2goeyBkcm9wRGF0YWJhc2U6IHRydWUgfSk7XG4gIH07XG4gIGNiID0gYmluZEVudmlyb25tZW50Rm9yV3JpdGUod3JpdGVDYWxsYmFjayh3cml0ZSwgcmVmcmVzaCwgY2IpKTtcblxuICB0cnkge1xuICAgIHNlbGYuZGIuZHJvcERhdGFiYXNlKGNiKTtcbiAgfSBjYXRjaCAoZSkge1xuICAgIHdyaXRlLmNvbW1pdHRlZCgpO1xuICAgIHRocm93IGU7XG4gIH1cbn07XG5cbk1vbmdvQ29ubmVjdGlvbi5wcm90b3R5cGUuX3VwZGF0ZSA9IGZ1bmN0aW9uIChjb2xsZWN0aW9uX25hbWUsIHNlbGVjdG9yLCBtb2QsXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgb3B0aW9ucywgY2FsbGJhY2spIHtcbiAgdmFyIHNlbGYgPSB0aGlzO1xuXG4gIGlmICghIGNhbGxiYWNrICYmIG9wdGlvbnMgaW5zdGFuY2VvZiBGdW5jdGlvbikge1xuICAgIGNhbGxiYWNrID0gb3B0aW9ucztcbiAgICBvcHRpb25zID0gbnVsbDtcbiAgfVxuXG4gIGlmIChjb2xsZWN0aW9uX25hbWUgPT09IFwiX19fbWV0ZW9yX2ZhaWx1cmVfdGVzdF9jb2xsZWN0aW9uXCIpIHtcbiAgICB2YXIgZSA9IG5ldyBFcnJvcihcIkZhaWx1cmUgdGVzdFwiKTtcbiAgICBlLl9leHBlY3RlZEJ5VGVzdCA9IHRydWU7XG4gICAgaWYgKGNhbGxiYWNrKSB7XG4gICAgICByZXR1cm4gY2FsbGJhY2soZSk7XG4gICAgfSBlbHNlIHtcbiAgICAgIHRocm93IGU7XG4gICAgfVxuICB9XG5cbiAgLy8gZXhwbGljaXQgc2FmZXR5IGNoZWNrLiBudWxsIGFuZCB1bmRlZmluZWQgY2FuIGNyYXNoIHRoZSBtb25nb1xuICAvLyBkcml2ZXIuIEFsdGhvdWdoIHRoZSBub2RlIGRyaXZlciBhbmQgbWluaW1vbmdvIGRvICdzdXBwb3J0J1xuICAvLyBub24tb2JqZWN0IG1vZGlmaWVyIGluIHRoYXQgdGhleSBkb24ndCBjcmFzaCwgdGhleSBhcmUgbm90XG4gIC8vIG1lYW5pbmdmdWwgb3BlcmF0aW9ucyBhbmQgZG8gbm90IGRvIGFueXRoaW5nLiBEZWZlbnNpdmVseSB0aHJvdyBhblxuICAvLyBlcnJvciBoZXJlLlxuICBpZiAoIW1vZCB8fCB0eXBlb2YgbW9kICE9PSAnb2JqZWN0JylcbiAgICB0aHJvdyBuZXcgRXJyb3IoXCJJbnZhbGlkIG1vZGlmaWVyLiBNb2RpZmllciBtdXN0IGJlIGFuIG9iamVjdC5cIik7XG5cbiAgaWYgKCEoTG9jYWxDb2xsZWN0aW9uLl9pc1BsYWluT2JqZWN0KG1vZCkgJiZcbiAgICAgICAgIUVKU09OLl9pc0N1c3RvbVR5cGUobW9kKSkpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoXG4gICAgICBcIk9ubHkgcGxhaW4gb2JqZWN0cyBtYXkgYmUgdXNlZCBhcyByZXBsYWNlbWVudFwiICtcbiAgICAgICAgXCIgZG9jdW1lbnRzIGluIE1vbmdvREJcIik7XG4gIH1cblxuICBpZiAoIW9wdGlvbnMpIG9wdGlvbnMgPSB7fTtcblxuICB2YXIgd3JpdGUgPSBzZWxmLl9tYXliZUJlZ2luV3JpdGUoKTtcbiAgdmFyIHJlZnJlc2ggPSBmdW5jdGlvbiAoKSB7XG4gICAgc2VsZi5fcmVmcmVzaChjb2xsZWN0aW9uX25hbWUsIHNlbGVjdG9yKTtcbiAgfTtcbiAgY2FsbGJhY2sgPSB3cml0ZUNhbGxiYWNrKHdyaXRlLCByZWZyZXNoLCBjYWxsYmFjayk7XG4gIHRyeSB7XG4gICAgdmFyIGNvbGxlY3Rpb24gPSBzZWxmLnJhd0NvbGxlY3Rpb24oY29sbGVjdGlvbl9uYW1lKTtcbiAgICB2YXIgbW9uZ29PcHRzID0ge3NhZmU6IHRydWV9O1xuICAgIC8vIEFkZCBzdXBwb3J0IGZvciBmaWx0ZXJlZCBwb3NpdGlvbmFsIG9wZXJhdG9yXG4gICAgaWYgKG9wdGlvbnMuYXJyYXlGaWx0ZXJzICE9PSB1bmRlZmluZWQpIG1vbmdvT3B0cy5hcnJheUZpbHRlcnMgPSBvcHRpb25zLmFycmF5RmlsdGVycztcbiAgICAvLyBleHBsaWN0bHkgZW51bWVyYXRlIG9wdGlvbnMgdGhhdCBtaW5pbW9uZ28gc3VwcG9ydHNcbiAgICBpZiAob3B0aW9ucy51cHNlcnQpIG1vbmdvT3B0cy51cHNlcnQgPSB0cnVlO1xuICAgIGlmIChvcHRpb25zLm11bHRpKSBtb25nb09wdHMubXVsdGkgPSB0cnVlO1xuICAgIC8vIExldHMgeW91IGdldCBhIG1vcmUgbW9yZSBmdWxsIHJlc3VsdCBmcm9tIE1vbmdvREIuIFVzZSB3aXRoIGNhdXRpb246XG4gICAgLy8gbWlnaHQgbm90IHdvcmsgd2l0aCBDLnVwc2VydCAoYXMgb3Bwb3NlZCB0byBDLnVwZGF0ZSh7dXBzZXJ0OnRydWV9KSBvclxuICAgIC8vIHdpdGggc2ltdWxhdGVkIHVwc2VydC5cbiAgICBpZiAob3B0aW9ucy5mdWxsUmVzdWx0KSBtb25nb09wdHMuZnVsbFJlc3VsdCA9IHRydWU7XG5cbiAgICB2YXIgbW9uZ29TZWxlY3RvciA9IHJlcGxhY2VUeXBlcyhzZWxlY3RvciwgcmVwbGFjZU1ldGVvckF0b21XaXRoTW9uZ28pO1xuICAgIHZhciBtb25nb01vZCA9IHJlcGxhY2VUeXBlcyhtb2QsIHJlcGxhY2VNZXRlb3JBdG9tV2l0aE1vbmdvKTtcblxuICAgIHZhciBpc01vZGlmeSA9IExvY2FsQ29sbGVjdGlvbi5faXNNb2RpZmljYXRpb25Nb2QobW9uZ29Nb2QpO1xuXG4gICAgaWYgKG9wdGlvbnMuX2ZvcmJpZFJlcGxhY2UgJiYgIWlzTW9kaWZ5KSB7XG4gICAgICB2YXIgZXJyID0gbmV3IEVycm9yKFwiSW52YWxpZCBtb2RpZmllci4gUmVwbGFjZW1lbnRzIGFyZSBmb3JiaWRkZW4uXCIpO1xuICAgICAgaWYgKGNhbGxiYWNrKSB7XG4gICAgICAgIHJldHVybiBjYWxsYmFjayhlcnIpO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgdGhyb3cgZXJyO1xuICAgICAgfVxuICAgIH1cblxuICAgIC8vIFdlJ3ZlIGFscmVhZHkgcnVuIHJlcGxhY2VUeXBlcy9yZXBsYWNlTWV0ZW9yQXRvbVdpdGhNb25nbyBvblxuICAgIC8vIHNlbGVjdG9yIGFuZCBtb2QuICBXZSBhc3N1bWUgaXQgZG9lc24ndCBtYXR0ZXIsIGFzIGZhciBhc1xuICAgIC8vIHRoZSBiZWhhdmlvciBvZiBtb2RpZmllcnMgaXMgY29uY2VybmVkLCB3aGV0aGVyIGBfbW9kaWZ5YFxuICAgIC8vIGlzIHJ1biBvbiBFSlNPTiBvciBvbiBtb25nby1jb252ZXJ0ZWQgRUpTT04uXG5cbiAgICAvLyBSdW4gdGhpcyBjb2RlIHVwIGZyb250IHNvIHRoYXQgaXQgZmFpbHMgZmFzdCBpZiBzb21lb25lIHVzZXNcbiAgICAvLyBhIE1vbmdvIHVwZGF0ZSBvcGVyYXRvciB3ZSBkb24ndCBzdXBwb3J0LlxuICAgIGxldCBrbm93bklkO1xuICAgIGlmIChvcHRpb25zLnVwc2VydCkge1xuICAgICAgdHJ5IHtcbiAgICAgICAgbGV0IG5ld0RvYyA9IExvY2FsQ29sbGVjdGlvbi5fY3JlYXRlVXBzZXJ0RG9jdW1lbnQoc2VsZWN0b3IsIG1vZCk7XG4gICAgICAgIGtub3duSWQgPSBuZXdEb2MuX2lkO1xuICAgICAgfSBjYXRjaCAoZXJyKSB7XG4gICAgICAgIGlmIChjYWxsYmFjaykge1xuICAgICAgICAgIHJldHVybiBjYWxsYmFjayhlcnIpO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIHRocm93IGVycjtcbiAgICAgICAgfVxuICAgICAgfVxuICAgIH1cblxuICAgIGlmIChvcHRpb25zLnVwc2VydCAmJlxuICAgICAgICAhIGlzTW9kaWZ5ICYmXG4gICAgICAgICEga25vd25JZCAmJlxuICAgICAgICBvcHRpb25zLmluc2VydGVkSWQgJiZcbiAgICAgICAgISAob3B0aW9ucy5pbnNlcnRlZElkIGluc3RhbmNlb2YgTW9uZ28uT2JqZWN0SUQgJiZcbiAgICAgICAgICAgb3B0aW9ucy5nZW5lcmF0ZWRJZCkpIHtcbiAgICAgIC8vIEluIGNhc2Ugb2YgYW4gdXBzZXJ0IHdpdGggYSByZXBsYWNlbWVudCwgd2hlcmUgdGhlcmUgaXMgbm8gX2lkIGRlZmluZWRcbiAgICAgIC8vIGluIGVpdGhlciB0aGUgcXVlcnkgb3IgdGhlIHJlcGxhY2VtZW50IGRvYywgbW9uZ28gd2lsbCBnZW5lcmF0ZSBhbiBpZCBpdHNlbGYuXG4gICAgICAvLyBUaGVyZWZvcmUgd2UgbmVlZCB0aGlzIHNwZWNpYWwgc3RyYXRlZ3kgaWYgd2Ugd2FudCB0byBjb250cm9sIHRoZSBpZCBvdXJzZWx2ZXMuXG5cbiAgICAgIC8vIFdlIGRvbid0IG5lZWQgdG8gZG8gdGhpcyB3aGVuOlxuICAgICAgLy8gLSBUaGlzIGlzIG5vdCBhIHJlcGxhY2VtZW50LCBzbyB3ZSBjYW4gYWRkIGFuIF9pZCB0byAkc2V0T25JbnNlcnRcbiAgICAgIC8vIC0gVGhlIGlkIGlzIGRlZmluZWQgYnkgcXVlcnkgb3IgbW9kIHdlIGNhbiBqdXN0IGFkZCBpdCB0byB0aGUgcmVwbGFjZW1lbnQgZG9jXG4gICAgICAvLyAtIFRoZSB1c2VyIGRpZCBub3Qgc3BlY2lmeSBhbnkgaWQgcHJlZmVyZW5jZSBhbmQgdGhlIGlkIGlzIGEgTW9uZ28gT2JqZWN0SWQsXG4gICAgICAvLyAgICAgdGhlbiB3ZSBjYW4ganVzdCBsZXQgTW9uZ28gZ2VuZXJhdGUgdGhlIGlkXG5cbiAgICAgIHNpbXVsYXRlVXBzZXJ0V2l0aEluc2VydGVkSWQoXG4gICAgICAgIGNvbGxlY3Rpb24sIG1vbmdvU2VsZWN0b3IsIG1vbmdvTW9kLCBvcHRpb25zLFxuICAgICAgICAvLyBUaGlzIGNhbGxiYWNrIGRvZXMgbm90IG5lZWQgdG8gYmUgYmluZEVudmlyb25tZW50J2VkIGJlY2F1c2VcbiAgICAgICAgLy8gc2ltdWxhdGVVcHNlcnRXaXRoSW5zZXJ0ZWRJZCgpIHdyYXBzIGl0IGFuZCB0aGVuIHBhc3NlcyBpdCB0aHJvdWdoXG4gICAgICAgIC8vIGJpbmRFbnZpcm9ubWVudEZvcldyaXRlLlxuICAgICAgICBmdW5jdGlvbiAoZXJyb3IsIHJlc3VsdCkge1xuICAgICAgICAgIC8vIElmIHdlIGdvdCBoZXJlIHZpYSBhIHVwc2VydCgpIGNhbGwsIHRoZW4gb3B0aW9ucy5fcmV0dXJuT2JqZWN0IHdpbGxcbiAgICAgICAgICAvLyBiZSBzZXQgYW5kIHdlIHNob3VsZCByZXR1cm4gdGhlIHdob2xlIG9iamVjdC4gT3RoZXJ3aXNlLCB3ZSBzaG91bGRcbiAgICAgICAgICAvLyBqdXN0IHJldHVybiB0aGUgbnVtYmVyIG9mIGFmZmVjdGVkIGRvY3MgdG8gbWF0Y2ggdGhlIG1vbmdvIEFQSS5cbiAgICAgICAgICBpZiAocmVzdWx0ICYmICEgb3B0aW9ucy5fcmV0dXJuT2JqZWN0KSB7XG4gICAgICAgICAgICBjYWxsYmFjayhlcnJvciwgcmVzdWx0Lm51bWJlckFmZmVjdGVkKTtcbiAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgY2FsbGJhY2soZXJyb3IsIHJlc3VsdCk7XG4gICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICApO1xuICAgIH0gZWxzZSB7XG5cbiAgICAgIGlmIChvcHRpb25zLnVwc2VydCAmJiAha25vd25JZCAmJiBvcHRpb25zLmluc2VydGVkSWQgJiYgaXNNb2RpZnkpIHtcbiAgICAgICAgaWYgKCFtb25nb01vZC5oYXNPd25Qcm9wZXJ0eSgnJHNldE9uSW5zZXJ0JykpIHtcbiAgICAgICAgICBtb25nb01vZC4kc2V0T25JbnNlcnQgPSB7fTtcbiAgICAgICAgfVxuICAgICAgICBrbm93bklkID0gb3B0aW9ucy5pbnNlcnRlZElkO1xuICAgICAgICBPYmplY3QuYXNzaWduKG1vbmdvTW9kLiRzZXRPbkluc2VydCwgcmVwbGFjZVR5cGVzKHtfaWQ6IG9wdGlvbnMuaW5zZXJ0ZWRJZH0sIHJlcGxhY2VNZXRlb3JBdG9tV2l0aE1vbmdvKSk7XG4gICAgICB9XG5cbiAgICAgIGNvbGxlY3Rpb24udXBkYXRlKFxuICAgICAgICBtb25nb1NlbGVjdG9yLCBtb25nb01vZCwgbW9uZ29PcHRzLFxuICAgICAgICBiaW5kRW52aXJvbm1lbnRGb3JXcml0ZShmdW5jdGlvbiAoZXJyLCByZXN1bHQpIHtcbiAgICAgICAgICBpZiAoISBlcnIpIHtcbiAgICAgICAgICAgIHZhciBtZXRlb3JSZXN1bHQgPSB0cmFuc2Zvcm1SZXN1bHQocmVzdWx0KTtcbiAgICAgICAgICAgIGlmIChtZXRlb3JSZXN1bHQgJiYgb3B0aW9ucy5fcmV0dXJuT2JqZWN0KSB7XG4gICAgICAgICAgICAgIC8vIElmIHRoaXMgd2FzIGFuIHVwc2VydCgpIGNhbGwsIGFuZCB3ZSBlbmRlZCB1cFxuICAgICAgICAgICAgICAvLyBpbnNlcnRpbmcgYSBuZXcgZG9jIGFuZCB3ZSBrbm93IGl0cyBpZCwgdGhlblxuICAgICAgICAgICAgICAvLyByZXR1cm4gdGhhdCBpZCBhcyB3ZWxsLlxuICAgICAgICAgICAgICBpZiAob3B0aW9ucy51cHNlcnQgJiYgbWV0ZW9yUmVzdWx0Lmluc2VydGVkSWQpIHtcbiAgICAgICAgICAgICAgICBpZiAoa25vd25JZCkge1xuICAgICAgICAgICAgICAgICAgbWV0ZW9yUmVzdWx0Lmluc2VydGVkSWQgPSBrbm93bklkO1xuICAgICAgICAgICAgICAgIH0gZWxzZSBpZiAobWV0ZW9yUmVzdWx0Lmluc2VydGVkSWQgaW5zdGFuY2VvZiBNb25nb0RCLk9iamVjdElEKSB7XG4gICAgICAgICAgICAgICAgICBtZXRlb3JSZXN1bHQuaW5zZXJ0ZWRJZCA9IG5ldyBNb25nby5PYmplY3RJRChtZXRlb3JSZXN1bHQuaW5zZXJ0ZWRJZC50b0hleFN0cmluZygpKTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgICBjYWxsYmFjayhlcnIsIG1ldGVvclJlc3VsdCk7XG4gICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICBjYWxsYmFjayhlcnIsIG1ldGVvclJlc3VsdC5udW1iZXJBZmZlY3RlZCk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIGNhbGxiYWNrKGVycik7XG4gICAgICAgICAgfVxuICAgICAgICB9KSk7XG4gICAgfVxuICB9IGNhdGNoIChlKSB7XG4gICAgd3JpdGUuY29tbWl0dGVkKCk7XG4gICAgdGhyb3cgZTtcbiAgfVxufTtcblxudmFyIHRyYW5zZm9ybVJlc3VsdCA9IGZ1bmN0aW9uIChkcml2ZXJSZXN1bHQpIHtcbiAgdmFyIG1ldGVvclJlc3VsdCA9IHsgbnVtYmVyQWZmZWN0ZWQ6IDAgfTtcbiAgaWYgKGRyaXZlclJlc3VsdCkge1xuICAgIHZhciBtb25nb1Jlc3VsdCA9IGRyaXZlclJlc3VsdC5yZXN1bHQ7XG5cbiAgICAvLyBPbiB1cGRhdGVzIHdpdGggdXBzZXJ0OnRydWUsIHRoZSBpbnNlcnRlZCB2YWx1ZXMgY29tZSBhcyBhIGxpc3Qgb2ZcbiAgICAvLyB1cHNlcnRlZCB2YWx1ZXMgLS0gZXZlbiB3aXRoIG9wdGlvbnMubXVsdGksIHdoZW4gdGhlIHVwc2VydCBkb2VzIGluc2VydCxcbiAgICAvLyBpdCBvbmx5IGluc2VydHMgb25lIGVsZW1lbnQuXG4gICAgaWYgKG1vbmdvUmVzdWx0LnVwc2VydGVkKSB7XG4gICAgICBtZXRlb3JSZXN1bHQubnVtYmVyQWZmZWN0ZWQgKz0gbW9uZ29SZXN1bHQudXBzZXJ0ZWQubGVuZ3RoO1xuXG4gICAgICBpZiAobW9uZ29SZXN1bHQudXBzZXJ0ZWQubGVuZ3RoID09IDEpIHtcbiAgICAgICAgbWV0ZW9yUmVzdWx0Lmluc2VydGVkSWQgPSBtb25nb1Jlc3VsdC51cHNlcnRlZFswXS5faWQ7XG4gICAgICB9XG4gICAgfSBlbHNlIHtcbiAgICAgIG1ldGVvclJlc3VsdC5udW1iZXJBZmZlY3RlZCA9IG1vbmdvUmVzdWx0Lm47XG4gICAgfVxuICB9XG5cbiAgcmV0dXJuIG1ldGVvclJlc3VsdDtcbn07XG5cblxudmFyIE5VTV9PUFRJTUlTVElDX1RSSUVTID0gMztcblxuLy8gZXhwb3NlZCBmb3IgdGVzdGluZ1xuTW9uZ29Db25uZWN0aW9uLl9pc0Nhbm5vdENoYW5nZUlkRXJyb3IgPSBmdW5jdGlvbiAoZXJyKSB7XG5cbiAgLy8gTW9uZ28gMy4yLiogcmV0dXJucyBlcnJvciBhcyBuZXh0IE9iamVjdDpcbiAgLy8ge25hbWU6IFN0cmluZywgY29kZTogTnVtYmVyLCBlcnJtc2c6IFN0cmluZ31cbiAgLy8gT2xkZXIgTW9uZ28gcmV0dXJuczpcbiAgLy8ge25hbWU6IFN0cmluZywgY29kZTogTnVtYmVyLCBlcnI6IFN0cmluZ31cbiAgdmFyIGVycm9yID0gZXJyLmVycm1zZyB8fCBlcnIuZXJyO1xuXG4gIC8vIFdlIGRvbid0IHVzZSB0aGUgZXJyb3IgY29kZSBoZXJlXG4gIC8vIGJlY2F1c2UgdGhlIGVycm9yIGNvZGUgd2Ugb2JzZXJ2ZWQgaXQgcHJvZHVjaW5nICgxNjgzNykgYXBwZWFycyB0byBiZVxuICAvLyBhIGZhciBtb3JlIGdlbmVyaWMgZXJyb3IgY29kZSBiYXNlZCBvbiBleGFtaW5pbmcgdGhlIHNvdXJjZS5cbiAgaWYgKGVycm9yLmluZGV4T2YoJ1RoZSBfaWQgZmllbGQgY2Fubm90IGJlIGNoYW5nZWQnKSA9PT0gMFxuICAgIHx8IGVycm9yLmluZGV4T2YoXCJ0aGUgKGltbXV0YWJsZSkgZmllbGQgJ19pZCcgd2FzIGZvdW5kIHRvIGhhdmUgYmVlbiBhbHRlcmVkIHRvIF9pZFwiKSAhPT0gLTEpIHtcbiAgICByZXR1cm4gdHJ1ZTtcbiAgfVxuXG4gIHJldHVybiBmYWxzZTtcbn07XG5cbnZhciBzaW11bGF0ZVVwc2VydFdpdGhJbnNlcnRlZElkID0gZnVuY3Rpb24gKGNvbGxlY3Rpb24sIHNlbGVjdG9yLCBtb2QsXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBvcHRpb25zLCBjYWxsYmFjaykge1xuICAvLyBTVFJBVEVHWTogRmlyc3QgdHJ5IGRvaW5nIGFuIHVwc2VydCB3aXRoIGEgZ2VuZXJhdGVkIElELlxuICAvLyBJZiB0aGlzIHRocm93cyBhbiBlcnJvciBhYm91dCBjaGFuZ2luZyB0aGUgSUQgb24gYW4gZXhpc3RpbmcgZG9jdW1lbnRcbiAgLy8gdGhlbiB3aXRob3V0IGFmZmVjdGluZyB0aGUgZGF0YWJhc2UsIHdlIGtub3cgd2Ugc2hvdWxkIHByb2JhYmx5IHRyeVxuICAvLyBhbiB1cGRhdGUgd2l0aG91dCB0aGUgZ2VuZXJhdGVkIElELiBJZiBpdCBhZmZlY3RlZCAwIGRvY3VtZW50cyxcbiAgLy8gdGhlbiB3aXRob3V0IGFmZmVjdGluZyB0aGUgZGF0YWJhc2UsIHdlIHRoZSBkb2N1bWVudCB0aGF0IGZpcnN0XG4gIC8vIGdhdmUgdGhlIGVycm9yIGlzIHByb2JhYmx5IHJlbW92ZWQgYW5kIHdlIG5lZWQgdG8gdHJ5IGFuIGluc2VydCBhZ2FpblxuICAvLyBXZSBnbyBiYWNrIHRvIHN0ZXAgb25lIGFuZCByZXBlYXQuXG4gIC8vIExpa2UgYWxsIFwib3B0aW1pc3RpYyB3cml0ZVwiIHNjaGVtZXMsIHdlIHJlbHkgb24gdGhlIGZhY3QgdGhhdCBpdCdzXG4gIC8vIHVubGlrZWx5IG91ciB3cml0ZXMgd2lsbCBjb250aW51ZSB0byBiZSBpbnRlcmZlcmVkIHdpdGggdW5kZXIgbm9ybWFsXG4gIC8vIGNpcmN1bXN0YW5jZXMgKHRob3VnaCBzdWZmaWNpZW50bHkgaGVhdnkgY29udGVudGlvbiB3aXRoIHdyaXRlcnNcbiAgLy8gZGlzYWdyZWVpbmcgb24gdGhlIGV4aXN0ZW5jZSBvZiBhbiBvYmplY3Qgd2lsbCBjYXVzZSB3cml0ZXMgdG8gZmFpbFxuICAvLyBpbiB0aGVvcnkpLlxuXG4gIHZhciBpbnNlcnRlZElkID0gb3B0aW9ucy5pbnNlcnRlZElkOyAvLyBtdXN0IGV4aXN0XG4gIHZhciBtb25nb09wdHNGb3JVcGRhdGUgPSB7XG4gICAgc2FmZTogdHJ1ZSxcbiAgICBtdWx0aTogb3B0aW9ucy5tdWx0aVxuICB9O1xuICB2YXIgbW9uZ29PcHRzRm9ySW5zZXJ0ID0ge1xuICAgIHNhZmU6IHRydWUsXG4gICAgdXBzZXJ0OiB0cnVlXG4gIH07XG5cbiAgdmFyIHJlcGxhY2VtZW50V2l0aElkID0gT2JqZWN0LmFzc2lnbihcbiAgICByZXBsYWNlVHlwZXMoe19pZDogaW5zZXJ0ZWRJZH0sIHJlcGxhY2VNZXRlb3JBdG9tV2l0aE1vbmdvKSxcbiAgICBtb2QpO1xuXG4gIHZhciB0cmllcyA9IE5VTV9PUFRJTUlTVElDX1RSSUVTO1xuXG4gIHZhciBkb1VwZGF0ZSA9IGZ1bmN0aW9uICgpIHtcbiAgICB0cmllcy0tO1xuICAgIGlmICghIHRyaWVzKSB7XG4gICAgICBjYWxsYmFjayhuZXcgRXJyb3IoXCJVcHNlcnQgZmFpbGVkIGFmdGVyIFwiICsgTlVNX09QVElNSVNUSUNfVFJJRVMgKyBcIiB0cmllcy5cIikpO1xuICAgIH0gZWxzZSB7XG4gICAgICBjb2xsZWN0aW9uLnVwZGF0ZShzZWxlY3RvciwgbW9kLCBtb25nb09wdHNGb3JVcGRhdGUsXG4gICAgICAgICAgICAgICAgICAgICAgICBiaW5kRW52aXJvbm1lbnRGb3JXcml0ZShmdW5jdGlvbiAoZXJyLCByZXN1bHQpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgaWYgKGVycikge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNhbGxiYWNrKGVycik7XG4gICAgICAgICAgICAgICAgICAgICAgICAgIH0gZWxzZSBpZiAocmVzdWx0ICYmIHJlc3VsdC5yZXN1bHQubiAhPSAwKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgY2FsbGJhY2sobnVsbCwge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgbnVtYmVyQWZmZWN0ZWQ6IHJlc3VsdC5yZXN1bHQublxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgICAgICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGRvQ29uZGl0aW9uYWxJbnNlcnQoKTtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICAgICAgfSkpO1xuICAgIH1cbiAgfTtcblxuICB2YXIgZG9Db25kaXRpb25hbEluc2VydCA9IGZ1bmN0aW9uICgpIHtcbiAgICBjb2xsZWN0aW9uLnVwZGF0ZShzZWxlY3RvciwgcmVwbGFjZW1lbnRXaXRoSWQsIG1vbmdvT3B0c0Zvckluc2VydCxcbiAgICAgICAgICAgICAgICAgICAgICBiaW5kRW52aXJvbm1lbnRGb3JXcml0ZShmdW5jdGlvbiAoZXJyLCByZXN1bHQpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIGlmIChlcnIpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgLy8gZmlndXJlIG91dCBpZiB0aGlzIGlzIGFcbiAgICAgICAgICAgICAgICAgICAgICAgICAgLy8gXCJjYW5ub3QgY2hhbmdlIF9pZCBvZiBkb2N1bWVudFwiIGVycm9yLCBhbmRcbiAgICAgICAgICAgICAgICAgICAgICAgICAgLy8gaWYgc28sIHRyeSBkb1VwZGF0ZSgpIGFnYWluLCB1cCB0byAzIHRpbWVzLlxuICAgICAgICAgICAgICAgICAgICAgICAgICBpZiAoTW9uZ29Db25uZWN0aW9uLl9pc0Nhbm5vdENoYW5nZUlkRXJyb3IoZXJyKSkge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGRvVXBkYXRlKCk7XG4gICAgICAgICAgICAgICAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgY2FsbGJhY2soZXJyKTtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgY2FsbGJhY2sobnVsbCwge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIG51bWJlckFmZmVjdGVkOiByZXN1bHQucmVzdWx0LnVwc2VydGVkLmxlbmd0aCxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBpbnNlcnRlZElkOiBpbnNlcnRlZElkLFxuICAgICAgICAgICAgICAgICAgICAgICAgICB9KTtcbiAgICAgICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgICB9KSk7XG4gIH07XG5cbiAgZG9VcGRhdGUoKTtcbn07XG5cbl8uZWFjaChbXCJpbnNlcnRcIiwgXCJ1cGRhdGVcIiwgXCJyZW1vdmVcIiwgXCJkcm9wQ29sbGVjdGlvblwiLCBcImRyb3BEYXRhYmFzZVwiXSwgZnVuY3Rpb24gKG1ldGhvZCkge1xuICBNb25nb0Nvbm5lY3Rpb24ucHJvdG90eXBlW21ldGhvZF0gPSBmdW5jdGlvbiAoLyogYXJndW1lbnRzICovKSB7XG4gICAgdmFyIHNlbGYgPSB0aGlzO1xuICAgIHJldHVybiBNZXRlb3Iud3JhcEFzeW5jKHNlbGZbXCJfXCIgKyBtZXRob2RdKS5hcHBseShzZWxmLCBhcmd1bWVudHMpO1xuICB9O1xufSk7XG5cbi8vIFhYWCBNb25nb0Nvbm5lY3Rpb24udXBzZXJ0KCkgZG9lcyBub3QgcmV0dXJuIHRoZSBpZCBvZiB0aGUgaW5zZXJ0ZWQgZG9jdW1lbnRcbi8vIHVubGVzcyB5b3Ugc2V0IGl0IGV4cGxpY2l0bHkgaW4gdGhlIHNlbGVjdG9yIG9yIG1vZGlmaWVyIChhcyBhIHJlcGxhY2VtZW50XG4vLyBkb2MpLlxuTW9uZ29Db25uZWN0aW9uLnByb3RvdHlwZS51cHNlcnQgPSBmdW5jdGlvbiAoY29sbGVjdGlvbk5hbWUsIHNlbGVjdG9yLCBtb2QsXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBvcHRpb25zLCBjYWxsYmFjaykge1xuICB2YXIgc2VsZiA9IHRoaXM7XG4gIGlmICh0eXBlb2Ygb3B0aW9ucyA9PT0gXCJmdW5jdGlvblwiICYmICEgY2FsbGJhY2spIHtcbiAgICBjYWxsYmFjayA9IG9wdGlvbnM7XG4gICAgb3B0aW9ucyA9IHt9O1xuICB9XG5cbiAgcmV0dXJuIHNlbGYudXBkYXRlKGNvbGxlY3Rpb25OYW1lLCBzZWxlY3RvciwgbW9kLFxuICAgICAgICAgICAgICAgICAgICAgXy5leHRlbmQoe30sIG9wdGlvbnMsIHtcbiAgICAgICAgICAgICAgICAgICAgICAgdXBzZXJ0OiB0cnVlLFxuICAgICAgICAgICAgICAgICAgICAgICBfcmV0dXJuT2JqZWN0OiB0cnVlXG4gICAgICAgICAgICAgICAgICAgICB9KSwgY2FsbGJhY2spO1xufTtcblxuTW9uZ29Db25uZWN0aW9uLnByb3RvdHlwZS5maW5kID0gZnVuY3Rpb24gKGNvbGxlY3Rpb25OYW1lLCBzZWxlY3Rvciwgb3B0aW9ucykge1xuICB2YXIgc2VsZiA9IHRoaXM7XG5cbiAgaWYgKGFyZ3VtZW50cy5sZW5ndGggPT09IDEpXG4gICAgc2VsZWN0b3IgPSB7fTtcblxuICByZXR1cm4gbmV3IEN1cnNvcihcbiAgICBzZWxmLCBuZXcgQ3Vyc29yRGVzY3JpcHRpb24oY29sbGVjdGlvbk5hbWUsIHNlbGVjdG9yLCBvcHRpb25zKSk7XG59O1xuXG5Nb25nb0Nvbm5lY3Rpb24ucHJvdG90eXBlLmZpbmRPbmUgPSBmdW5jdGlvbiAoY29sbGVjdGlvbl9uYW1lLCBzZWxlY3RvcixcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBvcHRpb25zKSB7XG4gIHZhciBzZWxmID0gdGhpcztcbiAgaWYgKGFyZ3VtZW50cy5sZW5ndGggPT09IDEpXG4gICAgc2VsZWN0b3IgPSB7fTtcblxuICBvcHRpb25zID0gb3B0aW9ucyB8fCB7fTtcbiAgb3B0aW9ucy5saW1pdCA9IDE7XG4gIHJldHVybiBzZWxmLmZpbmQoY29sbGVjdGlvbl9uYW1lLCBzZWxlY3Rvciwgb3B0aW9ucykuZmV0Y2goKVswXTtcbn07XG5cbi8vIFdlJ2xsIGFjdHVhbGx5IGRlc2lnbiBhbiBpbmRleCBBUEkgbGF0ZXIuIEZvciBub3csIHdlIGp1c3QgcGFzcyB0aHJvdWdoIHRvXG4vLyBNb25nbydzLCBidXQgbWFrZSBpdCBzeW5jaHJvbm91cy5cbk1vbmdvQ29ubmVjdGlvbi5wcm90b3R5cGUuX2Vuc3VyZUluZGV4ID0gZnVuY3Rpb24gKGNvbGxlY3Rpb25OYW1lLCBpbmRleCxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIG9wdGlvbnMpIHtcbiAgdmFyIHNlbGYgPSB0aGlzO1xuXG4gIC8vIFdlIGV4cGVjdCB0aGlzIGZ1bmN0aW9uIHRvIGJlIGNhbGxlZCBhdCBzdGFydHVwLCBub3QgZnJvbSB3aXRoaW4gYSBtZXRob2QsXG4gIC8vIHNvIHdlIGRvbid0IGludGVyYWN0IHdpdGggdGhlIHdyaXRlIGZlbmNlLlxuICB2YXIgY29sbGVjdGlvbiA9IHNlbGYucmF3Q29sbGVjdGlvbihjb2xsZWN0aW9uTmFtZSk7XG4gIHZhciBmdXR1cmUgPSBuZXcgRnV0dXJlO1xuICB2YXIgaW5kZXhOYW1lID0gY29sbGVjdGlvbi5lbnN1cmVJbmRleChpbmRleCwgb3B0aW9ucywgZnV0dXJlLnJlc29sdmVyKCkpO1xuICBmdXR1cmUud2FpdCgpO1xufTtcbk1vbmdvQ29ubmVjdGlvbi5wcm90b3R5cGUuX2Ryb3BJbmRleCA9IGZ1bmN0aW9uIChjb2xsZWN0aW9uTmFtZSwgaW5kZXgpIHtcbiAgdmFyIHNlbGYgPSB0aGlzO1xuXG4gIC8vIFRoaXMgZnVuY3Rpb24gaXMgb25seSB1c2VkIGJ5IHRlc3QgY29kZSwgbm90IHdpdGhpbiBhIG1ldGhvZCwgc28gd2UgZG9uJ3RcbiAgLy8gaW50ZXJhY3Qgd2l0aCB0aGUgd3JpdGUgZmVuY2UuXG4gIHZhciBjb2xsZWN0aW9uID0gc2VsZi5yYXdDb2xsZWN0aW9uKGNvbGxlY3Rpb25OYW1lKTtcbiAgdmFyIGZ1dHVyZSA9IG5ldyBGdXR1cmU7XG4gIHZhciBpbmRleE5hbWUgPSBjb2xsZWN0aW9uLmRyb3BJbmRleChpbmRleCwgZnV0dXJlLnJlc29sdmVyKCkpO1xuICBmdXR1cmUud2FpdCgpO1xufTtcblxuLy8gQ1VSU09SU1xuXG4vLyBUaGVyZSBhcmUgc2V2ZXJhbCBjbGFzc2VzIHdoaWNoIHJlbGF0ZSB0byBjdXJzb3JzOlxuLy9cbi8vIEN1cnNvckRlc2NyaXB0aW9uIHJlcHJlc2VudHMgdGhlIGFyZ3VtZW50cyB1c2VkIHRvIGNvbnN0cnVjdCBhIGN1cnNvcjpcbi8vIGNvbGxlY3Rpb25OYW1lLCBzZWxlY3RvciwgYW5kIChmaW5kKSBvcHRpb25zLiAgQmVjYXVzZSBpdCBpcyB1c2VkIGFzIGEga2V5XG4vLyBmb3IgY3Vyc29yIGRlLWR1cCwgZXZlcnl0aGluZyBpbiBpdCBzaG91bGQgZWl0aGVyIGJlIEpTT04tc3RyaW5naWZpYWJsZSBvclxuLy8gbm90IGFmZmVjdCBvYnNlcnZlQ2hhbmdlcyBvdXRwdXQgKGVnLCBvcHRpb25zLnRyYW5zZm9ybSBmdW5jdGlvbnMgYXJlIG5vdFxuLy8gc3RyaW5naWZpYWJsZSBidXQgZG8gbm90IGFmZmVjdCBvYnNlcnZlQ2hhbmdlcykuXG4vL1xuLy8gU3luY2hyb25vdXNDdXJzb3IgaXMgYSB3cmFwcGVyIGFyb3VuZCBhIE1vbmdvREIgY3Vyc29yXG4vLyB3aGljaCBpbmNsdWRlcyBmdWxseS1zeW5jaHJvbm91cyB2ZXJzaW9ucyBvZiBmb3JFYWNoLCBldGMuXG4vL1xuLy8gQ3Vyc29yIGlzIHRoZSBjdXJzb3Igb2JqZWN0IHJldHVybmVkIGZyb20gZmluZCgpLCB3aGljaCBpbXBsZW1lbnRzIHRoZVxuLy8gZG9jdW1lbnRlZCBNb25nby5Db2xsZWN0aW9uIGN1cnNvciBBUEkuICBJdCB3cmFwcyBhIEN1cnNvckRlc2NyaXB0aW9uIGFuZCBhXG4vLyBTeW5jaHJvbm91c0N1cnNvciAobGF6aWx5OiBpdCBkb2Vzbid0IGNvbnRhY3QgTW9uZ28gdW50aWwgeW91IGNhbGwgYSBtZXRob2Rcbi8vIGxpa2UgZmV0Y2ggb3IgZm9yRWFjaCBvbiBpdCkuXG4vL1xuLy8gT2JzZXJ2ZUhhbmRsZSBpcyB0aGUgXCJvYnNlcnZlIGhhbmRsZVwiIHJldHVybmVkIGZyb20gb2JzZXJ2ZUNoYW5nZXMuIEl0IGhhcyBhXG4vLyByZWZlcmVuY2UgdG8gYW4gT2JzZXJ2ZU11bHRpcGxleGVyLlxuLy9cbi8vIE9ic2VydmVNdWx0aXBsZXhlciBhbGxvd3MgbXVsdGlwbGUgaWRlbnRpY2FsIE9ic2VydmVIYW5kbGVzIHRvIGJlIGRyaXZlbiBieSBhXG4vLyBzaW5nbGUgb2JzZXJ2ZSBkcml2ZXIuXG4vL1xuLy8gVGhlcmUgYXJlIHR3byBcIm9ic2VydmUgZHJpdmVyc1wiIHdoaWNoIGRyaXZlIE9ic2VydmVNdWx0aXBsZXhlcnM6XG4vLyAgIC0gUG9sbGluZ09ic2VydmVEcml2ZXIgY2FjaGVzIHRoZSByZXN1bHRzIG9mIGEgcXVlcnkgYW5kIHJlcnVucyBpdCB3aGVuXG4vLyAgICAgbmVjZXNzYXJ5LlxuLy8gICAtIE9wbG9nT2JzZXJ2ZURyaXZlciBmb2xsb3dzIHRoZSBNb25nbyBvcGVyYXRpb24gbG9nIHRvIGRpcmVjdGx5IG9ic2VydmVcbi8vICAgICBkYXRhYmFzZSBjaGFuZ2VzLlxuLy8gQm90aCBpbXBsZW1lbnRhdGlvbnMgZm9sbG93IHRoZSBzYW1lIHNpbXBsZSBpbnRlcmZhY2U6IHdoZW4geW91IGNyZWF0ZSB0aGVtLFxuLy8gdGhleSBzdGFydCBzZW5kaW5nIG9ic2VydmVDaGFuZ2VzIGNhbGxiYWNrcyAoYW5kIGEgcmVhZHkoKSBpbnZvY2F0aW9uKSB0b1xuLy8gdGhlaXIgT2JzZXJ2ZU11bHRpcGxleGVyLCBhbmQgeW91IHN0b3AgdGhlbSBieSBjYWxsaW5nIHRoZWlyIHN0b3AoKSBtZXRob2QuXG5cbkN1cnNvckRlc2NyaXB0aW9uID0gZnVuY3Rpb24gKGNvbGxlY3Rpb25OYW1lLCBzZWxlY3Rvciwgb3B0aW9ucykge1xuICB2YXIgc2VsZiA9IHRoaXM7XG4gIHNlbGYuY29sbGVjdGlvbk5hbWUgPSBjb2xsZWN0aW9uTmFtZTtcbiAgc2VsZi5zZWxlY3RvciA9IE1vbmdvLkNvbGxlY3Rpb24uX3Jld3JpdGVTZWxlY3RvcihzZWxlY3Rvcik7XG4gIHNlbGYub3B0aW9ucyA9IG9wdGlvbnMgfHwge307XG59O1xuXG5DdXJzb3IgPSBmdW5jdGlvbiAobW9uZ28sIGN1cnNvckRlc2NyaXB0aW9uKSB7XG4gIHZhciBzZWxmID0gdGhpcztcblxuICBzZWxmLl9tb25nbyA9IG1vbmdvO1xuICBzZWxmLl9jdXJzb3JEZXNjcmlwdGlvbiA9IGN1cnNvckRlc2NyaXB0aW9uO1xuICBzZWxmLl9zeW5jaHJvbm91c0N1cnNvciA9IG51bGw7XG59O1xuXG5fLmVhY2goWydmb3JFYWNoJywgJ21hcCcsICdmZXRjaCcsICdjb3VudCcsIFN5bWJvbC5pdGVyYXRvcl0sIGZ1bmN0aW9uIChtZXRob2QpIHtcbiAgQ3Vyc29yLnByb3RvdHlwZVttZXRob2RdID0gZnVuY3Rpb24gKCkge1xuICAgIHZhciBzZWxmID0gdGhpcztcblxuICAgIC8vIFlvdSBjYW4gb25seSBvYnNlcnZlIGEgdGFpbGFibGUgY3Vyc29yLlxuICAgIGlmIChzZWxmLl9jdXJzb3JEZXNjcmlwdGlvbi5vcHRpb25zLnRhaWxhYmxlKVxuICAgICAgdGhyb3cgbmV3IEVycm9yKFwiQ2Fubm90IGNhbGwgXCIgKyBtZXRob2QgKyBcIiBvbiBhIHRhaWxhYmxlIGN1cnNvclwiKTtcblxuICAgIGlmICghc2VsZi5fc3luY2hyb25vdXNDdXJzb3IpIHtcbiAgICAgIHNlbGYuX3N5bmNocm9ub3VzQ3Vyc29yID0gc2VsZi5fbW9uZ28uX2NyZWF0ZVN5bmNocm9ub3VzQ3Vyc29yKFxuICAgICAgICBzZWxmLl9jdXJzb3JEZXNjcmlwdGlvbiwge1xuICAgICAgICAgIC8vIE1ha2Ugc3VyZSB0aGF0IHRoZSBcInNlbGZcIiBhcmd1bWVudCB0byBmb3JFYWNoL21hcCBjYWxsYmFja3MgaXMgdGhlXG4gICAgICAgICAgLy8gQ3Vyc29yLCBub3QgdGhlIFN5bmNocm9ub3VzQ3Vyc29yLlxuICAgICAgICAgIHNlbGZGb3JJdGVyYXRpb246IHNlbGYsXG4gICAgICAgICAgdXNlVHJhbnNmb3JtOiB0cnVlXG4gICAgICAgIH0pO1xuICAgIH1cblxuICAgIHJldHVybiBzZWxmLl9zeW5jaHJvbm91c0N1cnNvclttZXRob2RdLmFwcGx5KFxuICAgICAgc2VsZi5fc3luY2hyb25vdXNDdXJzb3IsIGFyZ3VtZW50cyk7XG4gIH07XG59KTtcblxuLy8gU2luY2Ugd2UgZG9uJ3QgYWN0dWFsbHkgaGF2ZSBhIFwibmV4dE9iamVjdFwiIGludGVyZmFjZSwgdGhlcmUncyByZWFsbHkgbm9cbi8vIHJlYXNvbiB0byBoYXZlIGEgXCJyZXdpbmRcIiBpbnRlcmZhY2UuICBBbGwgaXQgZGlkIHdhcyBtYWtlIG11bHRpcGxlIGNhbGxzXG4vLyB0byBmZXRjaC9tYXAvZm9yRWFjaCByZXR1cm4gbm90aGluZyB0aGUgc2Vjb25kIHRpbWUuXG4vLyBYWFggQ09NUEFUIFdJVEggMC44LjFcbkN1cnNvci5wcm90b3R5cGUucmV3aW5kID0gZnVuY3Rpb24gKCkge1xufTtcblxuQ3Vyc29yLnByb3RvdHlwZS5nZXRUcmFuc2Zvcm0gPSBmdW5jdGlvbiAoKSB7XG4gIHJldHVybiB0aGlzLl9jdXJzb3JEZXNjcmlwdGlvbi5vcHRpb25zLnRyYW5zZm9ybTtcbn07XG5cbi8vIFdoZW4geW91IGNhbGwgTWV0ZW9yLnB1Ymxpc2goKSB3aXRoIGEgZnVuY3Rpb24gdGhhdCByZXR1cm5zIGEgQ3Vyc29yLCB3ZSBuZWVkXG4vLyB0byB0cmFuc211dGUgaXQgaW50byB0aGUgZXF1aXZhbGVudCBzdWJzY3JpcHRpb24uICBUaGlzIGlzIHRoZSBmdW5jdGlvbiB0aGF0XG4vLyBkb2VzIHRoYXQuXG5cbkN1cnNvci5wcm90b3R5cGUuX3B1Ymxpc2hDdXJzb3IgPSBmdW5jdGlvbiAoc3ViKSB7XG4gIHZhciBzZWxmID0gdGhpcztcbiAgdmFyIGNvbGxlY3Rpb24gPSBzZWxmLl9jdXJzb3JEZXNjcmlwdGlvbi5jb2xsZWN0aW9uTmFtZTtcbiAgcmV0dXJuIE1vbmdvLkNvbGxlY3Rpb24uX3B1Ymxpc2hDdXJzb3Ioc2VsZiwgc3ViLCBjb2xsZWN0aW9uKTtcbn07XG5cbi8vIFVzZWQgdG8gZ3VhcmFudGVlIHRoYXQgcHVibGlzaCBmdW5jdGlvbnMgcmV0dXJuIGF0IG1vc3Qgb25lIGN1cnNvciBwZXJcbi8vIGNvbGxlY3Rpb24uIFByaXZhdGUsIGJlY2F1c2Ugd2UgbWlnaHQgbGF0ZXIgaGF2ZSBjdXJzb3JzIHRoYXQgaW5jbHVkZVxuLy8gZG9jdW1lbnRzIGZyb20gbXVsdGlwbGUgY29sbGVjdGlvbnMgc29tZWhvdy5cbkN1cnNvci5wcm90b3R5cGUuX2dldENvbGxlY3Rpb25OYW1lID0gZnVuY3Rpb24gKCkge1xuICB2YXIgc2VsZiA9IHRoaXM7XG4gIHJldHVybiBzZWxmLl9jdXJzb3JEZXNjcmlwdGlvbi5jb2xsZWN0aW9uTmFtZTtcbn07XG5cbkN1cnNvci5wcm90b3R5cGUub2JzZXJ2ZSA9IGZ1bmN0aW9uIChjYWxsYmFja3MpIHtcbiAgdmFyIHNlbGYgPSB0aGlzO1xuICByZXR1cm4gTG9jYWxDb2xsZWN0aW9uLl9vYnNlcnZlRnJvbU9ic2VydmVDaGFuZ2VzKHNlbGYsIGNhbGxiYWNrcyk7XG59O1xuXG5DdXJzb3IucHJvdG90eXBlLm9ic2VydmVDaGFuZ2VzID0gZnVuY3Rpb24gKGNhbGxiYWNrcywgb3B0aW9ucyA9IHt9KSB7XG4gIHZhciBzZWxmID0gdGhpcztcbiAgdmFyIG1ldGhvZHMgPSBbXG4gICAgJ2FkZGVkQXQnLFxuICAgICdhZGRlZCcsXG4gICAgJ2NoYW5nZWRBdCcsXG4gICAgJ2NoYW5nZWQnLFxuICAgICdyZW1vdmVkQXQnLFxuICAgICdyZW1vdmVkJyxcbiAgICAnbW92ZWRUbydcbiAgXTtcbiAgdmFyIG9yZGVyZWQgPSBMb2NhbENvbGxlY3Rpb24uX29ic2VydmVDaGFuZ2VzQ2FsbGJhY2tzQXJlT3JkZXJlZChjYWxsYmFja3MpO1xuXG4gIGxldCBleGNlcHRpb25OYW1lID0gY2FsbGJhY2tzLl9mcm9tT2JzZXJ2ZSA/ICdvYnNlcnZlJyA6ICdvYnNlcnZlQ2hhbmdlcyc7XG4gIGV4Y2VwdGlvbk5hbWUgKz0gJyBjYWxsYmFjayc7XG4gIG1ldGhvZHMuZm9yRWFjaChmdW5jdGlvbiAobWV0aG9kKSB7XG4gICAgaWYgKGNhbGxiYWNrc1ttZXRob2RdICYmIHR5cGVvZiBjYWxsYmFja3NbbWV0aG9kXSA9PSBcImZ1bmN0aW9uXCIpIHtcbiAgICAgIGNhbGxiYWNrc1ttZXRob2RdID0gTWV0ZW9yLmJpbmRFbnZpcm9ubWVudChjYWxsYmFja3NbbWV0aG9kXSwgbWV0aG9kICsgZXhjZXB0aW9uTmFtZSk7XG4gICAgfVxuICB9KTtcblxuICByZXR1cm4gc2VsZi5fbW9uZ28uX29ic2VydmVDaGFuZ2VzKFxuICAgIHNlbGYuX2N1cnNvckRlc2NyaXB0aW9uLCBvcmRlcmVkLCBjYWxsYmFja3MsIG9wdGlvbnMubm9uTXV0YXRpbmdDYWxsYmFja3MpO1xufTtcblxuTW9uZ29Db25uZWN0aW9uLnByb3RvdHlwZS5fY3JlYXRlU3luY2hyb25vdXNDdXJzb3IgPSBmdW5jdGlvbihcbiAgICBjdXJzb3JEZXNjcmlwdGlvbiwgb3B0aW9ucykge1xuICB2YXIgc2VsZiA9IHRoaXM7XG4gIG9wdGlvbnMgPSBfLnBpY2sob3B0aW9ucyB8fCB7fSwgJ3NlbGZGb3JJdGVyYXRpb24nLCAndXNlVHJhbnNmb3JtJyk7XG5cbiAgdmFyIGNvbGxlY3Rpb24gPSBzZWxmLnJhd0NvbGxlY3Rpb24oY3Vyc29yRGVzY3JpcHRpb24uY29sbGVjdGlvbk5hbWUpO1xuICB2YXIgY3Vyc29yT3B0aW9ucyA9IGN1cnNvckRlc2NyaXB0aW9uLm9wdGlvbnM7XG4gIHZhciBtb25nb09wdGlvbnMgPSB7XG4gICAgc29ydDogY3Vyc29yT3B0aW9ucy5zb3J0LFxuICAgIGxpbWl0OiBjdXJzb3JPcHRpb25zLmxpbWl0LFxuICAgIHNraXA6IGN1cnNvck9wdGlvbnMuc2tpcCxcbiAgICBwcm9qZWN0aW9uOiBjdXJzb3JPcHRpb25zLmZpZWxkc1xuICB9O1xuXG4gIC8vIERvIHdlIHdhbnQgYSB0YWlsYWJsZSBjdXJzb3IgKHdoaWNoIG9ubHkgd29ya3Mgb24gY2FwcGVkIGNvbGxlY3Rpb25zKT9cbiAgaWYgKGN1cnNvck9wdGlvbnMudGFpbGFibGUpIHtcbiAgICAvLyBXZSB3YW50IGEgdGFpbGFibGUgY3Vyc29yLi4uXG4gICAgbW9uZ29PcHRpb25zLnRhaWxhYmxlID0gdHJ1ZTtcbiAgICAvLyAuLi4gYW5kIGZvciB0aGUgc2VydmVyIHRvIHdhaXQgYSBiaXQgaWYgYW55IGdldE1vcmUgaGFzIG5vIGRhdGEgKHJhdGhlclxuICAgIC8vIHRoYW4gbWFraW5nIHVzIHB1dCB0aGUgcmVsZXZhbnQgc2xlZXBzIGluIHRoZSBjbGllbnQpLi4uXG4gICAgbW9uZ29PcHRpb25zLmF3YWl0ZGF0YSA9IHRydWU7XG4gICAgLy8gLi4uIGFuZCB0byBrZWVwIHF1ZXJ5aW5nIHRoZSBzZXJ2ZXIgaW5kZWZpbml0ZWx5IHJhdGhlciB0aGFuIGp1c3QgNSB0aW1lc1xuICAgIC8vIGlmIHRoZXJlJ3Mgbm8gbW9yZSBkYXRhLlxuICAgIG1vbmdvT3B0aW9ucy5udW1iZXJPZlJldHJpZXMgPSAtMTtcbiAgICAvLyBBbmQgaWYgdGhpcyBpcyBvbiB0aGUgb3Bsb2cgY29sbGVjdGlvbiBhbmQgdGhlIGN1cnNvciBzcGVjaWZpZXMgYSAndHMnLFxuICAgIC8vIHRoZW4gc2V0IHRoZSB1bmRvY3VtZW50ZWQgb3Bsb2cgcmVwbGF5IGZsYWcsIHdoaWNoIGRvZXMgYSBzcGVjaWFsIHNjYW4gdG9cbiAgICAvLyBmaW5kIHRoZSBmaXJzdCBkb2N1bWVudCAoaW5zdGVhZCBvZiBjcmVhdGluZyBhbiBpbmRleCBvbiB0cykuIFRoaXMgaXMgYVxuICAgIC8vIHZlcnkgaGFyZC1jb2RlZCBNb25nbyBmbGFnIHdoaWNoIG9ubHkgd29ya3Mgb24gdGhlIG9wbG9nIGNvbGxlY3Rpb24gYW5kXG4gICAgLy8gb25seSB3b3JrcyB3aXRoIHRoZSB0cyBmaWVsZC5cbiAgICBpZiAoY3Vyc29yRGVzY3JpcHRpb24uY29sbGVjdGlvbk5hbWUgPT09IE9QTE9HX0NPTExFQ1RJT04gJiZcbiAgICAgICAgY3Vyc29yRGVzY3JpcHRpb24uc2VsZWN0b3IudHMpIHtcbiAgICAgIG1vbmdvT3B0aW9ucy5vcGxvZ1JlcGxheSA9IHRydWU7XG4gICAgfVxuICB9XG5cbiAgdmFyIGRiQ3Vyc29yID0gY29sbGVjdGlvbi5maW5kKFxuICAgIHJlcGxhY2VUeXBlcyhjdXJzb3JEZXNjcmlwdGlvbi5zZWxlY3RvciwgcmVwbGFjZU1ldGVvckF0b21XaXRoTW9uZ28pLFxuICAgIG1vbmdvT3B0aW9ucyk7XG5cbiAgaWYgKHR5cGVvZiBjdXJzb3JPcHRpb25zLm1heFRpbWVNcyAhPT0gJ3VuZGVmaW5lZCcpIHtcbiAgICBkYkN1cnNvciA9IGRiQ3Vyc29yLm1heFRpbWVNUyhjdXJzb3JPcHRpb25zLm1heFRpbWVNcyk7XG4gIH1cbiAgaWYgKHR5cGVvZiBjdXJzb3JPcHRpb25zLmhpbnQgIT09ICd1bmRlZmluZWQnKSB7XG4gICAgZGJDdXJzb3IgPSBkYkN1cnNvci5oaW50KGN1cnNvck9wdGlvbnMuaGludCk7XG4gIH1cblxuICByZXR1cm4gbmV3IFN5bmNocm9ub3VzQ3Vyc29yKGRiQ3Vyc29yLCBjdXJzb3JEZXNjcmlwdGlvbiwgb3B0aW9ucyk7XG59O1xuXG52YXIgU3luY2hyb25vdXNDdXJzb3IgPSBmdW5jdGlvbiAoZGJDdXJzb3IsIGN1cnNvckRlc2NyaXB0aW9uLCBvcHRpb25zKSB7XG4gIHZhciBzZWxmID0gdGhpcztcbiAgb3B0aW9ucyA9IF8ucGljayhvcHRpb25zIHx8IHt9LCAnc2VsZkZvckl0ZXJhdGlvbicsICd1c2VUcmFuc2Zvcm0nKTtcblxuICBzZWxmLl9kYkN1cnNvciA9IGRiQ3Vyc29yO1xuICBzZWxmLl9jdXJzb3JEZXNjcmlwdGlvbiA9IGN1cnNvckRlc2NyaXB0aW9uO1xuICAvLyBUaGUgXCJzZWxmXCIgYXJndW1lbnQgcGFzc2VkIHRvIGZvckVhY2gvbWFwIGNhbGxiYWNrcy4gSWYgd2UncmUgd3JhcHBlZFxuICAvLyBpbnNpZGUgYSB1c2VyLXZpc2libGUgQ3Vyc29yLCB3ZSB3YW50IHRvIHByb3ZpZGUgdGhlIG91dGVyIGN1cnNvciFcbiAgc2VsZi5fc2VsZkZvckl0ZXJhdGlvbiA9IG9wdGlvbnMuc2VsZkZvckl0ZXJhdGlvbiB8fCBzZWxmO1xuICBpZiAob3B0aW9ucy51c2VUcmFuc2Zvcm0gJiYgY3Vyc29yRGVzY3JpcHRpb24ub3B0aW9ucy50cmFuc2Zvcm0pIHtcbiAgICBzZWxmLl90cmFuc2Zvcm0gPSBMb2NhbENvbGxlY3Rpb24ud3JhcFRyYW5zZm9ybShcbiAgICAgIGN1cnNvckRlc2NyaXB0aW9uLm9wdGlvbnMudHJhbnNmb3JtKTtcbiAgfSBlbHNlIHtcbiAgICBzZWxmLl90cmFuc2Zvcm0gPSBudWxsO1xuICB9XG5cbiAgc2VsZi5fc3luY2hyb25vdXNDb3VudCA9IEZ1dHVyZS53cmFwKGRiQ3Vyc29yLmNvdW50LmJpbmQoZGJDdXJzb3IpKTtcbiAgc2VsZi5fdmlzaXRlZElkcyA9IG5ldyBMb2NhbENvbGxlY3Rpb24uX0lkTWFwO1xufTtcblxuXy5leHRlbmQoU3luY2hyb25vdXNDdXJzb3IucHJvdG90eXBlLCB7XG4gIC8vIFJldHVybnMgYSBQcm9taXNlIGZvciB0aGUgbmV4dCBvYmplY3QgZnJvbSB0aGUgdW5kZXJseWluZyBjdXJzb3IgKGJlZm9yZVxuICAvLyB0aGUgTW9uZ28tPk1ldGVvciB0eXBlIHJlcGxhY2VtZW50KS5cbiAgX3Jhd05leHRPYmplY3RQcm9taXNlOiBmdW5jdGlvbiAoKSB7XG4gICAgY29uc3Qgc2VsZiA9IHRoaXM7XG4gICAgcmV0dXJuIG5ldyBQcm9taXNlKChyZXNvbHZlLCByZWplY3QpID0+IHtcbiAgICAgIHNlbGYuX2RiQ3Vyc29yLm5leHQoKGVyciwgZG9jKSA9PiB7XG4gICAgICAgIGlmIChlcnIpIHtcbiAgICAgICAgICByZWplY3QoZXJyKTtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICByZXNvbHZlKGRvYyk7XG4gICAgICAgIH1cbiAgICAgIH0pO1xuICAgIH0pO1xuICB9LFxuXG4gIC8vIFJldHVybnMgYSBQcm9taXNlIGZvciB0aGUgbmV4dCBvYmplY3QgZnJvbSB0aGUgY3Vyc29yLCBza2lwcGluZyB0aG9zZSB3aG9zZVxuICAvLyBJRHMgd2UndmUgYWxyZWFkeSBzZWVuIGFuZCByZXBsYWNpbmcgTW9uZ28gYXRvbXMgd2l0aCBNZXRlb3IgYXRvbXMuXG4gIF9uZXh0T2JqZWN0UHJvbWlzZTogYXN5bmMgZnVuY3Rpb24gKCkge1xuICAgIHZhciBzZWxmID0gdGhpcztcblxuICAgIHdoaWxlICh0cnVlKSB7XG4gICAgICB2YXIgZG9jID0gYXdhaXQgc2VsZi5fcmF3TmV4dE9iamVjdFByb21pc2UoKTtcblxuICAgICAgaWYgKCFkb2MpIHJldHVybiBudWxsO1xuICAgICAgZG9jID0gcmVwbGFjZVR5cGVzKGRvYywgcmVwbGFjZU1vbmdvQXRvbVdpdGhNZXRlb3IpO1xuXG4gICAgICBpZiAoIXNlbGYuX2N1cnNvckRlc2NyaXB0aW9uLm9wdGlvbnMudGFpbGFibGUgJiYgXy5oYXMoZG9jLCAnX2lkJykpIHtcbiAgICAgICAgLy8gRGlkIE1vbmdvIGdpdmUgdXMgZHVwbGljYXRlIGRvY3VtZW50cyBpbiB0aGUgc2FtZSBjdXJzb3I/IElmIHNvLFxuICAgICAgICAvLyBpZ25vcmUgdGhpcyBvbmUuIChEbyB0aGlzIGJlZm9yZSB0aGUgdHJhbnNmb3JtLCBzaW5jZSB0cmFuc2Zvcm0gbWlnaHRcbiAgICAgICAgLy8gcmV0dXJuIHNvbWUgdW5yZWxhdGVkIHZhbHVlLikgV2UgZG9uJ3QgZG8gdGhpcyBmb3IgdGFpbGFibGUgY3Vyc29ycyxcbiAgICAgICAgLy8gYmVjYXVzZSB3ZSB3YW50IHRvIG1haW50YWluIE8oMSkgbWVtb3J5IHVzYWdlLiBBbmQgaWYgdGhlcmUgaXNuJ3QgX2lkXG4gICAgICAgIC8vIGZvciBzb21lIHJlYXNvbiAobWF5YmUgaXQncyB0aGUgb3Bsb2cpLCB0aGVuIHdlIGRvbid0IGRvIHRoaXMgZWl0aGVyLlxuICAgICAgICAvLyAoQmUgY2FyZWZ1bCB0byBkbyB0aGlzIGZvciBmYWxzZXkgYnV0IGV4aXN0aW5nIF9pZCwgdGhvdWdoLilcbiAgICAgICAgaWYgKHNlbGYuX3Zpc2l0ZWRJZHMuaGFzKGRvYy5faWQpKSBjb250aW51ZTtcbiAgICAgICAgc2VsZi5fdmlzaXRlZElkcy5zZXQoZG9jLl9pZCwgdHJ1ZSk7XG4gICAgICB9XG5cbiAgICAgIGlmIChzZWxmLl90cmFuc2Zvcm0pXG4gICAgICAgIGRvYyA9IHNlbGYuX3RyYW5zZm9ybShkb2MpO1xuXG4gICAgICByZXR1cm4gZG9jO1xuICAgIH1cbiAgfSxcblxuICAvLyBSZXR1cm5zIGEgcHJvbWlzZSB3aGljaCBpcyByZXNvbHZlZCB3aXRoIHRoZSBuZXh0IG9iamVjdCAobGlrZSB3aXRoXG4gIC8vIF9uZXh0T2JqZWN0UHJvbWlzZSkgb3IgcmVqZWN0ZWQgaWYgdGhlIGN1cnNvciBkb2Vzbid0IHJldHVybiB3aXRoaW5cbiAgLy8gdGltZW91dE1TIG1zLlxuICBfbmV4dE9iamVjdFByb21pc2VXaXRoVGltZW91dDogZnVuY3Rpb24gKHRpbWVvdXRNUykge1xuICAgIGNvbnN0IHNlbGYgPSB0aGlzO1xuICAgIGlmICghdGltZW91dE1TKSB7XG4gICAgICByZXR1cm4gc2VsZi5fbmV4dE9iamVjdFByb21pc2UoKTtcbiAgICB9XG4gICAgY29uc3QgbmV4dE9iamVjdFByb21pc2UgPSBzZWxmLl9uZXh0T2JqZWN0UHJvbWlzZSgpO1xuICAgIGNvbnN0IHRpbWVvdXRFcnIgPSBuZXcgRXJyb3IoJ0NsaWVudC1zaWRlIHRpbWVvdXQgd2FpdGluZyBmb3IgbmV4dCBvYmplY3QnKTtcbiAgICBjb25zdCB0aW1lb3V0UHJvbWlzZSA9IG5ldyBQcm9taXNlKChyZXNvbHZlLCByZWplY3QpID0+IHtcbiAgICAgIGNvbnN0IHRpbWVyID0gc2V0VGltZW91dCgoKSA9PiB7XG4gICAgICAgIHJlamVjdCh0aW1lb3V0RXJyKTtcbiAgICAgIH0sIHRpbWVvdXRNUyk7XG4gICAgfSk7XG4gICAgcmV0dXJuIFByb21pc2UucmFjZShbbmV4dE9iamVjdFByb21pc2UsIHRpbWVvdXRQcm9taXNlXSlcbiAgICAgIC5jYXRjaCgoZXJyKSA9PiB7XG4gICAgICAgIGlmIChlcnIgPT09IHRpbWVvdXRFcnIpIHtcbiAgICAgICAgICBzZWxmLmNsb3NlKCk7XG4gICAgICAgIH1cbiAgICAgICAgdGhyb3cgZXJyO1xuICAgICAgfSk7XG4gIH0sXG5cbiAgX25leHRPYmplY3Q6IGZ1bmN0aW9uICgpIHtcbiAgICB2YXIgc2VsZiA9IHRoaXM7XG4gICAgcmV0dXJuIHNlbGYuX25leHRPYmplY3RQcm9taXNlKCkuYXdhaXQoKTtcbiAgfSxcblxuICBmb3JFYWNoOiBmdW5jdGlvbiAoY2FsbGJhY2ssIHRoaXNBcmcpIHtcbiAgICB2YXIgc2VsZiA9IHRoaXM7XG5cbiAgICAvLyBHZXQgYmFjayB0byB0aGUgYmVnaW5uaW5nLlxuICAgIHNlbGYuX3Jld2luZCgpO1xuXG4gICAgLy8gV2UgaW1wbGVtZW50IHRoZSBsb29wIG91cnNlbGYgaW5zdGVhZCBvZiB1c2luZyBzZWxmLl9kYkN1cnNvci5lYWNoLFxuICAgIC8vIGJlY2F1c2UgXCJlYWNoXCIgd2lsbCBjYWxsIGl0cyBjYWxsYmFjayBvdXRzaWRlIG9mIGEgZmliZXIgd2hpY2ggbWFrZXMgaXRcbiAgICAvLyBtdWNoIG1vcmUgY29tcGxleCB0byBtYWtlIHRoaXMgZnVuY3Rpb24gc3luY2hyb25vdXMuXG4gICAgdmFyIGluZGV4ID0gMDtcbiAgICB3aGlsZSAodHJ1ZSkge1xuICAgICAgdmFyIGRvYyA9IHNlbGYuX25leHRPYmplY3QoKTtcbiAgICAgIGlmICghZG9jKSByZXR1cm47XG4gICAgICBjYWxsYmFjay5jYWxsKHRoaXNBcmcsIGRvYywgaW5kZXgrKywgc2VsZi5fc2VsZkZvckl0ZXJhdGlvbik7XG4gICAgfVxuICB9LFxuXG4gIC8vIFhYWCBBbGxvdyBvdmVybGFwcGluZyBjYWxsYmFjayBleGVjdXRpb25zIGlmIGNhbGxiYWNrIHlpZWxkcy5cbiAgbWFwOiBmdW5jdGlvbiAoY2FsbGJhY2ssIHRoaXNBcmcpIHtcbiAgICB2YXIgc2VsZiA9IHRoaXM7XG4gICAgdmFyIHJlcyA9IFtdO1xuICAgIHNlbGYuZm9yRWFjaChmdW5jdGlvbiAoZG9jLCBpbmRleCkge1xuICAgICAgcmVzLnB1c2goY2FsbGJhY2suY2FsbCh0aGlzQXJnLCBkb2MsIGluZGV4LCBzZWxmLl9zZWxmRm9ySXRlcmF0aW9uKSk7XG4gICAgfSk7XG4gICAgcmV0dXJuIHJlcztcbiAgfSxcblxuICBfcmV3aW5kOiBmdW5jdGlvbiAoKSB7XG4gICAgdmFyIHNlbGYgPSB0aGlzO1xuXG4gICAgLy8ga25vd24gdG8gYmUgc3luY2hyb25vdXNcbiAgICBzZWxmLl9kYkN1cnNvci5yZXdpbmQoKTtcblxuICAgIHNlbGYuX3Zpc2l0ZWRJZHMgPSBuZXcgTG9jYWxDb2xsZWN0aW9uLl9JZE1hcDtcbiAgfSxcblxuICAvLyBNb3N0bHkgdXNhYmxlIGZvciB0YWlsYWJsZSBjdXJzb3JzLlxuICBjbG9zZTogZnVuY3Rpb24gKCkge1xuICAgIHZhciBzZWxmID0gdGhpcztcblxuICAgIHNlbGYuX2RiQ3Vyc29yLmNsb3NlKCk7XG4gIH0sXG5cbiAgZmV0Y2g6IGZ1bmN0aW9uICgpIHtcbiAgICB2YXIgc2VsZiA9IHRoaXM7XG4gICAgcmV0dXJuIHNlbGYubWFwKF8uaWRlbnRpdHkpO1xuICB9LFxuXG4gIGNvdW50OiBmdW5jdGlvbiAoYXBwbHlTa2lwTGltaXQgPSBmYWxzZSkge1xuICAgIHZhciBzZWxmID0gdGhpcztcbiAgICByZXR1cm4gc2VsZi5fc3luY2hyb25vdXNDb3VudChhcHBseVNraXBMaW1pdCkud2FpdCgpO1xuICB9LFxuXG4gIC8vIFRoaXMgbWV0aG9kIGlzIE5PVCB3cmFwcGVkIGluIEN1cnNvci5cbiAgZ2V0UmF3T2JqZWN0czogZnVuY3Rpb24gKG9yZGVyZWQpIHtcbiAgICB2YXIgc2VsZiA9IHRoaXM7XG4gICAgaWYgKG9yZGVyZWQpIHtcbiAgICAgIHJldHVybiBzZWxmLmZldGNoKCk7XG4gICAgfSBlbHNlIHtcbiAgICAgIHZhciByZXN1bHRzID0gbmV3IExvY2FsQ29sbGVjdGlvbi5fSWRNYXA7XG4gICAgICBzZWxmLmZvckVhY2goZnVuY3Rpb24gKGRvYykge1xuICAgICAgICByZXN1bHRzLnNldChkb2MuX2lkLCBkb2MpO1xuICAgICAgfSk7XG4gICAgICByZXR1cm4gcmVzdWx0cztcbiAgICB9XG4gIH1cbn0pO1xuXG5TeW5jaHJvbm91c0N1cnNvci5wcm90b3R5cGVbU3ltYm9sLml0ZXJhdG9yXSA9IGZ1bmN0aW9uICgpIHtcbiAgdmFyIHNlbGYgPSB0aGlzO1xuXG4gIC8vIEdldCBiYWNrIHRvIHRoZSBiZWdpbm5pbmcuXG4gIHNlbGYuX3Jld2luZCgpO1xuXG4gIHJldHVybiB7XG4gICAgbmV4dCgpIHtcbiAgICAgIGNvbnN0IGRvYyA9IHNlbGYuX25leHRPYmplY3QoKTtcbiAgICAgIHJldHVybiBkb2MgPyB7XG4gICAgICAgIHZhbHVlOiBkb2NcbiAgICAgIH0gOiB7XG4gICAgICAgIGRvbmU6IHRydWVcbiAgICAgIH07XG4gICAgfVxuICB9O1xufTtcblxuLy8gVGFpbHMgdGhlIGN1cnNvciBkZXNjcmliZWQgYnkgY3Vyc29yRGVzY3JpcHRpb24sIG1vc3QgbGlrZWx5IG9uIHRoZVxuLy8gb3Bsb2cuIENhbGxzIGRvY0NhbGxiYWNrIHdpdGggZWFjaCBkb2N1bWVudCBmb3VuZC4gSWdub3JlcyBlcnJvcnMgYW5kIGp1c3Rcbi8vIHJlc3RhcnRzIHRoZSB0YWlsIG9uIGVycm9yLlxuLy9cbi8vIElmIHRpbWVvdXRNUyBpcyBzZXQsIHRoZW4gaWYgd2UgZG9uJ3QgZ2V0IGEgbmV3IGRvY3VtZW50IGV2ZXJ5IHRpbWVvdXRNUyxcbi8vIGtpbGwgYW5kIHJlc3RhcnQgdGhlIGN1cnNvci4gVGhpcyBpcyBwcmltYXJpbHkgYSB3b3JrYXJvdW5kIGZvciAjODU5OC5cbk1vbmdvQ29ubmVjdGlvbi5wcm90b3R5cGUudGFpbCA9IGZ1bmN0aW9uIChjdXJzb3JEZXNjcmlwdGlvbiwgZG9jQ2FsbGJhY2ssIHRpbWVvdXRNUykge1xuICB2YXIgc2VsZiA9IHRoaXM7XG4gIGlmICghY3Vyc29yRGVzY3JpcHRpb24ub3B0aW9ucy50YWlsYWJsZSlcbiAgICB0aHJvdyBuZXcgRXJyb3IoXCJDYW4gb25seSB0YWlsIGEgdGFpbGFibGUgY3Vyc29yXCIpO1xuXG4gIHZhciBjdXJzb3IgPSBzZWxmLl9jcmVhdGVTeW5jaHJvbm91c0N1cnNvcihjdXJzb3JEZXNjcmlwdGlvbik7XG5cbiAgdmFyIHN0b3BwZWQgPSBmYWxzZTtcbiAgdmFyIGxhc3RUUztcbiAgdmFyIGxvb3AgPSBmdW5jdGlvbiAoKSB7XG4gICAgdmFyIGRvYyA9IG51bGw7XG4gICAgd2hpbGUgKHRydWUpIHtcbiAgICAgIGlmIChzdG9wcGVkKVxuICAgICAgICByZXR1cm47XG4gICAgICB0cnkge1xuICAgICAgICBkb2MgPSBjdXJzb3IuX25leHRPYmplY3RQcm9taXNlV2l0aFRpbWVvdXQodGltZW91dE1TKS5hd2FpdCgpO1xuICAgICAgfSBjYXRjaCAoZXJyKSB7XG4gICAgICAgIC8vIFRoZXJlJ3Mgbm8gZ29vZCB3YXkgdG8gZmlndXJlIG91dCBpZiB0aGlzIHdhcyBhY3R1YWxseSBhbiBlcnJvciBmcm9tXG4gICAgICAgIC8vIE1vbmdvLCBvciBqdXN0IGNsaWVudC1zaWRlIChpbmNsdWRpbmcgb3VyIG93biB0aW1lb3V0IGVycm9yKS4gQWhcbiAgICAgICAgLy8gd2VsbC4gQnV0IGVpdGhlciB3YXksIHdlIG5lZWQgdG8gcmV0cnkgdGhlIGN1cnNvciAodW5sZXNzIHRoZSBmYWlsdXJlXG4gICAgICAgIC8vIHdhcyBiZWNhdXNlIHRoZSBvYnNlcnZlIGdvdCBzdG9wcGVkKS5cbiAgICAgICAgZG9jID0gbnVsbDtcbiAgICAgIH1cbiAgICAgIC8vIFNpbmNlIHdlIGF3YWl0ZWQgYSBwcm9taXNlIGFib3ZlLCB3ZSBuZWVkIHRvIGNoZWNrIGFnYWluIHRvIHNlZSBpZlxuICAgICAgLy8gd2UndmUgYmVlbiBzdG9wcGVkIGJlZm9yZSBjYWxsaW5nIHRoZSBjYWxsYmFjay5cbiAgICAgIGlmIChzdG9wcGVkKVxuICAgICAgICByZXR1cm47XG4gICAgICBpZiAoZG9jKSB7XG4gICAgICAgIC8vIElmIGEgdGFpbGFibGUgY3Vyc29yIGNvbnRhaW5zIGEgXCJ0c1wiIGZpZWxkLCB1c2UgaXQgdG8gcmVjcmVhdGUgdGhlXG4gICAgICAgIC8vIGN1cnNvciBvbiBlcnJvci4gKFwidHNcIiBpcyBhIHN0YW5kYXJkIHRoYXQgTW9uZ28gdXNlcyBpbnRlcm5hbGx5IGZvclxuICAgICAgICAvLyB0aGUgb3Bsb2csIGFuZCB0aGVyZSdzIGEgc3BlY2lhbCBmbGFnIHRoYXQgbGV0cyB5b3UgZG8gYmluYXJ5IHNlYXJjaFxuICAgICAgICAvLyBvbiBpdCBpbnN0ZWFkIG9mIG5lZWRpbmcgdG8gdXNlIGFuIGluZGV4LilcbiAgICAgICAgbGFzdFRTID0gZG9jLnRzO1xuICAgICAgICBkb2NDYWxsYmFjayhkb2MpO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgdmFyIG5ld1NlbGVjdG9yID0gXy5jbG9uZShjdXJzb3JEZXNjcmlwdGlvbi5zZWxlY3Rvcik7XG4gICAgICAgIGlmIChsYXN0VFMpIHtcbiAgICAgICAgICBuZXdTZWxlY3Rvci50cyA9IHskZ3Q6IGxhc3RUU307XG4gICAgICAgIH1cbiAgICAgICAgY3Vyc29yID0gc2VsZi5fY3JlYXRlU3luY2hyb25vdXNDdXJzb3IobmV3IEN1cnNvckRlc2NyaXB0aW9uKFxuICAgICAgICAgIGN1cnNvckRlc2NyaXB0aW9uLmNvbGxlY3Rpb25OYW1lLFxuICAgICAgICAgIG5ld1NlbGVjdG9yLFxuICAgICAgICAgIGN1cnNvckRlc2NyaXB0aW9uLm9wdGlvbnMpKTtcbiAgICAgICAgLy8gTW9uZ28gZmFpbG92ZXIgdGFrZXMgbWFueSBzZWNvbmRzLiAgUmV0cnkgaW4gYSBiaXQuICAoV2l0aG91dCB0aGlzXG4gICAgICAgIC8vIHNldFRpbWVvdXQsIHdlIHBlZyB0aGUgQ1BVIGF0IDEwMCUgYW5kIG5ldmVyIG5vdGljZSB0aGUgYWN0dWFsXG4gICAgICAgIC8vIGZhaWxvdmVyLlxuICAgICAgICBNZXRlb3Iuc2V0VGltZW91dChsb29wLCAxMDApO1xuICAgICAgICBicmVhaztcbiAgICAgIH1cbiAgICB9XG4gIH07XG5cbiAgTWV0ZW9yLmRlZmVyKGxvb3ApO1xuXG4gIHJldHVybiB7XG4gICAgc3RvcDogZnVuY3Rpb24gKCkge1xuICAgICAgc3RvcHBlZCA9IHRydWU7XG4gICAgICBjdXJzb3IuY2xvc2UoKTtcbiAgICB9XG4gIH07XG59O1xuXG5Nb25nb0Nvbm5lY3Rpb24ucHJvdG90eXBlLl9vYnNlcnZlQ2hhbmdlcyA9IGZ1bmN0aW9uIChcbiAgICBjdXJzb3JEZXNjcmlwdGlvbiwgb3JkZXJlZCwgY2FsbGJhY2tzLCBub25NdXRhdGluZ0NhbGxiYWNrcykge1xuICB2YXIgc2VsZiA9IHRoaXM7XG5cbiAgaWYgKGN1cnNvckRlc2NyaXB0aW9uLm9wdGlvbnMudGFpbGFibGUpIHtcbiAgICByZXR1cm4gc2VsZi5fb2JzZXJ2ZUNoYW5nZXNUYWlsYWJsZShjdXJzb3JEZXNjcmlwdGlvbiwgb3JkZXJlZCwgY2FsbGJhY2tzKTtcbiAgfVxuXG4gIC8vIFlvdSBtYXkgbm90IGZpbHRlciBvdXQgX2lkIHdoZW4gb2JzZXJ2aW5nIGNoYW5nZXMsIGJlY2F1c2UgdGhlIGlkIGlzIGEgY29yZVxuICAvLyBwYXJ0IG9mIHRoZSBvYnNlcnZlQ2hhbmdlcyBBUEkuXG4gIGlmIChjdXJzb3JEZXNjcmlwdGlvbi5vcHRpb25zLmZpZWxkcyAmJlxuICAgICAgKGN1cnNvckRlc2NyaXB0aW9uLm9wdGlvbnMuZmllbGRzLl9pZCA9PT0gMCB8fFxuICAgICAgIGN1cnNvckRlc2NyaXB0aW9uLm9wdGlvbnMuZmllbGRzLl9pZCA9PT0gZmFsc2UpKSB7XG4gICAgdGhyb3cgRXJyb3IoXCJZb3UgbWF5IG5vdCBvYnNlcnZlIGEgY3Vyc29yIHdpdGgge2ZpZWxkczoge19pZDogMH19XCIpO1xuICB9XG5cbiAgdmFyIG9ic2VydmVLZXkgPSBFSlNPTi5zdHJpbmdpZnkoXG4gICAgXy5leHRlbmQoe29yZGVyZWQ6IG9yZGVyZWR9LCBjdXJzb3JEZXNjcmlwdGlvbikpO1xuXG4gIHZhciBtdWx0aXBsZXhlciwgb2JzZXJ2ZURyaXZlcjtcbiAgdmFyIGZpcnN0SGFuZGxlID0gZmFsc2U7XG5cbiAgLy8gRmluZCBhIG1hdGNoaW5nIE9ic2VydmVNdWx0aXBsZXhlciwgb3IgY3JlYXRlIGEgbmV3IG9uZS4gVGhpcyBuZXh0IGJsb2NrIGlzXG4gIC8vIGd1YXJhbnRlZWQgdG8gbm90IHlpZWxkIChhbmQgaXQgZG9lc24ndCBjYWxsIGFueXRoaW5nIHRoYXQgY2FuIG9ic2VydmUgYVxuICAvLyBuZXcgcXVlcnkpLCBzbyBubyBvdGhlciBjYWxscyB0byB0aGlzIGZ1bmN0aW9uIGNhbiBpbnRlcmxlYXZlIHdpdGggaXQuXG4gIE1ldGVvci5fbm9ZaWVsZHNBbGxvd2VkKGZ1bmN0aW9uICgpIHtcbiAgICBpZiAoXy5oYXMoc2VsZi5fb2JzZXJ2ZU11bHRpcGxleGVycywgb2JzZXJ2ZUtleSkpIHtcbiAgICAgIG11bHRpcGxleGVyID0gc2VsZi5fb2JzZXJ2ZU11bHRpcGxleGVyc1tvYnNlcnZlS2V5XTtcbiAgICB9IGVsc2Uge1xuICAgICAgZmlyc3RIYW5kbGUgPSB0cnVlO1xuICAgICAgLy8gQ3JlYXRlIGEgbmV3IE9ic2VydmVNdWx0aXBsZXhlci5cbiAgICAgIG11bHRpcGxleGVyID0gbmV3IE9ic2VydmVNdWx0aXBsZXhlcih7XG4gICAgICAgIG9yZGVyZWQ6IG9yZGVyZWQsXG4gICAgICAgIG9uU3RvcDogZnVuY3Rpb24gKCkge1xuICAgICAgICAgIGRlbGV0ZSBzZWxmLl9vYnNlcnZlTXVsdGlwbGV4ZXJzW29ic2VydmVLZXldO1xuICAgICAgICAgIG9ic2VydmVEcml2ZXIuc3RvcCgpO1xuICAgICAgICB9XG4gICAgICB9KTtcbiAgICAgIHNlbGYuX29ic2VydmVNdWx0aXBsZXhlcnNbb2JzZXJ2ZUtleV0gPSBtdWx0aXBsZXhlcjtcbiAgICB9XG4gIH0pO1xuXG4gIHZhciBvYnNlcnZlSGFuZGxlID0gbmV3IE9ic2VydmVIYW5kbGUobXVsdGlwbGV4ZXIsXG4gICAgY2FsbGJhY2tzLFxuICAgIG5vbk11dGF0aW5nQ2FsbGJhY2tzLFxuICApO1xuXG4gIGlmIChmaXJzdEhhbmRsZSkge1xuICAgIHZhciBtYXRjaGVyLCBzb3J0ZXI7XG4gICAgdmFyIGNhblVzZU9wbG9nID0gXy5hbGwoW1xuICAgICAgZnVuY3Rpb24gKCkge1xuICAgICAgICAvLyBBdCBhIGJhcmUgbWluaW11bSwgdXNpbmcgdGhlIG9wbG9nIHJlcXVpcmVzIHVzIHRvIGhhdmUgYW4gb3Bsb2csIHRvXG4gICAgICAgIC8vIHdhbnQgdW5vcmRlcmVkIGNhbGxiYWNrcywgYW5kIHRvIG5vdCB3YW50IGEgY2FsbGJhY2sgb24gdGhlIHBvbGxzXG4gICAgICAgIC8vIHRoYXQgd29uJ3QgaGFwcGVuLlxuICAgICAgICByZXR1cm4gc2VsZi5fb3Bsb2dIYW5kbGUgJiYgIW9yZGVyZWQgJiZcbiAgICAgICAgICAhY2FsbGJhY2tzLl90ZXN0T25seVBvbGxDYWxsYmFjaztcbiAgICAgIH0sIGZ1bmN0aW9uICgpIHtcbiAgICAgICAgLy8gV2UgbmVlZCB0byBiZSBhYmxlIHRvIGNvbXBpbGUgdGhlIHNlbGVjdG9yLiBGYWxsIGJhY2sgdG8gcG9sbGluZyBmb3JcbiAgICAgICAgLy8gc29tZSBuZXdmYW5nbGVkICRzZWxlY3RvciB0aGF0IG1pbmltb25nbyBkb2Vzbid0IHN1cHBvcnQgeWV0LlxuICAgICAgICB0cnkge1xuICAgICAgICAgIG1hdGNoZXIgPSBuZXcgTWluaW1vbmdvLk1hdGNoZXIoY3Vyc29yRGVzY3JpcHRpb24uc2VsZWN0b3IpO1xuICAgICAgICAgIHJldHVybiB0cnVlO1xuICAgICAgICB9IGNhdGNoIChlKSB7XG4gICAgICAgICAgLy8gWFhYIG1ha2UgYWxsIGNvbXBpbGF0aW9uIGVycm9ycyBNaW5pbW9uZ29FcnJvciBvciBzb21ldGhpbmdcbiAgICAgICAgICAvLyAgICAgc28gdGhhdCB0aGlzIGRvZXNuJ3QgaWdub3JlIHVucmVsYXRlZCBleGNlcHRpb25zXG4gICAgICAgICAgcmV0dXJuIGZhbHNlO1xuICAgICAgICB9XG4gICAgICB9LCBmdW5jdGlvbiAoKSB7XG4gICAgICAgIC8vIC4uLiBhbmQgdGhlIHNlbGVjdG9yIGl0c2VsZiBuZWVkcyB0byBzdXBwb3J0IG9wbG9nLlxuICAgICAgICByZXR1cm4gT3Bsb2dPYnNlcnZlRHJpdmVyLmN1cnNvclN1cHBvcnRlZChjdXJzb3JEZXNjcmlwdGlvbiwgbWF0Y2hlcik7XG4gICAgICB9LCBmdW5jdGlvbiAoKSB7XG4gICAgICAgIC8vIEFuZCB3ZSBuZWVkIHRvIGJlIGFibGUgdG8gY29tcGlsZSB0aGUgc29ydCwgaWYgYW55LiAgZWcsIGNhbid0IGJlXG4gICAgICAgIC8vIHskbmF0dXJhbDogMX0uXG4gICAgICAgIGlmICghY3Vyc29yRGVzY3JpcHRpb24ub3B0aW9ucy5zb3J0KVxuICAgICAgICAgIHJldHVybiB0cnVlO1xuICAgICAgICB0cnkge1xuICAgICAgICAgIHNvcnRlciA9IG5ldyBNaW5pbW9uZ28uU29ydGVyKGN1cnNvckRlc2NyaXB0aW9uLm9wdGlvbnMuc29ydCk7XG4gICAgICAgICAgcmV0dXJuIHRydWU7XG4gICAgICAgIH0gY2F0Y2ggKGUpIHtcbiAgICAgICAgICAvLyBYWFggbWFrZSBhbGwgY29tcGlsYXRpb24gZXJyb3JzIE1pbmltb25nb0Vycm9yIG9yIHNvbWV0aGluZ1xuICAgICAgICAgIC8vICAgICBzbyB0aGF0IHRoaXMgZG9lc24ndCBpZ25vcmUgdW5yZWxhdGVkIGV4Y2VwdGlvbnNcbiAgICAgICAgICByZXR1cm4gZmFsc2U7XG4gICAgICAgIH1cbiAgICAgIH1dLCBmdW5jdGlvbiAoZikgeyByZXR1cm4gZigpOyB9KTsgIC8vIGludm9rZSBlYWNoIGZ1bmN0aW9uXG5cbiAgICB2YXIgZHJpdmVyQ2xhc3MgPSBjYW5Vc2VPcGxvZyA/IE9wbG9nT2JzZXJ2ZURyaXZlciA6IFBvbGxpbmdPYnNlcnZlRHJpdmVyO1xuICAgIG9ic2VydmVEcml2ZXIgPSBuZXcgZHJpdmVyQ2xhc3Moe1xuICAgICAgY3Vyc29yRGVzY3JpcHRpb246IGN1cnNvckRlc2NyaXB0aW9uLFxuICAgICAgbW9uZ29IYW5kbGU6IHNlbGYsXG4gICAgICBtdWx0aXBsZXhlcjogbXVsdGlwbGV4ZXIsXG4gICAgICBvcmRlcmVkOiBvcmRlcmVkLFxuICAgICAgbWF0Y2hlcjogbWF0Y2hlciwgIC8vIGlnbm9yZWQgYnkgcG9sbGluZ1xuICAgICAgc29ydGVyOiBzb3J0ZXIsICAvLyBpZ25vcmVkIGJ5IHBvbGxpbmdcbiAgICAgIF90ZXN0T25seVBvbGxDYWxsYmFjazogY2FsbGJhY2tzLl90ZXN0T25seVBvbGxDYWxsYmFja1xuICAgIH0pO1xuXG4gICAgLy8gVGhpcyBmaWVsZCBpcyBvbmx5IHNldCBmb3IgdXNlIGluIHRlc3RzLlxuICAgIG11bHRpcGxleGVyLl9vYnNlcnZlRHJpdmVyID0gb2JzZXJ2ZURyaXZlcjtcbiAgfVxuXG4gIC8vIEJsb2NrcyB1bnRpbCB0aGUgaW5pdGlhbCBhZGRzIGhhdmUgYmVlbiBzZW50LlxuICBtdWx0aXBsZXhlci5hZGRIYW5kbGVBbmRTZW5kSW5pdGlhbEFkZHMob2JzZXJ2ZUhhbmRsZSk7XG5cbiAgcmV0dXJuIG9ic2VydmVIYW5kbGU7XG59O1xuXG4vLyBMaXN0ZW4gZm9yIHRoZSBpbnZhbGlkYXRpb24gbWVzc2FnZXMgdGhhdCB3aWxsIHRyaWdnZXIgdXMgdG8gcG9sbCB0aGVcbi8vIGRhdGFiYXNlIGZvciBjaGFuZ2VzLiBJZiB0aGlzIHNlbGVjdG9yIHNwZWNpZmllcyBzcGVjaWZpYyBJRHMsIHNwZWNpZnkgdGhlbVxuLy8gaGVyZSwgc28gdGhhdCB1cGRhdGVzIHRvIGRpZmZlcmVudCBzcGVjaWZpYyBJRHMgZG9uJ3QgY2F1c2UgdXMgdG8gcG9sbC5cbi8vIGxpc3RlbkNhbGxiYWNrIGlzIHRoZSBzYW1lIGtpbmQgb2YgKG5vdGlmaWNhdGlvbiwgY29tcGxldGUpIGNhbGxiYWNrIHBhc3NlZFxuLy8gdG8gSW52YWxpZGF0aW9uQ3Jvc3NiYXIubGlzdGVuLlxuXG5saXN0ZW5BbGwgPSBmdW5jdGlvbiAoY3Vyc29yRGVzY3JpcHRpb24sIGxpc3RlbkNhbGxiYWNrKSB7XG4gIHZhciBsaXN0ZW5lcnMgPSBbXTtcbiAgZm9yRWFjaFRyaWdnZXIoY3Vyc29yRGVzY3JpcHRpb24sIGZ1bmN0aW9uICh0cmlnZ2VyKSB7XG4gICAgbGlzdGVuZXJzLnB1c2goRERQU2VydmVyLl9JbnZhbGlkYXRpb25Dcm9zc2Jhci5saXN0ZW4oXG4gICAgICB0cmlnZ2VyLCBsaXN0ZW5DYWxsYmFjaykpO1xuICB9KTtcblxuICByZXR1cm4ge1xuICAgIHN0b3A6IGZ1bmN0aW9uICgpIHtcbiAgICAgIF8uZWFjaChsaXN0ZW5lcnMsIGZ1bmN0aW9uIChsaXN0ZW5lcikge1xuICAgICAgICBsaXN0ZW5lci5zdG9wKCk7XG4gICAgICB9KTtcbiAgICB9XG4gIH07XG59O1xuXG5mb3JFYWNoVHJpZ2dlciA9IGZ1bmN0aW9uIChjdXJzb3JEZXNjcmlwdGlvbiwgdHJpZ2dlckNhbGxiYWNrKSB7XG4gIHZhciBrZXkgPSB7Y29sbGVjdGlvbjogY3Vyc29yRGVzY3JpcHRpb24uY29sbGVjdGlvbk5hbWV9O1xuICB2YXIgc3BlY2lmaWNJZHMgPSBMb2NhbENvbGxlY3Rpb24uX2lkc01hdGNoZWRCeVNlbGVjdG9yKFxuICAgIGN1cnNvckRlc2NyaXB0aW9uLnNlbGVjdG9yKTtcbiAgaWYgKHNwZWNpZmljSWRzKSB7XG4gICAgXy5lYWNoKHNwZWNpZmljSWRzLCBmdW5jdGlvbiAoaWQpIHtcbiAgICAgIHRyaWdnZXJDYWxsYmFjayhfLmV4dGVuZCh7aWQ6IGlkfSwga2V5KSk7XG4gICAgfSk7XG4gICAgdHJpZ2dlckNhbGxiYWNrKF8uZXh0ZW5kKHtkcm9wQ29sbGVjdGlvbjogdHJ1ZSwgaWQ6IG51bGx9LCBrZXkpKTtcbiAgfSBlbHNlIHtcbiAgICB0cmlnZ2VyQ2FsbGJhY2soa2V5KTtcbiAgfVxuICAvLyBFdmVyeW9uZSBjYXJlcyBhYm91dCB0aGUgZGF0YWJhc2UgYmVpbmcgZHJvcHBlZC5cbiAgdHJpZ2dlckNhbGxiYWNrKHsgZHJvcERhdGFiYXNlOiB0cnVlIH0pO1xufTtcblxuLy8gb2JzZXJ2ZUNoYW5nZXMgZm9yIHRhaWxhYmxlIGN1cnNvcnMgb24gY2FwcGVkIGNvbGxlY3Rpb25zLlxuLy9cbi8vIFNvbWUgZGlmZmVyZW5jZXMgZnJvbSBub3JtYWwgY3Vyc29yczpcbi8vICAgLSBXaWxsIG5ldmVyIHByb2R1Y2UgYW55dGhpbmcgb3RoZXIgdGhhbiAnYWRkZWQnIG9yICdhZGRlZEJlZm9yZScuIElmIHlvdVxuLy8gICAgIGRvIHVwZGF0ZSBhIGRvY3VtZW50IHRoYXQgaGFzIGFscmVhZHkgYmVlbiBwcm9kdWNlZCwgdGhpcyB3aWxsIG5vdCBub3RpY2Vcbi8vICAgICBpdC5cbi8vICAgLSBJZiB5b3UgZGlzY29ubmVjdCBhbmQgcmVjb25uZWN0IGZyb20gTW9uZ28sIGl0IHdpbGwgZXNzZW50aWFsbHkgcmVzdGFydFxuLy8gICAgIHRoZSBxdWVyeSwgd2hpY2ggd2lsbCBsZWFkIHRvIGR1cGxpY2F0ZSByZXN1bHRzLiBUaGlzIGlzIHByZXR0eSBiYWQsXG4vLyAgICAgYnV0IGlmIHlvdSBpbmNsdWRlIGEgZmllbGQgY2FsbGVkICd0cycgd2hpY2ggaXMgaW5zZXJ0ZWQgYXNcbi8vICAgICBuZXcgTW9uZ29JbnRlcm5hbHMuTW9uZ29UaW1lc3RhbXAoMCwgMCkgKHdoaWNoIGlzIGluaXRpYWxpemVkIHRvIHRoZVxuLy8gICAgIGN1cnJlbnQgTW9uZ28tc3R5bGUgdGltZXN0YW1wKSwgd2UnbGwgYmUgYWJsZSB0byBmaW5kIHRoZSBwbGFjZSB0b1xuLy8gICAgIHJlc3RhcnQgcHJvcGVybHkuIChUaGlzIGZpZWxkIGlzIHNwZWNpZmljYWxseSB1bmRlcnN0b29kIGJ5IE1vbmdvIHdpdGggYW5cbi8vICAgICBvcHRpbWl6YXRpb24gd2hpY2ggYWxsb3dzIGl0IHRvIGZpbmQgdGhlIHJpZ2h0IHBsYWNlIHRvIHN0YXJ0IHdpdGhvdXRcbi8vICAgICBhbiBpbmRleCBvbiB0cy4gSXQncyBob3cgdGhlIG9wbG9nIHdvcmtzLilcbi8vICAgLSBObyBjYWxsYmFja3MgYXJlIHRyaWdnZXJlZCBzeW5jaHJvbm91c2x5IHdpdGggdGhlIGNhbGwgKHRoZXJlJ3Mgbm9cbi8vICAgICBkaWZmZXJlbnRpYXRpb24gYmV0d2VlbiBcImluaXRpYWwgZGF0YVwiIGFuZCBcImxhdGVyIGNoYW5nZXNcIjsgZXZlcnl0aGluZ1xuLy8gICAgIHRoYXQgbWF0Y2hlcyB0aGUgcXVlcnkgZ2V0cyBzZW50IGFzeW5jaHJvbm91c2x5KS5cbi8vICAgLSBEZS1kdXBsaWNhdGlvbiBpcyBub3QgaW1wbGVtZW50ZWQuXG4vLyAgIC0gRG9lcyBub3QgeWV0IGludGVyYWN0IHdpdGggdGhlIHdyaXRlIGZlbmNlLiBQcm9iYWJseSwgdGhpcyBzaG91bGQgd29yayBieVxuLy8gICAgIGlnbm9yaW5nIHJlbW92ZXMgKHdoaWNoIGRvbid0IHdvcmsgb24gY2FwcGVkIGNvbGxlY3Rpb25zKSBhbmQgdXBkYXRlc1xuLy8gICAgICh3aGljaCBkb24ndCBhZmZlY3QgdGFpbGFibGUgY3Vyc29ycyksIGFuZCBqdXN0IGtlZXBpbmcgdHJhY2sgb2YgdGhlIElEXG4vLyAgICAgb2YgdGhlIGluc2VydGVkIG9iamVjdCwgYW5kIGNsb3NpbmcgdGhlIHdyaXRlIGZlbmNlIG9uY2UgeW91IGdldCB0byB0aGF0XG4vLyAgICAgSUQgKG9yIHRpbWVzdGFtcD8pLiAgVGhpcyBkb2Vzbid0IHdvcmsgd2VsbCBpZiB0aGUgZG9jdW1lbnQgZG9lc24ndCBtYXRjaFxuLy8gICAgIHRoZSBxdWVyeSwgdGhvdWdoLiAgT24gdGhlIG90aGVyIGhhbmQsIHRoZSB3cml0ZSBmZW5jZSBjYW4gY2xvc2Vcbi8vICAgICBpbW1lZGlhdGVseSBpZiBpdCBkb2VzIG5vdCBtYXRjaCB0aGUgcXVlcnkuIFNvIGlmIHdlIHRydXN0IG1pbmltb25nb1xuLy8gICAgIGVub3VnaCB0byBhY2N1cmF0ZWx5IGV2YWx1YXRlIHRoZSBxdWVyeSBhZ2FpbnN0IHRoZSB3cml0ZSBmZW5jZSwgd2Vcbi8vICAgICBzaG91bGQgYmUgYWJsZSB0byBkbyB0aGlzLi4uICBPZiBjb3Vyc2UsIG1pbmltb25nbyBkb2Vzbid0IGV2ZW4gc3VwcG9ydFxuLy8gICAgIE1vbmdvIFRpbWVzdGFtcHMgeWV0LlxuTW9uZ29Db25uZWN0aW9uLnByb3RvdHlwZS5fb2JzZXJ2ZUNoYW5nZXNUYWlsYWJsZSA9IGZ1bmN0aW9uIChcbiAgICBjdXJzb3JEZXNjcmlwdGlvbiwgb3JkZXJlZCwgY2FsbGJhY2tzKSB7XG4gIHZhciBzZWxmID0gdGhpcztcblxuICAvLyBUYWlsYWJsZSBjdXJzb3JzIG9ubHkgZXZlciBjYWxsIGFkZGVkL2FkZGVkQmVmb3JlIGNhbGxiYWNrcywgc28gaXQncyBhblxuICAvLyBlcnJvciBpZiB5b3UgZGlkbid0IHByb3ZpZGUgdGhlbS5cbiAgaWYgKChvcmRlcmVkICYmICFjYWxsYmFja3MuYWRkZWRCZWZvcmUpIHx8XG4gICAgICAoIW9yZGVyZWQgJiYgIWNhbGxiYWNrcy5hZGRlZCkpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoXCJDYW4ndCBvYnNlcnZlIGFuIFwiICsgKG9yZGVyZWQgPyBcIm9yZGVyZWRcIiA6IFwidW5vcmRlcmVkXCIpXG4gICAgICAgICAgICAgICAgICAgICsgXCIgdGFpbGFibGUgY3Vyc29yIHdpdGhvdXQgYSBcIlxuICAgICAgICAgICAgICAgICAgICArIChvcmRlcmVkID8gXCJhZGRlZEJlZm9yZVwiIDogXCJhZGRlZFwiKSArIFwiIGNhbGxiYWNrXCIpO1xuICB9XG5cbiAgcmV0dXJuIHNlbGYudGFpbChjdXJzb3JEZXNjcmlwdGlvbiwgZnVuY3Rpb24gKGRvYykge1xuICAgIHZhciBpZCA9IGRvYy5faWQ7XG4gICAgZGVsZXRlIGRvYy5faWQ7XG4gICAgLy8gVGhlIHRzIGlzIGFuIGltcGxlbWVudGF0aW9uIGRldGFpbC4gSGlkZSBpdC5cbiAgICBkZWxldGUgZG9jLnRzO1xuICAgIGlmIChvcmRlcmVkKSB7XG4gICAgICBjYWxsYmFja3MuYWRkZWRCZWZvcmUoaWQsIGRvYywgbnVsbCk7XG4gICAgfSBlbHNlIHtcbiAgICAgIGNhbGxiYWNrcy5hZGRlZChpZCwgZG9jKTtcbiAgICB9XG4gIH0pO1xufTtcblxuLy8gWFhYIFdlIHByb2JhYmx5IG5lZWQgdG8gZmluZCBhIGJldHRlciB3YXkgdG8gZXhwb3NlIHRoaXMuIFJpZ2h0IG5vd1xuLy8gaXQncyBvbmx5IHVzZWQgYnkgdGVzdHMsIGJ1dCBpbiBmYWN0IHlvdSBuZWVkIGl0IGluIG5vcm1hbFxuLy8gb3BlcmF0aW9uIHRvIGludGVyYWN0IHdpdGggY2FwcGVkIGNvbGxlY3Rpb25zLlxuTW9uZ29JbnRlcm5hbHMuTW9uZ29UaW1lc3RhbXAgPSBNb25nb0RCLlRpbWVzdGFtcDtcblxuTW9uZ29JbnRlcm5hbHMuQ29ubmVjdGlvbiA9IE1vbmdvQ29ubmVjdGlvbjtcbiIsInZhciBGdXR1cmUgPSBOcG0ucmVxdWlyZSgnZmliZXJzL2Z1dHVyZScpO1xuXG5pbXBvcnQgeyBOcG1Nb2R1bGVNb25nb2RiIH0gZnJvbSBcIm1ldGVvci9ucG0tbW9uZ29cIjtcbmNvbnN0IHsgVGltZXN0YW1wIH0gPSBOcG1Nb2R1bGVNb25nb2RiO1xuXG5PUExPR19DT0xMRUNUSU9OID0gJ29wbG9nLnJzJztcblxudmFyIFRPT19GQVJfQkVISU5EID0gcHJvY2Vzcy5lbnYuTUVURU9SX09QTE9HX1RPT19GQVJfQkVISU5EIHx8IDIwMDA7XG52YXIgVEFJTF9USU1FT1VUID0gK3Byb2Nlc3MuZW52Lk1FVEVPUl9PUExPR19UQUlMX1RJTUVPVVQgfHwgMzAwMDA7XG5cbnZhciBzaG93VFMgPSBmdW5jdGlvbiAodHMpIHtcbiAgcmV0dXJuIFwiVGltZXN0YW1wKFwiICsgdHMuZ2V0SGlnaEJpdHMoKSArIFwiLCBcIiArIHRzLmdldExvd0JpdHMoKSArIFwiKVwiO1xufTtcblxuaWRGb3JPcCA9IGZ1bmN0aW9uIChvcCkge1xuICBpZiAob3Aub3AgPT09ICdkJylcbiAgICByZXR1cm4gb3Auby5faWQ7XG4gIGVsc2UgaWYgKG9wLm9wID09PSAnaScpXG4gICAgcmV0dXJuIG9wLm8uX2lkO1xuICBlbHNlIGlmIChvcC5vcCA9PT0gJ3UnKVxuICAgIHJldHVybiBvcC5vMi5faWQ7XG4gIGVsc2UgaWYgKG9wLm9wID09PSAnYycpXG4gICAgdGhyb3cgRXJyb3IoXCJPcGVyYXRvciAnYycgZG9lc24ndCBzdXBwbHkgYW4gb2JqZWN0IHdpdGggaWQ6IFwiICtcbiAgICAgICAgICAgICAgICBFSlNPTi5zdHJpbmdpZnkob3ApKTtcbiAgZWxzZVxuICAgIHRocm93IEVycm9yKFwiVW5rbm93biBvcDogXCIgKyBFSlNPTi5zdHJpbmdpZnkob3ApKTtcbn07XG5cbk9wbG9nSGFuZGxlID0gZnVuY3Rpb24gKG9wbG9nVXJsLCBkYk5hbWUpIHtcbiAgdmFyIHNlbGYgPSB0aGlzO1xuICBzZWxmLl9vcGxvZ1VybCA9IG9wbG9nVXJsO1xuICBzZWxmLl9kYk5hbWUgPSBkYk5hbWU7XG5cbiAgc2VsZi5fb3Bsb2dMYXN0RW50cnlDb25uZWN0aW9uID0gbnVsbDtcbiAgc2VsZi5fb3Bsb2dUYWlsQ29ubmVjdGlvbiA9IG51bGw7XG4gIHNlbGYuX3N0b3BwZWQgPSBmYWxzZTtcbiAgc2VsZi5fdGFpbEhhbmRsZSA9IG51bGw7XG4gIHNlbGYuX3JlYWR5RnV0dXJlID0gbmV3IEZ1dHVyZSgpO1xuICBzZWxmLl9jcm9zc2JhciA9IG5ldyBERFBTZXJ2ZXIuX0Nyb3NzYmFyKHtcbiAgICBmYWN0UGFja2FnZTogXCJtb25nby1saXZlZGF0YVwiLCBmYWN0TmFtZTogXCJvcGxvZy13YXRjaGVyc1wiXG4gIH0pO1xuICBzZWxmLl9iYXNlT3Bsb2dTZWxlY3RvciA9IHtcbiAgICBuczogbmV3IFJlZ0V4cChcIl4oPzpcIiArIFtcbiAgICAgIE1ldGVvci5fZXNjYXBlUmVnRXhwKHNlbGYuX2RiTmFtZSArIFwiLlwiKSxcbiAgICAgIE1ldGVvci5fZXNjYXBlUmVnRXhwKFwiYWRtaW4uJGNtZFwiKSxcbiAgICBdLmpvaW4oXCJ8XCIpICsgXCIpXCIpLFxuXG4gICAgJG9yOiBbXG4gICAgICB7IG9wOiB7ICRpbjogWydpJywgJ3UnLCAnZCddIH0gfSxcbiAgICAgIC8vIGRyb3AgY29sbGVjdGlvblxuICAgICAgeyBvcDogJ2MnLCAnby5kcm9wJzogeyAkZXhpc3RzOiB0cnVlIH0gfSxcbiAgICAgIHsgb3A6ICdjJywgJ28uZHJvcERhdGFiYXNlJzogMSB9LFxuICAgICAgeyBvcDogJ2MnLCAnby5hcHBseU9wcyc6IHsgJGV4aXN0czogdHJ1ZSB9IH0sXG4gICAgXVxuICB9O1xuXG4gIC8vIERhdGEgc3RydWN0dXJlcyB0byBzdXBwb3J0IHdhaXRVbnRpbENhdWdodFVwKCkuIEVhY2ggb3Bsb2cgZW50cnkgaGFzIGFcbiAgLy8gTW9uZ29UaW1lc3RhbXAgb2JqZWN0IG9uIGl0ICh3aGljaCBpcyBub3QgdGhlIHNhbWUgYXMgYSBEYXRlIC0tLSBpdCdzIGFcbiAgLy8gY29tYmluYXRpb24gb2YgdGltZSBhbmQgYW4gaW5jcmVtZW50aW5nIGNvdW50ZXI7IHNlZVxuICAvLyBodHRwOi8vZG9jcy5tb25nb2RiLm9yZy9tYW51YWwvcmVmZXJlbmNlL2Jzb24tdHlwZXMvI3RpbWVzdGFtcHMpLlxuICAvL1xuICAvLyBfY2F0Y2hpbmdVcEZ1dHVyZXMgaXMgYW4gYXJyYXkgb2Yge3RzOiBNb25nb1RpbWVzdGFtcCwgZnV0dXJlOiBGdXR1cmV9XG4gIC8vIG9iamVjdHMsIHNvcnRlZCBieSBhc2NlbmRpbmcgdGltZXN0YW1wLiBfbGFzdFByb2Nlc3NlZFRTIGlzIHRoZVxuICAvLyBNb25nb1RpbWVzdGFtcCBvZiB0aGUgbGFzdCBvcGxvZyBlbnRyeSB3ZSd2ZSBwcm9jZXNzZWQuXG4gIC8vXG4gIC8vIEVhY2ggdGltZSB3ZSBjYWxsIHdhaXRVbnRpbENhdWdodFVwLCB3ZSB0YWtlIGEgcGVlayBhdCB0aGUgZmluYWwgb3Bsb2dcbiAgLy8gZW50cnkgaW4gdGhlIGRiLiAgSWYgd2UndmUgYWxyZWFkeSBwcm9jZXNzZWQgaXQgKGllLCBpdCBpcyBub3QgZ3JlYXRlciB0aGFuXG4gIC8vIF9sYXN0UHJvY2Vzc2VkVFMpLCB3YWl0VW50aWxDYXVnaHRVcCBpbW1lZGlhdGVseSByZXR1cm5zLiBPdGhlcndpc2UsXG4gIC8vIHdhaXRVbnRpbENhdWdodFVwIG1ha2VzIGEgbmV3IEZ1dHVyZSBhbmQgaW5zZXJ0cyBpdCBhbG9uZyB3aXRoIHRoZSBmaW5hbFxuICAvLyB0aW1lc3RhbXAgZW50cnkgdGhhdCBpdCByZWFkLCBpbnRvIF9jYXRjaGluZ1VwRnV0dXJlcy4gd2FpdFVudGlsQ2F1Z2h0VXBcbiAgLy8gdGhlbiB3YWl0cyBvbiB0aGF0IGZ1dHVyZSwgd2hpY2ggaXMgcmVzb2x2ZWQgb25jZSBfbGFzdFByb2Nlc3NlZFRTIGlzXG4gIC8vIGluY3JlbWVudGVkIHRvIGJlIHBhc3QgaXRzIHRpbWVzdGFtcCBieSB0aGUgd29ya2VyIGZpYmVyLlxuICAvL1xuICAvLyBYWFggdXNlIGEgcHJpb3JpdHkgcXVldWUgb3Igc29tZXRoaW5nIGVsc2UgdGhhdCdzIGZhc3RlciB0aGFuIGFuIGFycmF5XG4gIHNlbGYuX2NhdGNoaW5nVXBGdXR1cmVzID0gW107XG4gIHNlbGYuX2xhc3RQcm9jZXNzZWRUUyA9IG51bGw7XG5cbiAgc2VsZi5fb25Ta2lwcGVkRW50cmllc0hvb2sgPSBuZXcgSG9vayh7XG4gICAgZGVidWdQcmludEV4Y2VwdGlvbnM6IFwib25Ta2lwcGVkRW50cmllcyBjYWxsYmFja1wiXG4gIH0pO1xuXG4gIHNlbGYuX2VudHJ5UXVldWUgPSBuZXcgTWV0ZW9yLl9Eb3VibGVFbmRlZFF1ZXVlKCk7XG4gIHNlbGYuX3dvcmtlckFjdGl2ZSA9IGZhbHNlO1xuXG4gIHNlbGYuX3N0YXJ0VGFpbGluZygpO1xufTtcblxuXy5leHRlbmQoT3Bsb2dIYW5kbGUucHJvdG90eXBlLCB7XG4gIHN0b3A6IGZ1bmN0aW9uICgpIHtcbiAgICB2YXIgc2VsZiA9IHRoaXM7XG4gICAgaWYgKHNlbGYuX3N0b3BwZWQpXG4gICAgICByZXR1cm47XG4gICAgc2VsZi5fc3RvcHBlZCA9IHRydWU7XG4gICAgaWYgKHNlbGYuX3RhaWxIYW5kbGUpXG4gICAgICBzZWxmLl90YWlsSGFuZGxlLnN0b3AoKTtcbiAgICAvLyBYWFggc2hvdWxkIGNsb3NlIGNvbm5lY3Rpb25zIHRvb1xuICB9LFxuICBvbk9wbG9nRW50cnk6IGZ1bmN0aW9uICh0cmlnZ2VyLCBjYWxsYmFjaykge1xuICAgIHZhciBzZWxmID0gdGhpcztcbiAgICBpZiAoc2VsZi5fc3RvcHBlZClcbiAgICAgIHRocm93IG5ldyBFcnJvcihcIkNhbGxlZCBvbk9wbG9nRW50cnkgb24gc3RvcHBlZCBoYW5kbGUhXCIpO1xuXG4gICAgLy8gQ2FsbGluZyBvbk9wbG9nRW50cnkgcmVxdWlyZXMgdXMgdG8gd2FpdCBmb3IgdGhlIHRhaWxpbmcgdG8gYmUgcmVhZHkuXG4gICAgc2VsZi5fcmVhZHlGdXR1cmUud2FpdCgpO1xuXG4gICAgdmFyIG9yaWdpbmFsQ2FsbGJhY2sgPSBjYWxsYmFjaztcbiAgICBjYWxsYmFjayA9IE1ldGVvci5iaW5kRW52aXJvbm1lbnQoZnVuY3Rpb24gKG5vdGlmaWNhdGlvbikge1xuICAgICAgb3JpZ2luYWxDYWxsYmFjayhub3RpZmljYXRpb24pO1xuICAgIH0sIGZ1bmN0aW9uIChlcnIpIHtcbiAgICAgIE1ldGVvci5fZGVidWcoXCJFcnJvciBpbiBvcGxvZyBjYWxsYmFja1wiLCBlcnIpO1xuICAgIH0pO1xuICAgIHZhciBsaXN0ZW5IYW5kbGUgPSBzZWxmLl9jcm9zc2Jhci5saXN0ZW4odHJpZ2dlciwgY2FsbGJhY2spO1xuICAgIHJldHVybiB7XG4gICAgICBzdG9wOiBmdW5jdGlvbiAoKSB7XG4gICAgICAgIGxpc3RlbkhhbmRsZS5zdG9wKCk7XG4gICAgICB9XG4gICAgfTtcbiAgfSxcbiAgLy8gUmVnaXN0ZXIgYSBjYWxsYmFjayB0byBiZSBpbnZva2VkIGFueSB0aW1lIHdlIHNraXAgb3Bsb2cgZW50cmllcyAoZWcsXG4gIC8vIGJlY2F1c2Ugd2UgYXJlIHRvbyBmYXIgYmVoaW5kKS5cbiAgb25Ta2lwcGVkRW50cmllczogZnVuY3Rpb24gKGNhbGxiYWNrKSB7XG4gICAgdmFyIHNlbGYgPSB0aGlzO1xuICAgIGlmIChzZWxmLl9zdG9wcGVkKVxuICAgICAgdGhyb3cgbmV3IEVycm9yKFwiQ2FsbGVkIG9uU2tpcHBlZEVudHJpZXMgb24gc3RvcHBlZCBoYW5kbGUhXCIpO1xuICAgIHJldHVybiBzZWxmLl9vblNraXBwZWRFbnRyaWVzSG9vay5yZWdpc3RlcihjYWxsYmFjayk7XG4gIH0sXG4gIC8vIENhbGxzIGBjYWxsYmFja2Agb25jZSB0aGUgb3Bsb2cgaGFzIGJlZW4gcHJvY2Vzc2VkIHVwIHRvIGEgcG9pbnQgdGhhdCBpc1xuICAvLyByb3VnaGx5IFwibm93XCI6IHNwZWNpZmljYWxseSwgb25jZSB3ZSd2ZSBwcm9jZXNzZWQgYWxsIG9wcyB0aGF0IGFyZVxuICAvLyBjdXJyZW50bHkgdmlzaWJsZS5cbiAgLy8gWFhYIGJlY29tZSBjb252aW5jZWQgdGhhdCB0aGlzIGlzIGFjdHVhbGx5IHNhZmUgZXZlbiBpZiBvcGxvZ0Nvbm5lY3Rpb25cbiAgLy8gaXMgc29tZSBraW5kIG9mIHBvb2xcbiAgd2FpdFVudGlsQ2F1Z2h0VXA6IGZ1bmN0aW9uICgpIHtcbiAgICB2YXIgc2VsZiA9IHRoaXM7XG4gICAgaWYgKHNlbGYuX3N0b3BwZWQpXG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXCJDYWxsZWQgd2FpdFVudGlsQ2F1Z2h0VXAgb24gc3RvcHBlZCBoYW5kbGUhXCIpO1xuXG4gICAgLy8gQ2FsbGluZyB3YWl0VW50aWxDYXVnaHRVcCByZXF1cmllcyB1cyB0byB3YWl0IGZvciB0aGUgb3Bsb2cgY29ubmVjdGlvbiB0b1xuICAgIC8vIGJlIHJlYWR5LlxuICAgIHNlbGYuX3JlYWR5RnV0dXJlLndhaXQoKTtcbiAgICB2YXIgbGFzdEVudHJ5O1xuXG4gICAgd2hpbGUgKCFzZWxmLl9zdG9wcGVkKSB7XG4gICAgICAvLyBXZSBuZWVkIHRvIG1ha2UgdGhlIHNlbGVjdG9yIGF0IGxlYXN0IGFzIHJlc3RyaWN0aXZlIGFzIHRoZSBhY3R1YWxcbiAgICAgIC8vIHRhaWxpbmcgc2VsZWN0b3IgKGllLCB3ZSBuZWVkIHRvIHNwZWNpZnkgdGhlIERCIG5hbWUpIG9yIGVsc2Ugd2UgbWlnaHRcbiAgICAgIC8vIGZpbmQgYSBUUyB0aGF0IHdvbid0IHNob3cgdXAgaW4gdGhlIGFjdHVhbCB0YWlsIHN0cmVhbS5cbiAgICAgIHRyeSB7XG4gICAgICAgIGxhc3RFbnRyeSA9IHNlbGYuX29wbG9nTGFzdEVudHJ5Q29ubmVjdGlvbi5maW5kT25lKFxuICAgICAgICAgIE9QTE9HX0NPTExFQ1RJT04sIHNlbGYuX2Jhc2VPcGxvZ1NlbGVjdG9yLFxuICAgICAgICAgIHtmaWVsZHM6IHt0czogMX0sIHNvcnQ6IHskbmF0dXJhbDogLTF9fSk7XG4gICAgICAgIGJyZWFrO1xuICAgICAgfSBjYXRjaCAoZSkge1xuICAgICAgICAvLyBEdXJpbmcgZmFpbG92ZXIgKGVnKSBpZiB3ZSBnZXQgYW4gZXhjZXB0aW9uIHdlIHNob3VsZCBsb2cgYW5kIHJldHJ5XG4gICAgICAgIC8vIGluc3RlYWQgb2YgY3Jhc2hpbmcuXG4gICAgICAgIE1ldGVvci5fZGVidWcoXCJHb3QgZXhjZXB0aW9uIHdoaWxlIHJlYWRpbmcgbGFzdCBlbnRyeVwiLCBlKTtcbiAgICAgICAgTWV0ZW9yLl9zbGVlcEZvck1zKDEwMCk7XG4gICAgICB9XG4gICAgfVxuXG4gICAgaWYgKHNlbGYuX3N0b3BwZWQpXG4gICAgICByZXR1cm47XG5cbiAgICBpZiAoIWxhc3RFbnRyeSkge1xuICAgICAgLy8gUmVhbGx5LCBub3RoaW5nIGluIHRoZSBvcGxvZz8gV2VsbCwgd2UndmUgcHJvY2Vzc2VkIGV2ZXJ5dGhpbmcuXG4gICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgdmFyIHRzID0gbGFzdEVudHJ5LnRzO1xuICAgIGlmICghdHMpXG4gICAgICB0aHJvdyBFcnJvcihcIm9wbG9nIGVudHJ5IHdpdGhvdXQgdHM6IFwiICsgRUpTT04uc3RyaW5naWZ5KGxhc3RFbnRyeSkpO1xuXG4gICAgaWYgKHNlbGYuX2xhc3RQcm9jZXNzZWRUUyAmJiB0cy5sZXNzVGhhbk9yRXF1YWwoc2VsZi5fbGFzdFByb2Nlc3NlZFRTKSkge1xuICAgICAgLy8gV2UndmUgYWxyZWFkeSBjYXVnaHQgdXAgdG8gaGVyZS5cbiAgICAgIHJldHVybjtcbiAgICB9XG5cblxuICAgIC8vIEluc2VydCB0aGUgZnV0dXJlIGludG8gb3VyIGxpc3QuIEFsbW9zdCBhbHdheXMsIHRoaXMgd2lsbCBiZSBhdCB0aGUgZW5kLFxuICAgIC8vIGJ1dCBpdCdzIGNvbmNlaXZhYmxlIHRoYXQgaWYgd2UgZmFpbCBvdmVyIGZyb20gb25lIHByaW1hcnkgdG8gYW5vdGhlcixcbiAgICAvLyB0aGUgb3Bsb2cgZW50cmllcyB3ZSBzZWUgd2lsbCBnbyBiYWNrd2FyZHMuXG4gICAgdmFyIGluc2VydEFmdGVyID0gc2VsZi5fY2F0Y2hpbmdVcEZ1dHVyZXMubGVuZ3RoO1xuICAgIHdoaWxlIChpbnNlcnRBZnRlciAtIDEgPiAwICYmIHNlbGYuX2NhdGNoaW5nVXBGdXR1cmVzW2luc2VydEFmdGVyIC0gMV0udHMuZ3JlYXRlclRoYW4odHMpKSB7XG4gICAgICBpbnNlcnRBZnRlci0tO1xuICAgIH1cbiAgICB2YXIgZiA9IG5ldyBGdXR1cmU7XG4gICAgc2VsZi5fY2F0Y2hpbmdVcEZ1dHVyZXMuc3BsaWNlKGluc2VydEFmdGVyLCAwLCB7dHM6IHRzLCBmdXR1cmU6IGZ9KTtcbiAgICBmLndhaXQoKTtcbiAgfSxcbiAgX3N0YXJ0VGFpbGluZzogZnVuY3Rpb24gKCkge1xuICAgIHZhciBzZWxmID0gdGhpcztcbiAgICAvLyBGaXJzdCwgbWFrZSBzdXJlIHRoYXQgd2UncmUgdGFsa2luZyB0byB0aGUgbG9jYWwgZGF0YWJhc2UuXG4gICAgdmFyIG1vbmdvZGJVcmkgPSBOcG0ucmVxdWlyZSgnbW9uZ29kYi11cmknKTtcbiAgICBpZiAobW9uZ29kYlVyaS5wYXJzZShzZWxmLl9vcGxvZ1VybCkuZGF0YWJhc2UgIT09ICdsb2NhbCcpIHtcbiAgICAgIHRocm93IEVycm9yKFwiJE1PTkdPX09QTE9HX1VSTCBtdXN0IGJlIHNldCB0byB0aGUgJ2xvY2FsJyBkYXRhYmFzZSBvZiBcIiArXG4gICAgICAgICAgICAgICAgICBcImEgTW9uZ28gcmVwbGljYSBzZXRcIik7XG4gICAgfVxuXG4gICAgLy8gV2UgbWFrZSB0d28gc2VwYXJhdGUgY29ubmVjdGlvbnMgdG8gTW9uZ28uIFRoZSBOb2RlIE1vbmdvIGRyaXZlclxuICAgIC8vIGltcGxlbWVudHMgYSBuYWl2ZSByb3VuZC1yb2JpbiBjb25uZWN0aW9uIHBvb2w6IGVhY2ggXCJjb25uZWN0aW9uXCIgaXMgYVxuICAgIC8vIHBvb2wgb2Ygc2V2ZXJhbCAoNSBieSBkZWZhdWx0KSBUQ1AgY29ubmVjdGlvbnMsIGFuZCBlYWNoIHJlcXVlc3QgaXNcbiAgICAvLyByb3RhdGVkIHRocm91Z2ggdGhlIHBvb2xzLiBUYWlsYWJsZSBjdXJzb3IgcXVlcmllcyBibG9jayBvbiB0aGUgc2VydmVyXG4gICAgLy8gdW50aWwgdGhlcmUgaXMgc29tZSBkYXRhIHRvIHJldHVybiAob3IgdW50aWwgYSBmZXcgc2Vjb25kcyBoYXZlXG4gICAgLy8gcGFzc2VkKS4gU28gaWYgdGhlIGNvbm5lY3Rpb24gcG9vbCB1c2VkIGZvciB0YWlsaW5nIGN1cnNvcnMgaXMgdGhlIHNhbWVcbiAgICAvLyBwb29sIHVzZWQgZm9yIG90aGVyIHF1ZXJpZXMsIHRoZSBvdGhlciBxdWVyaWVzIHdpbGwgYmUgZGVsYXllZCBieSBzZWNvbmRzXG4gICAgLy8gMS81IG9mIHRoZSB0aW1lLlxuICAgIC8vXG4gICAgLy8gVGhlIHRhaWwgY29ubmVjdGlvbiB3aWxsIG9ubHkgZXZlciBiZSBydW5uaW5nIGEgc2luZ2xlIHRhaWwgY29tbWFuZCwgc29cbiAgICAvLyBpdCBvbmx5IG5lZWRzIHRvIG1ha2Ugb25lIHVuZGVybHlpbmcgVENQIGNvbm5lY3Rpb24uXG4gICAgc2VsZi5fb3Bsb2dUYWlsQ29ubmVjdGlvbiA9IG5ldyBNb25nb0Nvbm5lY3Rpb24oXG4gICAgICBzZWxmLl9vcGxvZ1VybCwge3Bvb2xTaXplOiAxfSk7XG4gICAgLy8gWFhYIGJldHRlciBkb2NzLCBidXQ6IGl0J3MgdG8gZ2V0IG1vbm90b25pYyByZXN1bHRzXG4gICAgLy8gWFhYIGlzIGl0IHNhZmUgdG8gc2F5IFwiaWYgdGhlcmUncyBhbiBpbiBmbGlnaHQgcXVlcnksIGp1c3QgdXNlIGl0c1xuICAgIC8vICAgICByZXN1bHRzXCI/IEkgZG9uJ3QgdGhpbmsgc28gYnV0IHNob3VsZCBjb25zaWRlciB0aGF0XG4gICAgc2VsZi5fb3Bsb2dMYXN0RW50cnlDb25uZWN0aW9uID0gbmV3IE1vbmdvQ29ubmVjdGlvbihcbiAgICAgIHNlbGYuX29wbG9nVXJsLCB7cG9vbFNpemU6IDF9KTtcblxuICAgIC8vIE5vdywgbWFrZSBzdXJlIHRoYXQgdGhlcmUgYWN0dWFsbHkgaXMgYSByZXBsIHNldCBoZXJlLiBJZiBub3QsIG9wbG9nXG4gICAgLy8gdGFpbGluZyB3b24ndCBldmVyIGZpbmQgYW55dGhpbmchXG4gICAgLy8gTW9yZSBvbiB0aGUgaXNNYXN0ZXJEb2NcbiAgICAvLyBodHRwczovL2RvY3MubW9uZ29kYi5jb20vbWFudWFsL3JlZmVyZW5jZS9jb21tYW5kL2lzTWFzdGVyL1xuICAgIHZhciBmID0gbmV3IEZ1dHVyZTtcbiAgICBzZWxmLl9vcGxvZ0xhc3RFbnRyeUNvbm5lY3Rpb24uZGIuYWRtaW4oKS5jb21tYW5kKFxuICAgICAgeyBpc21hc3RlcjogMSB9LCBmLnJlc29sdmVyKCkpO1xuICAgIHZhciBpc01hc3RlckRvYyA9IGYud2FpdCgpO1xuXG4gICAgaWYgKCEoaXNNYXN0ZXJEb2MgJiYgaXNNYXN0ZXJEb2Muc2V0TmFtZSkpIHtcbiAgICAgIHRocm93IEVycm9yKFwiJE1PTkdPX09QTE9HX1VSTCBtdXN0IGJlIHNldCB0byB0aGUgJ2xvY2FsJyBkYXRhYmFzZSBvZiBcIiArXG4gICAgICAgICAgICAgICAgICBcImEgTW9uZ28gcmVwbGljYSBzZXRcIik7XG4gICAgfVxuXG4gICAgLy8gRmluZCB0aGUgbGFzdCBvcGxvZyBlbnRyeS5cbiAgICB2YXIgbGFzdE9wbG9nRW50cnkgPSBzZWxmLl9vcGxvZ0xhc3RFbnRyeUNvbm5lY3Rpb24uZmluZE9uZShcbiAgICAgIE9QTE9HX0NPTExFQ1RJT04sIHt9LCB7c29ydDogeyRuYXR1cmFsOiAtMX0sIGZpZWxkczoge3RzOiAxfX0pO1xuXG4gICAgdmFyIG9wbG9nU2VsZWN0b3IgPSBfLmNsb25lKHNlbGYuX2Jhc2VPcGxvZ1NlbGVjdG9yKTtcbiAgICBpZiAobGFzdE9wbG9nRW50cnkpIHtcbiAgICAgIC8vIFN0YXJ0IGFmdGVyIHRoZSBsYXN0IGVudHJ5IHRoYXQgY3VycmVudGx5IGV4aXN0cy5cbiAgICAgIG9wbG9nU2VsZWN0b3IudHMgPSB7JGd0OiBsYXN0T3Bsb2dFbnRyeS50c307XG4gICAgICAvLyBJZiB0aGVyZSBhcmUgYW55IGNhbGxzIHRvIGNhbGxXaGVuUHJvY2Vzc2VkTGF0ZXN0IGJlZm9yZSBhbnkgb3RoZXJcbiAgICAgIC8vIG9wbG9nIGVudHJpZXMgc2hvdyB1cCwgYWxsb3cgY2FsbFdoZW5Qcm9jZXNzZWRMYXRlc3QgdG8gY2FsbCBpdHNcbiAgICAgIC8vIGNhbGxiYWNrIGltbWVkaWF0ZWx5LlxuICAgICAgc2VsZi5fbGFzdFByb2Nlc3NlZFRTID0gbGFzdE9wbG9nRW50cnkudHM7XG4gICAgfVxuXG4gICAgdmFyIGN1cnNvckRlc2NyaXB0aW9uID0gbmV3IEN1cnNvckRlc2NyaXB0aW9uKFxuICAgICAgT1BMT0dfQ09MTEVDVElPTiwgb3Bsb2dTZWxlY3Rvciwge3RhaWxhYmxlOiB0cnVlfSk7XG5cbiAgICAvLyBTdGFydCB0YWlsaW5nIHRoZSBvcGxvZy5cbiAgICAvL1xuICAgIC8vIFdlIHJlc3RhcnQgdGhlIGxvdy1sZXZlbCBvcGxvZyBxdWVyeSBldmVyeSAzMCBzZWNvbmRzIGlmIHdlIGRpZG4ndCBnZXQgYVxuICAgIC8vIGRvYy4gVGhpcyBpcyBhIHdvcmthcm91bmQgZm9yICM4NTk4OiB0aGUgTm9kZSBNb25nbyBkcml2ZXIgaGFzIGF0IGxlYXN0XG4gICAgLy8gb25lIGJ1ZyB0aGF0IGNhbiBsZWFkIHRvIHF1ZXJ5IGNhbGxiYWNrcyBuZXZlciBnZXR0aW5nIGNhbGxlZCAoZXZlbiB3aXRoXG4gICAgLy8gYW4gZXJyb3IpIHdoZW4gbGVhZGVyc2hpcCBmYWlsb3ZlciBvY2N1ci5cbiAgICBzZWxmLl90YWlsSGFuZGxlID0gc2VsZi5fb3Bsb2dUYWlsQ29ubmVjdGlvbi50YWlsKFxuICAgICAgY3Vyc29yRGVzY3JpcHRpb24sXG4gICAgICBmdW5jdGlvbiAoZG9jKSB7XG4gICAgICAgIHNlbGYuX2VudHJ5UXVldWUucHVzaChkb2MpO1xuICAgICAgICBzZWxmLl9tYXliZVN0YXJ0V29ya2VyKCk7XG4gICAgICB9LFxuICAgICAgVEFJTF9USU1FT1VUXG4gICAgKTtcbiAgICBzZWxmLl9yZWFkeUZ1dHVyZS5yZXR1cm4oKTtcbiAgfSxcblxuICBfbWF5YmVTdGFydFdvcmtlcjogZnVuY3Rpb24gKCkge1xuICAgIHZhciBzZWxmID0gdGhpcztcbiAgICBpZiAoc2VsZi5fd29ya2VyQWN0aXZlKSByZXR1cm47XG4gICAgc2VsZi5fd29ya2VyQWN0aXZlID0gdHJ1ZTtcblxuICAgIE1ldGVvci5kZWZlcihmdW5jdGlvbiAoKSB7XG4gICAgICAvLyBNYXkgYmUgY2FsbGVkIHJlY3Vyc2l2ZWx5IGluIGNhc2Ugb2YgdHJhbnNhY3Rpb25zLlxuICAgICAgZnVuY3Rpb24gaGFuZGxlRG9jKGRvYykge1xuICAgICAgICBpZiAoZG9jLm5zID09PSBcImFkbWluLiRjbWRcIikge1xuICAgICAgICAgIGlmIChkb2Muby5hcHBseU9wcykge1xuICAgICAgICAgICAgLy8gVGhpcyB3YXMgYSBzdWNjZXNzZnVsIHRyYW5zYWN0aW9uLCBzbyB3ZSBuZWVkIHRvIGFwcGx5IHRoZVxuICAgICAgICAgICAgLy8gb3BlcmF0aW9ucyB0aGF0IHdlcmUgaW52b2x2ZWQuXG4gICAgICAgICAgICBsZXQgbmV4dFRpbWVzdGFtcCA9IGRvYy50cztcbiAgICAgICAgICAgIGRvYy5vLmFwcGx5T3BzLmZvckVhY2gob3AgPT4ge1xuICAgICAgICAgICAgICAvLyBTZWUgaHR0cHM6Ly9naXRodWIuY29tL21ldGVvci9tZXRlb3IvaXNzdWVzLzEwNDIwLlxuICAgICAgICAgICAgICBpZiAoIW9wLnRzKSB7XG4gICAgICAgICAgICAgICAgb3AudHMgPSBuZXh0VGltZXN0YW1wO1xuICAgICAgICAgICAgICAgIG5leHRUaW1lc3RhbXAgPSBuZXh0VGltZXN0YW1wLmFkZChUaW1lc3RhbXAuT05FKTtcbiAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICBoYW5kbGVEb2Mob3ApO1xuICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICByZXR1cm47XG4gICAgICAgICAgfVxuICAgICAgICAgIHRocm93IG5ldyBFcnJvcihcIlVua25vd24gY29tbWFuZCBcIiArIEVKU09OLnN0cmluZ2lmeShkb2MpKTtcbiAgICAgICAgfVxuXG4gICAgICAgIGNvbnN0IHRyaWdnZXIgPSB7XG4gICAgICAgICAgZHJvcENvbGxlY3Rpb246IGZhbHNlLFxuICAgICAgICAgIGRyb3BEYXRhYmFzZTogZmFsc2UsXG4gICAgICAgICAgb3A6IGRvYyxcbiAgICAgICAgfTtcblxuICAgICAgICBpZiAodHlwZW9mIGRvYy5ucyA9PT0gXCJzdHJpbmdcIiAmJlxuICAgICAgICAgICAgZG9jLm5zLnN0YXJ0c1dpdGgoc2VsZi5fZGJOYW1lICsgXCIuXCIpKSB7XG4gICAgICAgICAgdHJpZ2dlci5jb2xsZWN0aW9uID0gZG9jLm5zLnNsaWNlKHNlbGYuX2RiTmFtZS5sZW5ndGggKyAxKTtcbiAgICAgICAgfVxuXG4gICAgICAgIC8vIElzIGl0IGEgc3BlY2lhbCBjb21tYW5kIGFuZCB0aGUgY29sbGVjdGlvbiBuYW1lIGlzIGhpZGRlblxuICAgICAgICAvLyBzb21ld2hlcmUgaW4gb3BlcmF0b3I/XG4gICAgICAgIGlmICh0cmlnZ2VyLmNvbGxlY3Rpb24gPT09IFwiJGNtZFwiKSB7XG4gICAgICAgICAgaWYgKGRvYy5vLmRyb3BEYXRhYmFzZSkge1xuICAgICAgICAgICAgZGVsZXRlIHRyaWdnZXIuY29sbGVjdGlvbjtcbiAgICAgICAgICAgIHRyaWdnZXIuZHJvcERhdGFiYXNlID0gdHJ1ZTtcbiAgICAgICAgICB9IGVsc2UgaWYgKF8uaGFzKGRvYy5vLCBcImRyb3BcIikpIHtcbiAgICAgICAgICAgIHRyaWdnZXIuY29sbGVjdGlvbiA9IGRvYy5vLmRyb3A7XG4gICAgICAgICAgICB0cmlnZ2VyLmRyb3BDb2xsZWN0aW9uID0gdHJ1ZTtcbiAgICAgICAgICAgIHRyaWdnZXIuaWQgPSBudWxsO1xuICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICB0aHJvdyBFcnJvcihcIlVua25vd24gY29tbWFuZCBcIiArIEVKU09OLnN0cmluZ2lmeShkb2MpKTtcbiAgICAgICAgICB9XG5cbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAvLyBBbGwgb3RoZXIgb3BzIGhhdmUgYW4gaWQuXG4gICAgICAgICAgdHJpZ2dlci5pZCA9IGlkRm9yT3AoZG9jKTtcbiAgICAgICAgfVxuXG4gICAgICAgIHNlbGYuX2Nyb3NzYmFyLmZpcmUodHJpZ2dlcik7XG4gICAgICB9XG5cbiAgICAgIHRyeSB7XG4gICAgICAgIHdoaWxlICghIHNlbGYuX3N0b3BwZWQgJiZcbiAgICAgICAgICAgICAgICEgc2VsZi5fZW50cnlRdWV1ZS5pc0VtcHR5KCkpIHtcbiAgICAgICAgICAvLyBBcmUgd2UgdG9vIGZhciBiZWhpbmQ/IEp1c3QgdGVsbCBvdXIgb2JzZXJ2ZXJzIHRoYXQgdGhleSBuZWVkIHRvXG4gICAgICAgICAgLy8gcmVwb2xsLCBhbmQgZHJvcCBvdXIgcXVldWUuXG4gICAgICAgICAgaWYgKHNlbGYuX2VudHJ5UXVldWUubGVuZ3RoID4gVE9PX0ZBUl9CRUhJTkQpIHtcbiAgICAgICAgICAgIHZhciBsYXN0RW50cnkgPSBzZWxmLl9lbnRyeVF1ZXVlLnBvcCgpO1xuICAgICAgICAgICAgc2VsZi5fZW50cnlRdWV1ZS5jbGVhcigpO1xuXG4gICAgICAgICAgICBzZWxmLl9vblNraXBwZWRFbnRyaWVzSG9vay5lYWNoKGZ1bmN0aW9uIChjYWxsYmFjaykge1xuICAgICAgICAgICAgICBjYWxsYmFjaygpO1xuICAgICAgICAgICAgICByZXR1cm4gdHJ1ZTtcbiAgICAgICAgICAgIH0pO1xuXG4gICAgICAgICAgICAvLyBGcmVlIGFueSB3YWl0VW50aWxDYXVnaHRVcCgpIGNhbGxzIHRoYXQgd2VyZSB3YWl0aW5nIGZvciB1cyB0b1xuICAgICAgICAgICAgLy8gcGFzcyBzb21ldGhpbmcgdGhhdCB3ZSBqdXN0IHNraXBwZWQuXG4gICAgICAgICAgICBzZWxmLl9zZXRMYXN0UHJvY2Vzc2VkVFMobGFzdEVudHJ5LnRzKTtcbiAgICAgICAgICAgIGNvbnRpbnVlO1xuICAgICAgICAgIH1cblxuICAgICAgICAgIGNvbnN0IGRvYyA9IHNlbGYuX2VudHJ5UXVldWUuc2hpZnQoKTtcblxuICAgICAgICAgIC8vIEZpcmUgdHJpZ2dlcihzKSBmb3IgdGhpcyBkb2MuXG4gICAgICAgICAgaGFuZGxlRG9jKGRvYyk7XG5cbiAgICAgICAgICAvLyBOb3cgdGhhdCB3ZSd2ZSBwcm9jZXNzZWQgdGhpcyBvcGVyYXRpb24sIHByb2Nlc3MgcGVuZGluZ1xuICAgICAgICAgIC8vIHNlcXVlbmNlcnMuXG4gICAgICAgICAgaWYgKGRvYy50cykge1xuICAgICAgICAgICAgc2VsZi5fc2V0TGFzdFByb2Nlc3NlZFRTKGRvYy50cyk7XG4gICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIHRocm93IEVycm9yKFwib3Bsb2cgZW50cnkgd2l0aG91dCB0czogXCIgKyBFSlNPTi5zdHJpbmdpZnkoZG9jKSk7XG4gICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICB9IGZpbmFsbHkge1xuICAgICAgICBzZWxmLl93b3JrZXJBY3RpdmUgPSBmYWxzZTtcbiAgICAgIH1cbiAgICB9KTtcbiAgfSxcblxuICBfc2V0TGFzdFByb2Nlc3NlZFRTOiBmdW5jdGlvbiAodHMpIHtcbiAgICB2YXIgc2VsZiA9IHRoaXM7XG4gICAgc2VsZi5fbGFzdFByb2Nlc3NlZFRTID0gdHM7XG4gICAgd2hpbGUgKCFfLmlzRW1wdHkoc2VsZi5fY2F0Y2hpbmdVcEZ1dHVyZXMpICYmIHNlbGYuX2NhdGNoaW5nVXBGdXR1cmVzWzBdLnRzLmxlc3NUaGFuT3JFcXVhbChzZWxmLl9sYXN0UHJvY2Vzc2VkVFMpKSB7XG4gICAgICB2YXIgc2VxdWVuY2VyID0gc2VsZi5fY2F0Y2hpbmdVcEZ1dHVyZXMuc2hpZnQoKTtcbiAgICAgIHNlcXVlbmNlci5mdXR1cmUucmV0dXJuKCk7XG4gICAgfVxuICB9LFxuXG4gIC8vTWV0aG9kcyB1c2VkIG9uIHRlc3RzIHRvIGRpbmFtaWNhbGx5IGNoYW5nZSBUT09fRkFSX0JFSElORFxuICBfZGVmaW5lVG9vRmFyQmVoaW5kOiBmdW5jdGlvbih2YWx1ZSkge1xuICAgIFRPT19GQVJfQkVISU5EID0gdmFsdWU7XG4gIH0sXG4gIF9yZXNldFRvb0ZhckJlaGluZDogZnVuY3Rpb24oKSB7XG4gICAgVE9PX0ZBUl9CRUhJTkQgPSBwcm9jZXNzLmVudi5NRVRFT1JfT1BMT0dfVE9PX0ZBUl9CRUhJTkQgfHwgMjAwMDtcbiAgfVxufSk7XG4iLCJ2YXIgRnV0dXJlID0gTnBtLnJlcXVpcmUoJ2ZpYmVycy9mdXR1cmUnKTtcblxuT2JzZXJ2ZU11bHRpcGxleGVyID0gZnVuY3Rpb24gKG9wdGlvbnMpIHtcbiAgdmFyIHNlbGYgPSB0aGlzO1xuXG4gIGlmICghb3B0aW9ucyB8fCAhXy5oYXMob3B0aW9ucywgJ29yZGVyZWQnKSlcbiAgICB0aHJvdyBFcnJvcihcIm11c3Qgc3BlY2lmaWVkIG9yZGVyZWRcIik7XG5cbiAgUGFja2FnZVsnZmFjdHMtYmFzZSddICYmIFBhY2thZ2VbJ2ZhY3RzLWJhc2UnXS5GYWN0cy5pbmNyZW1lbnRTZXJ2ZXJGYWN0KFxuICAgIFwibW9uZ28tbGl2ZWRhdGFcIiwgXCJvYnNlcnZlLW11bHRpcGxleGVyc1wiLCAxKTtcblxuICBzZWxmLl9vcmRlcmVkID0gb3B0aW9ucy5vcmRlcmVkO1xuICBzZWxmLl9vblN0b3AgPSBvcHRpb25zLm9uU3RvcCB8fCBmdW5jdGlvbiAoKSB7fTtcbiAgc2VsZi5fcXVldWUgPSBuZXcgTWV0ZW9yLl9TeW5jaHJvbm91c1F1ZXVlKCk7XG4gIHNlbGYuX2hhbmRsZXMgPSB7fTtcbiAgc2VsZi5fcmVhZHlGdXR1cmUgPSBuZXcgRnV0dXJlO1xuICBzZWxmLl9jYWNoZSA9IG5ldyBMb2NhbENvbGxlY3Rpb24uX0NhY2hpbmdDaGFuZ2VPYnNlcnZlcih7XG4gICAgb3JkZXJlZDogb3B0aW9ucy5vcmRlcmVkfSk7XG4gIC8vIE51bWJlciBvZiBhZGRIYW5kbGVBbmRTZW5kSW5pdGlhbEFkZHMgdGFza3Mgc2NoZWR1bGVkIGJ1dCBub3QgeWV0XG4gIC8vIHJ1bm5pbmcuIHJlbW92ZUhhbmRsZSB1c2VzIHRoaXMgdG8ga25vdyBpZiBpdCdzIHRpbWUgdG8gY2FsbCB0aGUgb25TdG9wXG4gIC8vIGNhbGxiYWNrLlxuICBzZWxmLl9hZGRIYW5kbGVUYXNrc1NjaGVkdWxlZEJ1dE5vdFBlcmZvcm1lZCA9IDA7XG5cbiAgXy5lYWNoKHNlbGYuY2FsbGJhY2tOYW1lcygpLCBmdW5jdGlvbiAoY2FsbGJhY2tOYW1lKSB7XG4gICAgc2VsZltjYWxsYmFja05hbWVdID0gZnVuY3Rpb24gKC8qIC4uLiAqLykge1xuICAgICAgc2VsZi5fYXBwbHlDYWxsYmFjayhjYWxsYmFja05hbWUsIF8udG9BcnJheShhcmd1bWVudHMpKTtcbiAgICB9O1xuICB9KTtcbn07XG5cbl8uZXh0ZW5kKE9ic2VydmVNdWx0aXBsZXhlci5wcm90b3R5cGUsIHtcbiAgYWRkSGFuZGxlQW5kU2VuZEluaXRpYWxBZGRzOiBmdW5jdGlvbiAoaGFuZGxlKSB7XG4gICAgdmFyIHNlbGYgPSB0aGlzO1xuXG4gICAgLy8gQ2hlY2sgdGhpcyBiZWZvcmUgY2FsbGluZyBydW5UYXNrIChldmVuIHRob3VnaCBydW5UYXNrIGRvZXMgdGhlIHNhbWVcbiAgICAvLyBjaGVjaykgc28gdGhhdCB3ZSBkb24ndCBsZWFrIGFuIE9ic2VydmVNdWx0aXBsZXhlciBvbiBlcnJvciBieVxuICAgIC8vIGluY3JlbWVudGluZyBfYWRkSGFuZGxlVGFza3NTY2hlZHVsZWRCdXROb3RQZXJmb3JtZWQgYW5kIG5ldmVyXG4gICAgLy8gZGVjcmVtZW50aW5nIGl0LlxuICAgIGlmICghc2VsZi5fcXVldWUuc2FmZVRvUnVuVGFzaygpKVxuICAgICAgdGhyb3cgbmV3IEVycm9yKFwiQ2FuJ3QgY2FsbCBvYnNlcnZlQ2hhbmdlcyBmcm9tIGFuIG9ic2VydmUgY2FsbGJhY2sgb24gdGhlIHNhbWUgcXVlcnlcIik7XG4gICAgKytzZWxmLl9hZGRIYW5kbGVUYXNrc1NjaGVkdWxlZEJ1dE5vdFBlcmZvcm1lZDtcblxuICAgIFBhY2thZ2VbJ2ZhY3RzLWJhc2UnXSAmJiBQYWNrYWdlWydmYWN0cy1iYXNlJ10uRmFjdHMuaW5jcmVtZW50U2VydmVyRmFjdChcbiAgICAgIFwibW9uZ28tbGl2ZWRhdGFcIiwgXCJvYnNlcnZlLWhhbmRsZXNcIiwgMSk7XG5cbiAgICBzZWxmLl9xdWV1ZS5ydW5UYXNrKGZ1bmN0aW9uICgpIHtcbiAgICAgIHNlbGYuX2hhbmRsZXNbaGFuZGxlLl9pZF0gPSBoYW5kbGU7XG4gICAgICAvLyBTZW5kIG91dCB3aGF0ZXZlciBhZGRzIHdlIGhhdmUgc28gZmFyICh3aGV0aGVyIG9yIG5vdCB3ZSB0aGVcbiAgICAgIC8vIG11bHRpcGxleGVyIGlzIHJlYWR5KS5cbiAgICAgIHNlbGYuX3NlbmRBZGRzKGhhbmRsZSk7XG4gICAgICAtLXNlbGYuX2FkZEhhbmRsZVRhc2tzU2NoZWR1bGVkQnV0Tm90UGVyZm9ybWVkO1xuICAgIH0pO1xuICAgIC8vICpvdXRzaWRlKiB0aGUgdGFzaywgc2luY2Ugb3RoZXJ3aXNlIHdlJ2QgZGVhZGxvY2tcbiAgICBzZWxmLl9yZWFkeUZ1dHVyZS53YWl0KCk7XG4gIH0sXG5cbiAgLy8gUmVtb3ZlIGFuIG9ic2VydmUgaGFuZGxlLiBJZiBpdCB3YXMgdGhlIGxhc3Qgb2JzZXJ2ZSBoYW5kbGUsIGNhbGwgdGhlXG4gIC8vIG9uU3RvcCBjYWxsYmFjazsgeW91IGNhbm5vdCBhZGQgYW55IG1vcmUgb2JzZXJ2ZSBoYW5kbGVzIGFmdGVyIHRoaXMuXG4gIC8vXG4gIC8vIFRoaXMgaXMgbm90IHN5bmNocm9uaXplZCB3aXRoIHBvbGxzIGFuZCBoYW5kbGUgYWRkaXRpb25zOiB0aGlzIG1lYW5zIHRoYXRcbiAgLy8geW91IGNhbiBzYWZlbHkgY2FsbCBpdCBmcm9tIHdpdGhpbiBhbiBvYnNlcnZlIGNhbGxiYWNrLCBidXQgaXQgYWxzbyBtZWFuc1xuICAvLyB0aGF0IHdlIGhhdmUgdG8gYmUgY2FyZWZ1bCB3aGVuIHdlIGl0ZXJhdGUgb3ZlciBfaGFuZGxlcy5cbiAgcmVtb3ZlSGFuZGxlOiBmdW5jdGlvbiAoaWQpIHtcbiAgICB2YXIgc2VsZiA9IHRoaXM7XG5cbiAgICAvLyBUaGlzIHNob3VsZCBub3QgYmUgcG9zc2libGU6IHlvdSBjYW4gb25seSBjYWxsIHJlbW92ZUhhbmRsZSBieSBoYXZpbmdcbiAgICAvLyBhY2Nlc3MgdG8gdGhlIE9ic2VydmVIYW5kbGUsIHdoaWNoIGlzbid0IHJldHVybmVkIHRvIHVzZXIgY29kZSB1bnRpbCB0aGVcbiAgICAvLyBtdWx0aXBsZXggaXMgcmVhZHkuXG4gICAgaWYgKCFzZWxmLl9yZWFkeSgpKVxuICAgICAgdGhyb3cgbmV3IEVycm9yKFwiQ2FuJ3QgcmVtb3ZlIGhhbmRsZXMgdW50aWwgdGhlIG11bHRpcGxleCBpcyByZWFkeVwiKTtcblxuICAgIGRlbGV0ZSBzZWxmLl9oYW5kbGVzW2lkXTtcblxuICAgIFBhY2thZ2VbJ2ZhY3RzLWJhc2UnXSAmJiBQYWNrYWdlWydmYWN0cy1iYXNlJ10uRmFjdHMuaW5jcmVtZW50U2VydmVyRmFjdChcbiAgICAgIFwibW9uZ28tbGl2ZWRhdGFcIiwgXCJvYnNlcnZlLWhhbmRsZXNcIiwgLTEpO1xuXG4gICAgaWYgKF8uaXNFbXB0eShzZWxmLl9oYW5kbGVzKSAmJlxuICAgICAgICBzZWxmLl9hZGRIYW5kbGVUYXNrc1NjaGVkdWxlZEJ1dE5vdFBlcmZvcm1lZCA9PT0gMCkge1xuICAgICAgc2VsZi5fc3RvcCgpO1xuICAgIH1cbiAgfSxcbiAgX3N0b3A6IGZ1bmN0aW9uIChvcHRpb25zKSB7XG4gICAgdmFyIHNlbGYgPSB0aGlzO1xuICAgIG9wdGlvbnMgPSBvcHRpb25zIHx8IHt9O1xuXG4gICAgLy8gSXQgc2hvdWxkbid0IGJlIHBvc3NpYmxlIGZvciB1cyB0byBzdG9wIHdoZW4gYWxsIG91ciBoYW5kbGVzIHN0aWxsXG4gICAgLy8gaGF2ZW4ndCBiZWVuIHJldHVybmVkIGZyb20gb2JzZXJ2ZUNoYW5nZXMhXG4gICAgaWYgKCEgc2VsZi5fcmVhZHkoKSAmJiAhIG9wdGlvbnMuZnJvbVF1ZXJ5RXJyb3IpXG4gICAgICB0aHJvdyBFcnJvcihcInN1cnByaXNpbmcgX3N0b3A6IG5vdCByZWFkeVwiKTtcblxuICAgIC8vIENhbGwgc3RvcCBjYWxsYmFjayAod2hpY2gga2lsbHMgdGhlIHVuZGVybHlpbmcgcHJvY2VzcyB3aGljaCBzZW5kcyB1c1xuICAgIC8vIGNhbGxiYWNrcyBhbmQgcmVtb3ZlcyB1cyBmcm9tIHRoZSBjb25uZWN0aW9uJ3MgZGljdGlvbmFyeSkuXG4gICAgc2VsZi5fb25TdG9wKCk7XG4gICAgUGFja2FnZVsnZmFjdHMtYmFzZSddICYmIFBhY2thZ2VbJ2ZhY3RzLWJhc2UnXS5GYWN0cy5pbmNyZW1lbnRTZXJ2ZXJGYWN0KFxuICAgICAgXCJtb25nby1saXZlZGF0YVwiLCBcIm9ic2VydmUtbXVsdGlwbGV4ZXJzXCIsIC0xKTtcblxuICAgIC8vIENhdXNlIGZ1dHVyZSBhZGRIYW5kbGVBbmRTZW5kSW5pdGlhbEFkZHMgY2FsbHMgdG8gdGhyb3cgKGJ1dCB0aGUgb25TdG9wXG4gICAgLy8gY2FsbGJhY2sgc2hvdWxkIG1ha2Ugb3VyIGNvbm5lY3Rpb24gZm9yZ2V0IGFib3V0IHVzKS5cbiAgICBzZWxmLl9oYW5kbGVzID0gbnVsbDtcbiAgfSxcblxuICAvLyBBbGxvd3MgYWxsIGFkZEhhbmRsZUFuZFNlbmRJbml0aWFsQWRkcyBjYWxscyB0byByZXR1cm4sIG9uY2UgYWxsIHByZWNlZGluZ1xuICAvLyBhZGRzIGhhdmUgYmVlbiBwcm9jZXNzZWQuIERvZXMgbm90IGJsb2NrLlxuICByZWFkeTogZnVuY3Rpb24gKCkge1xuICAgIHZhciBzZWxmID0gdGhpcztcbiAgICBzZWxmLl9xdWV1ZS5xdWV1ZVRhc2soZnVuY3Rpb24gKCkge1xuICAgICAgaWYgKHNlbGYuX3JlYWR5KCkpXG4gICAgICAgIHRocm93IEVycm9yKFwiY2FuJ3QgbWFrZSBPYnNlcnZlTXVsdGlwbGV4IHJlYWR5IHR3aWNlIVwiKTtcbiAgICAgIHNlbGYuX3JlYWR5RnV0dXJlLnJldHVybigpO1xuICAgIH0pO1xuICB9LFxuXG4gIC8vIElmIHRyeWluZyB0byBleGVjdXRlIHRoZSBxdWVyeSByZXN1bHRzIGluIGFuIGVycm9yLCBjYWxsIHRoaXMuIFRoaXMgaXNcbiAgLy8gaW50ZW5kZWQgZm9yIHBlcm1hbmVudCBlcnJvcnMsIG5vdCB0cmFuc2llbnQgbmV0d29yayBlcnJvcnMgdGhhdCBjb3VsZCBiZVxuICAvLyBmaXhlZC4gSXQgc2hvdWxkIG9ubHkgYmUgY2FsbGVkIGJlZm9yZSByZWFkeSgpLCBiZWNhdXNlIGlmIHlvdSBjYWxsZWQgcmVhZHlcbiAgLy8gdGhhdCBtZWFudCB0aGF0IHlvdSBtYW5hZ2VkIHRvIHJ1biB0aGUgcXVlcnkgb25jZS4gSXQgd2lsbCBzdG9wIHRoaXNcbiAgLy8gT2JzZXJ2ZU11bHRpcGxleCBhbmQgY2F1c2UgYWRkSGFuZGxlQW5kU2VuZEluaXRpYWxBZGRzIGNhbGxzIChhbmQgdGh1c1xuICAvLyBvYnNlcnZlQ2hhbmdlcyBjYWxscykgdG8gdGhyb3cgdGhlIGVycm9yLlxuICBxdWVyeUVycm9yOiBmdW5jdGlvbiAoZXJyKSB7XG4gICAgdmFyIHNlbGYgPSB0aGlzO1xuICAgIHNlbGYuX3F1ZXVlLnJ1blRhc2soZnVuY3Rpb24gKCkge1xuICAgICAgaWYgKHNlbGYuX3JlYWR5KCkpXG4gICAgICAgIHRocm93IEVycm9yKFwiY2FuJ3QgY2xhaW0gcXVlcnkgaGFzIGFuIGVycm9yIGFmdGVyIGl0IHdvcmtlZCFcIik7XG4gICAgICBzZWxmLl9zdG9wKHtmcm9tUXVlcnlFcnJvcjogdHJ1ZX0pO1xuICAgICAgc2VsZi5fcmVhZHlGdXR1cmUudGhyb3coZXJyKTtcbiAgICB9KTtcbiAgfSxcblxuICAvLyBDYWxscyBcImNiXCIgb25jZSB0aGUgZWZmZWN0cyBvZiBhbGwgXCJyZWFkeVwiLCBcImFkZEhhbmRsZUFuZFNlbmRJbml0aWFsQWRkc1wiXG4gIC8vIGFuZCBvYnNlcnZlIGNhbGxiYWNrcyB3aGljaCBjYW1lIGJlZm9yZSB0aGlzIGNhbGwgaGF2ZSBiZWVuIHByb3BhZ2F0ZWQgdG9cbiAgLy8gYWxsIGhhbmRsZXMuIFwicmVhZHlcIiBtdXN0IGhhdmUgYWxyZWFkeSBiZWVuIGNhbGxlZCBvbiB0aGlzIG11bHRpcGxleGVyLlxuICBvbkZsdXNoOiBmdW5jdGlvbiAoY2IpIHtcbiAgICB2YXIgc2VsZiA9IHRoaXM7XG4gICAgc2VsZi5fcXVldWUucXVldWVUYXNrKGZ1bmN0aW9uICgpIHtcbiAgICAgIGlmICghc2VsZi5fcmVhZHkoKSlcbiAgICAgICAgdGhyb3cgRXJyb3IoXCJvbmx5IGNhbGwgb25GbHVzaCBvbiBhIG11bHRpcGxleGVyIHRoYXQgd2lsbCBiZSByZWFkeVwiKTtcbiAgICAgIGNiKCk7XG4gICAgfSk7XG4gIH0sXG4gIGNhbGxiYWNrTmFtZXM6IGZ1bmN0aW9uICgpIHtcbiAgICB2YXIgc2VsZiA9IHRoaXM7XG4gICAgaWYgKHNlbGYuX29yZGVyZWQpXG4gICAgICByZXR1cm4gW1wiYWRkZWRCZWZvcmVcIiwgXCJjaGFuZ2VkXCIsIFwibW92ZWRCZWZvcmVcIiwgXCJyZW1vdmVkXCJdO1xuICAgIGVsc2VcbiAgICAgIHJldHVybiBbXCJhZGRlZFwiLCBcImNoYW5nZWRcIiwgXCJyZW1vdmVkXCJdO1xuICB9LFxuICBfcmVhZHk6IGZ1bmN0aW9uICgpIHtcbiAgICByZXR1cm4gdGhpcy5fcmVhZHlGdXR1cmUuaXNSZXNvbHZlZCgpO1xuICB9LFxuICBfYXBwbHlDYWxsYmFjazogZnVuY3Rpb24gKGNhbGxiYWNrTmFtZSwgYXJncykge1xuICAgIHZhciBzZWxmID0gdGhpcztcbiAgICBzZWxmLl9xdWV1ZS5xdWV1ZVRhc2soZnVuY3Rpb24gKCkge1xuICAgICAgLy8gSWYgd2Ugc3RvcHBlZCBpbiB0aGUgbWVhbnRpbWUsIGRvIG5vdGhpbmcuXG4gICAgICBpZiAoIXNlbGYuX2hhbmRsZXMpXG4gICAgICAgIHJldHVybjtcblxuICAgICAgLy8gRmlyc3QsIGFwcGx5IHRoZSBjaGFuZ2UgdG8gdGhlIGNhY2hlLlxuICAgICAgc2VsZi5fY2FjaGUuYXBwbHlDaGFuZ2VbY2FsbGJhY2tOYW1lXS5hcHBseShudWxsLCBhcmdzKTtcblxuICAgICAgLy8gSWYgd2UgaGF2ZW4ndCBmaW5pc2hlZCB0aGUgaW5pdGlhbCBhZGRzLCB0aGVuIHdlIHNob3VsZCBvbmx5IGJlIGdldHRpbmdcbiAgICAgIC8vIGFkZHMuXG4gICAgICBpZiAoIXNlbGYuX3JlYWR5KCkgJiZcbiAgICAgICAgICAoY2FsbGJhY2tOYW1lICE9PSAnYWRkZWQnICYmIGNhbGxiYWNrTmFtZSAhPT0gJ2FkZGVkQmVmb3JlJykpIHtcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKFwiR290IFwiICsgY2FsbGJhY2tOYW1lICsgXCIgZHVyaW5nIGluaXRpYWwgYWRkc1wiKTtcbiAgICAgIH1cblxuICAgICAgLy8gTm93IG11bHRpcGxleCB0aGUgY2FsbGJhY2tzIG91dCB0byBhbGwgb2JzZXJ2ZSBoYW5kbGVzLiBJdCdzIE9LIGlmXG4gICAgICAvLyB0aGVzZSBjYWxscyB5aWVsZDsgc2luY2Ugd2UncmUgaW5zaWRlIGEgdGFzaywgbm8gb3RoZXIgdXNlIG9mIG91ciBxdWV1ZVxuICAgICAgLy8gY2FuIGNvbnRpbnVlIHVudGlsIHRoZXNlIGFyZSBkb25lLiAoQnV0IHdlIGRvIGhhdmUgdG8gYmUgY2FyZWZ1bCB0byBub3RcbiAgICAgIC8vIHVzZSBhIGhhbmRsZSB0aGF0IGdvdCByZW1vdmVkLCBiZWNhdXNlIHJlbW92ZUhhbmRsZSBkb2VzIG5vdCB1c2UgdGhlXG4gICAgICAvLyBxdWV1ZTsgdGh1cywgd2UgaXRlcmF0ZSBvdmVyIGFuIGFycmF5IG9mIGtleXMgdGhhdCB3ZSBjb250cm9sLilcbiAgICAgIF8uZWFjaChfLmtleXMoc2VsZi5faGFuZGxlcyksIGZ1bmN0aW9uIChoYW5kbGVJZCkge1xuICAgICAgICB2YXIgaGFuZGxlID0gc2VsZi5faGFuZGxlcyAmJiBzZWxmLl9oYW5kbGVzW2hhbmRsZUlkXTtcbiAgICAgICAgaWYgKCFoYW5kbGUpXG4gICAgICAgICAgcmV0dXJuO1xuICAgICAgICB2YXIgY2FsbGJhY2sgPSBoYW5kbGVbJ18nICsgY2FsbGJhY2tOYW1lXTtcbiAgICAgICAgLy8gY2xvbmUgYXJndW1lbnRzIHNvIHRoYXQgY2FsbGJhY2tzIGNhbiBtdXRhdGUgdGhlaXIgYXJndW1lbnRzXG4gICAgICAgIGNhbGxiYWNrICYmIGNhbGxiYWNrLmFwcGx5KG51bGwsXG4gICAgICAgICAgaGFuZGxlLm5vbk11dGF0aW5nQ2FsbGJhY2tzID8gYXJncyA6IEVKU09OLmNsb25lKGFyZ3MpKTtcbiAgICAgIH0pO1xuICAgIH0pO1xuICB9LFxuXG4gIC8vIFNlbmRzIGluaXRpYWwgYWRkcyB0byBhIGhhbmRsZS4gSXQgc2hvdWxkIG9ubHkgYmUgY2FsbGVkIGZyb20gd2l0aGluIGEgdGFza1xuICAvLyAodGhlIHRhc2sgdGhhdCBpcyBwcm9jZXNzaW5nIHRoZSBhZGRIYW5kbGVBbmRTZW5kSW5pdGlhbEFkZHMgY2FsbCkuIEl0XG4gIC8vIHN5bmNocm9ub3VzbHkgaW52b2tlcyB0aGUgaGFuZGxlJ3MgYWRkZWQgb3IgYWRkZWRCZWZvcmU7IHRoZXJlJ3Mgbm8gbmVlZCB0b1xuICAvLyBmbHVzaCB0aGUgcXVldWUgYWZ0ZXJ3YXJkcyB0byBlbnN1cmUgdGhhdCB0aGUgY2FsbGJhY2tzIGdldCBvdXQuXG4gIF9zZW5kQWRkczogZnVuY3Rpb24gKGhhbmRsZSkge1xuICAgIHZhciBzZWxmID0gdGhpcztcbiAgICBpZiAoc2VsZi5fcXVldWUuc2FmZVRvUnVuVGFzaygpKVxuICAgICAgdGhyb3cgRXJyb3IoXCJfc2VuZEFkZHMgbWF5IG9ubHkgYmUgY2FsbGVkIGZyb20gd2l0aGluIGEgdGFzayFcIik7XG4gICAgdmFyIGFkZCA9IHNlbGYuX29yZGVyZWQgPyBoYW5kbGUuX2FkZGVkQmVmb3JlIDogaGFuZGxlLl9hZGRlZDtcbiAgICBpZiAoIWFkZClcbiAgICAgIHJldHVybjtcbiAgICAvLyBub3RlOiBkb2NzIG1heSBiZSBhbiBfSWRNYXAgb3IgYW4gT3JkZXJlZERpY3RcbiAgICBzZWxmLl9jYWNoZS5kb2NzLmZvckVhY2goZnVuY3Rpb24gKGRvYywgaWQpIHtcbiAgICAgIGlmICghXy5oYXMoc2VsZi5faGFuZGxlcywgaGFuZGxlLl9pZCkpXG4gICAgICAgIHRocm93IEVycm9yKFwiaGFuZGxlIGdvdCByZW1vdmVkIGJlZm9yZSBzZW5kaW5nIGluaXRpYWwgYWRkcyFcIik7XG4gICAgICBjb25zdCB7IF9pZCwgLi4uZmllbGRzIH0gPSBoYW5kbGUubm9uTXV0YXRpbmdDYWxsYmFja3MgPyBkb2NcbiAgICAgICAgOiBFSlNPTi5jbG9uZShkb2MpO1xuICAgICAgaWYgKHNlbGYuX29yZGVyZWQpXG4gICAgICAgIGFkZChpZCwgZmllbGRzLCBudWxsKTsgLy8gd2UncmUgZ29pbmcgaW4gb3JkZXIsIHNvIGFkZCBhdCBlbmRcbiAgICAgIGVsc2VcbiAgICAgICAgYWRkKGlkLCBmaWVsZHMpO1xuICAgIH0pO1xuICB9XG59KTtcblxuXG52YXIgbmV4dE9ic2VydmVIYW5kbGVJZCA9IDE7XG5cbi8vIFdoZW4gdGhlIGNhbGxiYWNrcyBkbyBub3QgbXV0YXRlIHRoZSBhcmd1bWVudHMsIHdlIGNhbiBza2lwIGEgbG90IG9mIGRhdGEgY2xvbmVzXG5PYnNlcnZlSGFuZGxlID0gZnVuY3Rpb24gKG11bHRpcGxleGVyLCBjYWxsYmFja3MsIG5vbk11dGF0aW5nQ2FsbGJhY2tzID0gZmFsc2UpIHtcbiAgdmFyIHNlbGYgPSB0aGlzO1xuICAvLyBUaGUgZW5kIHVzZXIgaXMgb25seSBzdXBwb3NlZCB0byBjYWxsIHN0b3AoKS4gIFRoZSBvdGhlciBmaWVsZHMgYXJlXG4gIC8vIGFjY2Vzc2libGUgdG8gdGhlIG11bHRpcGxleGVyLCB0aG91Z2guXG4gIHNlbGYuX211bHRpcGxleGVyID0gbXVsdGlwbGV4ZXI7XG4gIF8uZWFjaChtdWx0aXBsZXhlci5jYWxsYmFja05hbWVzKCksIGZ1bmN0aW9uIChuYW1lKSB7XG4gICAgaWYgKGNhbGxiYWNrc1tuYW1lXSkge1xuICAgICAgc2VsZlsnXycgKyBuYW1lXSA9IGNhbGxiYWNrc1tuYW1lXTtcbiAgICB9IGVsc2UgaWYgKG5hbWUgPT09IFwiYWRkZWRCZWZvcmVcIiAmJiBjYWxsYmFja3MuYWRkZWQpIHtcbiAgICAgIC8vIFNwZWNpYWwgY2FzZTogaWYgeW91IHNwZWNpZnkgXCJhZGRlZFwiIGFuZCBcIm1vdmVkQmVmb3JlXCIsIHlvdSBnZXQgYW5cbiAgICAgIC8vIG9yZGVyZWQgb2JzZXJ2ZSB3aGVyZSBmb3Igc29tZSByZWFzb24geW91IGRvbid0IGdldCBvcmRlcmluZyBkYXRhIG9uXG4gICAgICAvLyB0aGUgYWRkcy4gIEkgZHVubm8sIHdlIHdyb3RlIHRlc3RzIGZvciBpdCwgdGhlcmUgbXVzdCBoYXZlIGJlZW4gYVxuICAgICAgLy8gcmVhc29uLlxuICAgICAgc2VsZi5fYWRkZWRCZWZvcmUgPSBmdW5jdGlvbiAoaWQsIGZpZWxkcywgYmVmb3JlKSB7XG4gICAgICAgIGNhbGxiYWNrcy5hZGRlZChpZCwgZmllbGRzKTtcbiAgICAgIH07XG4gICAgfVxuICB9KTtcbiAgc2VsZi5fc3RvcHBlZCA9IGZhbHNlO1xuICBzZWxmLl9pZCA9IG5leHRPYnNlcnZlSGFuZGxlSWQrKztcbiAgc2VsZi5ub25NdXRhdGluZ0NhbGxiYWNrcyA9IG5vbk11dGF0aW5nQ2FsbGJhY2tzO1xufTtcbk9ic2VydmVIYW5kbGUucHJvdG90eXBlLnN0b3AgPSBmdW5jdGlvbiAoKSB7XG4gIHZhciBzZWxmID0gdGhpcztcbiAgaWYgKHNlbGYuX3N0b3BwZWQpXG4gICAgcmV0dXJuO1xuICBzZWxmLl9zdG9wcGVkID0gdHJ1ZTtcbiAgc2VsZi5fbXVsdGlwbGV4ZXIucmVtb3ZlSGFuZGxlKHNlbGYuX2lkKTtcbn07XG4iLCJ2YXIgRmliZXIgPSBOcG0ucmVxdWlyZSgnZmliZXJzJyk7XG5cbmV4cG9ydCBjbGFzcyBEb2NGZXRjaGVyIHtcbiAgY29uc3RydWN0b3IobW9uZ29Db25uZWN0aW9uKSB7XG4gICAgdGhpcy5fbW9uZ29Db25uZWN0aW9uID0gbW9uZ29Db25uZWN0aW9uO1xuICAgIC8vIE1hcCBmcm9tIG9wIC0+IFtjYWxsYmFja11cbiAgICB0aGlzLl9jYWxsYmFja3NGb3JPcCA9IG5ldyBNYXA7XG4gIH1cblxuICAvLyBGZXRjaGVzIGRvY3VtZW50IFwiaWRcIiBmcm9tIGNvbGxlY3Rpb25OYW1lLCByZXR1cm5pbmcgaXQgb3IgbnVsbCBpZiBub3RcbiAgLy8gZm91bmQuXG4gIC8vXG4gIC8vIElmIHlvdSBtYWtlIG11bHRpcGxlIGNhbGxzIHRvIGZldGNoKCkgd2l0aCB0aGUgc2FtZSBvcCByZWZlcmVuY2UsXG4gIC8vIERvY0ZldGNoZXIgbWF5IGFzc3VtZSB0aGF0IHRoZXkgYWxsIHJldHVybiB0aGUgc2FtZSBkb2N1bWVudC4gKEl0IGRvZXNcbiAgLy8gbm90IGNoZWNrIHRvIHNlZSBpZiBjb2xsZWN0aW9uTmFtZS9pZCBtYXRjaC4pXG4gIC8vXG4gIC8vIFlvdSBtYXkgYXNzdW1lIHRoYXQgY2FsbGJhY2sgaXMgbmV2ZXIgY2FsbGVkIHN5bmNocm9ub3VzbHkgKGFuZCBpbiBmYWN0XG4gIC8vIE9wbG9nT2JzZXJ2ZURyaXZlciBkb2VzIHNvKS5cbiAgZmV0Y2goY29sbGVjdGlvbk5hbWUsIGlkLCBvcCwgY2FsbGJhY2spIHtcbiAgICBjb25zdCBzZWxmID0gdGhpcztcblxuICAgIGNoZWNrKGNvbGxlY3Rpb25OYW1lLCBTdHJpbmcpO1xuICAgIGNoZWNrKG9wLCBPYmplY3QpO1xuXG4gICAgLy8gSWYgdGhlcmUncyBhbHJlYWR5IGFuIGluLXByb2dyZXNzIGZldGNoIGZvciB0aGlzIGNhY2hlIGtleSwgeWllbGQgdW50aWxcbiAgICAvLyBpdCdzIGRvbmUgYW5kIHJldHVybiB3aGF0ZXZlciBpdCByZXR1cm5zLlxuICAgIGlmIChzZWxmLl9jYWxsYmFja3NGb3JPcC5oYXMob3ApKSB7XG4gICAgICBzZWxmLl9jYWxsYmFja3NGb3JPcC5nZXQob3ApLnB1c2goY2FsbGJhY2spO1xuICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIGNvbnN0IGNhbGxiYWNrcyA9IFtjYWxsYmFja107XG4gICAgc2VsZi5fY2FsbGJhY2tzRm9yT3Auc2V0KG9wLCBjYWxsYmFja3MpO1xuXG4gICAgRmliZXIoZnVuY3Rpb24gKCkge1xuICAgICAgdHJ5IHtcbiAgICAgICAgdmFyIGRvYyA9IHNlbGYuX21vbmdvQ29ubmVjdGlvbi5maW5kT25lKFxuICAgICAgICAgIGNvbGxlY3Rpb25OYW1lLCB7X2lkOiBpZH0pIHx8IG51bGw7XG4gICAgICAgIC8vIFJldHVybiBkb2MgdG8gYWxsIHJlbGV2YW50IGNhbGxiYWNrcy4gTm90ZSB0aGF0IHRoaXMgYXJyYXkgY2FuXG4gICAgICAgIC8vIGNvbnRpbnVlIHRvIGdyb3cgZHVyaW5nIGNhbGxiYWNrIGV4Y2VjdXRpb24uXG4gICAgICAgIHdoaWxlIChjYWxsYmFja3MubGVuZ3RoID4gMCkge1xuICAgICAgICAgIC8vIENsb25lIHRoZSBkb2N1bWVudCBzbyB0aGF0IHRoZSB2YXJpb3VzIGNhbGxzIHRvIGZldGNoIGRvbid0IHJldHVyblxuICAgICAgICAgIC8vIG9iamVjdHMgdGhhdCBhcmUgaW50ZXJ0d2luZ2xlZCB3aXRoIGVhY2ggb3RoZXIuIENsb25lIGJlZm9yZVxuICAgICAgICAgIC8vIHBvcHBpbmcgdGhlIGZ1dHVyZSwgc28gdGhhdCBpZiBjbG9uZSB0aHJvd3MsIHRoZSBlcnJvciBnZXRzIHBhc3NlZFxuICAgICAgICAgIC8vIHRvIHRoZSBuZXh0IGNhbGxiYWNrLlxuICAgICAgICAgIGNhbGxiYWNrcy5wb3AoKShudWxsLCBFSlNPTi5jbG9uZShkb2MpKTtcbiAgICAgICAgfVxuICAgICAgfSBjYXRjaCAoZSkge1xuICAgICAgICB3aGlsZSAoY2FsbGJhY2tzLmxlbmd0aCA+IDApIHtcbiAgICAgICAgICBjYWxsYmFja3MucG9wKCkoZSk7XG4gICAgICAgIH1cbiAgICAgIH0gZmluYWxseSB7XG4gICAgICAgIC8vIFhYWCBjb25zaWRlciBrZWVwaW5nIHRoZSBkb2MgYXJvdW5kIGZvciBhIHBlcmlvZCBvZiB0aW1lIGJlZm9yZVxuICAgICAgICAvLyByZW1vdmluZyBmcm9tIHRoZSBjYWNoZVxuICAgICAgICBzZWxmLl9jYWxsYmFja3NGb3JPcC5kZWxldGUob3ApO1xuICAgICAgfVxuICAgIH0pLnJ1bigpO1xuICB9XG59XG4iLCJ2YXIgUE9MTElOR19USFJPVFRMRV9NUyA9ICtwcm9jZXNzLmVudi5NRVRFT1JfUE9MTElOR19USFJPVFRMRV9NUyB8fCA1MDtcbnZhciBQT0xMSU5HX0lOVEVSVkFMX01TID0gK3Byb2Nlc3MuZW52Lk1FVEVPUl9QT0xMSU5HX0lOVEVSVkFMX01TIHx8IDEwICogMTAwMDtcblxuUG9sbGluZ09ic2VydmVEcml2ZXIgPSBmdW5jdGlvbiAob3B0aW9ucykge1xuICB2YXIgc2VsZiA9IHRoaXM7XG5cbiAgc2VsZi5fY3Vyc29yRGVzY3JpcHRpb24gPSBvcHRpb25zLmN1cnNvckRlc2NyaXB0aW9uO1xuICBzZWxmLl9tb25nb0hhbmRsZSA9IG9wdGlvbnMubW9uZ29IYW5kbGU7XG4gIHNlbGYuX29yZGVyZWQgPSBvcHRpb25zLm9yZGVyZWQ7XG4gIHNlbGYuX211bHRpcGxleGVyID0gb3B0aW9ucy5tdWx0aXBsZXhlcjtcbiAgc2VsZi5fc3RvcENhbGxiYWNrcyA9IFtdO1xuICBzZWxmLl9zdG9wcGVkID0gZmFsc2U7XG5cbiAgc2VsZi5fc3luY2hyb25vdXNDdXJzb3IgPSBzZWxmLl9tb25nb0hhbmRsZS5fY3JlYXRlU3luY2hyb25vdXNDdXJzb3IoXG4gICAgc2VsZi5fY3Vyc29yRGVzY3JpcHRpb24pO1xuXG4gIC8vIHByZXZpb3VzIHJlc3VsdHMgc25hcHNob3QuICBvbiBlYWNoIHBvbGwgY3ljbGUsIGRpZmZzIGFnYWluc3RcbiAgLy8gcmVzdWx0cyBkcml2ZXMgdGhlIGNhbGxiYWNrcy5cbiAgc2VsZi5fcmVzdWx0cyA9IG51bGw7XG5cbiAgLy8gVGhlIG51bWJlciBvZiBfcG9sbE1vbmdvIGNhbGxzIHRoYXQgaGF2ZSBiZWVuIGFkZGVkIHRvIHNlbGYuX3Rhc2tRdWV1ZSBidXRcbiAgLy8gaGF2ZSBub3Qgc3RhcnRlZCBydW5uaW5nLiBVc2VkIHRvIG1ha2Ugc3VyZSB3ZSBuZXZlciBzY2hlZHVsZSBtb3JlIHRoYW4gb25lXG4gIC8vIF9wb2xsTW9uZ28gKG90aGVyIHRoYW4gcG9zc2libHkgdGhlIG9uZSB0aGF0IGlzIGN1cnJlbnRseSBydW5uaW5nKS4gSXQnc1xuICAvLyBhbHNvIHVzZWQgYnkgX3N1c3BlbmRQb2xsaW5nIHRvIHByZXRlbmQgdGhlcmUncyBhIHBvbGwgc2NoZWR1bGVkLiBVc3VhbGx5LFxuICAvLyBpdCdzIGVpdGhlciAwIChmb3IgXCJubyBwb2xscyBzY2hlZHVsZWQgb3RoZXIgdGhhbiBtYXliZSBvbmUgY3VycmVudGx5XG4gIC8vIHJ1bm5pbmdcIikgb3IgMSAoZm9yIFwiYSBwb2xsIHNjaGVkdWxlZCB0aGF0IGlzbid0IHJ1bm5pbmcgeWV0XCIpLCBidXQgaXQgY2FuXG4gIC8vIGFsc28gYmUgMiBpZiBpbmNyZW1lbnRlZCBieSBfc3VzcGVuZFBvbGxpbmcuXG4gIHNlbGYuX3BvbGxzU2NoZWR1bGVkQnV0Tm90U3RhcnRlZCA9IDA7XG4gIHNlbGYuX3BlbmRpbmdXcml0ZXMgPSBbXTsgLy8gcGVvcGxlIHRvIG5vdGlmeSB3aGVuIHBvbGxpbmcgY29tcGxldGVzXG5cbiAgLy8gTWFrZSBzdXJlIHRvIGNyZWF0ZSBhIHNlcGFyYXRlbHkgdGhyb3R0bGVkIGZ1bmN0aW9uIGZvciBlYWNoXG4gIC8vIFBvbGxpbmdPYnNlcnZlRHJpdmVyIG9iamVjdC5cbiAgc2VsZi5fZW5zdXJlUG9sbElzU2NoZWR1bGVkID0gXy50aHJvdHRsZShcbiAgICBzZWxmLl91bnRocm90dGxlZEVuc3VyZVBvbGxJc1NjaGVkdWxlZCxcbiAgICBzZWxmLl9jdXJzb3JEZXNjcmlwdGlvbi5vcHRpb25zLnBvbGxpbmdUaHJvdHRsZU1zIHx8IFBPTExJTkdfVEhST1RUTEVfTVMgLyogbXMgKi8pO1xuXG4gIC8vIFhYWCBmaWd1cmUgb3V0IGlmIHdlIHN0aWxsIG5lZWQgYSBxdWV1ZVxuICBzZWxmLl90YXNrUXVldWUgPSBuZXcgTWV0ZW9yLl9TeW5jaHJvbm91c1F1ZXVlKCk7XG5cbiAgdmFyIGxpc3RlbmVyc0hhbmRsZSA9IGxpc3RlbkFsbChcbiAgICBzZWxmLl9jdXJzb3JEZXNjcmlwdGlvbiwgZnVuY3Rpb24gKG5vdGlmaWNhdGlvbikge1xuICAgICAgLy8gV2hlbiBzb21lb25lIGRvZXMgYSB0cmFuc2FjdGlvbiB0aGF0IG1pZ2h0IGFmZmVjdCB1cywgc2NoZWR1bGUgYSBwb2xsXG4gICAgICAvLyBvZiB0aGUgZGF0YWJhc2UuIElmIHRoYXQgdHJhbnNhY3Rpb24gaGFwcGVucyBpbnNpZGUgb2YgYSB3cml0ZSBmZW5jZSxcbiAgICAgIC8vIGJsb2NrIHRoZSBmZW5jZSB1bnRpbCB3ZSd2ZSBwb2xsZWQgYW5kIG5vdGlmaWVkIG9ic2VydmVycy5cbiAgICAgIHZhciBmZW5jZSA9IEREUFNlcnZlci5fQ3VycmVudFdyaXRlRmVuY2UuZ2V0KCk7XG4gICAgICBpZiAoZmVuY2UpXG4gICAgICAgIHNlbGYuX3BlbmRpbmdXcml0ZXMucHVzaChmZW5jZS5iZWdpbldyaXRlKCkpO1xuICAgICAgLy8gRW5zdXJlIGEgcG9sbCBpcyBzY2hlZHVsZWQuLi4gYnV0IGlmIHdlIGFscmVhZHkga25vdyB0aGF0IG9uZSBpcyxcbiAgICAgIC8vIGRvbid0IGhpdCB0aGUgdGhyb3R0bGVkIF9lbnN1cmVQb2xsSXNTY2hlZHVsZWQgZnVuY3Rpb24gKHdoaWNoIG1pZ2h0XG4gICAgICAvLyBsZWFkIHRvIHVzIGNhbGxpbmcgaXQgdW5uZWNlc3NhcmlseSBpbiA8cG9sbGluZ1Rocm90dGxlTXM+IG1zKS5cbiAgICAgIGlmIChzZWxmLl9wb2xsc1NjaGVkdWxlZEJ1dE5vdFN0YXJ0ZWQgPT09IDApXG4gICAgICAgIHNlbGYuX2Vuc3VyZVBvbGxJc1NjaGVkdWxlZCgpO1xuICAgIH1cbiAgKTtcbiAgc2VsZi5fc3RvcENhbGxiYWNrcy5wdXNoKGZ1bmN0aW9uICgpIHsgbGlzdGVuZXJzSGFuZGxlLnN0b3AoKTsgfSk7XG5cbiAgLy8gZXZlcnkgb25jZSBhbmQgYSB3aGlsZSwgcG9sbCBldmVuIGlmIHdlIGRvbid0IHRoaW5rIHdlJ3JlIGRpcnR5LCBmb3JcbiAgLy8gZXZlbnR1YWwgY29uc2lzdGVuY3kgd2l0aCBkYXRhYmFzZSB3cml0ZXMgZnJvbSBvdXRzaWRlIHRoZSBNZXRlb3JcbiAgLy8gdW5pdmVyc2UuXG4gIC8vXG4gIC8vIEZvciB0ZXN0aW5nLCB0aGVyZSdzIGFuIHVuZG9jdW1lbnRlZCBjYWxsYmFjayBhcmd1bWVudCB0byBvYnNlcnZlQ2hhbmdlc1xuICAvLyB3aGljaCBkaXNhYmxlcyB0aW1lLWJhc2VkIHBvbGxpbmcgYW5kIGdldHMgY2FsbGVkIGF0IHRoZSBiZWdpbm5pbmcgb2YgZWFjaFxuICAvLyBwb2xsLlxuICBpZiAob3B0aW9ucy5fdGVzdE9ubHlQb2xsQ2FsbGJhY2spIHtcbiAgICBzZWxmLl90ZXN0T25seVBvbGxDYWxsYmFjayA9IG9wdGlvbnMuX3Rlc3RPbmx5UG9sbENhbGxiYWNrO1xuICB9IGVsc2Uge1xuICAgIHZhciBwb2xsaW5nSW50ZXJ2YWwgPVxuICAgICAgICAgIHNlbGYuX2N1cnNvckRlc2NyaXB0aW9uLm9wdGlvbnMucG9sbGluZ0ludGVydmFsTXMgfHxcbiAgICAgICAgICBzZWxmLl9jdXJzb3JEZXNjcmlwdGlvbi5vcHRpb25zLl9wb2xsaW5nSW50ZXJ2YWwgfHwgLy8gQ09NUEFUIHdpdGggMS4yXG4gICAgICAgICAgUE9MTElOR19JTlRFUlZBTF9NUztcbiAgICB2YXIgaW50ZXJ2YWxIYW5kbGUgPSBNZXRlb3Iuc2V0SW50ZXJ2YWwoXG4gICAgICBfLmJpbmQoc2VsZi5fZW5zdXJlUG9sbElzU2NoZWR1bGVkLCBzZWxmKSwgcG9sbGluZ0ludGVydmFsKTtcbiAgICBzZWxmLl9zdG9wQ2FsbGJhY2tzLnB1c2goZnVuY3Rpb24gKCkge1xuICAgICAgTWV0ZW9yLmNsZWFySW50ZXJ2YWwoaW50ZXJ2YWxIYW5kbGUpO1xuICAgIH0pO1xuICB9XG5cbiAgLy8gTWFrZSBzdXJlIHdlIGFjdHVhbGx5IHBvbGwgc29vbiFcbiAgc2VsZi5fdW50aHJvdHRsZWRFbnN1cmVQb2xsSXNTY2hlZHVsZWQoKTtcblxuICBQYWNrYWdlWydmYWN0cy1iYXNlJ10gJiYgUGFja2FnZVsnZmFjdHMtYmFzZSddLkZhY3RzLmluY3JlbWVudFNlcnZlckZhY3QoXG4gICAgXCJtb25nby1saXZlZGF0YVwiLCBcIm9ic2VydmUtZHJpdmVycy1wb2xsaW5nXCIsIDEpO1xufTtcblxuXy5leHRlbmQoUG9sbGluZ09ic2VydmVEcml2ZXIucHJvdG90eXBlLCB7XG4gIC8vIFRoaXMgaXMgYWx3YXlzIGNhbGxlZCB0aHJvdWdoIF8udGhyb3R0bGUgKGV4Y2VwdCBvbmNlIGF0IHN0YXJ0dXApLlxuICBfdW50aHJvdHRsZWRFbnN1cmVQb2xsSXNTY2hlZHVsZWQ6IGZ1bmN0aW9uICgpIHtcbiAgICB2YXIgc2VsZiA9IHRoaXM7XG4gICAgaWYgKHNlbGYuX3BvbGxzU2NoZWR1bGVkQnV0Tm90U3RhcnRlZCA+IDApXG4gICAgICByZXR1cm47XG4gICAgKytzZWxmLl9wb2xsc1NjaGVkdWxlZEJ1dE5vdFN0YXJ0ZWQ7XG4gICAgc2VsZi5fdGFza1F1ZXVlLnF1ZXVlVGFzayhmdW5jdGlvbiAoKSB7XG4gICAgICBzZWxmLl9wb2xsTW9uZ28oKTtcbiAgICB9KTtcbiAgfSxcblxuICAvLyB0ZXN0LW9ubHkgaW50ZXJmYWNlIGZvciBjb250cm9sbGluZyBwb2xsaW5nLlxuICAvL1xuICAvLyBfc3VzcGVuZFBvbGxpbmcgYmxvY2tzIHVudGlsIGFueSBjdXJyZW50bHkgcnVubmluZyBhbmQgc2NoZWR1bGVkIHBvbGxzIGFyZVxuICAvLyBkb25lLCBhbmQgcHJldmVudHMgYW55IGZ1cnRoZXIgcG9sbHMgZnJvbSBiZWluZyBzY2hlZHVsZWQuIChuZXdcbiAgLy8gT2JzZXJ2ZUhhbmRsZXMgY2FuIGJlIGFkZGVkIGFuZCByZWNlaXZlIHRoZWlyIGluaXRpYWwgYWRkZWQgY2FsbGJhY2tzLFxuICAvLyB0aG91Z2guKVxuICAvL1xuICAvLyBfcmVzdW1lUG9sbGluZyBpbW1lZGlhdGVseSBwb2xscywgYW5kIGFsbG93cyBmdXJ0aGVyIHBvbGxzIHRvIG9jY3VyLlxuICBfc3VzcGVuZFBvbGxpbmc6IGZ1bmN0aW9uKCkge1xuICAgIHZhciBzZWxmID0gdGhpcztcbiAgICAvLyBQcmV0ZW5kIHRoYXQgdGhlcmUncyBhbm90aGVyIHBvbGwgc2NoZWR1bGVkICh3aGljaCB3aWxsIHByZXZlbnRcbiAgICAvLyBfZW5zdXJlUG9sbElzU2NoZWR1bGVkIGZyb20gcXVldWVpbmcgYW55IG1vcmUgcG9sbHMpLlxuICAgICsrc2VsZi5fcG9sbHNTY2hlZHVsZWRCdXROb3RTdGFydGVkO1xuICAgIC8vIE5vdyBibG9jayB1bnRpbCBhbGwgY3VycmVudGx5IHJ1bm5pbmcgb3Igc2NoZWR1bGVkIHBvbGxzIGFyZSBkb25lLlxuICAgIHNlbGYuX3Rhc2tRdWV1ZS5ydW5UYXNrKGZ1bmN0aW9uKCkge30pO1xuXG4gICAgLy8gQ29uZmlybSB0aGF0IHRoZXJlIGlzIG9ubHkgb25lIFwicG9sbFwiICh0aGUgZmFrZSBvbmUgd2UncmUgcHJldGVuZGluZyB0b1xuICAgIC8vIGhhdmUpIHNjaGVkdWxlZC5cbiAgICBpZiAoc2VsZi5fcG9sbHNTY2hlZHVsZWRCdXROb3RTdGFydGVkICE9PSAxKVxuICAgICAgdGhyb3cgbmV3IEVycm9yKFwiX3BvbGxzU2NoZWR1bGVkQnV0Tm90U3RhcnRlZCBpcyBcIiArXG4gICAgICAgICAgICAgICAgICAgICAgc2VsZi5fcG9sbHNTY2hlZHVsZWRCdXROb3RTdGFydGVkKTtcbiAgfSxcbiAgX3Jlc3VtZVBvbGxpbmc6IGZ1bmN0aW9uKCkge1xuICAgIHZhciBzZWxmID0gdGhpcztcbiAgICAvLyBXZSBzaG91bGQgYmUgaW4gdGhlIHNhbWUgc3RhdGUgYXMgaW4gdGhlIGVuZCBvZiBfc3VzcGVuZFBvbGxpbmcuXG4gICAgaWYgKHNlbGYuX3BvbGxzU2NoZWR1bGVkQnV0Tm90U3RhcnRlZCAhPT0gMSlcbiAgICAgIHRocm93IG5ldyBFcnJvcihcIl9wb2xsc1NjaGVkdWxlZEJ1dE5vdFN0YXJ0ZWQgaXMgXCIgK1xuICAgICAgICAgICAgICAgICAgICAgIHNlbGYuX3BvbGxzU2NoZWR1bGVkQnV0Tm90U3RhcnRlZCk7XG4gICAgLy8gUnVuIGEgcG9sbCBzeW5jaHJvbm91c2x5ICh3aGljaCB3aWxsIGNvdW50ZXJhY3QgdGhlXG4gICAgLy8gKytfcG9sbHNTY2hlZHVsZWRCdXROb3RTdGFydGVkIGZyb20gX3N1c3BlbmRQb2xsaW5nKS5cbiAgICBzZWxmLl90YXNrUXVldWUucnVuVGFzayhmdW5jdGlvbiAoKSB7XG4gICAgICBzZWxmLl9wb2xsTW9uZ28oKTtcbiAgICB9KTtcbiAgfSxcblxuICBfcG9sbE1vbmdvOiBmdW5jdGlvbiAoKSB7XG4gICAgdmFyIHNlbGYgPSB0aGlzO1xuICAgIC0tc2VsZi5fcG9sbHNTY2hlZHVsZWRCdXROb3RTdGFydGVkO1xuXG4gICAgaWYgKHNlbGYuX3N0b3BwZWQpXG4gICAgICByZXR1cm47XG5cbiAgICB2YXIgZmlyc3QgPSBmYWxzZTtcbiAgICB2YXIgbmV3UmVzdWx0cztcbiAgICB2YXIgb2xkUmVzdWx0cyA9IHNlbGYuX3Jlc3VsdHM7XG4gICAgaWYgKCFvbGRSZXN1bHRzKSB7XG4gICAgICBmaXJzdCA9IHRydWU7XG4gICAgICAvLyBYWFggbWF5YmUgdXNlIE9yZGVyZWREaWN0IGluc3RlYWQ/XG4gICAgICBvbGRSZXN1bHRzID0gc2VsZi5fb3JkZXJlZCA/IFtdIDogbmV3IExvY2FsQ29sbGVjdGlvbi5fSWRNYXA7XG4gICAgfVxuXG4gICAgc2VsZi5fdGVzdE9ubHlQb2xsQ2FsbGJhY2sgJiYgc2VsZi5fdGVzdE9ubHlQb2xsQ2FsbGJhY2soKTtcblxuICAgIC8vIFNhdmUgdGhlIGxpc3Qgb2YgcGVuZGluZyB3cml0ZXMgd2hpY2ggdGhpcyByb3VuZCB3aWxsIGNvbW1pdC5cbiAgICB2YXIgd3JpdGVzRm9yQ3ljbGUgPSBzZWxmLl9wZW5kaW5nV3JpdGVzO1xuICAgIHNlbGYuX3BlbmRpbmdXcml0ZXMgPSBbXTtcblxuICAgIC8vIEdldCB0aGUgbmV3IHF1ZXJ5IHJlc3VsdHMuIChUaGlzIHlpZWxkcy4pXG4gICAgdHJ5IHtcbiAgICAgIG5ld1Jlc3VsdHMgPSBzZWxmLl9zeW5jaHJvbm91c0N1cnNvci5nZXRSYXdPYmplY3RzKHNlbGYuX29yZGVyZWQpO1xuICAgIH0gY2F0Y2ggKGUpIHtcbiAgICAgIGlmIChmaXJzdCAmJiB0eXBlb2YoZS5jb2RlKSA9PT0gJ251bWJlcicpIHtcbiAgICAgICAgLy8gVGhpcyBpcyBhbiBlcnJvciBkb2N1bWVudCBzZW50IHRvIHVzIGJ5IG1vbmdvZCwgbm90IGEgY29ubmVjdGlvblxuICAgICAgICAvLyBlcnJvciBnZW5lcmF0ZWQgYnkgdGhlIGNsaWVudC4gQW5kIHdlJ3ZlIG5ldmVyIHNlZW4gdGhpcyBxdWVyeSB3b3JrXG4gICAgICAgIC8vIHN1Y2Nlc3NmdWxseS4gUHJvYmFibHkgaXQncyBhIGJhZCBzZWxlY3RvciBvciBzb21ldGhpbmcsIHNvIHdlIHNob3VsZFxuICAgICAgICAvLyBOT1QgcmV0cnkuIEluc3RlYWQsIHdlIHNob3VsZCBoYWx0IHRoZSBvYnNlcnZlICh3aGljaCBlbmRzIHVwIGNhbGxpbmdcbiAgICAgICAgLy8gYHN0b3BgIG9uIHVzKS5cbiAgICAgICAgc2VsZi5fbXVsdGlwbGV4ZXIucXVlcnlFcnJvcihcbiAgICAgICAgICBuZXcgRXJyb3IoXG4gICAgICAgICAgICBcIkV4Y2VwdGlvbiB3aGlsZSBwb2xsaW5nIHF1ZXJ5IFwiICtcbiAgICAgICAgICAgICAgSlNPTi5zdHJpbmdpZnkoc2VsZi5fY3Vyc29yRGVzY3JpcHRpb24pICsgXCI6IFwiICsgZS5tZXNzYWdlKSk7XG4gICAgICAgIHJldHVybjtcbiAgICAgIH1cblxuICAgICAgLy8gZ2V0UmF3T2JqZWN0cyBjYW4gdGhyb3cgaWYgd2UncmUgaGF2aW5nIHRyb3VibGUgdGFsa2luZyB0byB0aGVcbiAgICAgIC8vIGRhdGFiYXNlLiAgVGhhdCdzIGZpbmUgLS0tIHdlIHdpbGwgcmVwb2xsIGxhdGVyIGFueXdheS4gQnV0IHdlIHNob3VsZFxuICAgICAgLy8gbWFrZSBzdXJlIG5vdCB0byBsb3NlIHRyYWNrIG9mIHRoaXMgY3ljbGUncyB3cml0ZXMuXG4gICAgICAvLyAoSXQgYWxzbyBjYW4gdGhyb3cgaWYgdGhlcmUncyBqdXN0IHNvbWV0aGluZyBpbnZhbGlkIGFib3V0IHRoaXMgcXVlcnk7XG4gICAgICAvLyB1bmZvcnR1bmF0ZWx5IHRoZSBPYnNlcnZlRHJpdmVyIEFQSSBkb2Vzbid0IHByb3ZpZGUgYSBnb29kIHdheSB0b1xuICAgICAgLy8gXCJjYW5jZWxcIiB0aGUgb2JzZXJ2ZSBmcm9tIHRoZSBpbnNpZGUgaW4gdGhpcyBjYXNlLlxuICAgICAgQXJyYXkucHJvdG90eXBlLnB1c2guYXBwbHkoc2VsZi5fcGVuZGluZ1dyaXRlcywgd3JpdGVzRm9yQ3ljbGUpO1xuICAgICAgTWV0ZW9yLl9kZWJ1ZyhcIkV4Y2VwdGlvbiB3aGlsZSBwb2xsaW5nIHF1ZXJ5IFwiICtcbiAgICAgICAgICAgICAgICAgICAgSlNPTi5zdHJpbmdpZnkoc2VsZi5fY3Vyc29yRGVzY3JpcHRpb24pLCBlKTtcbiAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICAvLyBSdW4gZGlmZnMuXG4gICAgaWYgKCFzZWxmLl9zdG9wcGVkKSB7XG4gICAgICBMb2NhbENvbGxlY3Rpb24uX2RpZmZRdWVyeUNoYW5nZXMoXG4gICAgICAgIHNlbGYuX29yZGVyZWQsIG9sZFJlc3VsdHMsIG5ld1Jlc3VsdHMsIHNlbGYuX211bHRpcGxleGVyKTtcbiAgICB9XG5cbiAgICAvLyBTaWduYWxzIHRoZSBtdWx0aXBsZXhlciB0byBhbGxvdyBhbGwgb2JzZXJ2ZUNoYW5nZXMgY2FsbHMgdGhhdCBzaGFyZSB0aGlzXG4gICAgLy8gbXVsdGlwbGV4ZXIgdG8gcmV0dXJuLiAoVGhpcyBoYXBwZW5zIGFzeW5jaHJvbm91c2x5LCB2aWEgdGhlXG4gICAgLy8gbXVsdGlwbGV4ZXIncyBxdWV1ZS4pXG4gICAgaWYgKGZpcnN0KVxuICAgICAgc2VsZi5fbXVsdGlwbGV4ZXIucmVhZHkoKTtcblxuICAgIC8vIFJlcGxhY2Ugc2VsZi5fcmVzdWx0cyBhdG9taWNhbGx5LiAgKFRoaXMgYXNzaWdubWVudCBpcyB3aGF0IG1ha2VzIGBmaXJzdGBcbiAgICAvLyBzdGF5IHRocm91Z2ggb24gdGhlIG5leHQgY3ljbGUsIHNvIHdlJ3ZlIHdhaXRlZCB1bnRpbCBhZnRlciB3ZSd2ZVxuICAgIC8vIGNvbW1pdHRlZCB0byByZWFkeS1pbmcgdGhlIG11bHRpcGxleGVyLilcbiAgICBzZWxmLl9yZXN1bHRzID0gbmV3UmVzdWx0cztcblxuICAgIC8vIE9uY2UgdGhlIE9ic2VydmVNdWx0aXBsZXhlciBoYXMgcHJvY2Vzc2VkIGV2ZXJ5dGhpbmcgd2UndmUgZG9uZSBpbiB0aGlzXG4gICAgLy8gcm91bmQsIG1hcmsgYWxsIHRoZSB3cml0ZXMgd2hpY2ggZXhpc3RlZCBiZWZvcmUgdGhpcyBjYWxsIGFzXG4gICAgLy8gY29tbW1pdHRlZC4gKElmIG5ldyB3cml0ZXMgaGF2ZSBzaG93biB1cCBpbiB0aGUgbWVhbnRpbWUsIHRoZXJlJ2xsXG4gICAgLy8gYWxyZWFkeSBiZSBhbm90aGVyIF9wb2xsTW9uZ28gdGFzayBzY2hlZHVsZWQuKVxuICAgIHNlbGYuX211bHRpcGxleGVyLm9uRmx1c2goZnVuY3Rpb24gKCkge1xuICAgICAgXy5lYWNoKHdyaXRlc0ZvckN5Y2xlLCBmdW5jdGlvbiAodykge1xuICAgICAgICB3LmNvbW1pdHRlZCgpO1xuICAgICAgfSk7XG4gICAgfSk7XG4gIH0sXG5cbiAgc3RvcDogZnVuY3Rpb24gKCkge1xuICAgIHZhciBzZWxmID0gdGhpcztcbiAgICBzZWxmLl9zdG9wcGVkID0gdHJ1ZTtcbiAgICBfLmVhY2goc2VsZi5fc3RvcENhbGxiYWNrcywgZnVuY3Rpb24gKGMpIHsgYygpOyB9KTtcbiAgICAvLyBSZWxlYXNlIGFueSB3cml0ZSBmZW5jZXMgdGhhdCBhcmUgd2FpdGluZyBvbiB1cy5cbiAgICBfLmVhY2goc2VsZi5fcGVuZGluZ1dyaXRlcywgZnVuY3Rpb24gKHcpIHtcbiAgICAgIHcuY29tbWl0dGVkKCk7XG4gICAgfSk7XG4gICAgUGFja2FnZVsnZmFjdHMtYmFzZSddICYmIFBhY2thZ2VbJ2ZhY3RzLWJhc2UnXS5GYWN0cy5pbmNyZW1lbnRTZXJ2ZXJGYWN0KFxuICAgICAgXCJtb25nby1saXZlZGF0YVwiLCBcIm9ic2VydmUtZHJpdmVycy1wb2xsaW5nXCIsIC0xKTtcbiAgfVxufSk7XG4iLCJ2YXIgRnV0dXJlID0gTnBtLnJlcXVpcmUoJ2ZpYmVycy9mdXR1cmUnKTtcblxudmFyIFBIQVNFID0ge1xuICBRVUVSWUlORzogXCJRVUVSWUlOR1wiLFxuICBGRVRDSElORzogXCJGRVRDSElOR1wiLFxuICBTVEVBRFk6IFwiU1RFQURZXCJcbn07XG5cbi8vIEV4Y2VwdGlvbiB0aHJvd24gYnkgX25lZWRUb1BvbGxRdWVyeSB3aGljaCB1bnJvbGxzIHRoZSBzdGFjayB1cCB0byB0aGVcbi8vIGVuY2xvc2luZyBjYWxsIHRvIGZpbmlzaElmTmVlZFRvUG9sbFF1ZXJ5LlxudmFyIFN3aXRjaGVkVG9RdWVyeSA9IGZ1bmN0aW9uICgpIHt9O1xudmFyIGZpbmlzaElmTmVlZFRvUG9sbFF1ZXJ5ID0gZnVuY3Rpb24gKGYpIHtcbiAgcmV0dXJuIGZ1bmN0aW9uICgpIHtcbiAgICB0cnkge1xuICAgICAgZi5hcHBseSh0aGlzLCBhcmd1bWVudHMpO1xuICAgIH0gY2F0Y2ggKGUpIHtcbiAgICAgIGlmICghKGUgaW5zdGFuY2VvZiBTd2l0Y2hlZFRvUXVlcnkpKVxuICAgICAgICB0aHJvdyBlO1xuICAgIH1cbiAgfTtcbn07XG5cbnZhciBjdXJyZW50SWQgPSAwO1xuXG4vLyBPcGxvZ09ic2VydmVEcml2ZXIgaXMgYW4gYWx0ZXJuYXRpdmUgdG8gUG9sbGluZ09ic2VydmVEcml2ZXIgd2hpY2ggZm9sbG93c1xuLy8gdGhlIE1vbmdvIG9wZXJhdGlvbiBsb2cgaW5zdGVhZCBvZiBqdXN0IHJlLXBvbGxpbmcgdGhlIHF1ZXJ5LiBJdCBvYmV5cyB0aGVcbi8vIHNhbWUgc2ltcGxlIGludGVyZmFjZTogY29uc3RydWN0aW5nIGl0IHN0YXJ0cyBzZW5kaW5nIG9ic2VydmVDaGFuZ2VzXG4vLyBjYWxsYmFja3MgKGFuZCBhIHJlYWR5KCkgaW52b2NhdGlvbikgdG8gdGhlIE9ic2VydmVNdWx0aXBsZXhlciwgYW5kIHlvdSBzdG9wXG4vLyBpdCBieSBjYWxsaW5nIHRoZSBzdG9wKCkgbWV0aG9kLlxuT3Bsb2dPYnNlcnZlRHJpdmVyID0gZnVuY3Rpb24gKG9wdGlvbnMpIHtcbiAgdmFyIHNlbGYgPSB0aGlzO1xuICBzZWxmLl91c2VzT3Bsb2cgPSB0cnVlOyAgLy8gdGVzdHMgbG9vayBhdCB0aGlzXG5cbiAgc2VsZi5faWQgPSBjdXJyZW50SWQ7XG4gIGN1cnJlbnRJZCsrO1xuXG4gIHNlbGYuX2N1cnNvckRlc2NyaXB0aW9uID0gb3B0aW9ucy5jdXJzb3JEZXNjcmlwdGlvbjtcbiAgc2VsZi5fbW9uZ29IYW5kbGUgPSBvcHRpb25zLm1vbmdvSGFuZGxlO1xuICBzZWxmLl9tdWx0aXBsZXhlciA9IG9wdGlvbnMubXVsdGlwbGV4ZXI7XG5cbiAgaWYgKG9wdGlvbnMub3JkZXJlZCkge1xuICAgIHRocm93IEVycm9yKFwiT3Bsb2dPYnNlcnZlRHJpdmVyIG9ubHkgc3VwcG9ydHMgdW5vcmRlcmVkIG9ic2VydmVDaGFuZ2VzXCIpO1xuICB9XG5cbiAgdmFyIHNvcnRlciA9IG9wdGlvbnMuc29ydGVyO1xuICAvLyBXZSBkb24ndCBzdXBwb3J0ICRuZWFyIGFuZCBvdGhlciBnZW8tcXVlcmllcyBzbyBpdCdzIE9LIHRvIGluaXRpYWxpemUgdGhlXG4gIC8vIGNvbXBhcmF0b3Igb25seSBvbmNlIGluIHRoZSBjb25zdHJ1Y3Rvci5cbiAgdmFyIGNvbXBhcmF0b3IgPSBzb3J0ZXIgJiYgc29ydGVyLmdldENvbXBhcmF0b3IoKTtcblxuICBpZiAob3B0aW9ucy5jdXJzb3JEZXNjcmlwdGlvbi5vcHRpb25zLmxpbWl0KSB7XG4gICAgLy8gVGhlcmUgYXJlIHNldmVyYWwgcHJvcGVydGllcyBvcmRlcmVkIGRyaXZlciBpbXBsZW1lbnRzOlxuICAgIC8vIC0gX2xpbWl0IGlzIGEgcG9zaXRpdmUgbnVtYmVyXG4gICAgLy8gLSBfY29tcGFyYXRvciBpcyBhIGZ1bmN0aW9uLWNvbXBhcmF0b3IgYnkgd2hpY2ggdGhlIHF1ZXJ5IGlzIG9yZGVyZWRcbiAgICAvLyAtIF91bnB1Ymxpc2hlZEJ1ZmZlciBpcyBub24tbnVsbCBNaW4vTWF4IEhlYXAsXG4gICAgLy8gICAgICAgICAgICAgICAgICAgICAgdGhlIGVtcHR5IGJ1ZmZlciBpbiBTVEVBRFkgcGhhc2UgaW1wbGllcyB0aGF0IHRoZVxuICAgIC8vICAgICAgICAgICAgICAgICAgICAgIGV2ZXJ5dGhpbmcgdGhhdCBtYXRjaGVzIHRoZSBxdWVyaWVzIHNlbGVjdG9yIGZpdHNcbiAgICAvLyAgICAgICAgICAgICAgICAgICAgICBpbnRvIHB1Ymxpc2hlZCBzZXQuXG4gICAgLy8gLSBfcHVibGlzaGVkIC0gTWF4IEhlYXAgKGFsc28gaW1wbGVtZW50cyBJZE1hcCBtZXRob2RzKVxuXG4gICAgdmFyIGhlYXBPcHRpb25zID0geyBJZE1hcDogTG9jYWxDb2xsZWN0aW9uLl9JZE1hcCB9O1xuICAgIHNlbGYuX2xpbWl0ID0gc2VsZi5fY3Vyc29yRGVzY3JpcHRpb24ub3B0aW9ucy5saW1pdDtcbiAgICBzZWxmLl9jb21wYXJhdG9yID0gY29tcGFyYXRvcjtcbiAgICBzZWxmLl9zb3J0ZXIgPSBzb3J0ZXI7XG4gICAgc2VsZi5fdW5wdWJsaXNoZWRCdWZmZXIgPSBuZXcgTWluTWF4SGVhcChjb21wYXJhdG9yLCBoZWFwT3B0aW9ucyk7XG4gICAgLy8gV2UgbmVlZCBzb21ldGhpbmcgdGhhdCBjYW4gZmluZCBNYXggdmFsdWUgaW4gYWRkaXRpb24gdG8gSWRNYXAgaW50ZXJmYWNlXG4gICAgc2VsZi5fcHVibGlzaGVkID0gbmV3IE1heEhlYXAoY29tcGFyYXRvciwgaGVhcE9wdGlvbnMpO1xuICB9IGVsc2Uge1xuICAgIHNlbGYuX2xpbWl0ID0gMDtcbiAgICBzZWxmLl9jb21wYXJhdG9yID0gbnVsbDtcbiAgICBzZWxmLl9zb3J0ZXIgPSBudWxsO1xuICAgIHNlbGYuX3VucHVibGlzaGVkQnVmZmVyID0gbnVsbDtcbiAgICBzZWxmLl9wdWJsaXNoZWQgPSBuZXcgTG9jYWxDb2xsZWN0aW9uLl9JZE1hcDtcbiAgfVxuXG4gIC8vIEluZGljYXRlcyBpZiBpdCBpcyBzYWZlIHRvIGluc2VydCBhIG5ldyBkb2N1bWVudCBhdCB0aGUgZW5kIG9mIHRoZSBidWZmZXJcbiAgLy8gZm9yIHRoaXMgcXVlcnkuIGkuZS4gaXQgaXMga25vd24gdGhhdCB0aGVyZSBhcmUgbm8gZG9jdW1lbnRzIG1hdGNoaW5nIHRoZVxuICAvLyBzZWxlY3RvciB0aG9zZSBhcmUgbm90IGluIHB1Ymxpc2hlZCBvciBidWZmZXIuXG4gIHNlbGYuX3NhZmVBcHBlbmRUb0J1ZmZlciA9IGZhbHNlO1xuXG4gIHNlbGYuX3N0b3BwZWQgPSBmYWxzZTtcbiAgc2VsZi5fc3RvcEhhbmRsZXMgPSBbXTtcblxuICBQYWNrYWdlWydmYWN0cy1iYXNlJ10gJiYgUGFja2FnZVsnZmFjdHMtYmFzZSddLkZhY3RzLmluY3JlbWVudFNlcnZlckZhY3QoXG4gICAgXCJtb25nby1saXZlZGF0YVwiLCBcIm9ic2VydmUtZHJpdmVycy1vcGxvZ1wiLCAxKTtcblxuICBzZWxmLl9yZWdpc3RlclBoYXNlQ2hhbmdlKFBIQVNFLlFVRVJZSU5HKTtcblxuICBzZWxmLl9tYXRjaGVyID0gb3B0aW9ucy5tYXRjaGVyO1xuICB2YXIgcHJvamVjdGlvbiA9IHNlbGYuX2N1cnNvckRlc2NyaXB0aW9uLm9wdGlvbnMuZmllbGRzIHx8IHt9O1xuICBzZWxmLl9wcm9qZWN0aW9uRm4gPSBMb2NhbENvbGxlY3Rpb24uX2NvbXBpbGVQcm9qZWN0aW9uKHByb2plY3Rpb24pO1xuICAvLyBQcm9qZWN0aW9uIGZ1bmN0aW9uLCByZXN1bHQgb2YgY29tYmluaW5nIGltcG9ydGFudCBmaWVsZHMgZm9yIHNlbGVjdG9yIGFuZFxuICAvLyBleGlzdGluZyBmaWVsZHMgcHJvamVjdGlvblxuICBzZWxmLl9zaGFyZWRQcm9qZWN0aW9uID0gc2VsZi5fbWF0Y2hlci5jb21iaW5lSW50b1Byb2plY3Rpb24ocHJvamVjdGlvbik7XG4gIGlmIChzb3J0ZXIpXG4gICAgc2VsZi5fc2hhcmVkUHJvamVjdGlvbiA9IHNvcnRlci5jb21iaW5lSW50b1Byb2plY3Rpb24oc2VsZi5fc2hhcmVkUHJvamVjdGlvbik7XG4gIHNlbGYuX3NoYXJlZFByb2plY3Rpb25GbiA9IExvY2FsQ29sbGVjdGlvbi5fY29tcGlsZVByb2plY3Rpb24oXG4gICAgc2VsZi5fc2hhcmVkUHJvamVjdGlvbik7XG5cbiAgc2VsZi5fbmVlZFRvRmV0Y2ggPSBuZXcgTG9jYWxDb2xsZWN0aW9uLl9JZE1hcDtcbiAgc2VsZi5fY3VycmVudGx5RmV0Y2hpbmcgPSBudWxsO1xuICBzZWxmLl9mZXRjaEdlbmVyYXRpb24gPSAwO1xuXG4gIHNlbGYuX3JlcXVlcnlXaGVuRG9uZVRoaXNRdWVyeSA9IGZhbHNlO1xuICBzZWxmLl93cml0ZXNUb0NvbW1pdFdoZW5XZVJlYWNoU3RlYWR5ID0gW107XG5cbiAgLy8gSWYgdGhlIG9wbG9nIGhhbmRsZSB0ZWxscyB1cyB0aGF0IGl0IHNraXBwZWQgc29tZSBlbnRyaWVzIChiZWNhdXNlIGl0IGdvdFxuICAvLyBiZWhpbmQsIHNheSksIHJlLXBvbGwuXG4gIHNlbGYuX3N0b3BIYW5kbGVzLnB1c2goc2VsZi5fbW9uZ29IYW5kbGUuX29wbG9nSGFuZGxlLm9uU2tpcHBlZEVudHJpZXMoXG4gICAgZmluaXNoSWZOZWVkVG9Qb2xsUXVlcnkoZnVuY3Rpb24gKCkge1xuICAgICAgc2VsZi5fbmVlZFRvUG9sbFF1ZXJ5KCk7XG4gICAgfSlcbiAgKSk7XG5cbiAgZm9yRWFjaFRyaWdnZXIoc2VsZi5fY3Vyc29yRGVzY3JpcHRpb24sIGZ1bmN0aW9uICh0cmlnZ2VyKSB7XG4gICAgc2VsZi5fc3RvcEhhbmRsZXMucHVzaChzZWxmLl9tb25nb0hhbmRsZS5fb3Bsb2dIYW5kbGUub25PcGxvZ0VudHJ5KFxuICAgICAgdHJpZ2dlciwgZnVuY3Rpb24gKG5vdGlmaWNhdGlvbikge1xuICAgICAgICBNZXRlb3IuX25vWWllbGRzQWxsb3dlZChmaW5pc2hJZk5lZWRUb1BvbGxRdWVyeShmdW5jdGlvbiAoKSB7XG4gICAgICAgICAgdmFyIG9wID0gbm90aWZpY2F0aW9uLm9wO1xuICAgICAgICAgIGlmIChub3RpZmljYXRpb24uZHJvcENvbGxlY3Rpb24gfHwgbm90aWZpY2F0aW9uLmRyb3BEYXRhYmFzZSkge1xuICAgICAgICAgICAgLy8gTm90ZTogdGhpcyBjYWxsIGlzIG5vdCBhbGxvd2VkIHRvIGJsb2NrIG9uIGFueXRoaW5nIChlc3BlY2lhbGx5XG4gICAgICAgICAgICAvLyBvbiB3YWl0aW5nIGZvciBvcGxvZyBlbnRyaWVzIHRvIGNhdGNoIHVwKSBiZWNhdXNlIHRoYXQgd2lsbCBibG9ja1xuICAgICAgICAgICAgLy8gb25PcGxvZ0VudHJ5IVxuICAgICAgICAgICAgc2VsZi5fbmVlZFRvUG9sbFF1ZXJ5KCk7XG4gICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIC8vIEFsbCBvdGhlciBvcGVyYXRvcnMgc2hvdWxkIGJlIGhhbmRsZWQgZGVwZW5kaW5nIG9uIHBoYXNlXG4gICAgICAgICAgICBpZiAoc2VsZi5fcGhhc2UgPT09IFBIQVNFLlFVRVJZSU5HKSB7XG4gICAgICAgICAgICAgIHNlbGYuX2hhbmRsZU9wbG9nRW50cnlRdWVyeWluZyhvcCk7XG4gICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICBzZWxmLl9oYW5kbGVPcGxvZ0VudHJ5U3RlYWR5T3JGZXRjaGluZyhvcCk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgfVxuICAgICAgICB9KSk7XG4gICAgICB9XG4gICAgKSk7XG4gIH0pO1xuXG4gIC8vIFhYWCBvcmRlcmluZyB3LnIudC4gZXZlcnl0aGluZyBlbHNlP1xuICBzZWxmLl9zdG9wSGFuZGxlcy5wdXNoKGxpc3RlbkFsbChcbiAgICBzZWxmLl9jdXJzb3JEZXNjcmlwdGlvbiwgZnVuY3Rpb24gKG5vdGlmaWNhdGlvbikge1xuICAgICAgLy8gSWYgd2UncmUgbm90IGluIGEgcHJlLWZpcmUgd3JpdGUgZmVuY2UsIHdlIGRvbid0IGhhdmUgdG8gZG8gYW55dGhpbmcuXG4gICAgICB2YXIgZmVuY2UgPSBERFBTZXJ2ZXIuX0N1cnJlbnRXcml0ZUZlbmNlLmdldCgpO1xuICAgICAgaWYgKCFmZW5jZSB8fCBmZW5jZS5maXJlZClcbiAgICAgICAgcmV0dXJuO1xuXG4gICAgICBpZiAoZmVuY2UuX29wbG9nT2JzZXJ2ZURyaXZlcnMpIHtcbiAgICAgICAgZmVuY2UuX29wbG9nT2JzZXJ2ZURyaXZlcnNbc2VsZi5faWRdID0gc2VsZjtcbiAgICAgICAgcmV0dXJuO1xuICAgICAgfVxuXG4gICAgICBmZW5jZS5fb3Bsb2dPYnNlcnZlRHJpdmVycyA9IHt9O1xuICAgICAgZmVuY2UuX29wbG9nT2JzZXJ2ZURyaXZlcnNbc2VsZi5faWRdID0gc2VsZjtcblxuICAgICAgZmVuY2Uub25CZWZvcmVGaXJlKGZ1bmN0aW9uICgpIHtcbiAgICAgICAgdmFyIGRyaXZlcnMgPSBmZW5jZS5fb3Bsb2dPYnNlcnZlRHJpdmVycztcbiAgICAgICAgZGVsZXRlIGZlbmNlLl9vcGxvZ09ic2VydmVEcml2ZXJzO1xuXG4gICAgICAgIC8vIFRoaXMgZmVuY2UgY2Fubm90IGZpcmUgdW50aWwgd2UndmUgY2F1Z2h0IHVwIHRvIFwidGhpcyBwb2ludFwiIGluIHRoZVxuICAgICAgICAvLyBvcGxvZywgYW5kIGFsbCBvYnNlcnZlcnMgbWFkZSBpdCBiYWNrIHRvIHRoZSBzdGVhZHkgc3RhdGUuXG4gICAgICAgIHNlbGYuX21vbmdvSGFuZGxlLl9vcGxvZ0hhbmRsZS53YWl0VW50aWxDYXVnaHRVcCgpO1xuXG4gICAgICAgIF8uZWFjaChkcml2ZXJzLCBmdW5jdGlvbiAoZHJpdmVyKSB7XG4gICAgICAgICAgaWYgKGRyaXZlci5fc3RvcHBlZClcbiAgICAgICAgICAgIHJldHVybjtcblxuICAgICAgICAgIHZhciB3cml0ZSA9IGZlbmNlLmJlZ2luV3JpdGUoKTtcbiAgICAgICAgICBpZiAoZHJpdmVyLl9waGFzZSA9PT0gUEhBU0UuU1RFQURZKSB7XG4gICAgICAgICAgICAvLyBNYWtlIHN1cmUgdGhhdCBhbGwgb2YgdGhlIGNhbGxiYWNrcyBoYXZlIG1hZGUgaXQgdGhyb3VnaCB0aGVcbiAgICAgICAgICAgIC8vIG11bHRpcGxleGVyIGFuZCBiZWVuIGRlbGl2ZXJlZCB0byBPYnNlcnZlSGFuZGxlcyBiZWZvcmUgY29tbWl0dGluZ1xuICAgICAgICAgICAgLy8gd3JpdGVzLlxuICAgICAgICAgICAgZHJpdmVyLl9tdWx0aXBsZXhlci5vbkZsdXNoKGZ1bmN0aW9uICgpIHtcbiAgICAgICAgICAgICAgd3JpdGUuY29tbWl0dGVkKCk7XG4gICAgICAgICAgICB9KTtcbiAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgZHJpdmVyLl93cml0ZXNUb0NvbW1pdFdoZW5XZVJlYWNoU3RlYWR5LnB1c2god3JpdGUpO1xuICAgICAgICAgIH1cbiAgICAgICAgfSk7XG4gICAgICB9KTtcbiAgICB9XG4gICkpO1xuXG4gIC8vIFdoZW4gTW9uZ28gZmFpbHMgb3Zlciwgd2UgbmVlZCB0byByZXBvbGwgdGhlIHF1ZXJ5LCBpbiBjYXNlIHdlIHByb2Nlc3NlZCBhblxuICAvLyBvcGxvZyBlbnRyeSB0aGF0IGdvdCByb2xsZWQgYmFjay5cbiAgc2VsZi5fc3RvcEhhbmRsZXMucHVzaChzZWxmLl9tb25nb0hhbmRsZS5fb25GYWlsb3ZlcihmaW5pc2hJZk5lZWRUb1BvbGxRdWVyeShcbiAgICBmdW5jdGlvbiAoKSB7XG4gICAgICBzZWxmLl9uZWVkVG9Qb2xsUXVlcnkoKTtcbiAgICB9KSkpO1xuXG4gIC8vIEdpdmUgX29ic2VydmVDaGFuZ2VzIGEgY2hhbmNlIHRvIGFkZCB0aGUgbmV3IE9ic2VydmVIYW5kbGUgdG8gb3VyXG4gIC8vIG11bHRpcGxleGVyLCBzbyB0aGF0IHRoZSBhZGRlZCBjYWxscyBnZXQgc3RyZWFtZWQuXG4gIE1ldGVvci5kZWZlcihmaW5pc2hJZk5lZWRUb1BvbGxRdWVyeShmdW5jdGlvbiAoKSB7XG4gICAgc2VsZi5fcnVuSW5pdGlhbFF1ZXJ5KCk7XG4gIH0pKTtcbn07XG5cbl8uZXh0ZW5kKE9wbG9nT2JzZXJ2ZURyaXZlci5wcm90b3R5cGUsIHtcbiAgX2FkZFB1Ymxpc2hlZDogZnVuY3Rpb24gKGlkLCBkb2MpIHtcbiAgICB2YXIgc2VsZiA9IHRoaXM7XG4gICAgTWV0ZW9yLl9ub1lpZWxkc0FsbG93ZWQoZnVuY3Rpb24gKCkge1xuICAgICAgdmFyIGZpZWxkcyA9IF8uY2xvbmUoZG9jKTtcbiAgICAgIGRlbGV0ZSBmaWVsZHMuX2lkO1xuICAgICAgc2VsZi5fcHVibGlzaGVkLnNldChpZCwgc2VsZi5fc2hhcmVkUHJvamVjdGlvbkZuKGRvYykpO1xuICAgICAgc2VsZi5fbXVsdGlwbGV4ZXIuYWRkZWQoaWQsIHNlbGYuX3Byb2plY3Rpb25GbihmaWVsZHMpKTtcblxuICAgICAgLy8gQWZ0ZXIgYWRkaW5nIHRoaXMgZG9jdW1lbnQsIHRoZSBwdWJsaXNoZWQgc2V0IG1pZ2h0IGJlIG92ZXJmbG93ZWRcbiAgICAgIC8vIChleGNlZWRpbmcgY2FwYWNpdHkgc3BlY2lmaWVkIGJ5IGxpbWl0KS4gSWYgc28sIHB1c2ggdGhlIG1heGltdW1cbiAgICAgIC8vIGVsZW1lbnQgdG8gdGhlIGJ1ZmZlciwgd2UgbWlnaHQgd2FudCB0byBzYXZlIGl0IGluIG1lbW9yeSB0byByZWR1Y2UgdGhlXG4gICAgICAvLyBhbW91bnQgb2YgTW9uZ28gbG9va3VwcyBpbiB0aGUgZnV0dXJlLlxuICAgICAgaWYgKHNlbGYuX2xpbWl0ICYmIHNlbGYuX3B1Ymxpc2hlZC5zaXplKCkgPiBzZWxmLl9saW1pdCkge1xuICAgICAgICAvLyBYWFggaW4gdGhlb3J5IHRoZSBzaXplIG9mIHB1Ymxpc2hlZCBpcyBubyBtb3JlIHRoYW4gbGltaXQrMVxuICAgICAgICBpZiAoc2VsZi5fcHVibGlzaGVkLnNpemUoKSAhPT0gc2VsZi5fbGltaXQgKyAxKSB7XG4gICAgICAgICAgdGhyb3cgbmV3IEVycm9yKFwiQWZ0ZXIgYWRkaW5nIHRvIHB1Ymxpc2hlZCwgXCIgK1xuICAgICAgICAgICAgICAgICAgICAgICAgICAoc2VsZi5fcHVibGlzaGVkLnNpemUoKSAtIHNlbGYuX2xpbWl0KSArXG4gICAgICAgICAgICAgICAgICAgICAgICAgIFwiIGRvY3VtZW50cyBhcmUgb3ZlcmZsb3dpbmcgdGhlIHNldFwiKTtcbiAgICAgICAgfVxuXG4gICAgICAgIHZhciBvdmVyZmxvd2luZ0RvY0lkID0gc2VsZi5fcHVibGlzaGVkLm1heEVsZW1lbnRJZCgpO1xuICAgICAgICB2YXIgb3ZlcmZsb3dpbmdEb2MgPSBzZWxmLl9wdWJsaXNoZWQuZ2V0KG92ZXJmbG93aW5nRG9jSWQpO1xuXG4gICAgICAgIGlmIChFSlNPTi5lcXVhbHMob3ZlcmZsb3dpbmdEb2NJZCwgaWQpKSB7XG4gICAgICAgICAgdGhyb3cgbmV3IEVycm9yKFwiVGhlIGRvY3VtZW50IGp1c3QgYWRkZWQgaXMgb3ZlcmZsb3dpbmcgdGhlIHB1Ymxpc2hlZCBzZXRcIik7XG4gICAgICAgIH1cblxuICAgICAgICBzZWxmLl9wdWJsaXNoZWQucmVtb3ZlKG92ZXJmbG93aW5nRG9jSWQpO1xuICAgICAgICBzZWxmLl9tdWx0aXBsZXhlci5yZW1vdmVkKG92ZXJmbG93aW5nRG9jSWQpO1xuICAgICAgICBzZWxmLl9hZGRCdWZmZXJlZChvdmVyZmxvd2luZ0RvY0lkLCBvdmVyZmxvd2luZ0RvYyk7XG4gICAgICB9XG4gICAgfSk7XG4gIH0sXG4gIF9yZW1vdmVQdWJsaXNoZWQ6IGZ1bmN0aW9uIChpZCkge1xuICAgIHZhciBzZWxmID0gdGhpcztcbiAgICBNZXRlb3IuX25vWWllbGRzQWxsb3dlZChmdW5jdGlvbiAoKSB7XG4gICAgICBzZWxmLl9wdWJsaXNoZWQucmVtb3ZlKGlkKTtcbiAgICAgIHNlbGYuX211bHRpcGxleGVyLnJlbW92ZWQoaWQpO1xuICAgICAgaWYgKCEgc2VsZi5fbGltaXQgfHwgc2VsZi5fcHVibGlzaGVkLnNpemUoKSA9PT0gc2VsZi5fbGltaXQpXG4gICAgICAgIHJldHVybjtcblxuICAgICAgaWYgKHNlbGYuX3B1Ymxpc2hlZC5zaXplKCkgPiBzZWxmLl9saW1pdClcbiAgICAgICAgdGhyb3cgRXJyb3IoXCJzZWxmLl9wdWJsaXNoZWQgZ290IHRvbyBiaWdcIik7XG5cbiAgICAgIC8vIE9LLCB3ZSBhcmUgcHVibGlzaGluZyBsZXNzIHRoYW4gdGhlIGxpbWl0LiBNYXliZSB3ZSBzaG91bGQgbG9vayBpbiB0aGVcbiAgICAgIC8vIGJ1ZmZlciB0byBmaW5kIHRoZSBuZXh0IGVsZW1lbnQgcGFzdCB3aGF0IHdlIHdlcmUgcHVibGlzaGluZyBiZWZvcmUuXG5cbiAgICAgIGlmICghc2VsZi5fdW5wdWJsaXNoZWRCdWZmZXIuZW1wdHkoKSkge1xuICAgICAgICAvLyBUaGVyZSdzIHNvbWV0aGluZyBpbiB0aGUgYnVmZmVyOyBtb3ZlIHRoZSBmaXJzdCB0aGluZyBpbiBpdCB0b1xuICAgICAgICAvLyBfcHVibGlzaGVkLlxuICAgICAgICB2YXIgbmV3RG9jSWQgPSBzZWxmLl91bnB1Ymxpc2hlZEJ1ZmZlci5taW5FbGVtZW50SWQoKTtcbiAgICAgICAgdmFyIG5ld0RvYyA9IHNlbGYuX3VucHVibGlzaGVkQnVmZmVyLmdldChuZXdEb2NJZCk7XG4gICAgICAgIHNlbGYuX3JlbW92ZUJ1ZmZlcmVkKG5ld0RvY0lkKTtcbiAgICAgICAgc2VsZi5fYWRkUHVibGlzaGVkKG5ld0RvY0lkLCBuZXdEb2MpO1xuICAgICAgICByZXR1cm47XG4gICAgICB9XG5cbiAgICAgIC8vIFRoZXJlJ3Mgbm90aGluZyBpbiB0aGUgYnVmZmVyLiAgVGhpcyBjb3VsZCBtZWFuIG9uZSBvZiBhIGZldyB0aGluZ3MuXG5cbiAgICAgIC8vIChhKSBXZSBjb3VsZCBiZSBpbiB0aGUgbWlkZGxlIG9mIHJlLXJ1bm5pbmcgdGhlIHF1ZXJ5IChzcGVjaWZpY2FsbHksIHdlXG4gICAgICAvLyBjb3VsZCBiZSBpbiBfcHVibGlzaE5ld1Jlc3VsdHMpLiBJbiB0aGF0IGNhc2UsIF91bnB1Ymxpc2hlZEJ1ZmZlciBpc1xuICAgICAgLy8gZW1wdHkgYmVjYXVzZSB3ZSBjbGVhciBpdCBhdCB0aGUgYmVnaW5uaW5nIG9mIF9wdWJsaXNoTmV3UmVzdWx0cy4gSW5cbiAgICAgIC8vIHRoaXMgY2FzZSwgb3VyIGNhbGxlciBhbHJlYWR5IGtub3dzIHRoZSBlbnRpcmUgYW5zd2VyIHRvIHRoZSBxdWVyeSBhbmRcbiAgICAgIC8vIHdlIGRvbid0IG5lZWQgdG8gZG8gYW55dGhpbmcgZmFuY3kgaGVyZS4gIEp1c3QgcmV0dXJuLlxuICAgICAgaWYgKHNlbGYuX3BoYXNlID09PSBQSEFTRS5RVUVSWUlORylcbiAgICAgICAgcmV0dXJuO1xuXG4gICAgICAvLyAoYikgV2UncmUgcHJldHR5IGNvbmZpZGVudCB0aGF0IHRoZSB1bmlvbiBvZiBfcHVibGlzaGVkIGFuZFxuICAgICAgLy8gX3VucHVibGlzaGVkQnVmZmVyIGNvbnRhaW4gYWxsIGRvY3VtZW50cyB0aGF0IG1hdGNoIHNlbGVjdG9yLiBCZWNhdXNlXG4gICAgICAvLyBfdW5wdWJsaXNoZWRCdWZmZXIgaXMgZW1wdHksIHRoYXQgbWVhbnMgd2UncmUgY29uZmlkZW50IHRoYXQgX3B1Ymxpc2hlZFxuICAgICAgLy8gY29udGFpbnMgYWxsIGRvY3VtZW50cyB0aGF0IG1hdGNoIHNlbGVjdG9yLiBTbyB3ZSBoYXZlIG5vdGhpbmcgdG8gZG8uXG4gICAgICBpZiAoc2VsZi5fc2FmZUFwcGVuZFRvQnVmZmVyKVxuICAgICAgICByZXR1cm47XG5cbiAgICAgIC8vIChjKSBNYXliZSB0aGVyZSBhcmUgb3RoZXIgZG9jdW1lbnRzIG91dCB0aGVyZSB0aGF0IHNob3VsZCBiZSBpbiBvdXJcbiAgICAgIC8vIGJ1ZmZlci4gQnV0IGluIHRoYXQgY2FzZSwgd2hlbiB3ZSBlbXB0aWVkIF91bnB1Ymxpc2hlZEJ1ZmZlciBpblxuICAgICAgLy8gX3JlbW92ZUJ1ZmZlcmVkLCB3ZSBzaG91bGQgaGF2ZSBjYWxsZWQgX25lZWRUb1BvbGxRdWVyeSwgd2hpY2ggd2lsbFxuICAgICAgLy8gZWl0aGVyIHB1dCBzb21ldGhpbmcgaW4gX3VucHVibGlzaGVkQnVmZmVyIG9yIHNldCBfc2FmZUFwcGVuZFRvQnVmZmVyXG4gICAgICAvLyAob3IgYm90aCksIGFuZCBpdCB3aWxsIHB1dCB1cyBpbiBRVUVSWUlORyBmb3IgdGhhdCB3aG9sZSB0aW1lLiBTbyBpblxuICAgICAgLy8gZmFjdCwgd2Ugc2hvdWxkbid0IGJlIGFibGUgdG8gZ2V0IGhlcmUuXG5cbiAgICAgIHRocm93IG5ldyBFcnJvcihcIkJ1ZmZlciBpbmV4cGxpY2FibHkgZW1wdHlcIik7XG4gICAgfSk7XG4gIH0sXG4gIF9jaGFuZ2VQdWJsaXNoZWQ6IGZ1bmN0aW9uIChpZCwgb2xkRG9jLCBuZXdEb2MpIHtcbiAgICB2YXIgc2VsZiA9IHRoaXM7XG4gICAgTWV0ZW9yLl9ub1lpZWxkc0FsbG93ZWQoZnVuY3Rpb24gKCkge1xuICAgICAgc2VsZi5fcHVibGlzaGVkLnNldChpZCwgc2VsZi5fc2hhcmVkUHJvamVjdGlvbkZuKG5ld0RvYykpO1xuICAgICAgdmFyIHByb2plY3RlZE5ldyA9IHNlbGYuX3Byb2plY3Rpb25GbihuZXdEb2MpO1xuICAgICAgdmFyIHByb2plY3RlZE9sZCA9IHNlbGYuX3Byb2plY3Rpb25GbihvbGREb2MpO1xuICAgICAgdmFyIGNoYW5nZWQgPSBEaWZmU2VxdWVuY2UubWFrZUNoYW5nZWRGaWVsZHMoXG4gICAgICAgIHByb2plY3RlZE5ldywgcHJvamVjdGVkT2xkKTtcbiAgICAgIGlmICghXy5pc0VtcHR5KGNoYW5nZWQpKVxuICAgICAgICBzZWxmLl9tdWx0aXBsZXhlci5jaGFuZ2VkKGlkLCBjaGFuZ2VkKTtcbiAgICB9KTtcbiAgfSxcbiAgX2FkZEJ1ZmZlcmVkOiBmdW5jdGlvbiAoaWQsIGRvYykge1xuICAgIHZhciBzZWxmID0gdGhpcztcbiAgICBNZXRlb3IuX25vWWllbGRzQWxsb3dlZChmdW5jdGlvbiAoKSB7XG4gICAgICBzZWxmLl91bnB1Ymxpc2hlZEJ1ZmZlci5zZXQoaWQsIHNlbGYuX3NoYXJlZFByb2plY3Rpb25Gbihkb2MpKTtcblxuICAgICAgLy8gSWYgc29tZXRoaW5nIGlzIG92ZXJmbG93aW5nIHRoZSBidWZmZXIsIHdlIGp1c3QgcmVtb3ZlIGl0IGZyb20gY2FjaGVcbiAgICAgIGlmIChzZWxmLl91bnB1Ymxpc2hlZEJ1ZmZlci5zaXplKCkgPiBzZWxmLl9saW1pdCkge1xuICAgICAgICB2YXIgbWF4QnVmZmVyZWRJZCA9IHNlbGYuX3VucHVibGlzaGVkQnVmZmVyLm1heEVsZW1lbnRJZCgpO1xuXG4gICAgICAgIHNlbGYuX3VucHVibGlzaGVkQnVmZmVyLnJlbW92ZShtYXhCdWZmZXJlZElkKTtcblxuICAgICAgICAvLyBTaW5jZSBzb21ldGhpbmcgbWF0Y2hpbmcgaXMgcmVtb3ZlZCBmcm9tIGNhY2hlIChib3RoIHB1Ymxpc2hlZCBzZXQgYW5kXG4gICAgICAgIC8vIGJ1ZmZlciksIHNldCBmbGFnIHRvIGZhbHNlXG4gICAgICAgIHNlbGYuX3NhZmVBcHBlbmRUb0J1ZmZlciA9IGZhbHNlO1xuICAgICAgfVxuICAgIH0pO1xuICB9LFxuICAvLyBJcyBjYWxsZWQgZWl0aGVyIHRvIHJlbW92ZSB0aGUgZG9jIGNvbXBsZXRlbHkgZnJvbSBtYXRjaGluZyBzZXQgb3IgdG8gbW92ZVxuICAvLyBpdCB0byB0aGUgcHVibGlzaGVkIHNldCBsYXRlci5cbiAgX3JlbW92ZUJ1ZmZlcmVkOiBmdW5jdGlvbiAoaWQpIHtcbiAgICB2YXIgc2VsZiA9IHRoaXM7XG4gICAgTWV0ZW9yLl9ub1lpZWxkc0FsbG93ZWQoZnVuY3Rpb24gKCkge1xuICAgICAgc2VsZi5fdW5wdWJsaXNoZWRCdWZmZXIucmVtb3ZlKGlkKTtcbiAgICAgIC8vIFRvIGtlZXAgdGhlIGNvbnRyYWN0IFwiYnVmZmVyIGlzIG5ldmVyIGVtcHR5IGluIFNURUFEWSBwaGFzZSB1bmxlc3MgdGhlXG4gICAgICAvLyBldmVyeXRoaW5nIG1hdGNoaW5nIGZpdHMgaW50byBwdWJsaXNoZWRcIiB0cnVlLCB3ZSBwb2xsIGV2ZXJ5dGhpbmcgYXNcbiAgICAgIC8vIHNvb24gYXMgd2Ugc2VlIHRoZSBidWZmZXIgYmVjb21pbmcgZW1wdHkuXG4gICAgICBpZiAoISBzZWxmLl91bnB1Ymxpc2hlZEJ1ZmZlci5zaXplKCkgJiYgISBzZWxmLl9zYWZlQXBwZW5kVG9CdWZmZXIpXG4gICAgICAgIHNlbGYuX25lZWRUb1BvbGxRdWVyeSgpO1xuICAgIH0pO1xuICB9LFxuICAvLyBDYWxsZWQgd2hlbiBhIGRvY3VtZW50IGhhcyBqb2luZWQgdGhlIFwiTWF0Y2hpbmdcIiByZXN1bHRzIHNldC5cbiAgLy8gVGFrZXMgcmVzcG9uc2liaWxpdHkgb2Yga2VlcGluZyBfdW5wdWJsaXNoZWRCdWZmZXIgaW4gc3luYyB3aXRoIF9wdWJsaXNoZWRcbiAgLy8gYW5kIHRoZSBlZmZlY3Qgb2YgbGltaXQgZW5mb3JjZWQuXG4gIF9hZGRNYXRjaGluZzogZnVuY3Rpb24gKGRvYykge1xuICAgIHZhciBzZWxmID0gdGhpcztcbiAgICBNZXRlb3IuX25vWWllbGRzQWxsb3dlZChmdW5jdGlvbiAoKSB7XG4gICAgICB2YXIgaWQgPSBkb2MuX2lkO1xuICAgICAgaWYgKHNlbGYuX3B1Ymxpc2hlZC5oYXMoaWQpKVxuICAgICAgICB0aHJvdyBFcnJvcihcInRyaWVkIHRvIGFkZCBzb21ldGhpbmcgYWxyZWFkeSBwdWJsaXNoZWQgXCIgKyBpZCk7XG4gICAgICBpZiAoc2VsZi5fbGltaXQgJiYgc2VsZi5fdW5wdWJsaXNoZWRCdWZmZXIuaGFzKGlkKSlcbiAgICAgICAgdGhyb3cgRXJyb3IoXCJ0cmllZCB0byBhZGQgc29tZXRoaW5nIGFscmVhZHkgZXhpc3RlZCBpbiBidWZmZXIgXCIgKyBpZCk7XG5cbiAgICAgIHZhciBsaW1pdCA9IHNlbGYuX2xpbWl0O1xuICAgICAgdmFyIGNvbXBhcmF0b3IgPSBzZWxmLl9jb21wYXJhdG9yO1xuICAgICAgdmFyIG1heFB1Ymxpc2hlZCA9IChsaW1pdCAmJiBzZWxmLl9wdWJsaXNoZWQuc2l6ZSgpID4gMCkgP1xuICAgICAgICBzZWxmLl9wdWJsaXNoZWQuZ2V0KHNlbGYuX3B1Ymxpc2hlZC5tYXhFbGVtZW50SWQoKSkgOiBudWxsO1xuICAgICAgdmFyIG1heEJ1ZmZlcmVkID0gKGxpbWl0ICYmIHNlbGYuX3VucHVibGlzaGVkQnVmZmVyLnNpemUoKSA+IDApXG4gICAgICAgID8gc2VsZi5fdW5wdWJsaXNoZWRCdWZmZXIuZ2V0KHNlbGYuX3VucHVibGlzaGVkQnVmZmVyLm1heEVsZW1lbnRJZCgpKVxuICAgICAgICA6IG51bGw7XG4gICAgICAvLyBUaGUgcXVlcnkgaXMgdW5saW1pdGVkIG9yIGRpZG4ndCBwdWJsaXNoIGVub3VnaCBkb2N1bWVudHMgeWV0IG9yIHRoZVxuICAgICAgLy8gbmV3IGRvY3VtZW50IHdvdWxkIGZpdCBpbnRvIHB1Ymxpc2hlZCBzZXQgcHVzaGluZyB0aGUgbWF4aW11bSBlbGVtZW50XG4gICAgICAvLyBvdXQsIHRoZW4gd2UgbmVlZCB0byBwdWJsaXNoIHRoZSBkb2MuXG4gICAgICB2YXIgdG9QdWJsaXNoID0gISBsaW1pdCB8fCBzZWxmLl9wdWJsaXNoZWQuc2l6ZSgpIDwgbGltaXQgfHxcbiAgICAgICAgY29tcGFyYXRvcihkb2MsIG1heFB1Ymxpc2hlZCkgPCAwO1xuXG4gICAgICAvLyBPdGhlcndpc2Ugd2UgbWlnaHQgbmVlZCB0byBidWZmZXIgaXQgKG9ubHkgaW4gY2FzZSBvZiBsaW1pdGVkIHF1ZXJ5KS5cbiAgICAgIC8vIEJ1ZmZlcmluZyBpcyBhbGxvd2VkIGlmIHRoZSBidWZmZXIgaXMgbm90IGZpbGxlZCB1cCB5ZXQgYW5kIGFsbFxuICAgICAgLy8gbWF0Y2hpbmcgZG9jcyBhcmUgZWl0aGVyIGluIHRoZSBwdWJsaXNoZWQgc2V0IG9yIGluIHRoZSBidWZmZXIuXG4gICAgICB2YXIgY2FuQXBwZW5kVG9CdWZmZXIgPSAhdG9QdWJsaXNoICYmIHNlbGYuX3NhZmVBcHBlbmRUb0J1ZmZlciAmJlxuICAgICAgICBzZWxmLl91bnB1Ymxpc2hlZEJ1ZmZlci5zaXplKCkgPCBsaW1pdDtcblxuICAgICAgLy8gT3IgaWYgaXQgaXMgc21hbGwgZW5vdWdoIHRvIGJlIHNhZmVseSBpbnNlcnRlZCB0byB0aGUgbWlkZGxlIG9yIHRoZVxuICAgICAgLy8gYmVnaW5uaW5nIG9mIHRoZSBidWZmZXIuXG4gICAgICB2YXIgY2FuSW5zZXJ0SW50b0J1ZmZlciA9ICF0b1B1Ymxpc2ggJiYgbWF4QnVmZmVyZWQgJiZcbiAgICAgICAgY29tcGFyYXRvcihkb2MsIG1heEJ1ZmZlcmVkKSA8PSAwO1xuXG4gICAgICB2YXIgdG9CdWZmZXIgPSBjYW5BcHBlbmRUb0J1ZmZlciB8fCBjYW5JbnNlcnRJbnRvQnVmZmVyO1xuXG4gICAgICBpZiAodG9QdWJsaXNoKSB7XG4gICAgICAgIHNlbGYuX2FkZFB1Ymxpc2hlZChpZCwgZG9jKTtcbiAgICAgIH0gZWxzZSBpZiAodG9CdWZmZXIpIHtcbiAgICAgICAgc2VsZi5fYWRkQnVmZmVyZWQoaWQsIGRvYyk7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICAvLyBkcm9wcGluZyBpdCBhbmQgbm90IHNhdmluZyB0byB0aGUgY2FjaGVcbiAgICAgICAgc2VsZi5fc2FmZUFwcGVuZFRvQnVmZmVyID0gZmFsc2U7XG4gICAgICB9XG4gICAgfSk7XG4gIH0sXG4gIC8vIENhbGxlZCB3aGVuIGEgZG9jdW1lbnQgbGVhdmVzIHRoZSBcIk1hdGNoaW5nXCIgcmVzdWx0cyBzZXQuXG4gIC8vIFRha2VzIHJlc3BvbnNpYmlsaXR5IG9mIGtlZXBpbmcgX3VucHVibGlzaGVkQnVmZmVyIGluIHN5bmMgd2l0aCBfcHVibGlzaGVkXG4gIC8vIGFuZCB0aGUgZWZmZWN0IG9mIGxpbWl0IGVuZm9yY2VkLlxuICBfcmVtb3ZlTWF0Y2hpbmc6IGZ1bmN0aW9uIChpZCkge1xuICAgIHZhciBzZWxmID0gdGhpcztcbiAgICBNZXRlb3IuX25vWWllbGRzQWxsb3dlZChmdW5jdGlvbiAoKSB7XG4gICAgICBpZiAoISBzZWxmLl9wdWJsaXNoZWQuaGFzKGlkKSAmJiAhIHNlbGYuX2xpbWl0KVxuICAgICAgICB0aHJvdyBFcnJvcihcInRyaWVkIHRvIHJlbW92ZSBzb21ldGhpbmcgbWF0Y2hpbmcgYnV0IG5vdCBjYWNoZWQgXCIgKyBpZCk7XG5cbiAgICAgIGlmIChzZWxmLl9wdWJsaXNoZWQuaGFzKGlkKSkge1xuICAgICAgICBzZWxmLl9yZW1vdmVQdWJsaXNoZWQoaWQpO1xuICAgICAgfSBlbHNlIGlmIChzZWxmLl91bnB1Ymxpc2hlZEJ1ZmZlci5oYXMoaWQpKSB7XG4gICAgICAgIHNlbGYuX3JlbW92ZUJ1ZmZlcmVkKGlkKTtcbiAgICAgIH1cbiAgICB9KTtcbiAgfSxcbiAgX2hhbmRsZURvYzogZnVuY3Rpb24gKGlkLCBuZXdEb2MpIHtcbiAgICB2YXIgc2VsZiA9IHRoaXM7XG4gICAgTWV0ZW9yLl9ub1lpZWxkc0FsbG93ZWQoZnVuY3Rpb24gKCkge1xuICAgICAgdmFyIG1hdGNoZXNOb3cgPSBuZXdEb2MgJiYgc2VsZi5fbWF0Y2hlci5kb2N1bWVudE1hdGNoZXMobmV3RG9jKS5yZXN1bHQ7XG5cbiAgICAgIHZhciBwdWJsaXNoZWRCZWZvcmUgPSBzZWxmLl9wdWJsaXNoZWQuaGFzKGlkKTtcbiAgICAgIHZhciBidWZmZXJlZEJlZm9yZSA9IHNlbGYuX2xpbWl0ICYmIHNlbGYuX3VucHVibGlzaGVkQnVmZmVyLmhhcyhpZCk7XG4gICAgICB2YXIgY2FjaGVkQmVmb3JlID0gcHVibGlzaGVkQmVmb3JlIHx8IGJ1ZmZlcmVkQmVmb3JlO1xuXG4gICAgICBpZiAobWF0Y2hlc05vdyAmJiAhY2FjaGVkQmVmb3JlKSB7XG4gICAgICAgIHNlbGYuX2FkZE1hdGNoaW5nKG5ld0RvYyk7XG4gICAgICB9IGVsc2UgaWYgKGNhY2hlZEJlZm9yZSAmJiAhbWF0Y2hlc05vdykge1xuICAgICAgICBzZWxmLl9yZW1vdmVNYXRjaGluZyhpZCk7XG4gICAgICB9IGVsc2UgaWYgKGNhY2hlZEJlZm9yZSAmJiBtYXRjaGVzTm93KSB7XG4gICAgICAgIHZhciBvbGREb2MgPSBzZWxmLl9wdWJsaXNoZWQuZ2V0KGlkKTtcbiAgICAgICAgdmFyIGNvbXBhcmF0b3IgPSBzZWxmLl9jb21wYXJhdG9yO1xuICAgICAgICB2YXIgbWluQnVmZmVyZWQgPSBzZWxmLl9saW1pdCAmJiBzZWxmLl91bnB1Ymxpc2hlZEJ1ZmZlci5zaXplKCkgJiZcbiAgICAgICAgICBzZWxmLl91bnB1Ymxpc2hlZEJ1ZmZlci5nZXQoc2VsZi5fdW5wdWJsaXNoZWRCdWZmZXIubWluRWxlbWVudElkKCkpO1xuICAgICAgICB2YXIgbWF4QnVmZmVyZWQ7XG5cbiAgICAgICAgaWYgKHB1Ymxpc2hlZEJlZm9yZSkge1xuICAgICAgICAgIC8vIFVubGltaXRlZCBjYXNlIHdoZXJlIHRoZSBkb2N1bWVudCBzdGF5cyBpbiBwdWJsaXNoZWQgb25jZSBpdFxuICAgICAgICAgIC8vIG1hdGNoZXMgb3IgdGhlIGNhc2Ugd2hlbiB3ZSBkb24ndCBoYXZlIGVub3VnaCBtYXRjaGluZyBkb2NzIHRvXG4gICAgICAgICAgLy8gcHVibGlzaCBvciB0aGUgY2hhbmdlZCBidXQgbWF0Y2hpbmcgZG9jIHdpbGwgc3RheSBpbiBwdWJsaXNoZWRcbiAgICAgICAgICAvLyBhbnl3YXlzLlxuICAgICAgICAgIC8vXG4gICAgICAgICAgLy8gWFhYOiBXZSByZWx5IG9uIHRoZSBlbXB0aW5lc3Mgb2YgYnVmZmVyLiBCZSBzdXJlIHRvIG1haW50YWluIHRoZVxuICAgICAgICAgIC8vIGZhY3QgdGhhdCBidWZmZXIgY2FuJ3QgYmUgZW1wdHkgaWYgdGhlcmUgYXJlIG1hdGNoaW5nIGRvY3VtZW50cyBub3RcbiAgICAgICAgICAvLyBwdWJsaXNoZWQuIE5vdGFibHksIHdlIGRvbid0IHdhbnQgdG8gc2NoZWR1bGUgcmVwb2xsIGFuZCBjb250aW51ZVxuICAgICAgICAgIC8vIHJlbHlpbmcgb24gdGhpcyBwcm9wZXJ0eS5cbiAgICAgICAgICB2YXIgc3RheXNJblB1Ymxpc2hlZCA9ICEgc2VsZi5fbGltaXQgfHxcbiAgICAgICAgICAgIHNlbGYuX3VucHVibGlzaGVkQnVmZmVyLnNpemUoKSA9PT0gMCB8fFxuICAgICAgICAgICAgY29tcGFyYXRvcihuZXdEb2MsIG1pbkJ1ZmZlcmVkKSA8PSAwO1xuXG4gICAgICAgICAgaWYgKHN0YXlzSW5QdWJsaXNoZWQpIHtcbiAgICAgICAgICAgIHNlbGYuX2NoYW5nZVB1Ymxpc2hlZChpZCwgb2xkRG9jLCBuZXdEb2MpO1xuICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAvLyBhZnRlciB0aGUgY2hhbmdlIGRvYyBkb2Vzbid0IHN0YXkgaW4gdGhlIHB1Ymxpc2hlZCwgcmVtb3ZlIGl0XG4gICAgICAgICAgICBzZWxmLl9yZW1vdmVQdWJsaXNoZWQoaWQpO1xuICAgICAgICAgICAgLy8gYnV0IGl0IGNhbiBtb3ZlIGludG8gYnVmZmVyZWQgbm93LCBjaGVjayBpdFxuICAgICAgICAgICAgbWF4QnVmZmVyZWQgPSBzZWxmLl91bnB1Ymxpc2hlZEJ1ZmZlci5nZXQoXG4gICAgICAgICAgICAgIHNlbGYuX3VucHVibGlzaGVkQnVmZmVyLm1heEVsZW1lbnRJZCgpKTtcblxuICAgICAgICAgICAgdmFyIHRvQnVmZmVyID0gc2VsZi5fc2FmZUFwcGVuZFRvQnVmZmVyIHx8XG4gICAgICAgICAgICAgICAgICAobWF4QnVmZmVyZWQgJiYgY29tcGFyYXRvcihuZXdEb2MsIG1heEJ1ZmZlcmVkKSA8PSAwKTtcblxuICAgICAgICAgICAgaWYgKHRvQnVmZmVyKSB7XG4gICAgICAgICAgICAgIHNlbGYuX2FkZEJ1ZmZlcmVkKGlkLCBuZXdEb2MpO1xuICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgLy8gVGhyb3cgYXdheSBmcm9tIGJvdGggcHVibGlzaGVkIHNldCBhbmQgYnVmZmVyXG4gICAgICAgICAgICAgIHNlbGYuX3NhZmVBcHBlbmRUb0J1ZmZlciA9IGZhbHNlO1xuICAgICAgICAgICAgfVxuICAgICAgICAgIH1cbiAgICAgICAgfSBlbHNlIGlmIChidWZmZXJlZEJlZm9yZSkge1xuICAgICAgICAgIG9sZERvYyA9IHNlbGYuX3VucHVibGlzaGVkQnVmZmVyLmdldChpZCk7XG4gICAgICAgICAgLy8gcmVtb3ZlIHRoZSBvbGQgdmVyc2lvbiBtYW51YWxseSBpbnN0ZWFkIG9mIHVzaW5nIF9yZW1vdmVCdWZmZXJlZCBzb1xuICAgICAgICAgIC8vIHdlIGRvbid0IHRyaWdnZXIgdGhlIHF1ZXJ5aW5nIGltbWVkaWF0ZWx5LiAgaWYgd2UgZW5kIHRoaXMgYmxvY2tcbiAgICAgICAgICAvLyB3aXRoIHRoZSBidWZmZXIgZW1wdHksIHdlIHdpbGwgbmVlZCB0byB0cmlnZ2VyIHRoZSBxdWVyeSBwb2xsXG4gICAgICAgICAgLy8gbWFudWFsbHkgdG9vLlxuICAgICAgICAgIHNlbGYuX3VucHVibGlzaGVkQnVmZmVyLnJlbW92ZShpZCk7XG5cbiAgICAgICAgICB2YXIgbWF4UHVibGlzaGVkID0gc2VsZi5fcHVibGlzaGVkLmdldChcbiAgICAgICAgICAgIHNlbGYuX3B1Ymxpc2hlZC5tYXhFbGVtZW50SWQoKSk7XG4gICAgICAgICAgbWF4QnVmZmVyZWQgPSBzZWxmLl91bnB1Ymxpc2hlZEJ1ZmZlci5zaXplKCkgJiZcbiAgICAgICAgICAgICAgICBzZWxmLl91bnB1Ymxpc2hlZEJ1ZmZlci5nZXQoXG4gICAgICAgICAgICAgICAgICBzZWxmLl91bnB1Ymxpc2hlZEJ1ZmZlci5tYXhFbGVtZW50SWQoKSk7XG5cbiAgICAgICAgICAvLyB0aGUgYnVmZmVyZWQgZG9jIHdhcyB1cGRhdGVkLCBpdCBjb3VsZCBtb3ZlIHRvIHB1Ymxpc2hlZFxuICAgICAgICAgIHZhciB0b1B1Ymxpc2ggPSBjb21wYXJhdG9yKG5ld0RvYywgbWF4UHVibGlzaGVkKSA8IDA7XG5cbiAgICAgICAgICAvLyBvciBzdGF5cyBpbiBidWZmZXIgZXZlbiBhZnRlciB0aGUgY2hhbmdlXG4gICAgICAgICAgdmFyIHN0YXlzSW5CdWZmZXIgPSAoISB0b1B1Ymxpc2ggJiYgc2VsZi5fc2FmZUFwcGVuZFRvQnVmZmVyKSB8fFxuICAgICAgICAgICAgICAgICghdG9QdWJsaXNoICYmIG1heEJ1ZmZlcmVkICYmXG4gICAgICAgICAgICAgICAgIGNvbXBhcmF0b3IobmV3RG9jLCBtYXhCdWZmZXJlZCkgPD0gMCk7XG5cbiAgICAgICAgICBpZiAodG9QdWJsaXNoKSB7XG4gICAgICAgICAgICBzZWxmLl9hZGRQdWJsaXNoZWQoaWQsIG5ld0RvYyk7XG4gICAgICAgICAgfSBlbHNlIGlmIChzdGF5c0luQnVmZmVyKSB7XG4gICAgICAgICAgICAvLyBzdGF5cyBpbiBidWZmZXIgYnV0IGNoYW5nZXNcbiAgICAgICAgICAgIHNlbGYuX3VucHVibGlzaGVkQnVmZmVyLnNldChpZCwgbmV3RG9jKTtcbiAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgLy8gVGhyb3cgYXdheSBmcm9tIGJvdGggcHVibGlzaGVkIHNldCBhbmQgYnVmZmVyXG4gICAgICAgICAgICBzZWxmLl9zYWZlQXBwZW5kVG9CdWZmZXIgPSBmYWxzZTtcbiAgICAgICAgICAgIC8vIE5vcm1hbGx5IHRoaXMgY2hlY2sgd291bGQgaGF2ZSBiZWVuIGRvbmUgaW4gX3JlbW92ZUJ1ZmZlcmVkIGJ1dFxuICAgICAgICAgICAgLy8gd2UgZGlkbid0IHVzZSBpdCwgc28gd2UgbmVlZCB0byBkbyBpdCBvdXJzZWxmIG5vdy5cbiAgICAgICAgICAgIGlmICghIHNlbGYuX3VucHVibGlzaGVkQnVmZmVyLnNpemUoKSkge1xuICAgICAgICAgICAgICBzZWxmLl9uZWVkVG9Qb2xsUXVlcnkoKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICB9XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgdGhyb3cgbmV3IEVycm9yKFwiY2FjaGVkQmVmb3JlIGltcGxpZXMgZWl0aGVyIG9mIHB1Ymxpc2hlZEJlZm9yZSBvciBidWZmZXJlZEJlZm9yZSBpcyB0cnVlLlwiKTtcbiAgICAgICAgfVxuICAgICAgfVxuICAgIH0pO1xuICB9LFxuICBfZmV0Y2hNb2RpZmllZERvY3VtZW50czogZnVuY3Rpb24gKCkge1xuICAgIHZhciBzZWxmID0gdGhpcztcbiAgICBNZXRlb3IuX25vWWllbGRzQWxsb3dlZChmdW5jdGlvbiAoKSB7XG4gICAgICBzZWxmLl9yZWdpc3RlclBoYXNlQ2hhbmdlKFBIQVNFLkZFVENISU5HKTtcbiAgICAgIC8vIERlZmVyLCBiZWNhdXNlIG5vdGhpbmcgY2FsbGVkIGZyb20gdGhlIG9wbG9nIGVudHJ5IGhhbmRsZXIgbWF5IHlpZWxkLFxuICAgICAgLy8gYnV0IGZldGNoKCkgeWllbGRzLlxuICAgICAgTWV0ZW9yLmRlZmVyKGZpbmlzaElmTmVlZFRvUG9sbFF1ZXJ5KGZ1bmN0aW9uICgpIHtcbiAgICAgICAgd2hpbGUgKCFzZWxmLl9zdG9wcGVkICYmICFzZWxmLl9uZWVkVG9GZXRjaC5lbXB0eSgpKSB7XG4gICAgICAgICAgaWYgKHNlbGYuX3BoYXNlID09PSBQSEFTRS5RVUVSWUlORykge1xuICAgICAgICAgICAgLy8gV2hpbGUgZmV0Y2hpbmcsIHdlIGRlY2lkZWQgdG8gZ28gaW50byBRVUVSWUlORyBtb2RlLCBhbmQgdGhlbiB3ZVxuICAgICAgICAgICAgLy8gc2F3IGFub3RoZXIgb3Bsb2cgZW50cnksIHNvIF9uZWVkVG9GZXRjaCBpcyBub3QgZW1wdHkuIEJ1dCB3ZVxuICAgICAgICAgICAgLy8gc2hvdWxkbid0IGZldGNoIHRoZXNlIGRvY3VtZW50cyB1bnRpbCBBRlRFUiB0aGUgcXVlcnkgaXMgZG9uZS5cbiAgICAgICAgICAgIGJyZWFrO1xuICAgICAgICAgIH1cblxuICAgICAgICAgIC8vIEJlaW5nIGluIHN0ZWFkeSBwaGFzZSBoZXJlIHdvdWxkIGJlIHN1cnByaXNpbmcuXG4gICAgICAgICAgaWYgKHNlbGYuX3BoYXNlICE9PSBQSEFTRS5GRVRDSElORylcbiAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcihcInBoYXNlIGluIGZldGNoTW9kaWZpZWREb2N1bWVudHM6IFwiICsgc2VsZi5fcGhhc2UpO1xuXG4gICAgICAgICAgc2VsZi5fY3VycmVudGx5RmV0Y2hpbmcgPSBzZWxmLl9uZWVkVG9GZXRjaDtcbiAgICAgICAgICB2YXIgdGhpc0dlbmVyYXRpb24gPSArK3NlbGYuX2ZldGNoR2VuZXJhdGlvbjtcbiAgICAgICAgICBzZWxmLl9uZWVkVG9GZXRjaCA9IG5ldyBMb2NhbENvbGxlY3Rpb24uX0lkTWFwO1xuICAgICAgICAgIHZhciB3YWl0aW5nID0gMDtcbiAgICAgICAgICB2YXIgZnV0ID0gbmV3IEZ1dHVyZTtcbiAgICAgICAgICAvLyBUaGlzIGxvb3AgaXMgc2FmZSwgYmVjYXVzZSBfY3VycmVudGx5RmV0Y2hpbmcgd2lsbCBub3QgYmUgdXBkYXRlZFxuICAgICAgICAgIC8vIGR1cmluZyB0aGlzIGxvb3AgKGluIGZhY3QsIGl0IGlzIG5ldmVyIG11dGF0ZWQpLlxuICAgICAgICAgIHNlbGYuX2N1cnJlbnRseUZldGNoaW5nLmZvckVhY2goZnVuY3Rpb24gKG9wLCBpZCkge1xuICAgICAgICAgICAgd2FpdGluZysrO1xuICAgICAgICAgICAgc2VsZi5fbW9uZ29IYW5kbGUuX2RvY0ZldGNoZXIuZmV0Y2goXG4gICAgICAgICAgICAgIHNlbGYuX2N1cnNvckRlc2NyaXB0aW9uLmNvbGxlY3Rpb25OYW1lLCBpZCwgb3AsXG4gICAgICAgICAgICAgIGZpbmlzaElmTmVlZFRvUG9sbFF1ZXJ5KGZ1bmN0aW9uIChlcnIsIGRvYykge1xuICAgICAgICAgICAgICAgIHRyeSB7XG4gICAgICAgICAgICAgICAgICBpZiAoZXJyKSB7XG4gICAgICAgICAgICAgICAgICAgIE1ldGVvci5fZGVidWcoXCJHb3QgZXhjZXB0aW9uIHdoaWxlIGZldGNoaW5nIGRvY3VtZW50c1wiLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGVycik7XG4gICAgICAgICAgICAgICAgICAgIC8vIElmIHdlIGdldCBhbiBlcnJvciBmcm9tIHRoZSBmZXRjaGVyIChlZywgdHJvdWJsZVxuICAgICAgICAgICAgICAgICAgICAvLyBjb25uZWN0aW5nIHRvIE1vbmdvKSwgbGV0J3MganVzdCBhYmFuZG9uIHRoZSBmZXRjaCBwaGFzZVxuICAgICAgICAgICAgICAgICAgICAvLyBhbHRvZ2V0aGVyIGFuZCBmYWxsIGJhY2sgdG8gcG9sbGluZy4gSXQncyBub3QgbGlrZSB3ZSdyZVxuICAgICAgICAgICAgICAgICAgICAvLyBnZXR0aW5nIGxpdmUgdXBkYXRlcyBhbnl3YXkuXG4gICAgICAgICAgICAgICAgICAgIGlmIChzZWxmLl9waGFzZSAhPT0gUEhBU0UuUVVFUllJTkcpIHtcbiAgICAgICAgICAgICAgICAgICAgICBzZWxmLl9uZWVkVG9Qb2xsUXVlcnkoKTtcbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgfSBlbHNlIGlmICghc2VsZi5fc3RvcHBlZCAmJiBzZWxmLl9waGFzZSA9PT0gUEhBU0UuRkVUQ0hJTkdcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgJiYgc2VsZi5fZmV0Y2hHZW5lcmF0aW9uID09PSB0aGlzR2VuZXJhdGlvbikge1xuICAgICAgICAgICAgICAgICAgICAvLyBXZSByZS1jaGVjayB0aGUgZ2VuZXJhdGlvbiBpbiBjYXNlIHdlJ3ZlIGhhZCBhbiBleHBsaWNpdFxuICAgICAgICAgICAgICAgICAgICAvLyBfcG9sbFF1ZXJ5IGNhbGwgKGVnLCBpbiBhbm90aGVyIGZpYmVyKSB3aGljaCBzaG91bGRcbiAgICAgICAgICAgICAgICAgICAgLy8gZWZmZWN0aXZlbHkgY2FuY2VsIHRoaXMgcm91bmQgb2YgZmV0Y2hlcy4gIChfcG9sbFF1ZXJ5XG4gICAgICAgICAgICAgICAgICAgIC8vIGluY3JlbWVudHMgdGhlIGdlbmVyYXRpb24uKVxuICAgICAgICAgICAgICAgICAgICBzZWxmLl9oYW5kbGVEb2MoaWQsIGRvYyk7XG4gICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgfSBmaW5hbGx5IHtcbiAgICAgICAgICAgICAgICAgIHdhaXRpbmctLTtcbiAgICAgICAgICAgICAgICAgIC8vIEJlY2F1c2UgZmV0Y2goKSBuZXZlciBjYWxscyBpdHMgY2FsbGJhY2sgc3luY2hyb25vdXNseSxcbiAgICAgICAgICAgICAgICAgIC8vIHRoaXMgaXMgc2FmZSAoaWUsIHdlIHdvbid0IGNhbGwgZnV0LnJldHVybigpIGJlZm9yZSB0aGVcbiAgICAgICAgICAgICAgICAgIC8vIGZvckVhY2ggaXMgZG9uZSkuXG4gICAgICAgICAgICAgICAgICBpZiAod2FpdGluZyA9PT0gMClcbiAgICAgICAgICAgICAgICAgICAgZnV0LnJldHVybigpO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgfSkpO1xuICAgICAgICAgIH0pO1xuICAgICAgICAgIGZ1dC53YWl0KCk7XG4gICAgICAgICAgLy8gRXhpdCBub3cgaWYgd2UndmUgaGFkIGEgX3BvbGxRdWVyeSBjYWxsIChoZXJlIG9yIGluIGFub3RoZXIgZmliZXIpLlxuICAgICAgICAgIGlmIChzZWxmLl9waGFzZSA9PT0gUEhBU0UuUVVFUllJTkcpXG4gICAgICAgICAgICByZXR1cm47XG4gICAgICAgICAgc2VsZi5fY3VycmVudGx5RmV0Y2hpbmcgPSBudWxsO1xuICAgICAgICB9XG4gICAgICAgIC8vIFdlJ3JlIGRvbmUgZmV0Y2hpbmcsIHNvIHdlIGNhbiBiZSBzdGVhZHksIHVubGVzcyB3ZSd2ZSBoYWQgYVxuICAgICAgICAvLyBfcG9sbFF1ZXJ5IGNhbGwgKGhlcmUgb3IgaW4gYW5vdGhlciBmaWJlcikuXG4gICAgICAgIGlmIChzZWxmLl9waGFzZSAhPT0gUEhBU0UuUVVFUllJTkcpXG4gICAgICAgICAgc2VsZi5fYmVTdGVhZHkoKTtcbiAgICAgIH0pKTtcbiAgICB9KTtcbiAgfSxcbiAgX2JlU3RlYWR5OiBmdW5jdGlvbiAoKSB7XG4gICAgdmFyIHNlbGYgPSB0aGlzO1xuICAgIE1ldGVvci5fbm9ZaWVsZHNBbGxvd2VkKGZ1bmN0aW9uICgpIHtcbiAgICAgIHNlbGYuX3JlZ2lzdGVyUGhhc2VDaGFuZ2UoUEhBU0UuU1RFQURZKTtcbiAgICAgIHZhciB3cml0ZXMgPSBzZWxmLl93cml0ZXNUb0NvbW1pdFdoZW5XZVJlYWNoU3RlYWR5O1xuICAgICAgc2VsZi5fd3JpdGVzVG9Db21taXRXaGVuV2VSZWFjaFN0ZWFkeSA9IFtdO1xuICAgICAgc2VsZi5fbXVsdGlwbGV4ZXIub25GbHVzaChmdW5jdGlvbiAoKSB7XG4gICAgICAgIF8uZWFjaCh3cml0ZXMsIGZ1bmN0aW9uICh3KSB7XG4gICAgICAgICAgdy5jb21taXR0ZWQoKTtcbiAgICAgICAgfSk7XG4gICAgICB9KTtcbiAgICB9KTtcbiAgfSxcbiAgX2hhbmRsZU9wbG9nRW50cnlRdWVyeWluZzogZnVuY3Rpb24gKG9wKSB7XG4gICAgdmFyIHNlbGYgPSB0aGlzO1xuICAgIE1ldGVvci5fbm9ZaWVsZHNBbGxvd2VkKGZ1bmN0aW9uICgpIHtcbiAgICAgIHNlbGYuX25lZWRUb0ZldGNoLnNldChpZEZvck9wKG9wKSwgb3ApO1xuICAgIH0pO1xuICB9LFxuICBfaGFuZGxlT3Bsb2dFbnRyeVN0ZWFkeU9yRmV0Y2hpbmc6IGZ1bmN0aW9uIChvcCkge1xuICAgIHZhciBzZWxmID0gdGhpcztcbiAgICBNZXRlb3IuX25vWWllbGRzQWxsb3dlZChmdW5jdGlvbiAoKSB7XG4gICAgICB2YXIgaWQgPSBpZEZvck9wKG9wKTtcbiAgICAgIC8vIElmIHdlJ3JlIGFscmVhZHkgZmV0Y2hpbmcgdGhpcyBvbmUsIG9yIGFib3V0IHRvLCB3ZSBjYW4ndCBvcHRpbWl6ZTtcbiAgICAgIC8vIG1ha2Ugc3VyZSB0aGF0IHdlIGZldGNoIGl0IGFnYWluIGlmIG5lY2Vzc2FyeS5cbiAgICAgIGlmIChzZWxmLl9waGFzZSA9PT0gUEhBU0UuRkVUQ0hJTkcgJiZcbiAgICAgICAgICAoKHNlbGYuX2N1cnJlbnRseUZldGNoaW5nICYmIHNlbGYuX2N1cnJlbnRseUZldGNoaW5nLmhhcyhpZCkpIHx8XG4gICAgICAgICAgIHNlbGYuX25lZWRUb0ZldGNoLmhhcyhpZCkpKSB7XG4gICAgICAgIHNlbGYuX25lZWRUb0ZldGNoLnNldChpZCwgb3ApO1xuICAgICAgICByZXR1cm47XG4gICAgICB9XG5cbiAgICAgIGlmIChvcC5vcCA9PT0gJ2QnKSB7XG4gICAgICAgIGlmIChzZWxmLl9wdWJsaXNoZWQuaGFzKGlkKSB8fFxuICAgICAgICAgICAgKHNlbGYuX2xpbWl0ICYmIHNlbGYuX3VucHVibGlzaGVkQnVmZmVyLmhhcyhpZCkpKVxuICAgICAgICAgIHNlbGYuX3JlbW92ZU1hdGNoaW5nKGlkKTtcbiAgICAgIH0gZWxzZSBpZiAob3Aub3AgPT09ICdpJykge1xuICAgICAgICBpZiAoc2VsZi5fcHVibGlzaGVkLmhhcyhpZCkpXG4gICAgICAgICAgdGhyb3cgbmV3IEVycm9yKFwiaW5zZXJ0IGZvdW5kIGZvciBhbHJlYWR5LWV4aXN0aW5nIElEIGluIHB1Ymxpc2hlZFwiKTtcbiAgICAgICAgaWYgKHNlbGYuX3VucHVibGlzaGVkQnVmZmVyICYmIHNlbGYuX3VucHVibGlzaGVkQnVmZmVyLmhhcyhpZCkpXG4gICAgICAgICAgdGhyb3cgbmV3IEVycm9yKFwiaW5zZXJ0IGZvdW5kIGZvciBhbHJlYWR5LWV4aXN0aW5nIElEIGluIGJ1ZmZlclwiKTtcblxuICAgICAgICAvLyBYWFggd2hhdCBpZiBzZWxlY3RvciB5aWVsZHM/ICBmb3Igbm93IGl0IGNhbid0IGJ1dCBsYXRlciBpdCBjb3VsZFxuICAgICAgICAvLyBoYXZlICR3aGVyZVxuICAgICAgICBpZiAoc2VsZi5fbWF0Y2hlci5kb2N1bWVudE1hdGNoZXMob3AubykucmVzdWx0KVxuICAgICAgICAgIHNlbGYuX2FkZE1hdGNoaW5nKG9wLm8pO1xuICAgICAgfSBlbHNlIGlmIChvcC5vcCA9PT0gJ3UnKSB7XG4gICAgICAgIC8vIElzIHRoaXMgYSBtb2RpZmllciAoJHNldC8kdW5zZXQsIHdoaWNoIG1heSByZXF1aXJlIHVzIHRvIHBvbGwgdGhlXG4gICAgICAgIC8vIGRhdGFiYXNlIHRvIGZpZ3VyZSBvdXQgaWYgdGhlIHdob2xlIGRvY3VtZW50IG1hdGNoZXMgdGhlIHNlbGVjdG9yKSBvclxuICAgICAgICAvLyBhIHJlcGxhY2VtZW50IChpbiB3aGljaCBjYXNlIHdlIGNhbiBqdXN0IGRpcmVjdGx5IHJlLWV2YWx1YXRlIHRoZVxuICAgICAgICAvLyBzZWxlY3Rvcik/XG4gICAgICAgIHZhciBpc1JlcGxhY2UgPSAhXy5oYXMob3AubywgJyRzZXQnKSAmJiAhXy5oYXMob3AubywgJyR1bnNldCcpO1xuICAgICAgICAvLyBJZiB0aGlzIG1vZGlmaWVyIG1vZGlmaWVzIHNvbWV0aGluZyBpbnNpZGUgYW4gRUpTT04gY3VzdG9tIHR5cGUgKGllLFxuICAgICAgICAvLyBhbnl0aGluZyB3aXRoIEVKU09OJCksIHRoZW4gd2UgY2FuJ3QgdHJ5IHRvIHVzZVxuICAgICAgICAvLyBMb2NhbENvbGxlY3Rpb24uX21vZGlmeSwgc2luY2UgdGhhdCBqdXN0IG11dGF0ZXMgdGhlIEVKU09OIGVuY29kaW5nLFxuICAgICAgICAvLyBub3QgdGhlIGFjdHVhbCBvYmplY3QuXG4gICAgICAgIHZhciBjYW5EaXJlY3RseU1vZGlmeURvYyA9XG4gICAgICAgICAgIWlzUmVwbGFjZSAmJiBtb2RpZmllckNhbkJlRGlyZWN0bHlBcHBsaWVkKG9wLm8pO1xuXG4gICAgICAgIHZhciBwdWJsaXNoZWRCZWZvcmUgPSBzZWxmLl9wdWJsaXNoZWQuaGFzKGlkKTtcbiAgICAgICAgdmFyIGJ1ZmZlcmVkQmVmb3JlID0gc2VsZi5fbGltaXQgJiYgc2VsZi5fdW5wdWJsaXNoZWRCdWZmZXIuaGFzKGlkKTtcblxuICAgICAgICBpZiAoaXNSZXBsYWNlKSB7XG4gICAgICAgICAgc2VsZi5faGFuZGxlRG9jKGlkLCBfLmV4dGVuZCh7X2lkOiBpZH0sIG9wLm8pKTtcbiAgICAgICAgfSBlbHNlIGlmICgocHVibGlzaGVkQmVmb3JlIHx8IGJ1ZmZlcmVkQmVmb3JlKSAmJlxuICAgICAgICAgICAgICAgICAgIGNhbkRpcmVjdGx5TW9kaWZ5RG9jKSB7XG4gICAgICAgICAgLy8gT2ggZ3JlYXQsIHdlIGFjdHVhbGx5IGtub3cgd2hhdCB0aGUgZG9jdW1lbnQgaXMsIHNvIHdlIGNhbiBhcHBseVxuICAgICAgICAgIC8vIHRoaXMgZGlyZWN0bHkuXG4gICAgICAgICAgdmFyIG5ld0RvYyA9IHNlbGYuX3B1Ymxpc2hlZC5oYXMoaWQpXG4gICAgICAgICAgICA/IHNlbGYuX3B1Ymxpc2hlZC5nZXQoaWQpIDogc2VsZi5fdW5wdWJsaXNoZWRCdWZmZXIuZ2V0KGlkKTtcbiAgICAgICAgICBuZXdEb2MgPSBFSlNPTi5jbG9uZShuZXdEb2MpO1xuXG4gICAgICAgICAgbmV3RG9jLl9pZCA9IGlkO1xuICAgICAgICAgIHRyeSB7XG4gICAgICAgICAgICBMb2NhbENvbGxlY3Rpb24uX21vZGlmeShuZXdEb2MsIG9wLm8pO1xuICAgICAgICAgIH0gY2F0Y2ggKGUpIHtcbiAgICAgICAgICAgIGlmIChlLm5hbWUgIT09IFwiTWluaW1vbmdvRXJyb3JcIilcbiAgICAgICAgICAgICAgdGhyb3cgZTtcbiAgICAgICAgICAgIC8vIFdlIGRpZG4ndCB1bmRlcnN0YW5kIHRoZSBtb2RpZmllci4gIFJlLWZldGNoLlxuICAgICAgICAgICAgc2VsZi5fbmVlZFRvRmV0Y2guc2V0KGlkLCBvcCk7XG4gICAgICAgICAgICBpZiAoc2VsZi5fcGhhc2UgPT09IFBIQVNFLlNURUFEWSkge1xuICAgICAgICAgICAgICBzZWxmLl9mZXRjaE1vZGlmaWVkRG9jdW1lbnRzKCk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICByZXR1cm47XG4gICAgICAgICAgfVxuICAgICAgICAgIHNlbGYuX2hhbmRsZURvYyhpZCwgc2VsZi5fc2hhcmVkUHJvamVjdGlvbkZuKG5ld0RvYykpO1xuICAgICAgICB9IGVsc2UgaWYgKCFjYW5EaXJlY3RseU1vZGlmeURvYyB8fFxuICAgICAgICAgICAgICAgICAgIHNlbGYuX21hdGNoZXIuY2FuQmVjb21lVHJ1ZUJ5TW9kaWZpZXIob3AubykgfHxcbiAgICAgICAgICAgICAgICAgICAoc2VsZi5fc29ydGVyICYmIHNlbGYuX3NvcnRlci5hZmZlY3RlZEJ5TW9kaWZpZXIob3AubykpKSB7XG4gICAgICAgICAgc2VsZi5fbmVlZFRvRmV0Y2guc2V0KGlkLCBvcCk7XG4gICAgICAgICAgaWYgKHNlbGYuX3BoYXNlID09PSBQSEFTRS5TVEVBRFkpXG4gICAgICAgICAgICBzZWxmLl9mZXRjaE1vZGlmaWVkRG9jdW1lbnRzKCk7XG4gICAgICAgIH1cbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIHRocm93IEVycm9yKFwiWFhYIFNVUlBSSVNJTkcgT1BFUkFUSU9OOiBcIiArIG9wKTtcbiAgICAgIH1cbiAgICB9KTtcbiAgfSxcbiAgLy8gWWllbGRzIVxuICBfcnVuSW5pdGlhbFF1ZXJ5OiBmdW5jdGlvbiAoKSB7XG4gICAgdmFyIHNlbGYgPSB0aGlzO1xuICAgIGlmIChzZWxmLl9zdG9wcGVkKVxuICAgICAgdGhyb3cgbmV3IEVycm9yKFwib3Bsb2cgc3RvcHBlZCBzdXJwcmlzaW5nbHkgZWFybHlcIik7XG5cbiAgICBzZWxmLl9ydW5RdWVyeSh7aW5pdGlhbDogdHJ1ZX0pOyAgLy8geWllbGRzXG5cbiAgICBpZiAoc2VsZi5fc3RvcHBlZClcbiAgICAgIHJldHVybjsgIC8vIGNhbiBoYXBwZW4gb24gcXVlcnlFcnJvclxuXG4gICAgLy8gQWxsb3cgb2JzZXJ2ZUNoYW5nZXMgY2FsbHMgdG8gcmV0dXJuLiAoQWZ0ZXIgdGhpcywgaXQncyBwb3NzaWJsZSBmb3JcbiAgICAvLyBzdG9wKCkgdG8gYmUgY2FsbGVkLilcbiAgICBzZWxmLl9tdWx0aXBsZXhlci5yZWFkeSgpO1xuXG4gICAgc2VsZi5fZG9uZVF1ZXJ5aW5nKCk7ICAvLyB5aWVsZHNcbiAgfSxcblxuICAvLyBJbiB2YXJpb3VzIGNpcmN1bXN0YW5jZXMsIHdlIG1heSBqdXN0IHdhbnQgdG8gc3RvcCBwcm9jZXNzaW5nIHRoZSBvcGxvZyBhbmRcbiAgLy8gcmUtcnVuIHRoZSBpbml0aWFsIHF1ZXJ5LCBqdXN0IGFzIGlmIHdlIHdlcmUgYSBQb2xsaW5nT2JzZXJ2ZURyaXZlci5cbiAgLy9cbiAgLy8gVGhpcyBmdW5jdGlvbiBtYXkgbm90IGJsb2NrLCBiZWNhdXNlIGl0IGlzIGNhbGxlZCBmcm9tIGFuIG9wbG9nIGVudHJ5XG4gIC8vIGhhbmRsZXIuXG4gIC8vXG4gIC8vIFhYWCBXZSBzaG91bGQgY2FsbCB0aGlzIHdoZW4gd2UgZGV0ZWN0IHRoYXQgd2UndmUgYmVlbiBpbiBGRVRDSElORyBmb3IgXCJ0b29cbiAgLy8gbG9uZ1wiLlxuICAvL1xuICAvLyBYWFggV2Ugc2hvdWxkIGNhbGwgdGhpcyB3aGVuIHdlIGRldGVjdCBNb25nbyBmYWlsb3ZlciAoc2luY2UgdGhhdCBtaWdodFxuICAvLyBtZWFuIHRoYXQgc29tZSBvZiB0aGUgb3Bsb2cgZW50cmllcyB3ZSBoYXZlIHByb2Nlc3NlZCBoYXZlIGJlZW4gcm9sbGVkXG4gIC8vIGJhY2spLiBUaGUgTm9kZSBNb25nbyBkcml2ZXIgaXMgaW4gdGhlIG1pZGRsZSBvZiBhIGJ1bmNoIG9mIGh1Z2VcbiAgLy8gcmVmYWN0b3JpbmdzLCBpbmNsdWRpbmcgdGhlIHdheSB0aGF0IGl0IG5vdGlmaWVzIHlvdSB3aGVuIHByaW1hcnlcbiAgLy8gY2hhbmdlcy4gV2lsbCBwdXQgb2ZmIGltcGxlbWVudGluZyB0aGlzIHVudGlsIGRyaXZlciAxLjQgaXMgb3V0LlxuICBfcG9sbFF1ZXJ5OiBmdW5jdGlvbiAoKSB7XG4gICAgdmFyIHNlbGYgPSB0aGlzO1xuICAgIE1ldGVvci5fbm9ZaWVsZHNBbGxvd2VkKGZ1bmN0aW9uICgpIHtcbiAgICAgIGlmIChzZWxmLl9zdG9wcGVkKVxuICAgICAgICByZXR1cm47XG5cbiAgICAgIC8vIFlheSwgd2UgZ2V0IHRvIGZvcmdldCBhYm91dCBhbGwgdGhlIHRoaW5ncyB3ZSB0aG91Z2h0IHdlIGhhZCB0byBmZXRjaC5cbiAgICAgIHNlbGYuX25lZWRUb0ZldGNoID0gbmV3IExvY2FsQ29sbGVjdGlvbi5fSWRNYXA7XG4gICAgICBzZWxmLl9jdXJyZW50bHlGZXRjaGluZyA9IG51bGw7XG4gICAgICArK3NlbGYuX2ZldGNoR2VuZXJhdGlvbjsgIC8vIGlnbm9yZSBhbnkgaW4tZmxpZ2h0IGZldGNoZXNcbiAgICAgIHNlbGYuX3JlZ2lzdGVyUGhhc2VDaGFuZ2UoUEhBU0UuUVVFUllJTkcpO1xuXG4gICAgICAvLyBEZWZlciBzbyB0aGF0IHdlIGRvbid0IHlpZWxkLiAgV2UgZG9uJ3QgbmVlZCBmaW5pc2hJZk5lZWRUb1BvbGxRdWVyeVxuICAgICAgLy8gaGVyZSBiZWNhdXNlIFN3aXRjaGVkVG9RdWVyeSBpcyBub3QgdGhyb3duIGluIFFVRVJZSU5HIG1vZGUuXG4gICAgICBNZXRlb3IuZGVmZXIoZnVuY3Rpb24gKCkge1xuICAgICAgICBzZWxmLl9ydW5RdWVyeSgpO1xuICAgICAgICBzZWxmLl9kb25lUXVlcnlpbmcoKTtcbiAgICAgIH0pO1xuICAgIH0pO1xuICB9LFxuXG4gIC8vIFlpZWxkcyFcbiAgX3J1blF1ZXJ5OiBmdW5jdGlvbiAob3B0aW9ucykge1xuICAgIHZhciBzZWxmID0gdGhpcztcbiAgICBvcHRpb25zID0gb3B0aW9ucyB8fCB7fTtcbiAgICB2YXIgbmV3UmVzdWx0cywgbmV3QnVmZmVyO1xuXG4gICAgLy8gVGhpcyB3aGlsZSBsb29wIGlzIGp1c3QgdG8gcmV0cnkgZmFpbHVyZXMuXG4gICAgd2hpbGUgKHRydWUpIHtcbiAgICAgIC8vIElmIHdlJ3ZlIGJlZW4gc3RvcHBlZCwgd2UgZG9uJ3QgaGF2ZSB0byBydW4gYW55dGhpbmcgYW55IG1vcmUuXG4gICAgICBpZiAoc2VsZi5fc3RvcHBlZClcbiAgICAgICAgcmV0dXJuO1xuXG4gICAgICBuZXdSZXN1bHRzID0gbmV3IExvY2FsQ29sbGVjdGlvbi5fSWRNYXA7XG4gICAgICBuZXdCdWZmZXIgPSBuZXcgTG9jYWxDb2xsZWN0aW9uLl9JZE1hcDtcblxuICAgICAgLy8gUXVlcnkgMnggZG9jdW1lbnRzIGFzIHRoZSBoYWxmIGV4Y2x1ZGVkIGZyb20gdGhlIG9yaWdpbmFsIHF1ZXJ5IHdpbGwgZ29cbiAgICAgIC8vIGludG8gdW5wdWJsaXNoZWQgYnVmZmVyIHRvIHJlZHVjZSBhZGRpdGlvbmFsIE1vbmdvIGxvb2t1cHMgaW4gY2FzZXNcbiAgICAgIC8vIHdoZW4gZG9jdW1lbnRzIGFyZSByZW1vdmVkIGZyb20gdGhlIHB1Ymxpc2hlZCBzZXQgYW5kIG5lZWQgYVxuICAgICAgLy8gcmVwbGFjZW1lbnQuXG4gICAgICAvLyBYWFggbmVlZHMgbW9yZSB0aG91Z2h0IG9uIG5vbi16ZXJvIHNraXBcbiAgICAgIC8vIFhYWCAyIGlzIGEgXCJtYWdpYyBudW1iZXJcIiBtZWFuaW5nIHRoZXJlIGlzIGFuIGV4dHJhIGNodW5rIG9mIGRvY3MgZm9yXG4gICAgICAvLyBidWZmZXIgaWYgc3VjaCBpcyBuZWVkZWQuXG4gICAgICB2YXIgY3Vyc29yID0gc2VsZi5fY3Vyc29yRm9yUXVlcnkoeyBsaW1pdDogc2VsZi5fbGltaXQgKiAyIH0pO1xuICAgICAgdHJ5IHtcbiAgICAgICAgY3Vyc29yLmZvckVhY2goZnVuY3Rpb24gKGRvYywgaSkgeyAgLy8geWllbGRzXG4gICAgICAgICAgaWYgKCFzZWxmLl9saW1pdCB8fCBpIDwgc2VsZi5fbGltaXQpIHtcbiAgICAgICAgICAgIG5ld1Jlc3VsdHMuc2V0KGRvYy5faWQsIGRvYyk7XG4gICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIG5ld0J1ZmZlci5zZXQoZG9jLl9pZCwgZG9jKTtcbiAgICAgICAgICB9XG4gICAgICAgIH0pO1xuICAgICAgICBicmVhaztcbiAgICAgIH0gY2F0Y2ggKGUpIHtcbiAgICAgICAgaWYgKG9wdGlvbnMuaW5pdGlhbCAmJiB0eXBlb2YoZS5jb2RlKSA9PT0gJ251bWJlcicpIHtcbiAgICAgICAgICAvLyBUaGlzIGlzIGFuIGVycm9yIGRvY3VtZW50IHNlbnQgdG8gdXMgYnkgbW9uZ29kLCBub3QgYSBjb25uZWN0aW9uXG4gICAgICAgICAgLy8gZXJyb3IgZ2VuZXJhdGVkIGJ5IHRoZSBjbGllbnQuIEFuZCB3ZSd2ZSBuZXZlciBzZWVuIHRoaXMgcXVlcnkgd29ya1xuICAgICAgICAgIC8vIHN1Y2Nlc3NmdWxseS4gUHJvYmFibHkgaXQncyBhIGJhZCBzZWxlY3RvciBvciBzb21ldGhpbmcsIHNvIHdlXG4gICAgICAgICAgLy8gc2hvdWxkIE5PVCByZXRyeS4gSW5zdGVhZCwgd2Ugc2hvdWxkIGhhbHQgdGhlIG9ic2VydmUgKHdoaWNoIGVuZHNcbiAgICAgICAgICAvLyB1cCBjYWxsaW5nIGBzdG9wYCBvbiB1cykuXG4gICAgICAgICAgc2VsZi5fbXVsdGlwbGV4ZXIucXVlcnlFcnJvcihlKTtcbiAgICAgICAgICByZXR1cm47XG4gICAgICAgIH1cblxuICAgICAgICAvLyBEdXJpbmcgZmFpbG92ZXIgKGVnKSBpZiB3ZSBnZXQgYW4gZXhjZXB0aW9uIHdlIHNob3VsZCBsb2cgYW5kIHJldHJ5XG4gICAgICAgIC8vIGluc3RlYWQgb2YgY3Jhc2hpbmcuXG4gICAgICAgIE1ldGVvci5fZGVidWcoXCJHb3QgZXhjZXB0aW9uIHdoaWxlIHBvbGxpbmcgcXVlcnlcIiwgZSk7XG4gICAgICAgIE1ldGVvci5fc2xlZXBGb3JNcygxMDApO1xuICAgICAgfVxuICAgIH1cblxuICAgIGlmIChzZWxmLl9zdG9wcGVkKVxuICAgICAgcmV0dXJuO1xuXG4gICAgc2VsZi5fcHVibGlzaE5ld1Jlc3VsdHMobmV3UmVzdWx0cywgbmV3QnVmZmVyKTtcbiAgfSxcblxuICAvLyBUcmFuc2l0aW9ucyB0byBRVUVSWUlORyBhbmQgcnVucyBhbm90aGVyIHF1ZXJ5LCBvciAoaWYgYWxyZWFkeSBpbiBRVUVSWUlORylcbiAgLy8gZW5zdXJlcyB0aGF0IHdlIHdpbGwgcXVlcnkgYWdhaW4gbGF0ZXIuXG4gIC8vXG4gIC8vIFRoaXMgZnVuY3Rpb24gbWF5IG5vdCBibG9jaywgYmVjYXVzZSBpdCBpcyBjYWxsZWQgZnJvbSBhbiBvcGxvZyBlbnRyeVxuICAvLyBoYW5kbGVyLiBIb3dldmVyLCBpZiB3ZSB3ZXJlIG5vdCBhbHJlYWR5IGluIHRoZSBRVUVSWUlORyBwaGFzZSwgaXQgdGhyb3dzXG4gIC8vIGFuIGV4Y2VwdGlvbiB0aGF0IGlzIGNhdWdodCBieSB0aGUgY2xvc2VzdCBzdXJyb3VuZGluZ1xuICAvLyBmaW5pc2hJZk5lZWRUb1BvbGxRdWVyeSBjYWxsOyB0aGlzIGVuc3VyZXMgdGhhdCB3ZSBkb24ndCBjb250aW51ZSBydW5uaW5nXG4gIC8vIGNsb3NlIHRoYXQgd2FzIGRlc2lnbmVkIGZvciBhbm90aGVyIHBoYXNlIGluc2lkZSBQSEFTRS5RVUVSWUlORy5cbiAgLy9cbiAgLy8gKEl0J3MgYWxzbyBuZWNlc3Nhcnkgd2hlbmV2ZXIgbG9naWMgaW4gdGhpcyBmaWxlIHlpZWxkcyB0byBjaGVjayB0aGF0IG90aGVyXG4gIC8vIHBoYXNlcyBoYXZlbid0IHB1dCB1cyBpbnRvIFFVRVJZSU5HIG1vZGUsIHRob3VnaDsgZWcsXG4gIC8vIF9mZXRjaE1vZGlmaWVkRG9jdW1lbnRzIGRvZXMgdGhpcy4pXG4gIF9uZWVkVG9Qb2xsUXVlcnk6IGZ1bmN0aW9uICgpIHtcbiAgICB2YXIgc2VsZiA9IHRoaXM7XG4gICAgTWV0ZW9yLl9ub1lpZWxkc0FsbG93ZWQoZnVuY3Rpb24gKCkge1xuICAgICAgaWYgKHNlbGYuX3N0b3BwZWQpXG4gICAgICAgIHJldHVybjtcblxuICAgICAgLy8gSWYgd2UncmUgbm90IGFscmVhZHkgaW4gdGhlIG1pZGRsZSBvZiBhIHF1ZXJ5LCB3ZSBjYW4gcXVlcnkgbm93XG4gICAgICAvLyAocG9zc2libHkgcGF1c2luZyBGRVRDSElORykuXG4gICAgICBpZiAoc2VsZi5fcGhhc2UgIT09IFBIQVNFLlFVRVJZSU5HKSB7XG4gICAgICAgIHNlbGYuX3BvbGxRdWVyeSgpO1xuICAgICAgICB0aHJvdyBuZXcgU3dpdGNoZWRUb1F1ZXJ5O1xuICAgICAgfVxuXG4gICAgICAvLyBXZSdyZSBjdXJyZW50bHkgaW4gUVVFUllJTkcuIFNldCBhIGZsYWcgdG8gZW5zdXJlIHRoYXQgd2UgcnVuIGFub3RoZXJcbiAgICAgIC8vIHF1ZXJ5IHdoZW4gd2UncmUgZG9uZS5cbiAgICAgIHNlbGYuX3JlcXVlcnlXaGVuRG9uZVRoaXNRdWVyeSA9IHRydWU7XG4gICAgfSk7XG4gIH0sXG5cbiAgLy8gWWllbGRzIVxuICBfZG9uZVF1ZXJ5aW5nOiBmdW5jdGlvbiAoKSB7XG4gICAgdmFyIHNlbGYgPSB0aGlzO1xuXG4gICAgaWYgKHNlbGYuX3N0b3BwZWQpXG4gICAgICByZXR1cm47XG4gICAgc2VsZi5fbW9uZ29IYW5kbGUuX29wbG9nSGFuZGxlLndhaXRVbnRpbENhdWdodFVwKCk7ICAvLyB5aWVsZHNcbiAgICBpZiAoc2VsZi5fc3RvcHBlZClcbiAgICAgIHJldHVybjtcbiAgICBpZiAoc2VsZi5fcGhhc2UgIT09IFBIQVNFLlFVRVJZSU5HKVxuICAgICAgdGhyb3cgRXJyb3IoXCJQaGFzZSB1bmV4cGVjdGVkbHkgXCIgKyBzZWxmLl9waGFzZSk7XG5cbiAgICBNZXRlb3IuX25vWWllbGRzQWxsb3dlZChmdW5jdGlvbiAoKSB7XG4gICAgICBpZiAoc2VsZi5fcmVxdWVyeVdoZW5Eb25lVGhpc1F1ZXJ5KSB7XG4gICAgICAgIHNlbGYuX3JlcXVlcnlXaGVuRG9uZVRoaXNRdWVyeSA9IGZhbHNlO1xuICAgICAgICBzZWxmLl9wb2xsUXVlcnkoKTtcbiAgICAgIH0gZWxzZSBpZiAoc2VsZi5fbmVlZFRvRmV0Y2guZW1wdHkoKSkge1xuICAgICAgICBzZWxmLl9iZVN0ZWFkeSgpO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgc2VsZi5fZmV0Y2hNb2RpZmllZERvY3VtZW50cygpO1xuICAgICAgfVxuICAgIH0pO1xuICB9LFxuXG4gIF9jdXJzb3JGb3JRdWVyeTogZnVuY3Rpb24gKG9wdGlvbnNPdmVyd3JpdGUpIHtcbiAgICB2YXIgc2VsZiA9IHRoaXM7XG4gICAgcmV0dXJuIE1ldGVvci5fbm9ZaWVsZHNBbGxvd2VkKGZ1bmN0aW9uICgpIHtcbiAgICAgIC8vIFRoZSBxdWVyeSB3ZSBydW4gaXMgYWxtb3N0IHRoZSBzYW1lIGFzIHRoZSBjdXJzb3Igd2UgYXJlIG9ic2VydmluZyxcbiAgICAgIC8vIHdpdGggYSBmZXcgY2hhbmdlcy4gV2UgbmVlZCB0byByZWFkIGFsbCB0aGUgZmllbGRzIHRoYXQgYXJlIHJlbGV2YW50IHRvXG4gICAgICAvLyB0aGUgc2VsZWN0b3IsIG5vdCBqdXN0IHRoZSBmaWVsZHMgd2UgYXJlIGdvaW5nIHRvIHB1Ymxpc2ggKHRoYXQncyB0aGVcbiAgICAgIC8vIFwic2hhcmVkXCIgcHJvamVjdGlvbikuIEFuZCB3ZSBkb24ndCB3YW50IHRvIGFwcGx5IGFueSB0cmFuc2Zvcm0gaW4gdGhlXG4gICAgICAvLyBjdXJzb3IsIGJlY2F1c2Ugb2JzZXJ2ZUNoYW5nZXMgc2hvdWxkbid0IHVzZSB0aGUgdHJhbnNmb3JtLlxuICAgICAgdmFyIG9wdGlvbnMgPSBfLmNsb25lKHNlbGYuX2N1cnNvckRlc2NyaXB0aW9uLm9wdGlvbnMpO1xuXG4gICAgICAvLyBBbGxvdyB0aGUgY2FsbGVyIHRvIG1vZGlmeSB0aGUgb3B0aW9ucy4gVXNlZnVsIHRvIHNwZWNpZnkgZGlmZmVyZW50XG4gICAgICAvLyBza2lwIGFuZCBsaW1pdCB2YWx1ZXMuXG4gICAgICBfLmV4dGVuZChvcHRpb25zLCBvcHRpb25zT3ZlcndyaXRlKTtcblxuICAgICAgb3B0aW9ucy5maWVsZHMgPSBzZWxmLl9zaGFyZWRQcm9qZWN0aW9uO1xuICAgICAgZGVsZXRlIG9wdGlvbnMudHJhbnNmb3JtO1xuICAgICAgLy8gV2UgYXJlIE5PVCBkZWVwIGNsb25pbmcgZmllbGRzIG9yIHNlbGVjdG9yIGhlcmUsIHdoaWNoIHNob3VsZCBiZSBPSy5cbiAgICAgIHZhciBkZXNjcmlwdGlvbiA9IG5ldyBDdXJzb3JEZXNjcmlwdGlvbihcbiAgICAgICAgc2VsZi5fY3Vyc29yRGVzY3JpcHRpb24uY29sbGVjdGlvbk5hbWUsXG4gICAgICAgIHNlbGYuX2N1cnNvckRlc2NyaXB0aW9uLnNlbGVjdG9yLFxuICAgICAgICBvcHRpb25zKTtcbiAgICAgIHJldHVybiBuZXcgQ3Vyc29yKHNlbGYuX21vbmdvSGFuZGxlLCBkZXNjcmlwdGlvbik7XG4gICAgfSk7XG4gIH0sXG5cblxuICAvLyBSZXBsYWNlIHNlbGYuX3B1Ymxpc2hlZCB3aXRoIG5ld1Jlc3VsdHMgKGJvdGggYXJlIElkTWFwcyksIGludm9raW5nIG9ic2VydmVcbiAgLy8gY2FsbGJhY2tzIG9uIHRoZSBtdWx0aXBsZXhlci5cbiAgLy8gUmVwbGFjZSBzZWxmLl91bnB1Ymxpc2hlZEJ1ZmZlciB3aXRoIG5ld0J1ZmZlci5cbiAgLy9cbiAgLy8gWFhYIFRoaXMgaXMgdmVyeSBzaW1pbGFyIHRvIExvY2FsQ29sbGVjdGlvbi5fZGlmZlF1ZXJ5VW5vcmRlcmVkQ2hhbmdlcy4gV2VcbiAgLy8gc2hvdWxkIHJlYWxseTogKGEpIFVuaWZ5IElkTWFwIGFuZCBPcmRlcmVkRGljdCBpbnRvIFVub3JkZXJlZC9PcmRlcmVkRGljdFxuICAvLyAoYikgUmV3cml0ZSBkaWZmLmpzIHRvIHVzZSB0aGVzZSBjbGFzc2VzIGluc3RlYWQgb2YgYXJyYXlzIGFuZCBvYmplY3RzLlxuICBfcHVibGlzaE5ld1Jlc3VsdHM6IGZ1bmN0aW9uIChuZXdSZXN1bHRzLCBuZXdCdWZmZXIpIHtcbiAgICB2YXIgc2VsZiA9IHRoaXM7XG4gICAgTWV0ZW9yLl9ub1lpZWxkc0FsbG93ZWQoZnVuY3Rpb24gKCkge1xuXG4gICAgICAvLyBJZiB0aGUgcXVlcnkgaXMgbGltaXRlZCBhbmQgdGhlcmUgaXMgYSBidWZmZXIsIHNodXQgZG93biBzbyBpdCBkb2Vzbid0XG4gICAgICAvLyBzdGF5IGluIGEgd2F5LlxuICAgICAgaWYgKHNlbGYuX2xpbWl0KSB7XG4gICAgICAgIHNlbGYuX3VucHVibGlzaGVkQnVmZmVyLmNsZWFyKCk7XG4gICAgICB9XG5cbiAgICAgIC8vIEZpcnN0IHJlbW92ZSBhbnl0aGluZyB0aGF0J3MgZ29uZS4gQmUgY2FyZWZ1bCBub3QgdG8gbW9kaWZ5XG4gICAgICAvLyBzZWxmLl9wdWJsaXNoZWQgd2hpbGUgaXRlcmF0aW5nIG92ZXIgaXQuXG4gICAgICB2YXIgaWRzVG9SZW1vdmUgPSBbXTtcbiAgICAgIHNlbGYuX3B1Ymxpc2hlZC5mb3JFYWNoKGZ1bmN0aW9uIChkb2MsIGlkKSB7XG4gICAgICAgIGlmICghbmV3UmVzdWx0cy5oYXMoaWQpKVxuICAgICAgICAgIGlkc1RvUmVtb3ZlLnB1c2goaWQpO1xuICAgICAgfSk7XG4gICAgICBfLmVhY2goaWRzVG9SZW1vdmUsIGZ1bmN0aW9uIChpZCkge1xuICAgICAgICBzZWxmLl9yZW1vdmVQdWJsaXNoZWQoaWQpO1xuICAgICAgfSk7XG5cbiAgICAgIC8vIE5vdyBkbyBhZGRzIGFuZCBjaGFuZ2VzLlxuICAgICAgLy8gSWYgc2VsZiBoYXMgYSBidWZmZXIgYW5kIGxpbWl0LCB0aGUgbmV3IGZldGNoZWQgcmVzdWx0IHdpbGwgYmVcbiAgICAgIC8vIGxpbWl0ZWQgY29ycmVjdGx5IGFzIHRoZSBxdWVyeSBoYXMgc29ydCBzcGVjaWZpZXIuXG4gICAgICBuZXdSZXN1bHRzLmZvckVhY2goZnVuY3Rpb24gKGRvYywgaWQpIHtcbiAgICAgICAgc2VsZi5faGFuZGxlRG9jKGlkLCBkb2MpO1xuICAgICAgfSk7XG5cbiAgICAgIC8vIFNhbml0eS1jaGVjayB0aGF0IGV2ZXJ5dGhpbmcgd2UgdHJpZWQgdG8gcHV0IGludG8gX3B1Ymxpc2hlZCBlbmRlZCB1cFxuICAgICAgLy8gdGhlcmUuXG4gICAgICAvLyBYWFggaWYgdGhpcyBpcyBzbG93LCByZW1vdmUgaXQgbGF0ZXJcbiAgICAgIGlmIChzZWxmLl9wdWJsaXNoZWQuc2l6ZSgpICE9PSBuZXdSZXN1bHRzLnNpemUoKSkge1xuICAgICAgICBjb25zb2xlLmVycm9yKCdUaGUgTW9uZ28gc2VydmVyIGFuZCB0aGUgTWV0ZW9yIHF1ZXJ5IGRpc2FncmVlIG9uIGhvdyAnICtcbiAgICAgICAgICAnbWFueSBkb2N1bWVudHMgbWF0Y2ggeW91ciBxdWVyeS4gQ3Vyc29yIGRlc2NyaXB0aW9uOiAnLFxuICAgICAgICAgIHNlbGYuX2N1cnNvckRlc2NyaXB0aW9uKTtcbiAgICAgICAgdGhyb3cgRXJyb3IoXG4gICAgICAgICAgXCJUaGUgTW9uZ28gc2VydmVyIGFuZCB0aGUgTWV0ZW9yIHF1ZXJ5IGRpc2FncmVlIG9uIGhvdyBcIiArXG4gICAgICAgICAgICBcIm1hbnkgZG9jdW1lbnRzIG1hdGNoIHlvdXIgcXVlcnkuIE1heWJlIGl0IGlzIGhpdHRpbmcgYSBNb25nbyBcIiArXG4gICAgICAgICAgICBcImVkZ2UgY2FzZT8gVGhlIHF1ZXJ5IGlzOiBcIiArXG4gICAgICAgICAgICBFSlNPTi5zdHJpbmdpZnkoc2VsZi5fY3Vyc29yRGVzY3JpcHRpb24uc2VsZWN0b3IpKTtcbiAgICAgIH1cbiAgICAgIHNlbGYuX3B1Ymxpc2hlZC5mb3JFYWNoKGZ1bmN0aW9uIChkb2MsIGlkKSB7XG4gICAgICAgIGlmICghbmV3UmVzdWx0cy5oYXMoaWQpKVxuICAgICAgICAgIHRocm93IEVycm9yKFwiX3B1Ymxpc2hlZCBoYXMgYSBkb2MgdGhhdCBuZXdSZXN1bHRzIGRvZXNuJ3Q7IFwiICsgaWQpO1xuICAgICAgfSk7XG5cbiAgICAgIC8vIEZpbmFsbHksIHJlcGxhY2UgdGhlIGJ1ZmZlclxuICAgICAgbmV3QnVmZmVyLmZvckVhY2goZnVuY3Rpb24gKGRvYywgaWQpIHtcbiAgICAgICAgc2VsZi5fYWRkQnVmZmVyZWQoaWQsIGRvYyk7XG4gICAgICB9KTtcblxuICAgICAgc2VsZi5fc2FmZUFwcGVuZFRvQnVmZmVyID0gbmV3QnVmZmVyLnNpemUoKSA8IHNlbGYuX2xpbWl0O1xuICAgIH0pO1xuICB9LFxuXG4gIC8vIFRoaXMgc3RvcCBmdW5jdGlvbiBpcyBpbnZva2VkIGZyb20gdGhlIG9uU3RvcCBvZiB0aGUgT2JzZXJ2ZU11bHRpcGxleGVyLCBzb1xuICAvLyBpdCBzaG91bGRuJ3QgYWN0dWFsbHkgYmUgcG9zc2libGUgdG8gY2FsbCBpdCB1bnRpbCB0aGUgbXVsdGlwbGV4ZXIgaXNcbiAgLy8gcmVhZHkuXG4gIC8vXG4gIC8vIEl0J3MgaW1wb3J0YW50IHRvIGNoZWNrIHNlbGYuX3N0b3BwZWQgYWZ0ZXIgZXZlcnkgY2FsbCBpbiB0aGlzIGZpbGUgdGhhdFxuICAvLyBjYW4geWllbGQhXG4gIHN0b3A6IGZ1bmN0aW9uICgpIHtcbiAgICB2YXIgc2VsZiA9IHRoaXM7XG4gICAgaWYgKHNlbGYuX3N0b3BwZWQpXG4gICAgICByZXR1cm47XG4gICAgc2VsZi5fc3RvcHBlZCA9IHRydWU7XG4gICAgXy5lYWNoKHNlbGYuX3N0b3BIYW5kbGVzLCBmdW5jdGlvbiAoaGFuZGxlKSB7XG4gICAgICBoYW5kbGUuc3RvcCgpO1xuICAgIH0pO1xuXG4gICAgLy8gTm90ZTogd2UgKmRvbid0KiB1c2UgbXVsdGlwbGV4ZXIub25GbHVzaCBoZXJlIGJlY2F1c2UgdGhpcyBzdG9wXG4gICAgLy8gY2FsbGJhY2sgaXMgYWN0dWFsbHkgaW52b2tlZCBieSB0aGUgbXVsdGlwbGV4ZXIgaXRzZWxmIHdoZW4gaXQgaGFzXG4gICAgLy8gZGV0ZXJtaW5lZCB0aGF0IHRoZXJlIGFyZSBubyBoYW5kbGVzIGxlZnQuIFNvIG5vdGhpbmcgaXMgYWN0dWFsbHkgZ29pbmdcbiAgICAvLyB0byBnZXQgZmx1c2hlZCAoYW5kIGl0J3MgcHJvYmFibHkgbm90IHZhbGlkIHRvIGNhbGwgbWV0aG9kcyBvbiB0aGVcbiAgICAvLyBkeWluZyBtdWx0aXBsZXhlcikuXG4gICAgXy5lYWNoKHNlbGYuX3dyaXRlc1RvQ29tbWl0V2hlbldlUmVhY2hTdGVhZHksIGZ1bmN0aW9uICh3KSB7XG4gICAgICB3LmNvbW1pdHRlZCgpOyAgLy8gbWF5YmUgeWllbGRzP1xuICAgIH0pO1xuICAgIHNlbGYuX3dyaXRlc1RvQ29tbWl0V2hlbldlUmVhY2hTdGVhZHkgPSBudWxsO1xuXG4gICAgLy8gUHJvYWN0aXZlbHkgZHJvcCByZWZlcmVuY2VzIHRvIHBvdGVudGlhbGx5IGJpZyB0aGluZ3MuXG4gICAgc2VsZi5fcHVibGlzaGVkID0gbnVsbDtcbiAgICBzZWxmLl91bnB1Ymxpc2hlZEJ1ZmZlciA9IG51bGw7XG4gICAgc2VsZi5fbmVlZFRvRmV0Y2ggPSBudWxsO1xuICAgIHNlbGYuX2N1cnJlbnRseUZldGNoaW5nID0gbnVsbDtcbiAgICBzZWxmLl9vcGxvZ0VudHJ5SGFuZGxlID0gbnVsbDtcbiAgICBzZWxmLl9saXN0ZW5lcnNIYW5kbGUgPSBudWxsO1xuXG4gICAgUGFja2FnZVsnZmFjdHMtYmFzZSddICYmIFBhY2thZ2VbJ2ZhY3RzLWJhc2UnXS5GYWN0cy5pbmNyZW1lbnRTZXJ2ZXJGYWN0KFxuICAgICAgXCJtb25nby1saXZlZGF0YVwiLCBcIm9ic2VydmUtZHJpdmVycy1vcGxvZ1wiLCAtMSk7XG4gIH0sXG5cbiAgX3JlZ2lzdGVyUGhhc2VDaGFuZ2U6IGZ1bmN0aW9uIChwaGFzZSkge1xuICAgIHZhciBzZWxmID0gdGhpcztcbiAgICBNZXRlb3IuX25vWWllbGRzQWxsb3dlZChmdW5jdGlvbiAoKSB7XG4gICAgICB2YXIgbm93ID0gbmV3IERhdGU7XG5cbiAgICAgIGlmIChzZWxmLl9waGFzZSkge1xuICAgICAgICB2YXIgdGltZURpZmYgPSBub3cgLSBzZWxmLl9waGFzZVN0YXJ0VGltZTtcbiAgICAgICAgUGFja2FnZVsnZmFjdHMtYmFzZSddICYmIFBhY2thZ2VbJ2ZhY3RzLWJhc2UnXS5GYWN0cy5pbmNyZW1lbnRTZXJ2ZXJGYWN0KFxuICAgICAgICAgIFwibW9uZ28tbGl2ZWRhdGFcIiwgXCJ0aW1lLXNwZW50LWluLVwiICsgc2VsZi5fcGhhc2UgKyBcIi1waGFzZVwiLCB0aW1lRGlmZik7XG4gICAgICB9XG5cbiAgICAgIHNlbGYuX3BoYXNlID0gcGhhc2U7XG4gICAgICBzZWxmLl9waGFzZVN0YXJ0VGltZSA9IG5vdztcbiAgICB9KTtcbiAgfVxufSk7XG5cbi8vIERvZXMgb3VyIG9wbG9nIHRhaWxpbmcgY29kZSBzdXBwb3J0IHRoaXMgY3Vyc29yPyBGb3Igbm93LCB3ZSBhcmUgYmVpbmcgdmVyeVxuLy8gY29uc2VydmF0aXZlIGFuZCBhbGxvd2luZyBvbmx5IHNpbXBsZSBxdWVyaWVzIHdpdGggc2ltcGxlIG9wdGlvbnMuXG4vLyAoVGhpcyBpcyBhIFwic3RhdGljIG1ldGhvZFwiLilcbk9wbG9nT2JzZXJ2ZURyaXZlci5jdXJzb3JTdXBwb3J0ZWQgPSBmdW5jdGlvbiAoY3Vyc29yRGVzY3JpcHRpb24sIG1hdGNoZXIpIHtcbiAgLy8gRmlyc3QsIGNoZWNrIHRoZSBvcHRpb25zLlxuICB2YXIgb3B0aW9ucyA9IGN1cnNvckRlc2NyaXB0aW9uLm9wdGlvbnM7XG5cbiAgLy8gRGlkIHRoZSB1c2VyIHNheSBubyBleHBsaWNpdGx5P1xuICAvLyB1bmRlcnNjb3JlZCB2ZXJzaW9uIG9mIHRoZSBvcHRpb24gaXMgQ09NUEFUIHdpdGggMS4yXG4gIGlmIChvcHRpb25zLmRpc2FibGVPcGxvZyB8fCBvcHRpb25zLl9kaXNhYmxlT3Bsb2cpXG4gICAgcmV0dXJuIGZhbHNlO1xuXG4gIC8vIHNraXAgaXMgbm90IHN1cHBvcnRlZDogdG8gc3VwcG9ydCBpdCB3ZSB3b3VsZCBuZWVkIHRvIGtlZXAgdHJhY2sgb2YgYWxsXG4gIC8vIFwic2tpcHBlZFwiIGRvY3VtZW50cyBvciBhdCBsZWFzdCB0aGVpciBpZHMuXG4gIC8vIGxpbWl0IHcvbyBhIHNvcnQgc3BlY2lmaWVyIGlzIG5vdCBzdXBwb3J0ZWQ6IGN1cnJlbnQgaW1wbGVtZW50YXRpb24gbmVlZHMgYVxuICAvLyBkZXRlcm1pbmlzdGljIHdheSB0byBvcmRlciBkb2N1bWVudHMuXG4gIGlmIChvcHRpb25zLnNraXAgfHwgKG9wdGlvbnMubGltaXQgJiYgIW9wdGlvbnMuc29ydCkpIHJldHVybiBmYWxzZTtcblxuICAvLyBJZiBhIGZpZWxkcyBwcm9qZWN0aW9uIG9wdGlvbiBpcyBnaXZlbiBjaGVjayBpZiBpdCBpcyBzdXBwb3J0ZWQgYnlcbiAgLy8gbWluaW1vbmdvIChzb21lIG9wZXJhdG9ycyBhcmUgbm90IHN1cHBvcnRlZCkuXG4gIGlmIChvcHRpb25zLmZpZWxkcykge1xuICAgIHRyeSB7XG4gICAgICBMb2NhbENvbGxlY3Rpb24uX2NoZWNrU3VwcG9ydGVkUHJvamVjdGlvbihvcHRpb25zLmZpZWxkcyk7XG4gICAgfSBjYXRjaCAoZSkge1xuICAgICAgaWYgKGUubmFtZSA9PT0gXCJNaW5pbW9uZ29FcnJvclwiKSB7XG4gICAgICAgIHJldHVybiBmYWxzZTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIHRocm93IGU7XG4gICAgICB9XG4gICAgfVxuICB9XG5cbiAgLy8gV2UgZG9uJ3QgYWxsb3cgdGhlIGZvbGxvd2luZyBzZWxlY3RvcnM6XG4gIC8vICAgLSAkd2hlcmUgKG5vdCBjb25maWRlbnQgdGhhdCB3ZSBwcm92aWRlIHRoZSBzYW1lIEpTIGVudmlyb25tZW50XG4gIC8vICAgICAgICAgICAgIGFzIE1vbmdvLCBhbmQgY2FuIHlpZWxkISlcbiAgLy8gICAtICRuZWFyIChoYXMgXCJpbnRlcmVzdGluZ1wiIHByb3BlcnRpZXMgaW4gTW9uZ29EQiwgbGlrZSB0aGUgcG9zc2liaWxpdHlcbiAgLy8gICAgICAgICAgICBvZiByZXR1cm5pbmcgYW4gSUQgbXVsdGlwbGUgdGltZXMsIHRob3VnaCBldmVuIHBvbGxpbmcgbWF5YmVcbiAgLy8gICAgICAgICAgICBoYXZlIGEgYnVnIHRoZXJlKVxuICAvLyAgICAgICAgICAgWFhYOiBvbmNlIHdlIHN1cHBvcnQgaXQsIHdlIHdvdWxkIG5lZWQgdG8gdGhpbmsgbW9yZSBvbiBob3cgd2VcbiAgLy8gICAgICAgICAgIGluaXRpYWxpemUgdGhlIGNvbXBhcmF0b3JzIHdoZW4gd2UgY3JlYXRlIHRoZSBkcml2ZXIuXG4gIHJldHVybiAhbWF0Y2hlci5oYXNXaGVyZSgpICYmICFtYXRjaGVyLmhhc0dlb1F1ZXJ5KCk7XG59O1xuXG52YXIgbW9kaWZpZXJDYW5CZURpcmVjdGx5QXBwbGllZCA9IGZ1bmN0aW9uIChtb2RpZmllcikge1xuICByZXR1cm4gXy5hbGwobW9kaWZpZXIsIGZ1bmN0aW9uIChmaWVsZHMsIG9wZXJhdGlvbikge1xuICAgIHJldHVybiBfLmFsbChmaWVsZHMsIGZ1bmN0aW9uICh2YWx1ZSwgZmllbGQpIHtcbiAgICAgIHJldHVybiAhL0VKU09OXFwkLy50ZXN0KGZpZWxkKTtcbiAgICB9KTtcbiAgfSk7XG59O1xuXG5Nb25nb0ludGVybmFscy5PcGxvZ09ic2VydmVEcml2ZXIgPSBPcGxvZ09ic2VydmVEcml2ZXI7XG4iLCIvLyBzaW5nbGV0b25cbmV4cG9ydCBjb25zdCBMb2NhbENvbGxlY3Rpb25Ecml2ZXIgPSBuZXcgKGNsYXNzIExvY2FsQ29sbGVjdGlvbkRyaXZlciB7XG4gIGNvbnN0cnVjdG9yKCkge1xuICAgIHRoaXMubm9Db25uQ29sbGVjdGlvbnMgPSBPYmplY3QuY3JlYXRlKG51bGwpO1xuICB9XG5cbiAgb3BlbihuYW1lLCBjb25uKSB7XG4gICAgaWYgKCEgbmFtZSkge1xuICAgICAgcmV0dXJuIG5ldyBMb2NhbENvbGxlY3Rpb247XG4gICAgfVxuXG4gICAgaWYgKCEgY29ubikge1xuICAgICAgcmV0dXJuIGVuc3VyZUNvbGxlY3Rpb24obmFtZSwgdGhpcy5ub0Nvbm5Db2xsZWN0aW9ucyk7XG4gICAgfVxuXG4gICAgaWYgKCEgY29ubi5fbW9uZ29fbGl2ZWRhdGFfY29sbGVjdGlvbnMpIHtcbiAgICAgIGNvbm4uX21vbmdvX2xpdmVkYXRhX2NvbGxlY3Rpb25zID0gT2JqZWN0LmNyZWF0ZShudWxsKTtcbiAgICB9XG5cbiAgICAvLyBYWFggaXMgdGhlcmUgYSB3YXkgdG8ga2VlcCB0cmFjayBvZiBhIGNvbm5lY3Rpb24ncyBjb2xsZWN0aW9ucyB3aXRob3V0XG4gICAgLy8gZGFuZ2xpbmcgaXQgb2ZmIHRoZSBjb25uZWN0aW9uIG9iamVjdD9cbiAgICByZXR1cm4gZW5zdXJlQ29sbGVjdGlvbihuYW1lLCBjb25uLl9tb25nb19saXZlZGF0YV9jb2xsZWN0aW9ucyk7XG4gIH1cbn0pO1xuXG5mdW5jdGlvbiBlbnN1cmVDb2xsZWN0aW9uKG5hbWUsIGNvbGxlY3Rpb25zKSB7XG4gIHJldHVybiAobmFtZSBpbiBjb2xsZWN0aW9ucylcbiAgICA/IGNvbGxlY3Rpb25zW25hbWVdXG4gICAgOiBjb2xsZWN0aW9uc1tuYW1lXSA9IG5ldyBMb2NhbENvbGxlY3Rpb24obmFtZSk7XG59XG4iLCJNb25nb0ludGVybmFscy5SZW1vdGVDb2xsZWN0aW9uRHJpdmVyID0gZnVuY3Rpb24gKFxuICBtb25nb191cmwsIG9wdGlvbnMpIHtcbiAgdmFyIHNlbGYgPSB0aGlzO1xuICBzZWxmLm1vbmdvID0gbmV3IE1vbmdvQ29ubmVjdGlvbihtb25nb191cmwsIG9wdGlvbnMpO1xufTtcblxuXy5leHRlbmQoTW9uZ29JbnRlcm5hbHMuUmVtb3RlQ29sbGVjdGlvbkRyaXZlci5wcm90b3R5cGUsIHtcbiAgb3BlbjogZnVuY3Rpb24gKG5hbWUpIHtcbiAgICB2YXIgc2VsZiA9IHRoaXM7XG4gICAgdmFyIHJldCA9IHt9O1xuICAgIF8uZWFjaChcbiAgICAgIFsnZmluZCcsICdmaW5kT25lJywgJ2luc2VydCcsICd1cGRhdGUnLCAndXBzZXJ0JyxcbiAgICAgICAncmVtb3ZlJywgJ19lbnN1cmVJbmRleCcsICdfZHJvcEluZGV4JywgJ19jcmVhdGVDYXBwZWRDb2xsZWN0aW9uJyxcbiAgICAgICAnZHJvcENvbGxlY3Rpb24nLCAncmF3Q29sbGVjdGlvbiddLFxuICAgICAgZnVuY3Rpb24gKG0pIHtcbiAgICAgICAgcmV0W21dID0gXy5iaW5kKHNlbGYubW9uZ29bbV0sIHNlbGYubW9uZ28sIG5hbWUpO1xuICAgICAgfSk7XG4gICAgcmV0dXJuIHJldDtcbiAgfVxufSk7XG5cblxuLy8gQ3JlYXRlIHRoZSBzaW5nbGV0b24gUmVtb3RlQ29sbGVjdGlvbkRyaXZlciBvbmx5IG9uIGRlbWFuZCwgc28gd2Vcbi8vIG9ubHkgcmVxdWlyZSBNb25nbyBjb25maWd1cmF0aW9uIGlmIGl0J3MgYWN0dWFsbHkgdXNlZCAoZWcsIG5vdCBpZlxuLy8geW91J3JlIG9ubHkgdHJ5aW5nIHRvIHJlY2VpdmUgZGF0YSBmcm9tIGEgcmVtb3RlIEREUCBzZXJ2ZXIuKVxuTW9uZ29JbnRlcm5hbHMuZGVmYXVsdFJlbW90ZUNvbGxlY3Rpb25Ecml2ZXIgPSBfLm9uY2UoZnVuY3Rpb24gKCkge1xuICB2YXIgY29ubmVjdGlvbk9wdGlvbnMgPSB7fTtcblxuICB2YXIgbW9uZ29VcmwgPSBwcm9jZXNzLmVudi5NT05HT19VUkw7XG5cbiAgaWYgKHByb2Nlc3MuZW52Lk1PTkdPX09QTE9HX1VSTCkge1xuICAgIGNvbm5lY3Rpb25PcHRpb25zLm9wbG9nVXJsID0gcHJvY2Vzcy5lbnYuTU9OR09fT1BMT0dfVVJMO1xuICB9XG5cbiAgaWYgKCEgbW9uZ29VcmwpXG4gICAgdGhyb3cgbmV3IEVycm9yKFwiTU9OR09fVVJMIG11c3QgYmUgc2V0IGluIGVudmlyb25tZW50XCIpO1xuXG4gIHJldHVybiBuZXcgTW9uZ29JbnRlcm5hbHMuUmVtb3RlQ29sbGVjdGlvbkRyaXZlcihtb25nb1VybCwgY29ubmVjdGlvbk9wdGlvbnMpO1xufSk7XG4iLCIvLyBvcHRpb25zLmNvbm5lY3Rpb24sIGlmIGdpdmVuLCBpcyBhIExpdmVkYXRhQ2xpZW50IG9yIExpdmVkYXRhU2VydmVyXG4vLyBYWFggcHJlc2VudGx5IHRoZXJlIGlzIG5vIHdheSB0byBkZXN0cm95L2NsZWFuIHVwIGEgQ29sbGVjdGlvblxuXG4vKipcbiAqIEBzdW1tYXJ5IE5hbWVzcGFjZSBmb3IgTW9uZ29EQi1yZWxhdGVkIGl0ZW1zXG4gKiBAbmFtZXNwYWNlXG4gKi9cbk1vbmdvID0ge307XG5cbi8qKlxuICogQHN1bW1hcnkgQ29uc3RydWN0b3IgZm9yIGEgQ29sbGVjdGlvblxuICogQGxvY3VzIEFueXdoZXJlXG4gKiBAaW5zdGFuY2VuYW1lIGNvbGxlY3Rpb25cbiAqIEBjbGFzc1xuICogQHBhcmFtIHtTdHJpbmd9IG5hbWUgVGhlIG5hbWUgb2YgdGhlIGNvbGxlY3Rpb24uICBJZiBudWxsLCBjcmVhdGVzIGFuIHVubWFuYWdlZCAodW5zeW5jaHJvbml6ZWQpIGxvY2FsIGNvbGxlY3Rpb24uXG4gKiBAcGFyYW0ge09iamVjdH0gW29wdGlvbnNdXG4gKiBAcGFyYW0ge09iamVjdH0gb3B0aW9ucy5jb25uZWN0aW9uIFRoZSBzZXJ2ZXIgY29ubmVjdGlvbiB0aGF0IHdpbGwgbWFuYWdlIHRoaXMgY29sbGVjdGlvbi4gVXNlcyB0aGUgZGVmYXVsdCBjb25uZWN0aW9uIGlmIG5vdCBzcGVjaWZpZWQuICBQYXNzIHRoZSByZXR1cm4gdmFsdWUgb2YgY2FsbGluZyBbYEREUC5jb25uZWN0YF0oI2RkcF9jb25uZWN0KSB0byBzcGVjaWZ5IGEgZGlmZmVyZW50IHNlcnZlci4gUGFzcyBgbnVsbGAgdG8gc3BlY2lmeSBubyBjb25uZWN0aW9uLiBVbm1hbmFnZWQgKGBuYW1lYCBpcyBudWxsKSBjb2xsZWN0aW9ucyBjYW5ub3Qgc3BlY2lmeSBhIGNvbm5lY3Rpb24uXG4gKiBAcGFyYW0ge1N0cmluZ30gb3B0aW9ucy5pZEdlbmVyYXRpb24gVGhlIG1ldGhvZCBvZiBnZW5lcmF0aW5nIHRoZSBgX2lkYCBmaWVsZHMgb2YgbmV3IGRvY3VtZW50cyBpbiB0aGlzIGNvbGxlY3Rpb24uICBQb3NzaWJsZSB2YWx1ZXM6XG5cbiAtICoqYCdTVFJJTkcnYCoqOiByYW5kb20gc3RyaW5nc1xuIC0gKipgJ01PTkdPJ2AqKjogIHJhbmRvbSBbYE1vbmdvLk9iamVjdElEYF0oI21vbmdvX29iamVjdF9pZCkgdmFsdWVzXG5cblRoZSBkZWZhdWx0IGlkIGdlbmVyYXRpb24gdGVjaG5pcXVlIGlzIGAnU1RSSU5HJ2AuXG4gKiBAcGFyYW0ge0Z1bmN0aW9ufSBvcHRpb25zLnRyYW5zZm9ybSBBbiBvcHRpb25hbCB0cmFuc2Zvcm1hdGlvbiBmdW5jdGlvbi4gRG9jdW1lbnRzIHdpbGwgYmUgcGFzc2VkIHRocm91Z2ggdGhpcyBmdW5jdGlvbiBiZWZvcmUgYmVpbmcgcmV0dXJuZWQgZnJvbSBgZmV0Y2hgIG9yIGBmaW5kT25lYCwgYW5kIGJlZm9yZSBiZWluZyBwYXNzZWQgdG8gY2FsbGJhY2tzIG9mIGBvYnNlcnZlYCwgYG1hcGAsIGBmb3JFYWNoYCwgYGFsbG93YCwgYW5kIGBkZW55YC4gVHJhbnNmb3JtcyBhcmUgKm5vdCogYXBwbGllZCBmb3IgdGhlIGNhbGxiYWNrcyBvZiBgb2JzZXJ2ZUNoYW5nZXNgIG9yIHRvIGN1cnNvcnMgcmV0dXJuZWQgZnJvbSBwdWJsaXNoIGZ1bmN0aW9ucy5cbiAqIEBwYXJhbSB7Qm9vbGVhbn0gb3B0aW9ucy5kZWZpbmVNdXRhdGlvbk1ldGhvZHMgU2V0IHRvIGBmYWxzZWAgdG8gc2tpcCBzZXR0aW5nIHVwIHRoZSBtdXRhdGlvbiBtZXRob2RzIHRoYXQgZW5hYmxlIGluc2VydC91cGRhdGUvcmVtb3ZlIGZyb20gY2xpZW50IGNvZGUuIERlZmF1bHQgYHRydWVgLlxuICovXG5Nb25nby5Db2xsZWN0aW9uID0gZnVuY3Rpb24gQ29sbGVjdGlvbihuYW1lLCBvcHRpb25zKSB7XG4gIGlmICghbmFtZSAmJiAobmFtZSAhPT0gbnVsbCkpIHtcbiAgICBNZXRlb3IuX2RlYnVnKFwiV2FybmluZzogY3JlYXRpbmcgYW5vbnltb3VzIGNvbGxlY3Rpb24uIEl0IHdpbGwgbm90IGJlIFwiICtcbiAgICAgICAgICAgICAgICAgIFwic2F2ZWQgb3Igc3luY2hyb25pemVkIG92ZXIgdGhlIG5ldHdvcmsuIChQYXNzIG51bGwgZm9yIFwiICtcbiAgICAgICAgICAgICAgICAgIFwidGhlIGNvbGxlY3Rpb24gbmFtZSB0byB0dXJuIG9mZiB0aGlzIHdhcm5pbmcuKVwiKTtcbiAgICBuYW1lID0gbnVsbDtcbiAgfVxuXG4gIGlmIChuYW1lICE9PSBudWxsICYmIHR5cGVvZiBuYW1lICE9PSBcInN0cmluZ1wiKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKFxuICAgICAgXCJGaXJzdCBhcmd1bWVudCB0byBuZXcgTW9uZ28uQ29sbGVjdGlvbiBtdXN0IGJlIGEgc3RyaW5nIG9yIG51bGxcIik7XG4gIH1cblxuICBpZiAob3B0aW9ucyAmJiBvcHRpb25zLm1ldGhvZHMpIHtcbiAgICAvLyBCYWNrd2FyZHMgY29tcGF0aWJpbGl0eSBoYWNrIHdpdGggb3JpZ2luYWwgc2lnbmF0dXJlICh3aGljaCBwYXNzZWRcbiAgICAvLyBcImNvbm5lY3Rpb25cIiBkaXJlY3RseSBpbnN0ZWFkIG9mIGluIG9wdGlvbnMuIChDb25uZWN0aW9ucyBtdXN0IGhhdmUgYSBcIm1ldGhvZHNcIlxuICAgIC8vIG1ldGhvZC4pXG4gICAgLy8gWFhYIHJlbW92ZSBiZWZvcmUgMS4wXG4gICAgb3B0aW9ucyA9IHtjb25uZWN0aW9uOiBvcHRpb25zfTtcbiAgfVxuICAvLyBCYWNrd2FyZHMgY29tcGF0aWJpbGl0eTogXCJjb25uZWN0aW9uXCIgdXNlZCB0byBiZSBjYWxsZWQgXCJtYW5hZ2VyXCIuXG4gIGlmIChvcHRpb25zICYmIG9wdGlvbnMubWFuYWdlciAmJiAhb3B0aW9ucy5jb25uZWN0aW9uKSB7XG4gICAgb3B0aW9ucy5jb25uZWN0aW9uID0gb3B0aW9ucy5tYW5hZ2VyO1xuICB9XG5cbiAgb3B0aW9ucyA9IHtcbiAgICBjb25uZWN0aW9uOiB1bmRlZmluZWQsXG4gICAgaWRHZW5lcmF0aW9uOiAnU1RSSU5HJyxcbiAgICB0cmFuc2Zvcm06IG51bGwsXG4gICAgX2RyaXZlcjogdW5kZWZpbmVkLFxuICAgIF9wcmV2ZW50QXV0b3B1Ymxpc2g6IGZhbHNlLFxuICAgICAgLi4ub3B0aW9ucyxcbiAgfTtcblxuICBzd2l0Y2ggKG9wdGlvbnMuaWRHZW5lcmF0aW9uKSB7XG4gIGNhc2UgJ01PTkdPJzpcbiAgICB0aGlzLl9tYWtlTmV3SUQgPSBmdW5jdGlvbiAoKSB7XG4gICAgICB2YXIgc3JjID0gbmFtZSA/IEREUC5yYW5kb21TdHJlYW0oJy9jb2xsZWN0aW9uLycgKyBuYW1lKSA6IFJhbmRvbS5pbnNlY3VyZTtcbiAgICAgIHJldHVybiBuZXcgTW9uZ28uT2JqZWN0SUQoc3JjLmhleFN0cmluZygyNCkpO1xuICAgIH07XG4gICAgYnJlYWs7XG4gIGNhc2UgJ1NUUklORyc6XG4gIGRlZmF1bHQ6XG4gICAgdGhpcy5fbWFrZU5ld0lEID0gZnVuY3Rpb24gKCkge1xuICAgICAgdmFyIHNyYyA9IG5hbWUgPyBERFAucmFuZG9tU3RyZWFtKCcvY29sbGVjdGlvbi8nICsgbmFtZSkgOiBSYW5kb20uaW5zZWN1cmU7XG4gICAgICByZXR1cm4gc3JjLmlkKCk7XG4gICAgfTtcbiAgICBicmVhaztcbiAgfVxuXG4gIHRoaXMuX3RyYW5zZm9ybSA9IExvY2FsQ29sbGVjdGlvbi53cmFwVHJhbnNmb3JtKG9wdGlvbnMudHJhbnNmb3JtKTtcblxuICBpZiAoISBuYW1lIHx8IG9wdGlvbnMuY29ubmVjdGlvbiA9PT0gbnVsbClcbiAgICAvLyBub3RlOiBuYW1lbGVzcyBjb2xsZWN0aW9ucyBuZXZlciBoYXZlIGEgY29ubmVjdGlvblxuICAgIHRoaXMuX2Nvbm5lY3Rpb24gPSBudWxsO1xuICBlbHNlIGlmIChvcHRpb25zLmNvbm5lY3Rpb24pXG4gICAgdGhpcy5fY29ubmVjdGlvbiA9IG9wdGlvbnMuY29ubmVjdGlvbjtcbiAgZWxzZSBpZiAoTWV0ZW9yLmlzQ2xpZW50KVxuICAgIHRoaXMuX2Nvbm5lY3Rpb24gPSBNZXRlb3IuY29ubmVjdGlvbjtcbiAgZWxzZVxuICAgIHRoaXMuX2Nvbm5lY3Rpb24gPSBNZXRlb3Iuc2VydmVyO1xuXG4gIGlmICghb3B0aW9ucy5fZHJpdmVyKSB7XG4gICAgLy8gWFhYIFRoaXMgY2hlY2sgYXNzdW1lcyB0aGF0IHdlYmFwcCBpcyBsb2FkZWQgc28gdGhhdCBNZXRlb3Iuc2VydmVyICE9PVxuICAgIC8vIG51bGwuIFdlIHNob3VsZCBmdWxseSBzdXBwb3J0IHRoZSBjYXNlIG9mIFwid2FudCB0byB1c2UgYSBNb25nby1iYWNrZWRcbiAgICAvLyBjb2xsZWN0aW9uIGZyb20gTm9kZSBjb2RlIHdpdGhvdXQgd2ViYXBwXCIsIGJ1dCB3ZSBkb24ndCB5ZXQuXG4gICAgLy8gI01ldGVvclNlcnZlck51bGxcbiAgICBpZiAobmFtZSAmJiB0aGlzLl9jb25uZWN0aW9uID09PSBNZXRlb3Iuc2VydmVyICYmXG4gICAgICAgIHR5cGVvZiBNb25nb0ludGVybmFscyAhPT0gXCJ1bmRlZmluZWRcIiAmJlxuICAgICAgICBNb25nb0ludGVybmFscy5kZWZhdWx0UmVtb3RlQ29sbGVjdGlvbkRyaXZlcikge1xuICAgICAgb3B0aW9ucy5fZHJpdmVyID0gTW9uZ29JbnRlcm5hbHMuZGVmYXVsdFJlbW90ZUNvbGxlY3Rpb25Ecml2ZXIoKTtcbiAgICB9IGVsc2Uge1xuICAgICAgY29uc3QgeyBMb2NhbENvbGxlY3Rpb25Ecml2ZXIgfSA9XG4gICAgICAgIHJlcXVpcmUoXCIuL2xvY2FsX2NvbGxlY3Rpb25fZHJpdmVyLmpzXCIpO1xuICAgICAgb3B0aW9ucy5fZHJpdmVyID0gTG9jYWxDb2xsZWN0aW9uRHJpdmVyO1xuICAgIH1cbiAgfVxuXG4gIHRoaXMuX2NvbGxlY3Rpb24gPSBvcHRpb25zLl9kcml2ZXIub3BlbihuYW1lLCB0aGlzLl9jb25uZWN0aW9uKTtcbiAgdGhpcy5fbmFtZSA9IG5hbWU7XG4gIHRoaXMuX2RyaXZlciA9IG9wdGlvbnMuX2RyaXZlcjtcblxuICB0aGlzLl9tYXliZVNldFVwUmVwbGljYXRpb24obmFtZSwgb3B0aW9ucyk7XG5cbiAgLy8gWFhYIGRvbid0IGRlZmluZSB0aGVzZSB1bnRpbCBhbGxvdyBvciBkZW55IGlzIGFjdHVhbGx5IHVzZWQgZm9yIHRoaXNcbiAgLy8gY29sbGVjdGlvbi4gQ291bGQgYmUgaGFyZCBpZiB0aGUgc2VjdXJpdHkgcnVsZXMgYXJlIG9ubHkgZGVmaW5lZCBvbiB0aGVcbiAgLy8gc2VydmVyLlxuICBpZiAob3B0aW9ucy5kZWZpbmVNdXRhdGlvbk1ldGhvZHMgIT09IGZhbHNlKSB7XG4gICAgdHJ5IHtcbiAgICAgIHRoaXMuX2RlZmluZU11dGF0aW9uTWV0aG9kcyh7XG4gICAgICAgIHVzZUV4aXN0aW5nOiBvcHRpb25zLl9zdXBwcmVzc1NhbWVOYW1lRXJyb3IgPT09IHRydWVcbiAgICAgIH0pO1xuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAvLyBUaHJvdyBhIG1vcmUgdW5kZXJzdGFuZGFibGUgZXJyb3Igb24gdGhlIHNlcnZlciBmb3Igc2FtZSBjb2xsZWN0aW9uIG5hbWVcbiAgICAgIGlmIChlcnJvci5tZXNzYWdlID09PSBgQSBtZXRob2QgbmFtZWQgJy8ke25hbWV9L2luc2VydCcgaXMgYWxyZWFkeSBkZWZpbmVkYClcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBUaGVyZSBpcyBhbHJlYWR5IGEgY29sbGVjdGlvbiBuYW1lZCBcIiR7bmFtZX1cImApO1xuICAgICAgdGhyb3cgZXJyb3I7XG4gICAgfVxuICB9XG5cbiAgLy8gYXV0b3B1Ymxpc2hcbiAgaWYgKFBhY2thZ2UuYXV0b3B1Ymxpc2ggJiZcbiAgICAgICEgb3B0aW9ucy5fcHJldmVudEF1dG9wdWJsaXNoICYmXG4gICAgICB0aGlzLl9jb25uZWN0aW9uICYmXG4gICAgICB0aGlzLl9jb25uZWN0aW9uLnB1Ymxpc2gpIHtcbiAgICB0aGlzLl9jb25uZWN0aW9uLnB1Ymxpc2gobnVsbCwgKCkgPT4gdGhpcy5maW5kKCksIHtcbiAgICAgIGlzX2F1dG86IHRydWUsXG4gICAgfSk7XG4gIH1cbn07XG5cbk9iamVjdC5hc3NpZ24oTW9uZ28uQ29sbGVjdGlvbi5wcm90b3R5cGUsIHtcbiAgX21heWJlU2V0VXBSZXBsaWNhdGlvbihuYW1lLCB7XG4gICAgX3N1cHByZXNzU2FtZU5hbWVFcnJvciA9IGZhbHNlXG4gIH0pIHtcbiAgICBjb25zdCBzZWxmID0gdGhpcztcbiAgICBpZiAoISAoc2VsZi5fY29ubmVjdGlvbiAmJlxuICAgICAgICAgICBzZWxmLl9jb25uZWN0aW9uLnJlZ2lzdGVyU3RvcmUpKSB7XG4gICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgLy8gT0ssIHdlJ3JlIGdvaW5nIHRvIGJlIGEgc2xhdmUsIHJlcGxpY2F0aW5nIHNvbWUgcmVtb3RlXG4gICAgLy8gZGF0YWJhc2UsIGV4Y2VwdCBwb3NzaWJseSB3aXRoIHNvbWUgdGVtcG9yYXJ5IGRpdmVyZ2VuY2Ugd2hpbGVcbiAgICAvLyB3ZSBoYXZlIHVuYWNrbm93bGVkZ2VkIFJQQydzLlxuICAgIGNvbnN0IG9rID0gc2VsZi5fY29ubmVjdGlvbi5yZWdpc3RlclN0b3JlKG5hbWUsIHtcbiAgICAgIC8vIENhbGxlZCBhdCB0aGUgYmVnaW5uaW5nIG9mIGEgYmF0Y2ggb2YgdXBkYXRlcy4gYmF0Y2hTaXplIGlzIHRoZSBudW1iZXJcbiAgICAgIC8vIG9mIHVwZGF0ZSBjYWxscyB0byBleHBlY3QuXG4gICAgICAvL1xuICAgICAgLy8gWFhYIFRoaXMgaW50ZXJmYWNlIGlzIHByZXR0eSBqYW5reS4gcmVzZXQgcHJvYmFibHkgb3VnaHQgdG8gZ28gYmFjayB0b1xuICAgICAgLy8gYmVpbmcgaXRzIG93biBmdW5jdGlvbiwgYW5kIGNhbGxlcnMgc2hvdWxkbid0IGhhdmUgdG8gY2FsY3VsYXRlXG4gICAgICAvLyBiYXRjaFNpemUuIFRoZSBvcHRpbWl6YXRpb24gb2Ygbm90IGNhbGxpbmcgcGF1c2UvcmVtb3ZlIHNob3VsZCBiZVxuICAgICAgLy8gZGVsYXllZCB1bnRpbCBsYXRlcjogdGhlIGZpcnN0IGNhbGwgdG8gdXBkYXRlKCkgc2hvdWxkIGJ1ZmZlciBpdHNcbiAgICAgIC8vIG1lc3NhZ2UsIGFuZCB0aGVuIHdlIGNhbiBlaXRoZXIgZGlyZWN0bHkgYXBwbHkgaXQgYXQgZW5kVXBkYXRlIHRpbWUgaWZcbiAgICAgIC8vIGl0IHdhcyB0aGUgb25seSB1cGRhdGUsIG9yIGRvIHBhdXNlT2JzZXJ2ZXJzL2FwcGx5L2FwcGx5IGF0IHRoZSBuZXh0XG4gICAgICAvLyB1cGRhdGUoKSBpZiB0aGVyZSdzIGFub3RoZXIgb25lLlxuICAgICAgYmVnaW5VcGRhdGUoYmF0Y2hTaXplLCByZXNldCkge1xuICAgICAgICAvLyBwYXVzZSBvYnNlcnZlcnMgc28gdXNlcnMgZG9uJ3Qgc2VlIGZsaWNrZXIgd2hlbiB1cGRhdGluZyBzZXZlcmFsXG4gICAgICAgIC8vIG9iamVjdHMgYXQgb25jZSAoaW5jbHVkaW5nIHRoZSBwb3N0LXJlY29ubmVjdCByZXNldC1hbmQtcmVhcHBseVxuICAgICAgICAvLyBzdGFnZSksIGFuZCBzbyB0aGF0IGEgcmUtc29ydGluZyBvZiBhIHF1ZXJ5IGNhbiB0YWtlIGFkdmFudGFnZSBvZiB0aGVcbiAgICAgICAgLy8gZnVsbCBfZGlmZlF1ZXJ5IG1vdmVkIGNhbGN1bGF0aW9uIGluc3RlYWQgb2YgYXBwbHlpbmcgY2hhbmdlIG9uZSBhdCBhXG4gICAgICAgIC8vIHRpbWUuXG4gICAgICAgIGlmIChiYXRjaFNpemUgPiAxIHx8IHJlc2V0KVxuICAgICAgICAgIHNlbGYuX2NvbGxlY3Rpb24ucGF1c2VPYnNlcnZlcnMoKTtcblxuICAgICAgICBpZiAocmVzZXQpXG4gICAgICAgICAgc2VsZi5fY29sbGVjdGlvbi5yZW1vdmUoe30pO1xuICAgICAgfSxcblxuICAgICAgLy8gQXBwbHkgYW4gdXBkYXRlLlxuICAgICAgLy8gWFhYIGJldHRlciBzcGVjaWZ5IHRoaXMgaW50ZXJmYWNlIChub3QgaW4gdGVybXMgb2YgYSB3aXJlIG1lc3NhZ2UpP1xuICAgICAgdXBkYXRlKG1zZykge1xuICAgICAgICB2YXIgbW9uZ29JZCA9IE1vbmdvSUQuaWRQYXJzZShtc2cuaWQpO1xuICAgICAgICB2YXIgZG9jID0gc2VsZi5fY29sbGVjdGlvbi5fZG9jcy5nZXQobW9uZ29JZCk7XG5cbiAgICAgICAgLy8gSXMgdGhpcyBhIFwicmVwbGFjZSB0aGUgd2hvbGUgZG9jXCIgbWVzc2FnZSBjb21pbmcgZnJvbSB0aGUgcXVpZXNjZW5jZVxuICAgICAgICAvLyBvZiBtZXRob2Qgd3JpdGVzIHRvIGFuIG9iamVjdD8gKE5vdGUgdGhhdCAndW5kZWZpbmVkJyBpcyBhIHZhbGlkXG4gICAgICAgIC8vIHZhbHVlIG1lYW5pbmcgXCJyZW1vdmUgaXRcIi4pXG4gICAgICAgIGlmIChtc2cubXNnID09PSAncmVwbGFjZScpIHtcbiAgICAgICAgICB2YXIgcmVwbGFjZSA9IG1zZy5yZXBsYWNlO1xuICAgICAgICAgIGlmICghcmVwbGFjZSkge1xuICAgICAgICAgICAgaWYgKGRvYylcbiAgICAgICAgICAgICAgc2VsZi5fY29sbGVjdGlvbi5yZW1vdmUobW9uZ29JZCk7XG4gICAgICAgICAgfSBlbHNlIGlmICghZG9jKSB7XG4gICAgICAgICAgICBzZWxmLl9jb2xsZWN0aW9uLmluc2VydChyZXBsYWNlKTtcbiAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgLy8gWFhYIGNoZWNrIHRoYXQgcmVwbGFjZSBoYXMgbm8gJCBvcHNcbiAgICAgICAgICAgIHNlbGYuX2NvbGxlY3Rpb24udXBkYXRlKG1vbmdvSWQsIHJlcGxhY2UpO1xuICAgICAgICAgIH1cbiAgICAgICAgICByZXR1cm47XG4gICAgICAgIH0gZWxzZSBpZiAobXNnLm1zZyA9PT0gJ2FkZGVkJykge1xuICAgICAgICAgIGlmIChkb2MpIHtcbiAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcihcIkV4cGVjdGVkIG5vdCB0byBmaW5kIGEgZG9jdW1lbnQgYWxyZWFkeSBwcmVzZW50IGZvciBhbiBhZGRcIik7XG4gICAgICAgICAgfVxuICAgICAgICAgIHNlbGYuX2NvbGxlY3Rpb24uaW5zZXJ0KHsgX2lkOiBtb25nb0lkLCAuLi5tc2cuZmllbGRzIH0pO1xuICAgICAgICB9IGVsc2UgaWYgKG1zZy5tc2cgPT09ICdyZW1vdmVkJykge1xuICAgICAgICAgIGlmICghZG9jKVxuICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKFwiRXhwZWN0ZWQgdG8gZmluZCBhIGRvY3VtZW50IGFscmVhZHkgcHJlc2VudCBmb3IgcmVtb3ZlZFwiKTtcbiAgICAgICAgICBzZWxmLl9jb2xsZWN0aW9uLnJlbW92ZShtb25nb0lkKTtcbiAgICAgICAgfSBlbHNlIGlmIChtc2cubXNnID09PSAnY2hhbmdlZCcpIHtcbiAgICAgICAgICBpZiAoIWRvYylcbiAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcihcIkV4cGVjdGVkIHRvIGZpbmQgYSBkb2N1bWVudCB0byBjaGFuZ2VcIik7XG4gICAgICAgICAgY29uc3Qga2V5cyA9IE9iamVjdC5rZXlzKG1zZy5maWVsZHMpO1xuICAgICAgICAgIGlmIChrZXlzLmxlbmd0aCA+IDApIHtcbiAgICAgICAgICAgIHZhciBtb2RpZmllciA9IHt9O1xuICAgICAgICAgICAga2V5cy5mb3JFYWNoKGtleSA9PiB7XG4gICAgICAgICAgICAgIGNvbnN0IHZhbHVlID0gbXNnLmZpZWxkc1trZXldO1xuICAgICAgICAgICAgICBpZiAoRUpTT04uZXF1YWxzKGRvY1trZXldLCB2YWx1ZSkpIHtcbiAgICAgICAgICAgICAgICByZXR1cm47XG4gICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgaWYgKHR5cGVvZiB2YWx1ZSA9PT0gXCJ1bmRlZmluZWRcIikge1xuICAgICAgICAgICAgICAgIGlmICghbW9kaWZpZXIuJHVuc2V0KSB7XG4gICAgICAgICAgICAgICAgICBtb2RpZmllci4kdW5zZXQgPSB7fTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgbW9kaWZpZXIuJHVuc2V0W2tleV0gPSAxO1xuICAgICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgIGlmICghbW9kaWZpZXIuJHNldCkge1xuICAgICAgICAgICAgICAgICAgbW9kaWZpZXIuJHNldCA9IHt9O1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICBtb2RpZmllci4kc2V0W2tleV0gPSB2YWx1ZTtcbiAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICBpZiAoT2JqZWN0LmtleXMobW9kaWZpZXIpLmxlbmd0aCA+IDApIHtcbiAgICAgICAgICAgICAgc2VsZi5fY29sbGVjdGlvbi51cGRhdGUobW9uZ29JZCwgbW9kaWZpZXIpO1xuICAgICAgICAgICAgfVxuICAgICAgICAgIH1cbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoXCJJIGRvbid0IGtub3cgaG93IHRvIGRlYWwgd2l0aCB0aGlzIG1lc3NhZ2VcIik7XG4gICAgICAgIH1cbiAgICAgIH0sXG5cbiAgICAgIC8vIENhbGxlZCBhdCB0aGUgZW5kIG9mIGEgYmF0Y2ggb2YgdXBkYXRlcy5cbiAgICAgIGVuZFVwZGF0ZSgpIHtcbiAgICAgICAgc2VsZi5fY29sbGVjdGlvbi5yZXN1bWVPYnNlcnZlcnMoKTtcbiAgICAgIH0sXG5cbiAgICAgIC8vIENhbGxlZCBhcm91bmQgbWV0aG9kIHN0dWIgaW52b2NhdGlvbnMgdG8gY2FwdHVyZSB0aGUgb3JpZ2luYWwgdmVyc2lvbnNcbiAgICAgIC8vIG9mIG1vZGlmaWVkIGRvY3VtZW50cy5cbiAgICAgIHNhdmVPcmlnaW5hbHMoKSB7XG4gICAgICAgIHNlbGYuX2NvbGxlY3Rpb24uc2F2ZU9yaWdpbmFscygpO1xuICAgICAgfSxcbiAgICAgIHJldHJpZXZlT3JpZ2luYWxzKCkge1xuICAgICAgICByZXR1cm4gc2VsZi5fY29sbGVjdGlvbi5yZXRyaWV2ZU9yaWdpbmFscygpO1xuICAgICAgfSxcblxuICAgICAgLy8gVXNlZCB0byBwcmVzZXJ2ZSBjdXJyZW50IHZlcnNpb25zIG9mIGRvY3VtZW50cyBhY3Jvc3MgYSBzdG9yZSByZXNldC5cbiAgICAgIGdldERvYyhpZCkge1xuICAgICAgICByZXR1cm4gc2VsZi5maW5kT25lKGlkKTtcbiAgICAgIH0sXG5cbiAgICAgIC8vIFRvIGJlIGFibGUgdG8gZ2V0IGJhY2sgdG8gdGhlIGNvbGxlY3Rpb24gZnJvbSB0aGUgc3RvcmUuXG4gICAgICBfZ2V0Q29sbGVjdGlvbigpIHtcbiAgICAgICAgcmV0dXJuIHNlbGY7XG4gICAgICB9XG4gICAgfSk7XG5cbiAgICBpZiAoISBvaykge1xuICAgICAgY29uc3QgbWVzc2FnZSA9IGBUaGVyZSBpcyBhbHJlYWR5IGEgY29sbGVjdGlvbiBuYW1lZCBcIiR7bmFtZX1cImA7XG4gICAgICBpZiAoX3N1cHByZXNzU2FtZU5hbWVFcnJvciA9PT0gdHJ1ZSkge1xuICAgICAgICAvLyBYWFggSW4gdGhlb3J5IHdlIGRvIG5vdCBoYXZlIHRvIHRocm93IHdoZW4gYG9rYCBpcyBmYWxzeS4gVGhlXG4gICAgICAgIC8vIHN0b3JlIGlzIGFscmVhZHkgZGVmaW5lZCBmb3IgdGhpcyBjb2xsZWN0aW9uIG5hbWUsIGJ1dCB0aGlzXG4gICAgICAgIC8vIHdpbGwgc2ltcGx5IGJlIGFub3RoZXIgcmVmZXJlbmNlIHRvIGl0IGFuZCBldmVyeXRoaW5nIHNob3VsZFxuICAgICAgICAvLyB3b3JrLiBIb3dldmVyLCB3ZSBoYXZlIGhpc3RvcmljYWxseSB0aHJvd24gYW4gZXJyb3IgaGVyZSwgc29cbiAgICAgICAgLy8gZm9yIG5vdyB3ZSB3aWxsIHNraXAgdGhlIGVycm9yIG9ubHkgd2hlbiBfc3VwcHJlc3NTYW1lTmFtZUVycm9yXG4gICAgICAgIC8vIGlzIGB0cnVlYCwgYWxsb3dpbmcgcGVvcGxlIHRvIG9wdCBpbiBhbmQgZ2l2ZSB0aGlzIHNvbWUgcmVhbFxuICAgICAgICAvLyB3b3JsZCB0ZXN0aW5nLlxuICAgICAgICBjb25zb2xlLndhcm4gPyBjb25zb2xlLndhcm4obWVzc2FnZSkgOiBjb25zb2xlLmxvZyhtZXNzYWdlKTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIHRocm93IG5ldyBFcnJvcihtZXNzYWdlKTtcbiAgICAgIH1cbiAgICB9XG4gIH0sXG5cbiAgLy8vXG4gIC8vLyBNYWluIGNvbGxlY3Rpb24gQVBJXG4gIC8vL1xuXG4gIF9nZXRGaW5kU2VsZWN0b3IoYXJncykge1xuICAgIGlmIChhcmdzLmxlbmd0aCA9PSAwKVxuICAgICAgcmV0dXJuIHt9O1xuICAgIGVsc2VcbiAgICAgIHJldHVybiBhcmdzWzBdO1xuICB9LFxuXG4gIF9nZXRGaW5kT3B0aW9ucyhhcmdzKSB7XG4gICAgdmFyIHNlbGYgPSB0aGlzO1xuICAgIGlmIChhcmdzLmxlbmd0aCA8IDIpIHtcbiAgICAgIHJldHVybiB7IHRyYW5zZm9ybTogc2VsZi5fdHJhbnNmb3JtIH07XG4gICAgfSBlbHNlIHtcbiAgICAgIGNoZWNrKGFyZ3NbMV0sIE1hdGNoLk9wdGlvbmFsKE1hdGNoLk9iamVjdEluY2x1ZGluZyh7XG4gICAgICAgIGZpZWxkczogTWF0Y2guT3B0aW9uYWwoTWF0Y2guT25lT2YoT2JqZWN0LCB1bmRlZmluZWQpKSxcbiAgICAgICAgc29ydDogTWF0Y2guT3B0aW9uYWwoTWF0Y2guT25lT2YoT2JqZWN0LCBBcnJheSwgRnVuY3Rpb24sIHVuZGVmaW5lZCkpLFxuICAgICAgICBsaW1pdDogTWF0Y2guT3B0aW9uYWwoTWF0Y2guT25lT2YoTnVtYmVyLCB1bmRlZmluZWQpKSxcbiAgICAgICAgc2tpcDogTWF0Y2guT3B0aW9uYWwoTWF0Y2guT25lT2YoTnVtYmVyLCB1bmRlZmluZWQpKVxuICAgICAgfSkpKTtcblxuICAgICAgcmV0dXJuIHtcbiAgICAgICAgdHJhbnNmb3JtOiBzZWxmLl90cmFuc2Zvcm0sXG4gICAgICAgIC4uLmFyZ3NbMV0sXG4gICAgICB9O1xuICAgIH1cbiAgfSxcblxuICAvKipcbiAgICogQHN1bW1hcnkgRmluZCB0aGUgZG9jdW1lbnRzIGluIGEgY29sbGVjdGlvbiB0aGF0IG1hdGNoIHRoZSBzZWxlY3Rvci5cbiAgICogQGxvY3VzIEFueXdoZXJlXG4gICAqIEBtZXRob2QgZmluZFxuICAgKiBAbWVtYmVyb2YgTW9uZ28uQ29sbGVjdGlvblxuICAgKiBAaW5zdGFuY2VcbiAgICogQHBhcmFtIHtNb25nb1NlbGVjdG9yfSBbc2VsZWN0b3JdIEEgcXVlcnkgZGVzY3JpYmluZyB0aGUgZG9jdW1lbnRzIHRvIGZpbmRcbiAgICogQHBhcmFtIHtPYmplY3R9IFtvcHRpb25zXVxuICAgKiBAcGFyYW0ge01vbmdvU29ydFNwZWNpZmllcn0gb3B0aW9ucy5zb3J0IFNvcnQgb3JkZXIgKGRlZmF1bHQ6IG5hdHVyYWwgb3JkZXIpXG4gICAqIEBwYXJhbSB7TnVtYmVyfSBvcHRpb25zLnNraXAgTnVtYmVyIG9mIHJlc3VsdHMgdG8gc2tpcCBhdCB0aGUgYmVnaW5uaW5nXG4gICAqIEBwYXJhbSB7TnVtYmVyfSBvcHRpb25zLmxpbWl0IE1heGltdW0gbnVtYmVyIG9mIHJlc3VsdHMgdG8gcmV0dXJuXG4gICAqIEBwYXJhbSB7TW9uZ29GaWVsZFNwZWNpZmllcn0gb3B0aW9ucy5maWVsZHMgRGljdGlvbmFyeSBvZiBmaWVsZHMgdG8gcmV0dXJuIG9yIGV4Y2x1ZGUuXG4gICAqIEBwYXJhbSB7Qm9vbGVhbn0gb3B0aW9ucy5yZWFjdGl2ZSAoQ2xpZW50IG9ubHkpIERlZmF1bHQgYHRydWVgOyBwYXNzIGBmYWxzZWAgdG8gZGlzYWJsZSByZWFjdGl2aXR5XG4gICAqIEBwYXJhbSB7RnVuY3Rpb259IG9wdGlvbnMudHJhbnNmb3JtIE92ZXJyaWRlcyBgdHJhbnNmb3JtYCBvbiB0aGUgIFtgQ29sbGVjdGlvbmBdKCNjb2xsZWN0aW9ucykgZm9yIHRoaXMgY3Vyc29yLiAgUGFzcyBgbnVsbGAgdG8gZGlzYWJsZSB0cmFuc2Zvcm1hdGlvbi5cbiAgICogQHBhcmFtIHtCb29sZWFufSBvcHRpb25zLmRpc2FibGVPcGxvZyAoU2VydmVyIG9ubHkpIFBhc3MgdHJ1ZSB0byBkaXNhYmxlIG9wbG9nLXRhaWxpbmcgb24gdGhpcyBxdWVyeS4gVGhpcyBhZmZlY3RzIHRoZSB3YXkgc2VydmVyIHByb2Nlc3NlcyBjYWxscyB0byBgb2JzZXJ2ZWAgb24gdGhpcyBxdWVyeS4gRGlzYWJsaW5nIHRoZSBvcGxvZyBjYW4gYmUgdXNlZnVsIHdoZW4gd29ya2luZyB3aXRoIGRhdGEgdGhhdCB1cGRhdGVzIGluIGxhcmdlIGJhdGNoZXMuXG4gICAqIEBwYXJhbSB7TnVtYmVyfSBvcHRpb25zLnBvbGxpbmdJbnRlcnZhbE1zIChTZXJ2ZXIgb25seSkgV2hlbiBvcGxvZyBpcyBkaXNhYmxlZCAodGhyb3VnaCB0aGUgdXNlIG9mIGBkaXNhYmxlT3Bsb2dgIG9yIHdoZW4gb3RoZXJ3aXNlIG5vdCBhdmFpbGFibGUpLCB0aGUgZnJlcXVlbmN5IChpbiBtaWxsaXNlY29uZHMpIG9mIGhvdyBvZnRlbiB0byBwb2xsIHRoaXMgcXVlcnkgd2hlbiBvYnNlcnZpbmcgb24gdGhlIHNlcnZlci4gRGVmYXVsdHMgdG8gMTAwMDBtcyAoMTAgc2Vjb25kcykuXG4gICAqIEBwYXJhbSB7TnVtYmVyfSBvcHRpb25zLnBvbGxpbmdUaHJvdHRsZU1zIChTZXJ2ZXIgb25seSkgV2hlbiBvcGxvZyBpcyBkaXNhYmxlZCAodGhyb3VnaCB0aGUgdXNlIG9mIGBkaXNhYmxlT3Bsb2dgIG9yIHdoZW4gb3RoZXJ3aXNlIG5vdCBhdmFpbGFibGUpLCB0aGUgbWluaW11bSB0aW1lIChpbiBtaWxsaXNlY29uZHMpIHRvIGFsbG93IGJldHdlZW4gcmUtcG9sbGluZyB3aGVuIG9ic2VydmluZyBvbiB0aGUgc2VydmVyLiBJbmNyZWFzaW5nIHRoaXMgd2lsbCBzYXZlIENQVSBhbmQgbW9uZ28gbG9hZCBhdCB0aGUgZXhwZW5zZSBvZiBzbG93ZXIgdXBkYXRlcyB0byB1c2Vycy4gRGVjcmVhc2luZyB0aGlzIGlzIG5vdCByZWNvbW1lbmRlZC4gRGVmYXVsdHMgdG8gNTBtcy5cbiAgICogQHBhcmFtIHtOdW1iZXJ9IG9wdGlvbnMubWF4VGltZU1zIChTZXJ2ZXIgb25seSkgSWYgc2V0LCBpbnN0cnVjdHMgTW9uZ29EQiB0byBzZXQgYSB0aW1lIGxpbWl0IGZvciB0aGlzIGN1cnNvcidzIG9wZXJhdGlvbnMuIElmIHRoZSBvcGVyYXRpb24gcmVhY2hlcyB0aGUgc3BlY2lmaWVkIHRpbWUgbGltaXQgKGluIG1pbGxpc2Vjb25kcykgd2l0aG91dCB0aGUgaGF2aW5nIGJlZW4gY29tcGxldGVkLCBhbiBleGNlcHRpb24gd2lsbCBiZSB0aHJvd24uIFVzZWZ1bCB0byBwcmV2ZW50IGFuIChhY2NpZGVudGFsIG9yIG1hbGljaW91cykgdW5vcHRpbWl6ZWQgcXVlcnkgZnJvbSBjYXVzaW5nIGEgZnVsbCBjb2xsZWN0aW9uIHNjYW4gdGhhdCB3b3VsZCBkaXNydXB0IG90aGVyIGRhdGFiYXNlIHVzZXJzLCBhdCB0aGUgZXhwZW5zZSBvZiBuZWVkaW5nIHRvIGhhbmRsZSB0aGUgcmVzdWx0aW5nIGVycm9yLlxuICAgKiBAcGFyYW0ge1N0cmluZ3xPYmplY3R9IG9wdGlvbnMuaGludCAoU2VydmVyIG9ubHkpIE92ZXJyaWRlcyBNb25nb0RCJ3MgZGVmYXVsdCBpbmRleCBzZWxlY3Rpb24gYW5kIHF1ZXJ5IG9wdGltaXphdGlvbiBwcm9jZXNzLiBTcGVjaWZ5IGFuIGluZGV4IHRvIGZvcmNlIGl0cyB1c2UsIGVpdGhlciBieSBpdHMgbmFtZSBvciBpbmRleCBzcGVjaWZpY2F0aW9uLiBZb3UgY2FuIGFsc28gc3BlY2lmeSBgeyAkbmF0dXJhbCA6IDEgfWAgdG8gZm9yY2UgYSBmb3J3YXJkcyBjb2xsZWN0aW9uIHNjYW4sIG9yIGB7ICRuYXR1cmFsIDogLTEgfWAgZm9yIGEgcmV2ZXJzZSBjb2xsZWN0aW9uIHNjYW4uIFNldHRpbmcgdGhpcyBpcyBvbmx5IHJlY29tbWVuZGVkIGZvciBhZHZhbmNlZCB1c2Vycy5cbiAgICogQHJldHVybnMge01vbmdvLkN1cnNvcn1cbiAgICovXG4gIGZpbmQoLi4uYXJncykge1xuICAgIC8vIENvbGxlY3Rpb24uZmluZCgpIChyZXR1cm4gYWxsIGRvY3MpIGJlaGF2ZXMgZGlmZmVyZW50bHlcbiAgICAvLyBmcm9tIENvbGxlY3Rpb24uZmluZCh1bmRlZmluZWQpIChyZXR1cm4gMCBkb2NzKS4gIHNvIGJlXG4gICAgLy8gY2FyZWZ1bCBhYm91dCB0aGUgbGVuZ3RoIG9mIGFyZ3VtZW50cy5cbiAgICByZXR1cm4gdGhpcy5fY29sbGVjdGlvbi5maW5kKFxuICAgICAgdGhpcy5fZ2V0RmluZFNlbGVjdG9yKGFyZ3MpLFxuICAgICAgdGhpcy5fZ2V0RmluZE9wdGlvbnMoYXJncylcbiAgICApO1xuICB9LFxuXG4gIC8qKlxuICAgKiBAc3VtbWFyeSBGaW5kcyB0aGUgZmlyc3QgZG9jdW1lbnQgdGhhdCBtYXRjaGVzIHRoZSBzZWxlY3RvciwgYXMgb3JkZXJlZCBieSBzb3J0IGFuZCBza2lwIG9wdGlvbnMuIFJldHVybnMgYHVuZGVmaW5lZGAgaWYgbm8gbWF0Y2hpbmcgZG9jdW1lbnQgaXMgZm91bmQuXG4gICAqIEBsb2N1cyBBbnl3aGVyZVxuICAgKiBAbWV0aG9kIGZpbmRPbmVcbiAgICogQG1lbWJlcm9mIE1vbmdvLkNvbGxlY3Rpb25cbiAgICogQGluc3RhbmNlXG4gICAqIEBwYXJhbSB7TW9uZ29TZWxlY3Rvcn0gW3NlbGVjdG9yXSBBIHF1ZXJ5IGRlc2NyaWJpbmcgdGhlIGRvY3VtZW50cyB0byBmaW5kXG4gICAqIEBwYXJhbSB7T2JqZWN0fSBbb3B0aW9uc11cbiAgICogQHBhcmFtIHtNb25nb1NvcnRTcGVjaWZpZXJ9IG9wdGlvbnMuc29ydCBTb3J0IG9yZGVyIChkZWZhdWx0OiBuYXR1cmFsIG9yZGVyKVxuICAgKiBAcGFyYW0ge051bWJlcn0gb3B0aW9ucy5za2lwIE51bWJlciBvZiByZXN1bHRzIHRvIHNraXAgYXQgdGhlIGJlZ2lubmluZ1xuICAgKiBAcGFyYW0ge01vbmdvRmllbGRTcGVjaWZpZXJ9IG9wdGlvbnMuZmllbGRzIERpY3Rpb25hcnkgb2YgZmllbGRzIHRvIHJldHVybiBvciBleGNsdWRlLlxuICAgKiBAcGFyYW0ge0Jvb2xlYW59IG9wdGlvbnMucmVhY3RpdmUgKENsaWVudCBvbmx5KSBEZWZhdWx0IHRydWU7IHBhc3MgZmFsc2UgdG8gZGlzYWJsZSByZWFjdGl2aXR5XG4gICAqIEBwYXJhbSB7RnVuY3Rpb259IG9wdGlvbnMudHJhbnNmb3JtIE92ZXJyaWRlcyBgdHJhbnNmb3JtYCBvbiB0aGUgW2BDb2xsZWN0aW9uYF0oI2NvbGxlY3Rpb25zKSBmb3IgdGhpcyBjdXJzb3IuICBQYXNzIGBudWxsYCB0byBkaXNhYmxlIHRyYW5zZm9ybWF0aW9uLlxuICAgKiBAcmV0dXJucyB7T2JqZWN0fVxuICAgKi9cbiAgZmluZE9uZSguLi5hcmdzKSB7XG4gICAgcmV0dXJuIHRoaXMuX2NvbGxlY3Rpb24uZmluZE9uZShcbiAgICAgIHRoaXMuX2dldEZpbmRTZWxlY3RvcihhcmdzKSxcbiAgICAgIHRoaXMuX2dldEZpbmRPcHRpb25zKGFyZ3MpXG4gICAgKTtcbiAgfVxufSk7XG5cbk9iamVjdC5hc3NpZ24oTW9uZ28uQ29sbGVjdGlvbiwge1xuICBfcHVibGlzaEN1cnNvcihjdXJzb3IsIHN1YiwgY29sbGVjdGlvbikge1xuICAgIHZhciBvYnNlcnZlSGFuZGxlID0gY3Vyc29yLm9ic2VydmVDaGFuZ2VzKHtcbiAgICAgIGFkZGVkOiBmdW5jdGlvbiAoaWQsIGZpZWxkcykge1xuICAgICAgICBzdWIuYWRkZWQoY29sbGVjdGlvbiwgaWQsIGZpZWxkcyk7XG4gICAgICB9LFxuICAgICAgY2hhbmdlZDogZnVuY3Rpb24gKGlkLCBmaWVsZHMpIHtcbiAgICAgICAgc3ViLmNoYW5nZWQoY29sbGVjdGlvbiwgaWQsIGZpZWxkcyk7XG4gICAgICB9LFxuICAgICAgcmVtb3ZlZDogZnVuY3Rpb24gKGlkKSB7XG4gICAgICAgIHN1Yi5yZW1vdmVkKGNvbGxlY3Rpb24sIGlkKTtcbiAgICAgIH1cbiAgICB9LFxuICAgIC8vIFB1YmxpY2F0aW9ucyBkb24ndCBtdXRhdGUgdGhlIGRvY3VtZW50c1xuICAgIC8vIFRoaXMgaXMgdGVzdGVkIGJ5IHRoZSBgbGl2ZWRhdGEgLSBwdWJsaXNoIGNhbGxiYWNrcyBjbG9uZWAgdGVzdFxuICAgIHsgbm9uTXV0YXRpbmdDYWxsYmFja3M6IHRydWUgfSk7XG5cbiAgICAvLyBXZSBkb24ndCBjYWxsIHN1Yi5yZWFkeSgpIGhlcmU6IGl0IGdldHMgY2FsbGVkIGluIGxpdmVkYXRhX3NlcnZlciwgYWZ0ZXJcbiAgICAvLyBwb3NzaWJseSBjYWxsaW5nIF9wdWJsaXNoQ3Vyc29yIG9uIG11bHRpcGxlIHJldHVybmVkIGN1cnNvcnMuXG5cbiAgICAvLyByZWdpc3RlciBzdG9wIGNhbGxiYWNrIChleHBlY3RzIGxhbWJkYSB3LyBubyBhcmdzKS5cbiAgICBzdWIub25TdG9wKGZ1bmN0aW9uICgpIHtcbiAgICAgIG9ic2VydmVIYW5kbGUuc3RvcCgpO1xuICAgIH0pO1xuXG4gICAgLy8gcmV0dXJuIHRoZSBvYnNlcnZlSGFuZGxlIGluIGNhc2UgaXQgbmVlZHMgdG8gYmUgc3RvcHBlZCBlYXJseVxuICAgIHJldHVybiBvYnNlcnZlSGFuZGxlO1xuICB9LFxuXG4gIC8vIHByb3RlY3QgYWdhaW5zdCBkYW5nZXJvdXMgc2VsZWN0b3JzLiAgZmFsc2V5IGFuZCB7X2lkOiBmYWxzZXl9IGFyZSBib3RoXG4gIC8vIGxpa2VseSBwcm9ncmFtbWVyIGVycm9yLCBhbmQgbm90IHdoYXQgeW91IHdhbnQsIHBhcnRpY3VsYXJseSBmb3IgZGVzdHJ1Y3RpdmVcbiAgLy8gb3BlcmF0aW9ucy4gSWYgYSBmYWxzZXkgX2lkIGlzIHNlbnQgaW4sIGEgbmV3IHN0cmluZyBfaWQgd2lsbCBiZVxuICAvLyBnZW5lcmF0ZWQgYW5kIHJldHVybmVkOyBpZiBhIGZhbGxiYWNrSWQgaXMgcHJvdmlkZWQsIGl0IHdpbGwgYmUgcmV0dXJuZWRcbiAgLy8gaW5zdGVhZC5cbiAgX3Jld3JpdGVTZWxlY3RvcihzZWxlY3RvciwgeyBmYWxsYmFja0lkIH0gPSB7fSkge1xuICAgIC8vIHNob3J0aGFuZCAtLSBzY2FsYXJzIG1hdGNoIF9pZFxuICAgIGlmIChMb2NhbENvbGxlY3Rpb24uX3NlbGVjdG9ySXNJZChzZWxlY3RvcikpXG4gICAgICBzZWxlY3RvciA9IHtfaWQ6IHNlbGVjdG9yfTtcblxuICAgIGlmIChBcnJheS5pc0FycmF5KHNlbGVjdG9yKSkge1xuICAgICAgLy8gVGhpcyBpcyBjb25zaXN0ZW50IHdpdGggdGhlIE1vbmdvIGNvbnNvbGUgaXRzZWxmOyBpZiB3ZSBkb24ndCBkbyB0aGlzXG4gICAgICAvLyBjaGVjayBwYXNzaW5nIGFuIGVtcHR5IGFycmF5IGVuZHMgdXAgc2VsZWN0aW5nIGFsbCBpdGVtc1xuICAgICAgdGhyb3cgbmV3IEVycm9yKFwiTW9uZ28gc2VsZWN0b3IgY2FuJ3QgYmUgYW4gYXJyYXkuXCIpO1xuICAgIH1cblxuICAgIGlmICghc2VsZWN0b3IgfHwgKCgnX2lkJyBpbiBzZWxlY3RvcikgJiYgIXNlbGVjdG9yLl9pZCkpIHtcbiAgICAgIC8vIGNhbid0IG1hdGNoIGFueXRoaW5nXG4gICAgICByZXR1cm4geyBfaWQ6IGZhbGxiYWNrSWQgfHwgUmFuZG9tLmlkKCkgfTtcbiAgICB9XG5cbiAgICByZXR1cm4gc2VsZWN0b3I7XG4gIH1cbn0pO1xuXG5PYmplY3QuYXNzaWduKE1vbmdvLkNvbGxlY3Rpb24ucHJvdG90eXBlLCB7XG4gIC8vICdpbnNlcnQnIGltbWVkaWF0ZWx5IHJldHVybnMgdGhlIGluc2VydGVkIGRvY3VtZW50J3MgbmV3IF9pZC5cbiAgLy8gVGhlIG90aGVycyByZXR1cm4gdmFsdWVzIGltbWVkaWF0ZWx5IGlmIHlvdSBhcmUgaW4gYSBzdHViLCBhbiBpbi1tZW1vcnlcbiAgLy8gdW5tYW5hZ2VkIGNvbGxlY3Rpb24sIG9yIGEgbW9uZ28tYmFja2VkIGNvbGxlY3Rpb24gYW5kIHlvdSBkb24ndCBwYXNzIGFcbiAgLy8gY2FsbGJhY2suICd1cGRhdGUnIGFuZCAncmVtb3ZlJyByZXR1cm4gdGhlIG51bWJlciBvZiBhZmZlY3RlZFxuICAvLyBkb2N1bWVudHMuICd1cHNlcnQnIHJldHVybnMgYW4gb2JqZWN0IHdpdGgga2V5cyAnbnVtYmVyQWZmZWN0ZWQnIGFuZCwgaWYgYW5cbiAgLy8gaW5zZXJ0IGhhcHBlbmVkLCAnaW5zZXJ0ZWRJZCcuXG4gIC8vXG4gIC8vIE90aGVyd2lzZSwgdGhlIHNlbWFudGljcyBhcmUgZXhhY3RseSBsaWtlIG90aGVyIG1ldGhvZHM6IHRoZXkgdGFrZVxuICAvLyBhIGNhbGxiYWNrIGFzIGFuIG9wdGlvbmFsIGxhc3QgYXJndW1lbnQ7IGlmIG5vIGNhbGxiYWNrIGlzXG4gIC8vIHByb3ZpZGVkLCB0aGV5IGJsb2NrIHVudGlsIHRoZSBvcGVyYXRpb24gaXMgY29tcGxldGUsIGFuZCB0aHJvdyBhblxuICAvLyBleGNlcHRpb24gaWYgaXQgZmFpbHM7IGlmIGEgY2FsbGJhY2sgaXMgcHJvdmlkZWQsIHRoZW4gdGhleSBkb24ndFxuICAvLyBuZWNlc3NhcmlseSBibG9jaywgYW5kIHRoZXkgY2FsbCB0aGUgY2FsbGJhY2sgd2hlbiB0aGV5IGZpbmlzaCB3aXRoIGVycm9yIGFuZFxuICAvLyByZXN1bHQgYXJndW1lbnRzLiAgKFRoZSBpbnNlcnQgbWV0aG9kIHByb3ZpZGVzIHRoZSBkb2N1bWVudCBJRCBhcyBpdHMgcmVzdWx0O1xuICAvLyB1cGRhdGUgYW5kIHJlbW92ZSBwcm92aWRlIHRoZSBudW1iZXIgb2YgYWZmZWN0ZWQgZG9jcyBhcyB0aGUgcmVzdWx0OyB1cHNlcnRcbiAgLy8gcHJvdmlkZXMgYW4gb2JqZWN0IHdpdGggbnVtYmVyQWZmZWN0ZWQgYW5kIG1heWJlIGluc2VydGVkSWQuKVxuICAvL1xuICAvLyBPbiB0aGUgY2xpZW50LCBibG9ja2luZyBpcyBpbXBvc3NpYmxlLCBzbyBpZiBhIGNhbGxiYWNrXG4gIC8vIGlzbid0IHByb3ZpZGVkLCB0aGV5IGp1c3QgcmV0dXJuIGltbWVkaWF0ZWx5IGFuZCBhbnkgZXJyb3JcbiAgLy8gaW5mb3JtYXRpb24gaXMgbG9zdC5cbiAgLy9cbiAgLy8gVGhlcmUncyBvbmUgbW9yZSB0d2Vhay4gT24gdGhlIGNsaWVudCwgaWYgeW91IGRvbid0IHByb3ZpZGUgYVxuICAvLyBjYWxsYmFjaywgdGhlbiBpZiB0aGVyZSBpcyBhbiBlcnJvciwgYSBtZXNzYWdlIHdpbGwgYmUgbG9nZ2VkIHdpdGhcbiAgLy8gTWV0ZW9yLl9kZWJ1Zy5cbiAgLy9cbiAgLy8gVGhlIGludGVudCAodGhvdWdoIHRoaXMgaXMgYWN0dWFsbHkgZGV0ZXJtaW5lZCBieSB0aGUgdW5kZXJseWluZ1xuICAvLyBkcml2ZXJzKSBpcyB0aGF0IHRoZSBvcGVyYXRpb25zIHNob3VsZCBiZSBkb25lIHN5bmNocm9ub3VzbHksIG5vdFxuICAvLyBnZW5lcmF0aW5nIHRoZWlyIHJlc3VsdCB1bnRpbCB0aGUgZGF0YWJhc2UgaGFzIGFja25vd2xlZGdlZFxuICAvLyB0aGVtLiBJbiB0aGUgZnV0dXJlIG1heWJlIHdlIHNob3VsZCBwcm92aWRlIGEgZmxhZyB0byB0dXJuIHRoaXNcbiAgLy8gb2ZmLlxuXG4gIC8qKlxuICAgKiBAc3VtbWFyeSBJbnNlcnQgYSBkb2N1bWVudCBpbiB0aGUgY29sbGVjdGlvbi4gIFJldHVybnMgaXRzIHVuaXF1ZSBfaWQuXG4gICAqIEBsb2N1cyBBbnl3aGVyZVxuICAgKiBAbWV0aG9kICBpbnNlcnRcbiAgICogQG1lbWJlcm9mIE1vbmdvLkNvbGxlY3Rpb25cbiAgICogQGluc3RhbmNlXG4gICAqIEBwYXJhbSB7T2JqZWN0fSBkb2MgVGhlIGRvY3VtZW50IHRvIGluc2VydC4gTWF5IG5vdCB5ZXQgaGF2ZSBhbiBfaWQgYXR0cmlidXRlLCBpbiB3aGljaCBjYXNlIE1ldGVvciB3aWxsIGdlbmVyYXRlIG9uZSBmb3IgeW91LlxuICAgKiBAcGFyYW0ge0Z1bmN0aW9ufSBbY2FsbGJhY2tdIE9wdGlvbmFsLiAgSWYgcHJlc2VudCwgY2FsbGVkIHdpdGggYW4gZXJyb3Igb2JqZWN0IGFzIHRoZSBmaXJzdCBhcmd1bWVudCBhbmQsIGlmIG5vIGVycm9yLCB0aGUgX2lkIGFzIHRoZSBzZWNvbmQuXG4gICAqL1xuICBpbnNlcnQoZG9jLCBjYWxsYmFjaykge1xuICAgIC8vIE1ha2Ugc3VyZSB3ZSB3ZXJlIHBhc3NlZCBhIGRvY3VtZW50IHRvIGluc2VydFxuICAgIGlmICghZG9jKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXCJpbnNlcnQgcmVxdWlyZXMgYW4gYXJndW1lbnRcIik7XG4gICAgfVxuXG4gICAgLy8gTWFrZSBhIHNoYWxsb3cgY2xvbmUgb2YgdGhlIGRvY3VtZW50LCBwcmVzZXJ2aW5nIGl0cyBwcm90b3R5cGUuXG4gICAgZG9jID0gT2JqZWN0LmNyZWF0ZShcbiAgICAgIE9iamVjdC5nZXRQcm90b3R5cGVPZihkb2MpLFxuICAgICAgT2JqZWN0LmdldE93blByb3BlcnR5RGVzY3JpcHRvcnMoZG9jKVxuICAgICk7XG5cbiAgICBpZiAoJ19pZCcgaW4gZG9jKSB7XG4gICAgICBpZiAoISBkb2MuX2lkIHx8XG4gICAgICAgICAgISAodHlwZW9mIGRvYy5faWQgPT09ICdzdHJpbmcnIHx8XG4gICAgICAgICAgICAgZG9jLl9pZCBpbnN0YW5jZW9mIE1vbmdvLk9iamVjdElEKSkge1xuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoXG4gICAgICAgICAgXCJNZXRlb3IgcmVxdWlyZXMgZG9jdW1lbnQgX2lkIGZpZWxkcyB0byBiZSBub24tZW1wdHkgc3RyaW5ncyBvciBPYmplY3RJRHNcIik7XG4gICAgICB9XG4gICAgfSBlbHNlIHtcbiAgICAgIGxldCBnZW5lcmF0ZUlkID0gdHJ1ZTtcblxuICAgICAgLy8gRG9uJ3QgZ2VuZXJhdGUgdGhlIGlkIGlmIHdlJ3JlIHRoZSBjbGllbnQgYW5kIHRoZSAnb3V0ZXJtb3N0JyBjYWxsXG4gICAgICAvLyBUaGlzIG9wdGltaXphdGlvbiBzYXZlcyB1cyBwYXNzaW5nIGJvdGggdGhlIHJhbmRvbVNlZWQgYW5kIHRoZSBpZFxuICAgICAgLy8gUGFzc2luZyBib3RoIGlzIHJlZHVuZGFudC5cbiAgICAgIGlmICh0aGlzLl9pc1JlbW90ZUNvbGxlY3Rpb24oKSkge1xuICAgICAgICBjb25zdCBlbmNsb3NpbmcgPSBERFAuX0N1cnJlbnRNZXRob2RJbnZvY2F0aW9uLmdldCgpO1xuICAgICAgICBpZiAoIWVuY2xvc2luZykge1xuICAgICAgICAgIGdlbmVyYXRlSWQgPSBmYWxzZTtcbiAgICAgICAgfVxuICAgICAgfVxuXG4gICAgICBpZiAoZ2VuZXJhdGVJZCkge1xuICAgICAgICBkb2MuX2lkID0gdGhpcy5fbWFrZU5ld0lEKCk7XG4gICAgICB9XG4gICAgfVxuXG4gICAgLy8gT24gaW5zZXJ0cywgYWx3YXlzIHJldHVybiB0aGUgaWQgdGhhdCB3ZSBnZW5lcmF0ZWQ7IG9uIGFsbCBvdGhlclxuICAgIC8vIG9wZXJhdGlvbnMsIGp1c3QgcmV0dXJuIHRoZSByZXN1bHQgZnJvbSB0aGUgY29sbGVjdGlvbi5cbiAgICB2YXIgY2hvb3NlUmV0dXJuVmFsdWVGcm9tQ29sbGVjdGlvblJlc3VsdCA9IGZ1bmN0aW9uIChyZXN1bHQpIHtcbiAgICAgIGlmIChkb2MuX2lkKSB7XG4gICAgICAgIHJldHVybiBkb2MuX2lkO1xuICAgICAgfVxuXG4gICAgICAvLyBYWFggd2hhdCBpcyB0aGlzIGZvcj8/XG4gICAgICAvLyBJdCdzIHNvbWUgaXRlcmFjdGlvbiBiZXR3ZWVuIHRoZSBjYWxsYmFjayB0byBfY2FsbE11dGF0b3JNZXRob2QgYW5kXG4gICAgICAvLyB0aGUgcmV0dXJuIHZhbHVlIGNvbnZlcnNpb25cbiAgICAgIGRvYy5faWQgPSByZXN1bHQ7XG5cbiAgICAgIHJldHVybiByZXN1bHQ7XG4gICAgfTtcblxuICAgIGNvbnN0IHdyYXBwZWRDYWxsYmFjayA9IHdyYXBDYWxsYmFjayhcbiAgICAgIGNhbGxiYWNrLCBjaG9vc2VSZXR1cm5WYWx1ZUZyb21Db2xsZWN0aW9uUmVzdWx0KTtcblxuICAgIGlmICh0aGlzLl9pc1JlbW90ZUNvbGxlY3Rpb24oKSkge1xuICAgICAgY29uc3QgcmVzdWx0ID0gdGhpcy5fY2FsbE11dGF0b3JNZXRob2QoXCJpbnNlcnRcIiwgW2RvY10sIHdyYXBwZWRDYWxsYmFjayk7XG4gICAgICByZXR1cm4gY2hvb3NlUmV0dXJuVmFsdWVGcm9tQ29sbGVjdGlvblJlc3VsdChyZXN1bHQpO1xuICAgIH1cblxuICAgIC8vIGl0J3MgbXkgY29sbGVjdGlvbi4gIGRlc2NlbmQgaW50byB0aGUgY29sbGVjdGlvbiBvYmplY3RcbiAgICAvLyBhbmQgcHJvcGFnYXRlIGFueSBleGNlcHRpb24uXG4gICAgdHJ5IHtcbiAgICAgIC8vIElmIHRoZSB1c2VyIHByb3ZpZGVkIGEgY2FsbGJhY2sgYW5kIHRoZSBjb2xsZWN0aW9uIGltcGxlbWVudHMgdGhpc1xuICAgICAgLy8gb3BlcmF0aW9uIGFzeW5jaHJvbm91c2x5LCB0aGVuIHF1ZXJ5UmV0IHdpbGwgYmUgdW5kZWZpbmVkLCBhbmQgdGhlXG4gICAgICAvLyByZXN1bHQgd2lsbCBiZSByZXR1cm5lZCB0aHJvdWdoIHRoZSBjYWxsYmFjayBpbnN0ZWFkLlxuICAgICAgY29uc3QgcmVzdWx0ID0gdGhpcy5fY29sbGVjdGlvbi5pbnNlcnQoZG9jLCB3cmFwcGVkQ2FsbGJhY2spO1xuICAgICAgcmV0dXJuIGNob29zZVJldHVyblZhbHVlRnJvbUNvbGxlY3Rpb25SZXN1bHQocmVzdWx0KTtcbiAgICB9IGNhdGNoIChlKSB7XG4gICAgICBpZiAoY2FsbGJhY2spIHtcbiAgICAgICAgY2FsbGJhY2soZSk7XG4gICAgICAgIHJldHVybiBudWxsO1xuICAgICAgfVxuICAgICAgdGhyb3cgZTtcbiAgICB9XG4gIH0sXG5cbiAgLyoqXG4gICAqIEBzdW1tYXJ5IE1vZGlmeSBvbmUgb3IgbW9yZSBkb2N1bWVudHMgaW4gdGhlIGNvbGxlY3Rpb24uIFJldHVybnMgdGhlIG51bWJlciBvZiBtYXRjaGVkIGRvY3VtZW50cy5cbiAgICogQGxvY3VzIEFueXdoZXJlXG4gICAqIEBtZXRob2QgdXBkYXRlXG4gICAqIEBtZW1iZXJvZiBNb25nby5Db2xsZWN0aW9uXG4gICAqIEBpbnN0YW5jZVxuICAgKiBAcGFyYW0ge01vbmdvU2VsZWN0b3J9IHNlbGVjdG9yIFNwZWNpZmllcyB3aGljaCBkb2N1bWVudHMgdG8gbW9kaWZ5XG4gICAqIEBwYXJhbSB7TW9uZ29Nb2RpZmllcn0gbW9kaWZpZXIgU3BlY2lmaWVzIGhvdyB0byBtb2RpZnkgdGhlIGRvY3VtZW50c1xuICAgKiBAcGFyYW0ge09iamVjdH0gW29wdGlvbnNdXG4gICAqIEBwYXJhbSB7Qm9vbGVhbn0gb3B0aW9ucy5tdWx0aSBUcnVlIHRvIG1vZGlmeSBhbGwgbWF0Y2hpbmcgZG9jdW1lbnRzOyBmYWxzZSB0byBvbmx5IG1vZGlmeSBvbmUgb2YgdGhlIG1hdGNoaW5nIGRvY3VtZW50cyAodGhlIGRlZmF1bHQpLlxuICAgKiBAcGFyYW0ge0Jvb2xlYW59IG9wdGlvbnMudXBzZXJ0IFRydWUgdG8gaW5zZXJ0IGEgZG9jdW1lbnQgaWYgbm8gbWF0Y2hpbmcgZG9jdW1lbnRzIGFyZSBmb3VuZC5cbiAgICogQHBhcmFtIHtGdW5jdGlvbn0gW2NhbGxiYWNrXSBPcHRpb25hbC4gIElmIHByZXNlbnQsIGNhbGxlZCB3aXRoIGFuIGVycm9yIG9iamVjdCBhcyB0aGUgZmlyc3QgYXJndW1lbnQgYW5kLCBpZiBubyBlcnJvciwgdGhlIG51bWJlciBvZiBhZmZlY3RlZCBkb2N1bWVudHMgYXMgdGhlIHNlY29uZC5cbiAgICovXG4gIHVwZGF0ZShzZWxlY3RvciwgbW9kaWZpZXIsIC4uLm9wdGlvbnNBbmRDYWxsYmFjaykge1xuICAgIGNvbnN0IGNhbGxiYWNrID0gcG9wQ2FsbGJhY2tGcm9tQXJncyhvcHRpb25zQW5kQ2FsbGJhY2spO1xuXG4gICAgLy8gV2UndmUgYWxyZWFkeSBwb3BwZWQgb2ZmIHRoZSBjYWxsYmFjaywgc28gd2UgYXJlIGxlZnQgd2l0aCBhbiBhcnJheVxuICAgIC8vIG9mIG9uZSBvciB6ZXJvIGl0ZW1zXG4gICAgY29uc3Qgb3B0aW9ucyA9IHsgLi4uKG9wdGlvbnNBbmRDYWxsYmFja1swXSB8fCBudWxsKSB9O1xuICAgIGxldCBpbnNlcnRlZElkO1xuICAgIGlmIChvcHRpb25zICYmIG9wdGlvbnMudXBzZXJ0KSB7XG4gICAgICAvLyBzZXQgYGluc2VydGVkSWRgIGlmIGFic2VudC4gIGBpbnNlcnRlZElkYCBpcyBhIE1ldGVvciBleHRlbnNpb24uXG4gICAgICBpZiAob3B0aW9ucy5pbnNlcnRlZElkKSB7XG4gICAgICAgIGlmICghKHR5cGVvZiBvcHRpb25zLmluc2VydGVkSWQgPT09ICdzdHJpbmcnIHx8IG9wdGlvbnMuaW5zZXJ0ZWRJZCBpbnN0YW5jZW9mIE1vbmdvLk9iamVjdElEKSlcbiAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoXCJpbnNlcnRlZElkIG11c3QgYmUgc3RyaW5nIG9yIE9iamVjdElEXCIpO1xuICAgICAgICBpbnNlcnRlZElkID0gb3B0aW9ucy5pbnNlcnRlZElkO1xuICAgICAgfSBlbHNlIGlmICghc2VsZWN0b3IgfHwgIXNlbGVjdG9yLl9pZCkge1xuICAgICAgICBpbnNlcnRlZElkID0gdGhpcy5fbWFrZU5ld0lEKCk7XG4gICAgICAgIG9wdGlvbnMuZ2VuZXJhdGVkSWQgPSB0cnVlO1xuICAgICAgICBvcHRpb25zLmluc2VydGVkSWQgPSBpbnNlcnRlZElkO1xuICAgICAgfVxuICAgIH1cblxuICAgIHNlbGVjdG9yID1cbiAgICAgIE1vbmdvLkNvbGxlY3Rpb24uX3Jld3JpdGVTZWxlY3RvcihzZWxlY3RvciwgeyBmYWxsYmFja0lkOiBpbnNlcnRlZElkIH0pO1xuXG4gICAgY29uc3Qgd3JhcHBlZENhbGxiYWNrID0gd3JhcENhbGxiYWNrKGNhbGxiYWNrKTtcblxuICAgIGlmICh0aGlzLl9pc1JlbW90ZUNvbGxlY3Rpb24oKSkge1xuICAgICAgY29uc3QgYXJncyA9IFtcbiAgICAgICAgc2VsZWN0b3IsXG4gICAgICAgIG1vZGlmaWVyLFxuICAgICAgICBvcHRpb25zXG4gICAgICBdO1xuXG4gICAgICByZXR1cm4gdGhpcy5fY2FsbE11dGF0b3JNZXRob2QoXCJ1cGRhdGVcIiwgYXJncywgd3JhcHBlZENhbGxiYWNrKTtcbiAgICB9XG5cbiAgICAvLyBpdCdzIG15IGNvbGxlY3Rpb24uICBkZXNjZW5kIGludG8gdGhlIGNvbGxlY3Rpb24gb2JqZWN0XG4gICAgLy8gYW5kIHByb3BhZ2F0ZSBhbnkgZXhjZXB0aW9uLlxuICAgIHRyeSB7XG4gICAgICAvLyBJZiB0aGUgdXNlciBwcm92aWRlZCBhIGNhbGxiYWNrIGFuZCB0aGUgY29sbGVjdGlvbiBpbXBsZW1lbnRzIHRoaXNcbiAgICAgIC8vIG9wZXJhdGlvbiBhc3luY2hyb25vdXNseSwgdGhlbiBxdWVyeVJldCB3aWxsIGJlIHVuZGVmaW5lZCwgYW5kIHRoZVxuICAgICAgLy8gcmVzdWx0IHdpbGwgYmUgcmV0dXJuZWQgdGhyb3VnaCB0aGUgY2FsbGJhY2sgaW5zdGVhZC5cbiAgICAgIHJldHVybiB0aGlzLl9jb2xsZWN0aW9uLnVwZGF0ZShcbiAgICAgICAgc2VsZWN0b3IsIG1vZGlmaWVyLCBvcHRpb25zLCB3cmFwcGVkQ2FsbGJhY2spO1xuICAgIH0gY2F0Y2ggKGUpIHtcbiAgICAgIGlmIChjYWxsYmFjaykge1xuICAgICAgICBjYWxsYmFjayhlKTtcbiAgICAgICAgcmV0dXJuIG51bGw7XG4gICAgICB9XG4gICAgICB0aHJvdyBlO1xuICAgIH1cbiAgfSxcblxuICAvKipcbiAgICogQHN1bW1hcnkgUmVtb3ZlIGRvY3VtZW50cyBmcm9tIHRoZSBjb2xsZWN0aW9uXG4gICAqIEBsb2N1cyBBbnl3aGVyZVxuICAgKiBAbWV0aG9kIHJlbW92ZVxuICAgKiBAbWVtYmVyb2YgTW9uZ28uQ29sbGVjdGlvblxuICAgKiBAaW5zdGFuY2VcbiAgICogQHBhcmFtIHtNb25nb1NlbGVjdG9yfSBzZWxlY3RvciBTcGVjaWZpZXMgd2hpY2ggZG9jdW1lbnRzIHRvIHJlbW92ZVxuICAgKiBAcGFyYW0ge0Z1bmN0aW9ufSBbY2FsbGJhY2tdIE9wdGlvbmFsLiAgSWYgcHJlc2VudCwgY2FsbGVkIHdpdGggYW4gZXJyb3Igb2JqZWN0IGFzIGl0cyBhcmd1bWVudC5cbiAgICovXG4gIHJlbW92ZShzZWxlY3RvciwgY2FsbGJhY2spIHtcbiAgICBzZWxlY3RvciA9IE1vbmdvLkNvbGxlY3Rpb24uX3Jld3JpdGVTZWxlY3RvcihzZWxlY3Rvcik7XG5cbiAgICBjb25zdCB3cmFwcGVkQ2FsbGJhY2sgPSB3cmFwQ2FsbGJhY2soY2FsbGJhY2spO1xuXG4gICAgaWYgKHRoaXMuX2lzUmVtb3RlQ29sbGVjdGlvbigpKSB7XG4gICAgICByZXR1cm4gdGhpcy5fY2FsbE11dGF0b3JNZXRob2QoXCJyZW1vdmVcIiwgW3NlbGVjdG9yXSwgd3JhcHBlZENhbGxiYWNrKTtcbiAgICB9XG5cbiAgICAvLyBpdCdzIG15IGNvbGxlY3Rpb24uICBkZXNjZW5kIGludG8gdGhlIGNvbGxlY3Rpb24gb2JqZWN0XG4gICAgLy8gYW5kIHByb3BhZ2F0ZSBhbnkgZXhjZXB0aW9uLlxuICAgIHRyeSB7XG4gICAgICAvLyBJZiB0aGUgdXNlciBwcm92aWRlZCBhIGNhbGxiYWNrIGFuZCB0aGUgY29sbGVjdGlvbiBpbXBsZW1lbnRzIHRoaXNcbiAgICAgIC8vIG9wZXJhdGlvbiBhc3luY2hyb25vdXNseSwgdGhlbiBxdWVyeVJldCB3aWxsIGJlIHVuZGVmaW5lZCwgYW5kIHRoZVxuICAgICAgLy8gcmVzdWx0IHdpbGwgYmUgcmV0dXJuZWQgdGhyb3VnaCB0aGUgY2FsbGJhY2sgaW5zdGVhZC5cbiAgICAgIHJldHVybiB0aGlzLl9jb2xsZWN0aW9uLnJlbW92ZShzZWxlY3Rvciwgd3JhcHBlZENhbGxiYWNrKTtcbiAgICB9IGNhdGNoIChlKSB7XG4gICAgICBpZiAoY2FsbGJhY2spIHtcbiAgICAgICAgY2FsbGJhY2soZSk7XG4gICAgICAgIHJldHVybiBudWxsO1xuICAgICAgfVxuICAgICAgdGhyb3cgZTtcbiAgICB9XG4gIH0sXG5cbiAgLy8gRGV0ZXJtaW5lIGlmIHRoaXMgY29sbGVjdGlvbiBpcyBzaW1wbHkgYSBtaW5pbW9uZ28gcmVwcmVzZW50YXRpb24gb2YgYSByZWFsXG4gIC8vIGRhdGFiYXNlIG9uIGFub3RoZXIgc2VydmVyXG4gIF9pc1JlbW90ZUNvbGxlY3Rpb24oKSB7XG4gICAgLy8gWFhYIHNlZSAjTWV0ZW9yU2VydmVyTnVsbFxuICAgIHJldHVybiB0aGlzLl9jb25uZWN0aW9uICYmIHRoaXMuX2Nvbm5lY3Rpb24gIT09IE1ldGVvci5zZXJ2ZXI7XG4gIH0sXG5cbiAgLyoqXG4gICAqIEBzdW1tYXJ5IE1vZGlmeSBvbmUgb3IgbW9yZSBkb2N1bWVudHMgaW4gdGhlIGNvbGxlY3Rpb24sIG9yIGluc2VydCBvbmUgaWYgbm8gbWF0Y2hpbmcgZG9jdW1lbnRzIHdlcmUgZm91bmQuIFJldHVybnMgYW4gb2JqZWN0IHdpdGgga2V5cyBgbnVtYmVyQWZmZWN0ZWRgICh0aGUgbnVtYmVyIG9mIGRvY3VtZW50cyBtb2RpZmllZCkgIGFuZCBgaW5zZXJ0ZWRJZGAgKHRoZSB1bmlxdWUgX2lkIG9mIHRoZSBkb2N1bWVudCB0aGF0IHdhcyBpbnNlcnRlZCwgaWYgYW55KS5cbiAgICogQGxvY3VzIEFueXdoZXJlXG4gICAqIEBtZXRob2QgdXBzZXJ0XG4gICAqIEBtZW1iZXJvZiBNb25nby5Db2xsZWN0aW9uXG4gICAqIEBpbnN0YW5jZVxuICAgKiBAcGFyYW0ge01vbmdvU2VsZWN0b3J9IHNlbGVjdG9yIFNwZWNpZmllcyB3aGljaCBkb2N1bWVudHMgdG8gbW9kaWZ5XG4gICAqIEBwYXJhbSB7TW9uZ29Nb2RpZmllcn0gbW9kaWZpZXIgU3BlY2lmaWVzIGhvdyB0byBtb2RpZnkgdGhlIGRvY3VtZW50c1xuICAgKiBAcGFyYW0ge09iamVjdH0gW29wdGlvbnNdXG4gICAqIEBwYXJhbSB7Qm9vbGVhbn0gb3B0aW9ucy5tdWx0aSBUcnVlIHRvIG1vZGlmeSBhbGwgbWF0Y2hpbmcgZG9jdW1lbnRzOyBmYWxzZSB0byBvbmx5IG1vZGlmeSBvbmUgb2YgdGhlIG1hdGNoaW5nIGRvY3VtZW50cyAodGhlIGRlZmF1bHQpLlxuICAgKiBAcGFyYW0ge0Z1bmN0aW9ufSBbY2FsbGJhY2tdIE9wdGlvbmFsLiAgSWYgcHJlc2VudCwgY2FsbGVkIHdpdGggYW4gZXJyb3Igb2JqZWN0IGFzIHRoZSBmaXJzdCBhcmd1bWVudCBhbmQsIGlmIG5vIGVycm9yLCB0aGUgbnVtYmVyIG9mIGFmZmVjdGVkIGRvY3VtZW50cyBhcyB0aGUgc2Vjb25kLlxuICAgKi9cbiAgdXBzZXJ0KHNlbGVjdG9yLCBtb2RpZmllciwgb3B0aW9ucywgY2FsbGJhY2spIHtcbiAgICBpZiAoISBjYWxsYmFjayAmJiB0eXBlb2Ygb3B0aW9ucyA9PT0gXCJmdW5jdGlvblwiKSB7XG4gICAgICBjYWxsYmFjayA9IG9wdGlvbnM7XG4gICAgICBvcHRpb25zID0ge307XG4gICAgfVxuXG4gICAgcmV0dXJuIHRoaXMudXBkYXRlKHNlbGVjdG9yLCBtb2RpZmllciwge1xuICAgICAgLi4ub3B0aW9ucyxcbiAgICAgIF9yZXR1cm5PYmplY3Q6IHRydWUsXG4gICAgICB1cHNlcnQ6IHRydWUsXG4gICAgfSwgY2FsbGJhY2spO1xuICB9LFxuXG4gIC8vIFdlJ2xsIGFjdHVhbGx5IGRlc2lnbiBhbiBpbmRleCBBUEkgbGF0ZXIuIEZvciBub3csIHdlIGp1c3QgcGFzcyB0aHJvdWdoIHRvXG4gIC8vIE1vbmdvJ3MsIGJ1dCBtYWtlIGl0IHN5bmNocm9ub3VzLlxuICBfZW5zdXJlSW5kZXgoaW5kZXgsIG9wdGlvbnMpIHtcbiAgICB2YXIgc2VsZiA9IHRoaXM7XG4gICAgaWYgKCFzZWxmLl9jb2xsZWN0aW9uLl9lbnN1cmVJbmRleClcbiAgICAgIHRocm93IG5ldyBFcnJvcihcIkNhbiBvbmx5IGNhbGwgX2Vuc3VyZUluZGV4IG9uIHNlcnZlciBjb2xsZWN0aW9uc1wiKTtcbiAgICBzZWxmLl9jb2xsZWN0aW9uLl9lbnN1cmVJbmRleChpbmRleCwgb3B0aW9ucyk7XG4gIH0sXG5cbiAgX2Ryb3BJbmRleChpbmRleCkge1xuICAgIHZhciBzZWxmID0gdGhpcztcbiAgICBpZiAoIXNlbGYuX2NvbGxlY3Rpb24uX2Ryb3BJbmRleClcbiAgICAgIHRocm93IG5ldyBFcnJvcihcIkNhbiBvbmx5IGNhbGwgX2Ryb3BJbmRleCBvbiBzZXJ2ZXIgY29sbGVjdGlvbnNcIik7XG4gICAgc2VsZi5fY29sbGVjdGlvbi5fZHJvcEluZGV4KGluZGV4KTtcbiAgfSxcblxuICBfZHJvcENvbGxlY3Rpb24oKSB7XG4gICAgdmFyIHNlbGYgPSB0aGlzO1xuICAgIGlmICghc2VsZi5fY29sbGVjdGlvbi5kcm9wQ29sbGVjdGlvbilcbiAgICAgIHRocm93IG5ldyBFcnJvcihcIkNhbiBvbmx5IGNhbGwgX2Ryb3BDb2xsZWN0aW9uIG9uIHNlcnZlciBjb2xsZWN0aW9uc1wiKTtcbiAgICBzZWxmLl9jb2xsZWN0aW9uLmRyb3BDb2xsZWN0aW9uKCk7XG4gIH0sXG5cbiAgX2NyZWF0ZUNhcHBlZENvbGxlY3Rpb24oYnl0ZVNpemUsIG1heERvY3VtZW50cykge1xuICAgIHZhciBzZWxmID0gdGhpcztcbiAgICBpZiAoIXNlbGYuX2NvbGxlY3Rpb24uX2NyZWF0ZUNhcHBlZENvbGxlY3Rpb24pXG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXCJDYW4gb25seSBjYWxsIF9jcmVhdGVDYXBwZWRDb2xsZWN0aW9uIG9uIHNlcnZlciBjb2xsZWN0aW9uc1wiKTtcbiAgICBzZWxmLl9jb2xsZWN0aW9uLl9jcmVhdGVDYXBwZWRDb2xsZWN0aW9uKGJ5dGVTaXplLCBtYXhEb2N1bWVudHMpO1xuICB9LFxuXG4gIC8qKlxuICAgKiBAc3VtbWFyeSBSZXR1cm5zIHRoZSBbYENvbGxlY3Rpb25gXShodHRwOi8vbW9uZ29kYi5naXRodWIuaW8vbm9kZS1tb25nb2RiLW5hdGl2ZS8zLjAvYXBpL0NvbGxlY3Rpb24uaHRtbCkgb2JqZWN0IGNvcnJlc3BvbmRpbmcgdG8gdGhpcyBjb2xsZWN0aW9uIGZyb20gdGhlIFtucG0gYG1vbmdvZGJgIGRyaXZlciBtb2R1bGVdKGh0dHBzOi8vd3d3Lm5wbWpzLmNvbS9wYWNrYWdlL21vbmdvZGIpIHdoaWNoIGlzIHdyYXBwZWQgYnkgYE1vbmdvLkNvbGxlY3Rpb25gLlxuICAgKiBAbG9jdXMgU2VydmVyXG4gICAqIEBtZW1iZXJvZiBNb25nby5Db2xsZWN0aW9uXG4gICAqIEBpbnN0YW5jZVxuICAgKi9cbiAgcmF3Q29sbGVjdGlvbigpIHtcbiAgICB2YXIgc2VsZiA9IHRoaXM7XG4gICAgaWYgKCEgc2VsZi5fY29sbGVjdGlvbi5yYXdDb2xsZWN0aW9uKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXCJDYW4gb25seSBjYWxsIHJhd0NvbGxlY3Rpb24gb24gc2VydmVyIGNvbGxlY3Rpb25zXCIpO1xuICAgIH1cbiAgICByZXR1cm4gc2VsZi5fY29sbGVjdGlvbi5yYXdDb2xsZWN0aW9uKCk7XG4gIH0sXG5cbiAgLyoqXG4gICAqIEBzdW1tYXJ5IFJldHVybnMgdGhlIFtgRGJgXShodHRwOi8vbW9uZ29kYi5naXRodWIuaW8vbm9kZS1tb25nb2RiLW5hdGl2ZS8zLjAvYXBpL0RiLmh0bWwpIG9iamVjdCBjb3JyZXNwb25kaW5nIHRvIHRoaXMgY29sbGVjdGlvbidzIGRhdGFiYXNlIGNvbm5lY3Rpb24gZnJvbSB0aGUgW25wbSBgbW9uZ29kYmAgZHJpdmVyIG1vZHVsZV0oaHR0cHM6Ly93d3cubnBtanMuY29tL3BhY2thZ2UvbW9uZ29kYikgd2hpY2ggaXMgd3JhcHBlZCBieSBgTW9uZ28uQ29sbGVjdGlvbmAuXG4gICAqIEBsb2N1cyBTZXJ2ZXJcbiAgICogQG1lbWJlcm9mIE1vbmdvLkNvbGxlY3Rpb25cbiAgICogQGluc3RhbmNlXG4gICAqL1xuICByYXdEYXRhYmFzZSgpIHtcbiAgICB2YXIgc2VsZiA9IHRoaXM7XG4gICAgaWYgKCEgKHNlbGYuX2RyaXZlci5tb25nbyAmJiBzZWxmLl9kcml2ZXIubW9uZ28uZGIpKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXCJDYW4gb25seSBjYWxsIHJhd0RhdGFiYXNlIG9uIHNlcnZlciBjb2xsZWN0aW9uc1wiKTtcbiAgICB9XG4gICAgcmV0dXJuIHNlbGYuX2RyaXZlci5tb25nby5kYjtcbiAgfVxufSk7XG5cbi8vIENvbnZlcnQgdGhlIGNhbGxiYWNrIHRvIG5vdCByZXR1cm4gYSByZXN1bHQgaWYgdGhlcmUgaXMgYW4gZXJyb3JcbmZ1bmN0aW9uIHdyYXBDYWxsYmFjayhjYWxsYmFjaywgY29udmVydFJlc3VsdCkge1xuICByZXR1cm4gY2FsbGJhY2sgJiYgZnVuY3Rpb24gKGVycm9yLCByZXN1bHQpIHtcbiAgICBpZiAoZXJyb3IpIHtcbiAgICAgIGNhbGxiYWNrKGVycm9yKTtcbiAgICB9IGVsc2UgaWYgKHR5cGVvZiBjb252ZXJ0UmVzdWx0ID09PSBcImZ1bmN0aW9uXCIpIHtcbiAgICAgIGNhbGxiYWNrKGVycm9yLCBjb252ZXJ0UmVzdWx0KHJlc3VsdCkpO1xuICAgIH0gZWxzZSB7XG4gICAgICBjYWxsYmFjayhlcnJvciwgcmVzdWx0KTtcbiAgICB9XG4gIH07XG59XG5cbi8qKlxuICogQHN1bW1hcnkgQ3JlYXRlIGEgTW9uZ28tc3R5bGUgYE9iamVjdElEYC4gIElmIHlvdSBkb24ndCBzcGVjaWZ5IGEgYGhleFN0cmluZ2AsIHRoZSBgT2JqZWN0SURgIHdpbGwgZ2VuZXJhdGVkIHJhbmRvbWx5IChub3QgdXNpbmcgTW9uZ29EQidzIElEIGNvbnN0cnVjdGlvbiBydWxlcykuXG4gKiBAbG9jdXMgQW55d2hlcmVcbiAqIEBjbGFzc1xuICogQHBhcmFtIHtTdHJpbmd9IFtoZXhTdHJpbmddIE9wdGlvbmFsLiAgVGhlIDI0LWNoYXJhY3RlciBoZXhhZGVjaW1hbCBjb250ZW50cyBvZiB0aGUgT2JqZWN0SUQgdG8gY3JlYXRlXG4gKi9cbk1vbmdvLk9iamVjdElEID0gTW9uZ29JRC5PYmplY3RJRDtcblxuLyoqXG4gKiBAc3VtbWFyeSBUbyBjcmVhdGUgYSBjdXJzb3IsIHVzZSBmaW5kLiBUbyBhY2Nlc3MgdGhlIGRvY3VtZW50cyBpbiBhIGN1cnNvciwgdXNlIGZvckVhY2gsIG1hcCwgb3IgZmV0Y2guXG4gKiBAY2xhc3NcbiAqIEBpbnN0YW5jZU5hbWUgY3Vyc29yXG4gKi9cbk1vbmdvLkN1cnNvciA9IExvY2FsQ29sbGVjdGlvbi5DdXJzb3I7XG5cbi8qKlxuICogQGRlcHJlY2F0ZWQgaW4gMC45LjFcbiAqL1xuTW9uZ28uQ29sbGVjdGlvbi5DdXJzb3IgPSBNb25nby5DdXJzb3I7XG5cbi8qKlxuICogQGRlcHJlY2F0ZWQgaW4gMC45LjFcbiAqL1xuTW9uZ28uQ29sbGVjdGlvbi5PYmplY3RJRCA9IE1vbmdvLk9iamVjdElEO1xuXG4vKipcbiAqIEBkZXByZWNhdGVkIGluIDAuOS4xXG4gKi9cbk1ldGVvci5Db2xsZWN0aW9uID0gTW9uZ28uQ29sbGVjdGlvbjtcblxuLy8gQWxsb3cgZGVueSBzdHVmZiBpcyBub3cgaW4gdGhlIGFsbG93LWRlbnkgcGFja2FnZVxuT2JqZWN0LmFzc2lnbihcbiAgTWV0ZW9yLkNvbGxlY3Rpb24ucHJvdG90eXBlLFxuICBBbGxvd0RlbnkuQ29sbGVjdGlvblByb3RvdHlwZVxuKTtcblxuZnVuY3Rpb24gcG9wQ2FsbGJhY2tGcm9tQXJncyhhcmdzKSB7XG4gIC8vIFB1bGwgb2ZmIGFueSBjYWxsYmFjayAob3IgcGVyaGFwcyBhICdjYWxsYmFjaycgdmFyaWFibGUgdGhhdCB3YXMgcGFzc2VkXG4gIC8vIGluIHVuZGVmaW5lZCwgbGlrZSBob3cgJ3Vwc2VydCcgZG9lcyBpdCkuXG4gIGlmIChhcmdzLmxlbmd0aCAmJlxuICAgICAgKGFyZ3NbYXJncy5sZW5ndGggLSAxXSA9PT0gdW5kZWZpbmVkIHx8XG4gICAgICAgYXJnc1thcmdzLmxlbmd0aCAtIDFdIGluc3RhbmNlb2YgRnVuY3Rpb24pKSB7XG4gICAgcmV0dXJuIGFyZ3MucG9wKCk7XG4gIH1cbn1cbiIsIi8qKlxuICogQHN1bW1hcnkgQWxsb3dzIGZvciB1c2VyIHNwZWNpZmllZCBjb25uZWN0aW9uIG9wdGlvbnNcbiAqIEBleGFtcGxlIGh0dHA6Ly9tb25nb2RiLmdpdGh1Yi5pby9ub2RlLW1vbmdvZGItbmF0aXZlLzMuMC9yZWZlcmVuY2UvY29ubmVjdGluZy9jb25uZWN0aW9uLXNldHRpbmdzL1xuICogQGxvY3VzIFNlcnZlclxuICogQHBhcmFtIHtPYmplY3R9IG9wdGlvbnMgVXNlciBzcGVjaWZpZWQgTW9uZ28gY29ubmVjdGlvbiBvcHRpb25zXG4gKi9cbk1vbmdvLnNldENvbm5lY3Rpb25PcHRpb25zID0gZnVuY3Rpb24gc2V0Q29ubmVjdGlvbk9wdGlvbnMgKG9wdGlvbnMpIHtcbiAgY2hlY2sob3B0aW9ucywgT2JqZWN0KTtcbiAgTW9uZ28uX2Nvbm5lY3Rpb25PcHRpb25zID0gb3B0aW9ucztcbn07Il19
