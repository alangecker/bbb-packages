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
var Log = Package.logging.Log;
var Decimal = Package['mongo-decimal'].Decimal;
var _ = Package.underscore._;
var MaxHeap = Package['binary-heap'].MaxHeap;
var MinHeap = Package['binary-heap'].MinHeap;
var MinMaxHeap = Package['binary-heap'].MinMaxHeap;
var Hook = Package['callback-hook'].Hook;
var meteorInstall = Package.modules.meteorInstall;
var Promise = Package.promise.Promise;

/* Package-scope variables */
var MongoInternals, MongoConnection, CursorDescription, Cursor, listenAll, forEachTrigger, OPLOG_COLLECTION, idForOp, OplogHandle, ObserveMultiplexer, ObserveHandle, PollingObserveDriver, OplogObserveDriver, Mongo, _ref, field, value, selector, callback, options;

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
  let normalizeProjection;
  module1.link("./mongo_utils", {
    normalizeProjection(v) {
      normalizeProjection = v;
    }

  }, 0);
  let DocFetcher;
  module1.link("./doc_fetcher.js", {
    DocFetcher(v) {
      DocFetcher = v;
    }

  }, 1);

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

    const userOptions = _objectSpread(_objectSpread({}, Mongo._connectionOptions || {}), ((_Meteor$settings = Meteor.settings) === null || _Meteor$settings === void 0 ? void 0 : (_Meteor$settings$pack = _Meteor$settings.packages) === null || _Meteor$settings$pack === void 0 ? void 0 : (_Meteor$settings$pack2 = _Meteor$settings$pack.mongo) === null || _Meteor$settings$pack2 === void 0 ? void 0 : _Meteor$settings$pack2.options) || {});

    var mongoOptions = Object.assign({
      ignoreUndefined: true
    }, userOptions); // Internally the oplog connections specify their own maxPoolSize
    // which we don't want to overwrite with any user defined value

    if (_.has(options, 'maxPoolSize')) {
      // If we just set this for "server", replSet will override it. If we just
      // set it for replSet, it will be ignored if we're not using a replSet.
      mongoOptions.maxPoolSize = options.maxPoolSize;
    } // Transform options like "tlsCAFileAsset": "filename.pem" into
    // "tlsCAFile": "/<fullpath>/filename.pem"


    Object.entries(mongoOptions || {}).filter(_ref => {
      let [key] = _ref;
      return key && key.endsWith(FILE_ASSET_SUFFIX);
    }).forEach(_ref2 => {
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
    new MongoDB.MongoClient(url, mongoOptions).connect(Meteor.bindEnvironment(function (err, client) {
      if (err) {
        throw err;
      }

      var db = client.db();

      try {
        const helloDocument = db.admin().command({
          hello: 1
        }).await(); // First, figure out what the current primary is, if any.

        if (helloDocument.primary) {
          self._primary = helloDocument.primary;
        }
      } catch (_) {
        // ismaster command is supported on older mongodb versions
        const isMasterDocument = db.admin().command({
          ismaster: 1
        }).await(); // First, figure out what the current primary is, if any.

        if (isMasterDocument.primary) {
          self._primary = isMasterDocument.primary;
        }
      }

      client.topology.on('joined', Meteor.bindEnvironment(function (kind, doc) {
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
    return self.db.collection(collectionName);
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
      collection.insertOne(replaceTypes(document, replaceMeteorAtomWithMongo), {
        safe: true
      }).then(_ref3 => {
        let {
          insertedId
        } = _ref3;
        callback(null, insertedId);
      }).catch(e => {
        callback(e, null);
      });
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
      collection.deleteMany(replaceTypes(selector, replaceMeteorAtomWithMongo), {
        safe: true
      }).then(_ref4 => {
        let {
          deletedCount
        } = _ref4;
        callback(null, transformResult({
          result: {
            modifiedCount: deletedCount
          }
        }).numberAffected);
      }).catch(err => {
        callback(err);
      });
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

        const strings = Object.keys(mongoMod).filter(key => !key.startsWith("$"));
        let updateMethod = strings.length > 0 ? 'replaceOne' : 'updateMany';
        updateMethod = updateMethod === 'updateMany' && !mongoOpts.multi ? 'updateOne' : updateMethod;
        collection[updateMethod].bind(collection)(mongoSelector, mongoMod, mongoOpts, // mongo driver now returns undefined for err in the callback
        bindEnvironmentForWrite(function () {
          let err = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : null;
          let result = arguments.length > 1 ? arguments[1] : undefined;

          if (!err) {
            var meteorResult = transformResult({
              result
            });

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

      if (mongoResult.upsertedCount) {
        meteorResult.numberAffected = mongoResult.upsertedCount;

        if (mongoResult.upsertedId) {
          meteorResult.insertedId = mongoResult.upsertedId;
        }
      } else {
        // n was used before Mongo 5.0, in Mongo 5.0 we are not receiving this n
        // field and so we are using modifiedCount instead
        meteorResult.numberAffected = mongoResult.n || mongoResult.matchedCount || mongoResult.modifiedCount;
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
        let method = collection.updateMany;

        if (!Object.keys(mod).some(key => key.startsWith("$"))) {
          method = collection.replaceOne.bind(collection);
        }

        method(selector, mod, mongoOptsForUpdate, bindEnvironmentForWrite(function (err, result) {
          if (err) {
            callback(err);
          } else if (result && (result.modifiedCount || result.upsertedCount)) {
            callback(null, {
              numberAffected: result.modifiedCount || result.upsertedCount,
              insertedId: result.upsertedId || undefined
            });
          } else {
            doConditionalInsert();
          }
        }));
      }
    };

    var doConditionalInsert = function () {
      collection.replaceOne(selector, replacementWithId, mongoOptsForInsert, bindEnvironmentForWrite(function (err, result) {
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
            numberAffected: result.upsertedCount,
            insertedId: result.upsertedId
          });
        }
      }));
    };

    doUpdate();
  };

  _.each(["insert", "update", "remove", "dropCollection", "dropDatabase"], function (method) {
    MongoConnection.prototype[method] = function
      /* arguments */
    () {
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


  MongoConnection.prototype.createIndex = function (collectionName, index, options) {
    var self = this; // We expect this function to be called at startup, not from within a method,
    // so we don't interact with the write fence.

    var collection = self.rawCollection(collectionName);
    var future = new Future();
    var indexName = collection.createIndex(index, options, future.resolver());
    future.wait();
  };

  MongoConnection.prototype._ensureIndex = MongoConnection.prototype.createIndex;

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
  });

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
      projection: cursorOptions.fields || cursorOptions.projection,
      readPreference: cursorOptions.readPreference
    }; // Do we want a tailable cursor (which only works on capped collections)?

    if (cursorOptions.tailable) {
      mongoOptions.numberOfRetries = -1;
    }

    var dbCursor = collection.find(replaceTypes(cursorDescription.selector, replaceMeteorAtomWithMongo), mongoOptions); // Do we want a tailable cursor (which only works on capped collections)?

    if (cursorOptions.tailable) {
      // We want a tailable cursor...
      dbCursor.addCursorFlag("tailable", true); // ... and for the server to wait a bit if any getMore has no data (rather
      // than making us put the relevant sleeps in the client)...

      dbCursor.addCursorFlag("awaitData", true); // And if this is on the oplog collection and the cursor specifies a 'ts',
      // then set the undocumented oplog replay flag, which does a special scan to
      // find the first document (instead of creating an index on ts). This is a
      // very hard-coded Mongo flag which only works on the oplog collection and
      // only works with the ts field.

      if (cursorDescription.collectionName === OPLOG_COLLECTION && cursorDescription.selector.ts) {
        dbCursor.addCursorFlag("oplogReplay", true);
      }
    }

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
      var self = this;
      return self._synchronousCount().wait();
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


    const fieldsOptions = cursorDescription.options.projection || cursorDescription.options.fields;

    if (fieldsOptions && (fieldsOptions._id === 0 || fieldsOptions._id === false)) {
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
  Long
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

Object.assign(OplogHandle.prototype, {
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
      maxPoolSize: 1
    }); // XXX better docs, but: it's to get monotonic results
    // XXX is it safe to say "if there's an in flight query, just use its
    //     results"? I don't think so but should consider that

    self._oplogLastEntryConnection = new MongoConnection(self._oplogUrl, {
      maxPoolSize: 1
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
                nextTimestamp = nextTimestamp.add(Long.ONE);
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
const _excluded = ["_id"];

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
    self[callbackName] = function
      /* ... */
    () {
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
            fields = _objectWithoutProperties(_ref, _excluded);

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

},"oplog_observe_driver.js":function module(require,exports,module){

/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
//                                                                                                                     //
// packages/mongo/oplog_observe_driver.js                                                                              //
//                                                                                                                     //
/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
                                                                                                                       //
let oplogV2V1Converter;
module.link("./oplog_v2_converter", {
  oplogV2V1Converter(v) {
    oplogV2V1Converter = v;
  }

}, 0);

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

  self._matcher = options.matcher; // we are now using projection, not fields in the cursor description even if you pass {fields}
  // in the cursor construction

  var projection = self._cursorDescription.options.fields || self._cursorDescription.options.projection || {};
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
        // we are mapping the new oplog format on mongo 5
        // to what we know better, $set
        op.o = oplogV2V1Converter(op.o); // Is this a modifier ($set/$unset, which may require us to poll the
        // database to figure out if the whole document matches the selector) or
        // a replacement (in which case we can just directly re-evaluate the
        // selector)?
        // oplog format has changed on mongodb 5, we have to support both now
        // diff is the format in Mongo 5+ (oplog v2)

        var isReplace = !_.has(op.o, '$set') && !_.has(op.o, 'diff') && !_.has(op.o, '$unset'); // If this modifier modifies something inside an EJSON custom type (ie,
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

  const fields = options.fields || options.projection;

  if (fields) {
    try {
      LocalCollection._checkSupportedProjection(fields);
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

},"oplog_v2_converter.js":function module(require,exports,module){

/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
//                                                                                                                     //
// packages/mongo/oplog_v2_converter.js                                                                                //
//                                                                                                                     //
/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
                                                                                                                       //
const _excluded = ["i", "u", "d"],
      _excluded2 = ["a"];

let _objectSpread;

module.link("@babel/runtime/helpers/objectSpread2", {
  default(v) {
    _objectSpread = v;
  }

}, 0);

let _objectWithoutProperties;

module.link("@babel/runtime/helpers/objectWithoutProperties", {
  default(v) {
    _objectWithoutProperties = v;
  }

}, 1);
module.export({
  oplogV2V1Converter: () => oplogV2V1Converter
});

// we are mapping the new oplog format on mongo 5
// to what we know better, $set and $unset format
// new oplog format ex:
// {
//  '$v': 2,
//  diff: { u: { key1: 2022-01-06T18:23:16.131Z, key2: [ObjectID] } }
// }
function logConverterCalls(oplogEntry, prefixKey, key) {
  if (!process.env.OPLOG_CONVERTER_DEBUG) {
    return;
  }

  console.log('Calling nestedOplogEntryParsers with the following values: ');
  console.log("Oplog entry: ".concat(JSON.stringify(oplogEntry), ", prefixKey: ").concat(prefixKey, ", key: ").concat(key));
}
/*
the structure of an entry is:


-> entry: i, u, d + sFields.
-> sFields: i, u, d + sFields
-> sFields: arrayOperator -> { a: true, u0: 2 }
-> i,u,d: { key: value }
-> value: {key: value}

i and u are both $set
d is $unset
on mongo 4
 */


const isArrayOperator = possibleArrayOperator => {
  if (!possibleArrayOperator || !Object.keys(possibleArrayOperator).length) return false;

  if (!possibleArrayOperator.a) {
    return false;
  }

  return !Object.keys(possibleArrayOperator).find(key => key !== 'a' && !key.match(/^u\d+/));
};

function logOplogEntryError(oplogEntry, prefixKey, key) {
  console.log('---');
  console.log('WARNING: Unsupported oplog operation, please fill an issue with this message at github.com/meteor/meteor');
  console.log("Oplog entry: ".concat(JSON.stringify(oplogEntry), ", prefixKey: ").concat(prefixKey, ", key: ").concat(key));
  console.log('---');
}

const nestedOplogEntryParsers = function (oplogEntry) {
  let prefixKey = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : '';

  const {
    i = {},
    u = {},
    d = {}
  } = oplogEntry,
        sFields = _objectWithoutProperties(oplogEntry, _excluded);

  logConverterCalls(oplogEntry, prefixKey, 'ENTRY_POINT');
  const sFieldsOperators = [];
  Object.entries(sFields).forEach(_ref => {
    let [key, value] = _ref;
    const actualKeyNameWithoutSPrefix = key.substring(1);

    if (isArrayOperator(value || {})) {
      const {
        a
      } = value,
            uPosition = _objectWithoutProperties(value, _excluded2);

      if (uPosition) {
        for (const [positionKey, newArrayIndexValue] of Object.entries(uPosition)) {
          sFieldsOperators.push({
            [newArrayIndexValue === null ? '$unset' : '$set']: {
              ["".concat(prefixKey).concat(actualKeyNameWithoutSPrefix, ".").concat(positionKey.substring(1))]: newArrayIndexValue === null ? true : newArrayIndexValue
            }
          });
        }
      } else {
        logOplogEntryError(oplogEntry, prefixKey, key);
        throw new Error("Unsupported oplog array entry, please review the input: ".concat(JSON.stringify(value)));
      }
    } else {
      // we are looking at something that we expected to be "sSomething" but is null after removing s
      // this happens on "a": true which is a simply ack that comes embeded
      // we dont need to call recursion on this case, only ignore it
      if (!actualKeyNameWithoutSPrefix || actualKeyNameWithoutSPrefix === '') {
        return null;
      } // we are looking at a "sSomething" that is actually a nested object set


      logConverterCalls(oplogEntry, prefixKey, key);
      sFieldsOperators.push(nestedOplogEntryParsers(value, "".concat(prefixKey).concat(actualKeyNameWithoutSPrefix, ".")));
    }
  });
  const $unset = Object.keys(d).reduce((acc, key) => {
    return _objectSpread(_objectSpread({}, acc), {}, {
      ["".concat(prefixKey).concat(key)]: true
    });
  }, {});

  const setObjectSource = _objectSpread(_objectSpread({}, i), u);

  const $set = Object.keys(setObjectSource).reduce((acc, key) => {
    const prefixedKey = "".concat(prefixKey).concat(key);
    return _objectSpread(_objectSpread({}, acc), !Array.isArray(setObjectSource[key]) && typeof setObjectSource[key] === 'object' ? flattenObject({
      [prefixedKey]: setObjectSource[key]
    }) : {
      [prefixedKey]: setObjectSource[key]
    });
  }, {});
  const c = [...sFieldsOperators, {
    $unset,
    $set
  }];
  const {
    $set: s,
    $unset: un
  } = c.reduce((acc, _ref2) => {
    let {
      $set: set = {},
      $unset: unset = {}
    } = _ref2;
    return {
      $set: _objectSpread(_objectSpread({}, acc.$set), set),
      $unset: _objectSpread(_objectSpread({}, acc.$unset), unset)
    };
  }, {});
  return _objectSpread(_objectSpread({}, Object.keys(s).length ? {
    $set: s
  } : {}), Object.keys(un).length ? {
    $unset: un
  } : {});
};

const oplogV2V1Converter = v2OplogEntry => {
  if (v2OplogEntry.$v !== 2 || !v2OplogEntry.diff) return v2OplogEntry;
  logConverterCalls(v2OplogEntry, 'INITIAL_CALL', 'INITIAL_CALL');
  return _objectSpread({
    $v: 2
  }, nestedOplogEntryParsers(v2OplogEntry.diff || {}));
};

function flattenObject(ob) {
  const toReturn = {};

  for (const i in ob) {
    if (!ob.hasOwnProperty(i)) continue;

    if (!Array.isArray(ob[i]) && typeof ob[i] == 'object' && ob[i] !== null) {
      const flatObject = flattenObject(ob[i]);
      let objectKeys = Object.keys(flatObject);

      if (objectKeys.length === 0) {
        return ob;
      }

      for (const x of objectKeys) {
        toReturn[i + '.' + x] = flatObject[x];
      }
    } else {
      toReturn[i] = ob[i];
    }
  }

  return toReturn;
}
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

Object.assign(MongoInternals.RemoteCollectionDriver.prototype, {
  open: function (name) {
    var self = this;
    var ret = {};
    ['find', 'findOne', 'insert', 'update', 'upsert', 'remove', '_ensureIndex', 'createIndex', '_dropIndex', '_createCappedCollection', 'dropCollection', 'rawCollection'].forEach(function (m) {
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
  let normalizeProjection;
  module1.link("./mongo_utils", {
    normalizeProjection(v) {
      normalizeProjection = v;
    }

  }, 0);

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
      Meteor._debug('Warning: creating anonymous collection. It will not be ' + 'saved or synchronized over the network. (Pass null for ' + 'the collection name to turn off this warning.)');

      name = null;
    }

    if (name !== null && typeof name !== 'string') {
      throw new Error('First argument to new Mongo.Collection must be a string or null');
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
      if (name && this._connection === Meteor.server && typeof MongoInternals !== 'undefined' && MongoInternals.defaultRemoteCollectionDriver) {
        options._driver = MongoInternals.defaultRemoteCollectionDriver();
      } else {
        const {
          LocalCollectionDriver
        } = require('./local_collection_driver.js');

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
    _maybeSetUpReplication(name, _ref2) {
      let {
        _suppressSameNameError = false
      } = _ref2;
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

          var doc = self._collection._docs.get(mongoId); //When the server's mergebox is disabled for a collection, the client must gracefully handle it when:
          // *We receive an added message for a document that is already there. Instead, it will be changed
          // *We reeive a change message for a document that is not there. Instead, it will be added
          // *We receive a removed messsage for a document that is not there. Instead, noting wil happen.
          //Code is derived from client-side code originally in peerlibrary:control-mergebox
          //https://github.com/peerlibrary/meteor-control-mergebox/blob/master/client.coffee
          //For more information, refer to discussion "Initial support for publication strategies in livedata server":
          //https://github.com/meteor/meteor/pull/11151


          if (Meteor.isClient) {
            if (msg.msg === 'added' && doc) {
              msg.msg = 'changed';
            } else if (msg.msg === 'removed' && !doc) {
              return;
            } else if (msg.msg === 'changed' && !doc) {
              msg.msg = 'added';
              _ref = msg.fields;

              for (field in _ref) {
                value = _ref[field];

                if (value === void 0) {
                  delete msg.fields[field];
                }
              }
            }
          } // Is this a "replace the whole doc" message coming from the quiescence
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
              throw new Error('Expected not to find a document already present for an add');
            }

            self._collection.insert(_objectSpread({
              _id: mongoId
            }, msg.fields));
          } else if (msg.msg === 'removed') {
            if (!doc) throw new Error('Expected to find a document already present for removed');

            self._collection.remove(mongoId);
          } else if (msg.msg === 'changed') {
            if (!doc) throw new Error('Expected to find a document to change');
            const keys = Object.keys(msg.fields);

            if (keys.length > 0) {
              var modifier = {};
              keys.forEach(key => {
                const value = msg.fields[key];

                if (EJSON.equals(doc[key], value)) {
                  return;
                }

                if (typeof value === 'undefined') {
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
      const [, options] = args || [];
      const newOptions = normalizeProjection(options);
      var self = this;

      if (args.length < 2) {
        return {
          transform: self._transform
        };
      } else {
        check(newOptions, Match.Optional(Match.ObjectIncluding({
          projection: Match.Optional(Match.OneOf(Object, undefined)),
          sort: Match.Optional(Match.OneOf(Object, Array, Function, undefined)),
          limit: Match.Optional(Match.OneOf(Number, undefined)),
          skip: Match.Optional(Match.OneOf(Number, undefined))
        })));
        return _objectSpread({
          transform: self._transform
        }, newOptions);
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
     * @param {String} options.readPreference (Server only) Specifies a custom MongoDB [`readPreference`](https://docs.mongodb.com/manual/core/read-preference) for this particular cursor. Possible values are `primary`, `primaryPreferred`, `secondary`, `secondaryPreferred` and `nearest`.
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
     * @param {String} options.readPreference (Server only) Specifies a custom MongoDB [`readPreference`](https://docs.mongodb.com/manual/core/read-preference) for fetching the document. Possible values are `primary`, `primaryPreferred`, `secondary`, `secondaryPreferred` and `nearest`.
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
        throw new Error('insert requires an argument');
      } // Make a shallow clone of the document, preserving its prototype.


      doc = Object.create(Object.getPrototypeOf(doc), Object.getOwnPropertyDescriptors(doc));

      if ('_id' in doc) {
        if (!doc._id || !(typeof doc._id === 'string' || doc._id instanceof Mongo.ObjectID)) {
          throw new Error('Meteor requires document _id fields to be non-empty strings or ObjectIDs');
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
        const result = this._callMutatorMethod('insert', [doc], wrappedCallback);

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
     * @param {Array} options.arrayFilters Optional. Used in combination with MongoDB [filtered positional operator](https://docs.mongodb.com/manual/reference/operator/update/positional-filtered/) to specify which elements to modify in an array field.
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
          if (!(typeof options.insertedId === 'string' || options.insertedId instanceof Mongo.ObjectID)) throw new Error('insertedId must be string or ObjectID');
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
        return this._callMutatorMethod('update', args, wrappedCallback);
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
        return this._callMutatorMethod('remove', [selector], wrappedCallback);
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
      if (!callback && typeof options === 'function') {
        callback = options;
        options = {};
      }

      return this.update(selector, modifier, _objectSpread(_objectSpread({}, options), {}, {
        _returnObject: true,
        upsert: true
      }), callback);
    },

    // We'll actually design an index API later. For now, we just pass through to
    // Mongo's, but make it synchronous.
    _ensureIndex(index, options) {
      var self = this;
      if (!self._collection._ensureIndex || !self._collection.createIndex) throw new Error('Can only call createIndex on server collections');

      if (self._collection.createIndex) {
        self._collection.createIndex(index, options);
      } else {
        let Log;
        module1.link("meteor/logging", {
          Log(v) {
            Log = v;
          }

        }, 1);
        Log.debug("_ensureIndex has been deprecated, please use the new 'createIndex' instead".concat(options !== null && options !== void 0 && options.name ? ", index name: ".concat(options.name) : ", index: ".concat(JSON.stringify(index))));

        self._collection._ensureIndex(index, options);
      }
    },

    /**
     * @summary Creates the specified index on the collection.
     * @locus server
     * @method createIndex
     * @memberof Mongo.Collection
     * @instance
     * @param {Object} index A document that contains the field and value pairs where the field is the index key and the value describes the type of index for that field. For an ascending index on a field, specify a value of `1`; for descending index, specify a value of `-1`. Use `text` for text indexes.
     * @param {Object} [options] All options are listed in [MongoDB documentation](https://docs.mongodb.com/manual/reference/method/db.collection.createIndex/#options)
     * @param {String} options.name Name of the index
     * @param {Boolean} options.unique Define that the index values must be unique, more at [MongoDB documentation](https://docs.mongodb.com/manual/core/index-unique/)
     * @param {Boolean} options.sparse Define that the index is sparse, more at [MongoDB documentation](https://docs.mongodb.com/manual/core/index-sparse/)
     */
    createIndex(index, options) {
      var self = this;
      if (!self._collection.createIndex) throw new Error('Can only call createIndex on server collections');

      self._collection.createIndex(index, options);
    },

    _dropIndex(index) {
      var self = this;
      if (!self._collection._dropIndex) throw new Error('Can only call _dropIndex on server collections');

      self._collection._dropIndex(index);
    },

    _dropCollection() {
      var self = this;
      if (!self._collection.dropCollection) throw new Error('Can only call _dropCollection on server collections');

      self._collection.dropCollection();
    },

    _createCappedCollection(byteSize, maxDocuments) {
      var self = this;
      if (!self._collection._createCappedCollection) throw new Error('Can only call _createCappedCollection on server collections');

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
        throw new Error('Can only call rawCollection on server collections');
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
        throw new Error('Can only call rawDatabase on server collections');
      }

      return self._driver.mongo.db;
    }

  }); // Convert the callback to not return a result if there is an error

  function wrapCallback(callback, convertResult) {
    return callback && function (error, result) {
      if (error) {
        callback(error);
      } else if (typeof convertResult === 'function') {
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

},"mongo_utils.js":function module(require,exports,module){

/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
//                                                                                                                     //
// packages/mongo/mongo_utils.js                                                                                       //
//                                                                                                                     //
/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
                                                                                                                       //
const _excluded = ["fields", "projection"];

let _objectSpread;

module.link("@babel/runtime/helpers/objectSpread2", {
  default(v) {
    _objectSpread = v;
  }

}, 0);

let _objectWithoutProperties;

module.link("@babel/runtime/helpers/objectWithoutProperties", {
  default(v) {
    _objectWithoutProperties = v;
  }

}, 1);
module.export({
  normalizeProjection: () => normalizeProjection
});

const normalizeProjection = options => {
  // transform fields key in projection
  const _ref = options || {},
        {
    fields,
    projection
  } = _ref,
        otherOptions = _objectWithoutProperties(_ref, _excluded); // TODO: enable this comment when deprecating the fields option
  // Log.debug(`fields option has been deprecated, please use the new 'projection' instead`)


  return _objectSpread(_objectSpread({}, otherOptions), projection || fields ? {
    projection: fields || projection
  } : {});
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
require("/node_modules/meteor/mongo/oplog_v2_converter.js");
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
//# sourceMappingURL=data:application/json;charset=utf8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIm1ldGVvcjovL/CfkrthcHAvcGFja2FnZXMvbW9uZ28vbW9uZ29fZHJpdmVyLmpzIiwibWV0ZW9yOi8v8J+Su2FwcC9wYWNrYWdlcy9tb25nby9vcGxvZ190YWlsaW5nLmpzIiwibWV0ZW9yOi8v8J+Su2FwcC9wYWNrYWdlcy9tb25nby9vYnNlcnZlX211bHRpcGxleC5qcyIsIm1ldGVvcjovL/CfkrthcHAvcGFja2FnZXMvbW9uZ28vZG9jX2ZldGNoZXIuanMiLCJtZXRlb3I6Ly/wn5K7YXBwL3BhY2thZ2VzL21vbmdvL3BvbGxpbmdfb2JzZXJ2ZV9kcml2ZXIuanMiLCJtZXRlb3I6Ly/wn5K7YXBwL3BhY2thZ2VzL21vbmdvL29wbG9nX29ic2VydmVfZHJpdmVyLmpzIiwibWV0ZW9yOi8v8J+Su2FwcC9wYWNrYWdlcy9tb25nby9vcGxvZ192Ml9jb252ZXJ0ZXIuanMiLCJtZXRlb3I6Ly/wn5K7YXBwL3BhY2thZ2VzL21vbmdvL2xvY2FsX2NvbGxlY3Rpb25fZHJpdmVyLmpzIiwibWV0ZW9yOi8v8J+Su2FwcC9wYWNrYWdlcy9tb25nby9yZW1vdGVfY29sbGVjdGlvbl9kcml2ZXIuanMiLCJtZXRlb3I6Ly/wn5K7YXBwL3BhY2thZ2VzL21vbmdvL2NvbGxlY3Rpb24uanMiLCJtZXRlb3I6Ly/wn5K7YXBwL3BhY2thZ2VzL21vbmdvL2Nvbm5lY3Rpb25fb3B0aW9ucy5qcyIsIm1ldGVvcjovL/CfkrthcHAvcGFja2FnZXMvbW9uZ28vbW9uZ29fdXRpbHMuanMiXSwibmFtZXMiOlsiX29iamVjdFNwcmVhZCIsIm1vZHVsZTEiLCJsaW5rIiwiZGVmYXVsdCIsInYiLCJub3JtYWxpemVQcm9qZWN0aW9uIiwiRG9jRmV0Y2hlciIsInBhdGgiLCJyZXF1aXJlIiwiTW9uZ29EQiIsIk5wbU1vZHVsZU1vbmdvZGIiLCJGdXR1cmUiLCJOcG0iLCJNb25nb0ludGVybmFscyIsIk5wbU1vZHVsZXMiLCJtb25nb2RiIiwidmVyc2lvbiIsIk5wbU1vZHVsZU1vbmdvZGJWZXJzaW9uIiwibW9kdWxlIiwiTnBtTW9kdWxlIiwiRklMRV9BU1NFVF9TVUZGSVgiLCJBU1NFVFNfRk9MREVSIiwiQVBQX0ZPTERFUiIsInJlcGxhY2VOYW1lcyIsImZpbHRlciIsInRoaW5nIiwiXyIsImlzQXJyYXkiLCJtYXAiLCJiaW5kIiwicmV0IiwiZWFjaCIsInZhbHVlIiwia2V5IiwiVGltZXN0YW1wIiwicHJvdG90eXBlIiwiY2xvbmUiLCJtYWtlTW9uZ29MZWdhbCIsIm5hbWUiLCJ1bm1ha2VNb25nb0xlZ2FsIiwic3Vic3RyIiwicmVwbGFjZU1vbmdvQXRvbVdpdGhNZXRlb3IiLCJkb2N1bWVudCIsIkJpbmFyeSIsImJ1ZmZlciIsIlVpbnQ4QXJyYXkiLCJPYmplY3RJRCIsIk1vbmdvIiwidG9IZXhTdHJpbmciLCJEZWNpbWFsMTI4IiwiRGVjaW1hbCIsInRvU3RyaW5nIiwic2l6ZSIsIkVKU09OIiwiZnJvbUpTT05WYWx1ZSIsInVuZGVmaW5lZCIsInJlcGxhY2VNZXRlb3JBdG9tV2l0aE1vbmdvIiwiaXNCaW5hcnkiLCJCdWZmZXIiLCJmcm9tIiwiZnJvbVN0cmluZyIsIl9pc0N1c3RvbVR5cGUiLCJ0b0pTT05WYWx1ZSIsInJlcGxhY2VUeXBlcyIsImF0b21UcmFuc2Zvcm1lciIsInJlcGxhY2VkVG9wTGV2ZWxBdG9tIiwidmFsIiwidmFsUmVwbGFjZWQiLCJNb25nb0Nvbm5lY3Rpb24iLCJ1cmwiLCJvcHRpb25zIiwic2VsZiIsIl9vYnNlcnZlTXVsdGlwbGV4ZXJzIiwiX29uRmFpbG92ZXJIb29rIiwiSG9vayIsInVzZXJPcHRpb25zIiwiX2Nvbm5lY3Rpb25PcHRpb25zIiwiTWV0ZW9yIiwic2V0dGluZ3MiLCJwYWNrYWdlcyIsIm1vbmdvIiwibW9uZ29PcHRpb25zIiwiT2JqZWN0IiwiYXNzaWduIiwiaWdub3JlVW5kZWZpbmVkIiwiaGFzIiwibWF4UG9vbFNpemUiLCJlbnRyaWVzIiwiZW5kc1dpdGgiLCJmb3JFYWNoIiwib3B0aW9uTmFtZSIsInJlcGxhY2UiLCJqb2luIiwiQXNzZXRzIiwiZ2V0U2VydmVyRGlyIiwiZGIiLCJfcHJpbWFyeSIsIl9vcGxvZ0hhbmRsZSIsIl9kb2NGZXRjaGVyIiwiY29ubmVjdEZ1dHVyZSIsIk1vbmdvQ2xpZW50IiwiY29ubmVjdCIsImJpbmRFbnZpcm9ubWVudCIsImVyciIsImNsaWVudCIsImhlbGxvRG9jdW1lbnQiLCJhZG1pbiIsImNvbW1hbmQiLCJoZWxsbyIsImF3YWl0IiwicHJpbWFyeSIsImlzTWFzdGVyRG9jdW1lbnQiLCJpc21hc3RlciIsInRvcG9sb2d5Iiwib24iLCJraW5kIiwiZG9jIiwiY2FsbGJhY2siLCJtZSIsInJlc29sdmVyIiwid2FpdCIsIm9wbG9nVXJsIiwiUGFja2FnZSIsIk9wbG9nSGFuZGxlIiwiZGF0YWJhc2VOYW1lIiwiY2xvc2UiLCJFcnJvciIsIm9wbG9nSGFuZGxlIiwic3RvcCIsIndyYXAiLCJyYXdDb2xsZWN0aW9uIiwiY29sbGVjdGlvbk5hbWUiLCJjb2xsZWN0aW9uIiwiX2NyZWF0ZUNhcHBlZENvbGxlY3Rpb24iLCJieXRlU2l6ZSIsIm1heERvY3VtZW50cyIsImZ1dHVyZSIsImNyZWF0ZUNvbGxlY3Rpb24iLCJjYXBwZWQiLCJtYXgiLCJfbWF5YmVCZWdpbldyaXRlIiwiZmVuY2UiLCJERFBTZXJ2ZXIiLCJfQ3VycmVudFdyaXRlRmVuY2UiLCJnZXQiLCJiZWdpbldyaXRlIiwiY29tbWl0dGVkIiwiX29uRmFpbG92ZXIiLCJyZWdpc3RlciIsIndyaXRlQ2FsbGJhY2siLCJ3cml0ZSIsInJlZnJlc2giLCJyZXN1bHQiLCJyZWZyZXNoRXJyIiwiYmluZEVudmlyb25tZW50Rm9yV3JpdGUiLCJfaW5zZXJ0IiwiY29sbGVjdGlvbl9uYW1lIiwic2VuZEVycm9yIiwiZSIsIl9leHBlY3RlZEJ5VGVzdCIsIkxvY2FsQ29sbGVjdGlvbiIsIl9pc1BsYWluT2JqZWN0IiwiaWQiLCJfaWQiLCJpbnNlcnRPbmUiLCJzYWZlIiwidGhlbiIsImluc2VydGVkSWQiLCJjYXRjaCIsIl9yZWZyZXNoIiwic2VsZWN0b3IiLCJyZWZyZXNoS2V5Iiwic3BlY2lmaWNJZHMiLCJfaWRzTWF0Y2hlZEJ5U2VsZWN0b3IiLCJleHRlbmQiLCJfcmVtb3ZlIiwiZGVsZXRlTWFueSIsImRlbGV0ZWRDb3VudCIsInRyYW5zZm9ybVJlc3VsdCIsIm1vZGlmaWVkQ291bnQiLCJudW1iZXJBZmZlY3RlZCIsIl9kcm9wQ29sbGVjdGlvbiIsImNiIiwiZHJvcENvbGxlY3Rpb24iLCJkcm9wIiwiX2Ryb3BEYXRhYmFzZSIsImRyb3BEYXRhYmFzZSIsIl91cGRhdGUiLCJtb2QiLCJGdW5jdGlvbiIsIm1vbmdvT3B0cyIsImFycmF5RmlsdGVycyIsInVwc2VydCIsIm11bHRpIiwiZnVsbFJlc3VsdCIsIm1vbmdvU2VsZWN0b3IiLCJtb25nb01vZCIsImlzTW9kaWZ5IiwiX2lzTW9kaWZpY2F0aW9uTW9kIiwiX2ZvcmJpZFJlcGxhY2UiLCJrbm93bklkIiwibmV3RG9jIiwiX2NyZWF0ZVVwc2VydERvY3VtZW50IiwiZ2VuZXJhdGVkSWQiLCJzaW11bGF0ZVVwc2VydFdpdGhJbnNlcnRlZElkIiwiZXJyb3IiLCJfcmV0dXJuT2JqZWN0IiwiaGFzT3duUHJvcGVydHkiLCIkc2V0T25JbnNlcnQiLCJzdHJpbmdzIiwia2V5cyIsInN0YXJ0c1dpdGgiLCJ1cGRhdGVNZXRob2QiLCJsZW5ndGgiLCJtZXRlb3JSZXN1bHQiLCJkcml2ZXJSZXN1bHQiLCJtb25nb1Jlc3VsdCIsInVwc2VydGVkQ291bnQiLCJ1cHNlcnRlZElkIiwibiIsIm1hdGNoZWRDb3VudCIsIk5VTV9PUFRJTUlTVElDX1RSSUVTIiwiX2lzQ2Fubm90Q2hhbmdlSWRFcnJvciIsImVycm1zZyIsImluZGV4T2YiLCJtb25nb09wdHNGb3JVcGRhdGUiLCJtb25nb09wdHNGb3JJbnNlcnQiLCJyZXBsYWNlbWVudFdpdGhJZCIsInRyaWVzIiwiZG9VcGRhdGUiLCJtZXRob2QiLCJ1cGRhdGVNYW55Iiwic29tZSIsInJlcGxhY2VPbmUiLCJkb0NvbmRpdGlvbmFsSW5zZXJ0Iiwid3JhcEFzeW5jIiwiYXBwbHkiLCJhcmd1bWVudHMiLCJ1cGRhdGUiLCJmaW5kIiwiQ3Vyc29yIiwiQ3Vyc29yRGVzY3JpcHRpb24iLCJmaW5kT25lIiwibGltaXQiLCJmZXRjaCIsImNyZWF0ZUluZGV4IiwiaW5kZXgiLCJpbmRleE5hbWUiLCJfZW5zdXJlSW5kZXgiLCJfZHJvcEluZGV4IiwiZHJvcEluZGV4IiwiQ29sbGVjdGlvbiIsIl9yZXdyaXRlU2VsZWN0b3IiLCJjdXJzb3JEZXNjcmlwdGlvbiIsIl9tb25nbyIsIl9jdXJzb3JEZXNjcmlwdGlvbiIsIl9zeW5jaHJvbm91c0N1cnNvciIsIlN5bWJvbCIsIml0ZXJhdG9yIiwidGFpbGFibGUiLCJfY3JlYXRlU3luY2hyb25vdXNDdXJzb3IiLCJzZWxmRm9ySXRlcmF0aW9uIiwidXNlVHJhbnNmb3JtIiwiZ2V0VHJhbnNmb3JtIiwidHJhbnNmb3JtIiwiX3B1Ymxpc2hDdXJzb3IiLCJzdWIiLCJfZ2V0Q29sbGVjdGlvbk5hbWUiLCJvYnNlcnZlIiwiY2FsbGJhY2tzIiwiX29ic2VydmVGcm9tT2JzZXJ2ZUNoYW5nZXMiLCJvYnNlcnZlQ2hhbmdlcyIsIm1ldGhvZHMiLCJvcmRlcmVkIiwiX29ic2VydmVDaGFuZ2VzQ2FsbGJhY2tzQXJlT3JkZXJlZCIsImV4Y2VwdGlvbk5hbWUiLCJfZnJvbU9ic2VydmUiLCJfb2JzZXJ2ZUNoYW5nZXMiLCJub25NdXRhdGluZ0NhbGxiYWNrcyIsInBpY2siLCJjdXJzb3JPcHRpb25zIiwic29ydCIsInNraXAiLCJwcm9qZWN0aW9uIiwiZmllbGRzIiwicmVhZFByZWZlcmVuY2UiLCJudW1iZXJPZlJldHJpZXMiLCJkYkN1cnNvciIsImFkZEN1cnNvckZsYWciLCJPUExPR19DT0xMRUNUSU9OIiwidHMiLCJtYXhUaW1lTXMiLCJtYXhUaW1lTVMiLCJoaW50IiwiU3luY2hyb25vdXNDdXJzb3IiLCJfZGJDdXJzb3IiLCJfc2VsZkZvckl0ZXJhdGlvbiIsIl90cmFuc2Zvcm0iLCJ3cmFwVHJhbnNmb3JtIiwiX3N5bmNocm9ub3VzQ291bnQiLCJjb3VudCIsIl92aXNpdGVkSWRzIiwiX0lkTWFwIiwiX3Jhd05leHRPYmplY3RQcm9taXNlIiwiUHJvbWlzZSIsInJlc29sdmUiLCJyZWplY3QiLCJuZXh0IiwiX25leHRPYmplY3RQcm9taXNlIiwic2V0IiwiX25leHRPYmplY3RQcm9taXNlV2l0aFRpbWVvdXQiLCJ0aW1lb3V0TVMiLCJuZXh0T2JqZWN0UHJvbWlzZSIsInRpbWVvdXRFcnIiLCJ0aW1lb3V0UHJvbWlzZSIsInRpbWVyIiwic2V0VGltZW91dCIsInJhY2UiLCJfbmV4dE9iamVjdCIsInRoaXNBcmciLCJfcmV3aW5kIiwiY2FsbCIsInJlcyIsInB1c2giLCJyZXdpbmQiLCJpZGVudGl0eSIsImdldFJhd09iamVjdHMiLCJyZXN1bHRzIiwiZG9uZSIsInRhaWwiLCJkb2NDYWxsYmFjayIsImN1cnNvciIsInN0b3BwZWQiLCJsYXN0VFMiLCJsb29wIiwibmV3U2VsZWN0b3IiLCIkZ3QiLCJkZWZlciIsIl9vYnNlcnZlQ2hhbmdlc1RhaWxhYmxlIiwiZmllbGRzT3B0aW9ucyIsIm9ic2VydmVLZXkiLCJzdHJpbmdpZnkiLCJtdWx0aXBsZXhlciIsIm9ic2VydmVEcml2ZXIiLCJmaXJzdEhhbmRsZSIsIl9ub1lpZWxkc0FsbG93ZWQiLCJPYnNlcnZlTXVsdGlwbGV4ZXIiLCJvblN0b3AiLCJvYnNlcnZlSGFuZGxlIiwiT2JzZXJ2ZUhhbmRsZSIsIm1hdGNoZXIiLCJzb3J0ZXIiLCJjYW5Vc2VPcGxvZyIsImFsbCIsIl90ZXN0T25seVBvbGxDYWxsYmFjayIsIk1pbmltb25nbyIsIk1hdGNoZXIiLCJPcGxvZ09ic2VydmVEcml2ZXIiLCJjdXJzb3JTdXBwb3J0ZWQiLCJTb3J0ZXIiLCJmIiwiZHJpdmVyQ2xhc3MiLCJQb2xsaW5nT2JzZXJ2ZURyaXZlciIsIm1vbmdvSGFuZGxlIiwiX29ic2VydmVEcml2ZXIiLCJhZGRIYW5kbGVBbmRTZW5kSW5pdGlhbEFkZHMiLCJsaXN0ZW5BbGwiLCJsaXN0ZW5DYWxsYmFjayIsImxpc3RlbmVycyIsImZvckVhY2hUcmlnZ2VyIiwidHJpZ2dlciIsIl9JbnZhbGlkYXRpb25Dcm9zc2JhciIsImxpc3RlbiIsImxpc3RlbmVyIiwidHJpZ2dlckNhbGxiYWNrIiwiYWRkZWRCZWZvcmUiLCJhZGRlZCIsIk1vbmdvVGltZXN0YW1wIiwiQ29ubmVjdGlvbiIsIkxvbmciLCJUT09fRkFSX0JFSElORCIsInByb2Nlc3MiLCJlbnYiLCJNRVRFT1JfT1BMT0dfVE9PX0ZBUl9CRUhJTkQiLCJUQUlMX1RJTUVPVVQiLCJNRVRFT1JfT1BMT0dfVEFJTF9USU1FT1VUIiwic2hvd1RTIiwiZ2V0SGlnaEJpdHMiLCJnZXRMb3dCaXRzIiwiaWRGb3JPcCIsIm9wIiwibyIsIm8yIiwiZGJOYW1lIiwiX29wbG9nVXJsIiwiX2RiTmFtZSIsIl9vcGxvZ0xhc3RFbnRyeUNvbm5lY3Rpb24iLCJfb3Bsb2dUYWlsQ29ubmVjdGlvbiIsIl9zdG9wcGVkIiwiX3RhaWxIYW5kbGUiLCJfcmVhZHlGdXR1cmUiLCJfY3Jvc3NiYXIiLCJfQ3Jvc3NiYXIiLCJmYWN0UGFja2FnZSIsImZhY3ROYW1lIiwiX2Jhc2VPcGxvZ1NlbGVjdG9yIiwibnMiLCJSZWdFeHAiLCJfZXNjYXBlUmVnRXhwIiwiJG9yIiwiJGluIiwiJGV4aXN0cyIsIl9jYXRjaGluZ1VwRnV0dXJlcyIsIl9sYXN0UHJvY2Vzc2VkVFMiLCJfb25Ta2lwcGVkRW50cmllc0hvb2siLCJkZWJ1Z1ByaW50RXhjZXB0aW9ucyIsIl9lbnRyeVF1ZXVlIiwiX0RvdWJsZUVuZGVkUXVldWUiLCJfd29ya2VyQWN0aXZlIiwiX3N0YXJ0VGFpbGluZyIsIm9uT3Bsb2dFbnRyeSIsIm9yaWdpbmFsQ2FsbGJhY2siLCJub3RpZmljYXRpb24iLCJfZGVidWciLCJsaXN0ZW5IYW5kbGUiLCJvblNraXBwZWRFbnRyaWVzIiwid2FpdFVudGlsQ2F1Z2h0VXAiLCJsYXN0RW50cnkiLCIkbmF0dXJhbCIsIl9zbGVlcEZvck1zIiwibGVzc1RoYW5PckVxdWFsIiwiaW5zZXJ0QWZ0ZXIiLCJncmVhdGVyVGhhbiIsInNwbGljZSIsIm1vbmdvZGJVcmkiLCJwYXJzZSIsImRhdGFiYXNlIiwiaXNNYXN0ZXJEb2MiLCJzZXROYW1lIiwibGFzdE9wbG9nRW50cnkiLCJvcGxvZ1NlbGVjdG9yIiwiX21heWJlU3RhcnRXb3JrZXIiLCJyZXR1cm4iLCJoYW5kbGVEb2MiLCJhcHBseU9wcyIsIm5leHRUaW1lc3RhbXAiLCJhZGQiLCJPTkUiLCJzbGljZSIsImZpcmUiLCJpc0VtcHR5IiwicG9wIiwiY2xlYXIiLCJfc2V0TGFzdFByb2Nlc3NlZFRTIiwic2hpZnQiLCJzZXF1ZW5jZXIiLCJfZGVmaW5lVG9vRmFyQmVoaW5kIiwiX3Jlc2V0VG9vRmFyQmVoaW5kIiwiX29iamVjdFdpdGhvdXRQcm9wZXJ0aWVzIiwiRmFjdHMiLCJpbmNyZW1lbnRTZXJ2ZXJGYWN0IiwiX29yZGVyZWQiLCJfb25TdG9wIiwiX3F1ZXVlIiwiX1N5bmNocm9ub3VzUXVldWUiLCJfaGFuZGxlcyIsIl9jYWNoZSIsIl9DYWNoaW5nQ2hhbmdlT2JzZXJ2ZXIiLCJfYWRkSGFuZGxlVGFza3NTY2hlZHVsZWRCdXROb3RQZXJmb3JtZWQiLCJjYWxsYmFja05hbWVzIiwiY2FsbGJhY2tOYW1lIiwiX2FwcGx5Q2FsbGJhY2siLCJ0b0FycmF5IiwiaGFuZGxlIiwic2FmZVRvUnVuVGFzayIsInJ1blRhc2siLCJfc2VuZEFkZHMiLCJyZW1vdmVIYW5kbGUiLCJfcmVhZHkiLCJfc3RvcCIsImZyb21RdWVyeUVycm9yIiwicmVhZHkiLCJxdWV1ZVRhc2siLCJxdWVyeUVycm9yIiwidGhyb3ciLCJvbkZsdXNoIiwiaXNSZXNvbHZlZCIsImFyZ3MiLCJhcHBseUNoYW5nZSIsImhhbmRsZUlkIiwiX2FkZGVkQmVmb3JlIiwiX2FkZGVkIiwiZG9jcyIsIm5leHRPYnNlcnZlSGFuZGxlSWQiLCJfbXVsdGlwbGV4ZXIiLCJiZWZvcmUiLCJleHBvcnQiLCJGaWJlciIsImNvbnN0cnVjdG9yIiwibW9uZ29Db25uZWN0aW9uIiwiX21vbmdvQ29ubmVjdGlvbiIsIl9jYWxsYmFja3NGb3JPcCIsIk1hcCIsImNoZWNrIiwiU3RyaW5nIiwiZGVsZXRlIiwicnVuIiwiUE9MTElOR19USFJPVFRMRV9NUyIsIk1FVEVPUl9QT0xMSU5HX1RIUk9UVExFX01TIiwiUE9MTElOR19JTlRFUlZBTF9NUyIsIk1FVEVPUl9QT0xMSU5HX0lOVEVSVkFMX01TIiwiX21vbmdvSGFuZGxlIiwiX3N0b3BDYWxsYmFja3MiLCJfcmVzdWx0cyIsIl9wb2xsc1NjaGVkdWxlZEJ1dE5vdFN0YXJ0ZWQiLCJfcGVuZGluZ1dyaXRlcyIsIl9lbnN1cmVQb2xsSXNTY2hlZHVsZWQiLCJ0aHJvdHRsZSIsIl91bnRocm90dGxlZEVuc3VyZVBvbGxJc1NjaGVkdWxlZCIsInBvbGxpbmdUaHJvdHRsZU1zIiwiX3Rhc2tRdWV1ZSIsImxpc3RlbmVyc0hhbmRsZSIsInBvbGxpbmdJbnRlcnZhbCIsInBvbGxpbmdJbnRlcnZhbE1zIiwiX3BvbGxpbmdJbnRlcnZhbCIsImludGVydmFsSGFuZGxlIiwic2V0SW50ZXJ2YWwiLCJjbGVhckludGVydmFsIiwiX3BvbGxNb25nbyIsIl9zdXNwZW5kUG9sbGluZyIsIl9yZXN1bWVQb2xsaW5nIiwiZmlyc3QiLCJuZXdSZXN1bHRzIiwib2xkUmVzdWx0cyIsIndyaXRlc0ZvckN5Y2xlIiwiY29kZSIsIkpTT04iLCJtZXNzYWdlIiwiQXJyYXkiLCJfZGlmZlF1ZXJ5Q2hhbmdlcyIsInciLCJjIiwib3Bsb2dWMlYxQ29udmVydGVyIiwiUEhBU0UiLCJRVUVSWUlORyIsIkZFVENISU5HIiwiU1RFQURZIiwiU3dpdGNoZWRUb1F1ZXJ5IiwiZmluaXNoSWZOZWVkVG9Qb2xsUXVlcnkiLCJjdXJyZW50SWQiLCJfdXNlc09wbG9nIiwiY29tcGFyYXRvciIsImdldENvbXBhcmF0b3IiLCJoZWFwT3B0aW9ucyIsIklkTWFwIiwiX2xpbWl0IiwiX2NvbXBhcmF0b3IiLCJfc29ydGVyIiwiX3VucHVibGlzaGVkQnVmZmVyIiwiTWluTWF4SGVhcCIsIl9wdWJsaXNoZWQiLCJNYXhIZWFwIiwiX3NhZmVBcHBlbmRUb0J1ZmZlciIsIl9zdG9wSGFuZGxlcyIsIl9yZWdpc3RlclBoYXNlQ2hhbmdlIiwiX21hdGNoZXIiLCJfcHJvamVjdGlvbkZuIiwiX2NvbXBpbGVQcm9qZWN0aW9uIiwiX3NoYXJlZFByb2plY3Rpb24iLCJjb21iaW5lSW50b1Byb2plY3Rpb24iLCJfc2hhcmVkUHJvamVjdGlvbkZuIiwiX25lZWRUb0ZldGNoIiwiX2N1cnJlbnRseUZldGNoaW5nIiwiX2ZldGNoR2VuZXJhdGlvbiIsIl9yZXF1ZXJ5V2hlbkRvbmVUaGlzUXVlcnkiLCJfd3JpdGVzVG9Db21taXRXaGVuV2VSZWFjaFN0ZWFkeSIsIl9uZWVkVG9Qb2xsUXVlcnkiLCJfcGhhc2UiLCJfaGFuZGxlT3Bsb2dFbnRyeVF1ZXJ5aW5nIiwiX2hhbmRsZU9wbG9nRW50cnlTdGVhZHlPckZldGNoaW5nIiwiZmlyZWQiLCJfb3Bsb2dPYnNlcnZlRHJpdmVycyIsIm9uQmVmb3JlRmlyZSIsImRyaXZlcnMiLCJkcml2ZXIiLCJfcnVuSW5pdGlhbFF1ZXJ5IiwiX2FkZFB1Ymxpc2hlZCIsIm92ZXJmbG93aW5nRG9jSWQiLCJtYXhFbGVtZW50SWQiLCJvdmVyZmxvd2luZ0RvYyIsImVxdWFscyIsInJlbW92ZSIsInJlbW92ZWQiLCJfYWRkQnVmZmVyZWQiLCJfcmVtb3ZlUHVibGlzaGVkIiwiZW1wdHkiLCJuZXdEb2NJZCIsIm1pbkVsZW1lbnRJZCIsIl9yZW1vdmVCdWZmZXJlZCIsIl9jaGFuZ2VQdWJsaXNoZWQiLCJvbGREb2MiLCJwcm9qZWN0ZWROZXciLCJwcm9qZWN0ZWRPbGQiLCJjaGFuZ2VkIiwiRGlmZlNlcXVlbmNlIiwibWFrZUNoYW5nZWRGaWVsZHMiLCJtYXhCdWZmZXJlZElkIiwiX2FkZE1hdGNoaW5nIiwibWF4UHVibGlzaGVkIiwibWF4QnVmZmVyZWQiLCJ0b1B1Ymxpc2giLCJjYW5BcHBlbmRUb0J1ZmZlciIsImNhbkluc2VydEludG9CdWZmZXIiLCJ0b0J1ZmZlciIsIl9yZW1vdmVNYXRjaGluZyIsIl9oYW5kbGVEb2MiLCJtYXRjaGVzTm93IiwiZG9jdW1lbnRNYXRjaGVzIiwicHVibGlzaGVkQmVmb3JlIiwiYnVmZmVyZWRCZWZvcmUiLCJjYWNoZWRCZWZvcmUiLCJtaW5CdWZmZXJlZCIsInN0YXlzSW5QdWJsaXNoZWQiLCJzdGF5c0luQnVmZmVyIiwiX2ZldGNoTW9kaWZpZWREb2N1bWVudHMiLCJ0aGlzR2VuZXJhdGlvbiIsIndhaXRpbmciLCJmdXQiLCJfYmVTdGVhZHkiLCJ3cml0ZXMiLCJpc1JlcGxhY2UiLCJjYW5EaXJlY3RseU1vZGlmeURvYyIsIm1vZGlmaWVyQ2FuQmVEaXJlY3RseUFwcGxpZWQiLCJfbW9kaWZ5IiwiY2FuQmVjb21lVHJ1ZUJ5TW9kaWZpZXIiLCJhZmZlY3RlZEJ5TW9kaWZpZXIiLCJfcnVuUXVlcnkiLCJpbml0aWFsIiwiX2RvbmVRdWVyeWluZyIsIl9wb2xsUXVlcnkiLCJuZXdCdWZmZXIiLCJfY3Vyc29yRm9yUXVlcnkiLCJpIiwiX3B1Ymxpc2hOZXdSZXN1bHRzIiwib3B0aW9uc092ZXJ3cml0ZSIsImRlc2NyaXB0aW9uIiwiaWRzVG9SZW1vdmUiLCJjb25zb2xlIiwiX29wbG9nRW50cnlIYW5kbGUiLCJfbGlzdGVuZXJzSGFuZGxlIiwicGhhc2UiLCJub3ciLCJEYXRlIiwidGltZURpZmYiLCJfcGhhc2VTdGFydFRpbWUiLCJkaXNhYmxlT3Bsb2ciLCJfZGlzYWJsZU9wbG9nIiwiX2NoZWNrU3VwcG9ydGVkUHJvamVjdGlvbiIsImhhc1doZXJlIiwiaGFzR2VvUXVlcnkiLCJtb2RpZmllciIsIm9wZXJhdGlvbiIsImZpZWxkIiwidGVzdCIsImxvZ0NvbnZlcnRlckNhbGxzIiwib3Bsb2dFbnRyeSIsInByZWZpeEtleSIsIk9QTE9HX0NPTlZFUlRFUl9ERUJVRyIsImxvZyIsImlzQXJyYXlPcGVyYXRvciIsInBvc3NpYmxlQXJyYXlPcGVyYXRvciIsImEiLCJtYXRjaCIsImxvZ09wbG9nRW50cnlFcnJvciIsIm5lc3RlZE9wbG9nRW50cnlQYXJzZXJzIiwidSIsImQiLCJzRmllbGRzIiwic0ZpZWxkc09wZXJhdG9ycyIsImFjdHVhbEtleU5hbWVXaXRob3V0U1ByZWZpeCIsInN1YnN0cmluZyIsInVQb3NpdGlvbiIsInBvc2l0aW9uS2V5IiwibmV3QXJyYXlJbmRleFZhbHVlIiwiJHVuc2V0IiwicmVkdWNlIiwiYWNjIiwic2V0T2JqZWN0U291cmNlIiwiJHNldCIsInByZWZpeGVkS2V5IiwiZmxhdHRlbk9iamVjdCIsInMiLCJ1biIsInVuc2V0IiwidjJPcGxvZ0VudHJ5IiwiJHYiLCJkaWZmIiwib2IiLCJ0b1JldHVybiIsImZsYXRPYmplY3QiLCJvYmplY3RLZXlzIiwieCIsIkxvY2FsQ29sbGVjdGlvbkRyaXZlciIsIm5vQ29ubkNvbGxlY3Rpb25zIiwiY3JlYXRlIiwib3BlbiIsImNvbm4iLCJlbnN1cmVDb2xsZWN0aW9uIiwiX21vbmdvX2xpdmVkYXRhX2NvbGxlY3Rpb25zIiwiY29sbGVjdGlvbnMiLCJSZW1vdGVDb2xsZWN0aW9uRHJpdmVyIiwibW9uZ29fdXJsIiwibSIsImRlZmF1bHRSZW1vdGVDb2xsZWN0aW9uRHJpdmVyIiwib25jZSIsImNvbm5lY3Rpb25PcHRpb25zIiwibW9uZ29VcmwiLCJNT05HT19VUkwiLCJNT05HT19PUExPR19VUkwiLCJjb25uZWN0aW9uIiwibWFuYWdlciIsImlkR2VuZXJhdGlvbiIsIl9kcml2ZXIiLCJfcHJldmVudEF1dG9wdWJsaXNoIiwiX21ha2VOZXdJRCIsInNyYyIsIkREUCIsInJhbmRvbVN0cmVhbSIsIlJhbmRvbSIsImluc2VjdXJlIiwiaGV4U3RyaW5nIiwiX2Nvbm5lY3Rpb24iLCJpc0NsaWVudCIsInNlcnZlciIsIl9jb2xsZWN0aW9uIiwiX25hbWUiLCJfbWF5YmVTZXRVcFJlcGxpY2F0aW9uIiwiZGVmaW5lTXV0YXRpb25NZXRob2RzIiwiX2RlZmluZU11dGF0aW9uTWV0aG9kcyIsInVzZUV4aXN0aW5nIiwiX3N1cHByZXNzU2FtZU5hbWVFcnJvciIsImF1dG9wdWJsaXNoIiwicHVibGlzaCIsImlzX2F1dG8iLCJyZWdpc3RlclN0b3JlIiwib2siLCJiZWdpblVwZGF0ZSIsImJhdGNoU2l6ZSIsInJlc2V0IiwicGF1c2VPYnNlcnZlcnMiLCJtc2ciLCJtb25nb0lkIiwiTW9uZ29JRCIsImlkUGFyc2UiLCJfZG9jcyIsIl9yZWYiLCJpbnNlcnQiLCJlbmRVcGRhdGUiLCJyZXN1bWVPYnNlcnZlcnMiLCJzYXZlT3JpZ2luYWxzIiwicmV0cmlldmVPcmlnaW5hbHMiLCJnZXREb2MiLCJfZ2V0Q29sbGVjdGlvbiIsIndhcm4iLCJfZ2V0RmluZFNlbGVjdG9yIiwiX2dldEZpbmRPcHRpb25zIiwibmV3T3B0aW9ucyIsIk1hdGNoIiwiT3B0aW9uYWwiLCJPYmplY3RJbmNsdWRpbmciLCJPbmVPZiIsIk51bWJlciIsImZhbGxiYWNrSWQiLCJfc2VsZWN0b3JJc0lkIiwiZ2V0UHJvdG90eXBlT2YiLCJnZXRPd25Qcm9wZXJ0eURlc2NyaXB0b3JzIiwiZ2VuZXJhdGVJZCIsIl9pc1JlbW90ZUNvbGxlY3Rpb24iLCJlbmNsb3NpbmciLCJfQ3VycmVudE1ldGhvZEludm9jYXRpb24iLCJjaG9vc2VSZXR1cm5WYWx1ZUZyb21Db2xsZWN0aW9uUmVzdWx0Iiwid3JhcHBlZENhbGxiYWNrIiwid3JhcENhbGxiYWNrIiwiX2NhbGxNdXRhdG9yTWV0aG9kIiwib3B0aW9uc0FuZENhbGxiYWNrIiwicG9wQ2FsbGJhY2tGcm9tQXJncyIsIkxvZyIsImRlYnVnIiwicmF3RGF0YWJhc2UiLCJjb252ZXJ0UmVzdWx0IiwiQWxsb3dEZW55IiwiQ29sbGVjdGlvblByb3RvdHlwZSIsInNldENvbm5lY3Rpb25PcHRpb25zIiwib3RoZXJPcHRpb25zIl0sIm1hcHBpbmdzIjoiOzs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7OztBQUFBLE1BQUlBLGFBQUo7O0FBQWtCQyxTQUFPLENBQUNDLElBQVIsQ0FBYSxzQ0FBYixFQUFvRDtBQUFDQyxXQUFPLENBQUNDLENBQUQsRUFBRztBQUFDSixtQkFB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cG9ydCB7IG5vcm1hbGl6ZVByb2plY3Rpb24gfSBmcm9tIFwiLi9tb25nb191dGlsc1wiO1xuXG4vKipcbiAqIFByb3ZpZGUgYSBzeW5jaHJvbm91cyBDb2xsZWN0aW9uIEFQSSB1c2luZyBmaWJlcnMsIGJhY2tlZCBieVxuICogTW9uZ29EQi4gIFRoaXMgaXMgb25seSBmb3IgdXNlIG9uIHRoZSBzZXJ2ZXIsIGFuZCBtb3N0bHkgaWRlbnRpY2FsXG4gKiB0byB0aGUgY2xpZW50IEFQSS5cbiAqXG4gKiBOT1RFOiB0aGUgcHVibGljIEFQSSBtZXRob2RzIG11c3QgYmUgcnVuIHdpdGhpbiBhIGZpYmVyLiBJZiB5b3UgY2FsbFxuICogdGhlc2Ugb3V0c2lkZSBvZiBhIGZpYmVyIHRoZXkgd2lsbCBleHBsb2RlIVxuICovXG5cbmNvbnN0IHBhdGggPSByZXF1aXJlKFwicGF0aFwiKTtcblxudmFyIE1vbmdvREIgPSBOcG1Nb2R1bGVNb25nb2RiO1xudmFyIEZ1dHVyZSA9IE5wbS5yZXF1aXJlKCdmaWJlcnMvZnV0dXJlJyk7XG5pbXBvcnQgeyBEb2NGZXRjaGVyIH0gZnJvbSBcIi4vZG9jX2ZldGNoZXIuanNcIjtcblxuTW9uZ29JbnRlcm5hbHMgPSB7fTtcblxuTW9uZ29JbnRlcm5hbHMuTnBtTW9kdWxlcyA9IHtcbiAgbW9uZ29kYjoge1xuICAgIHZlcnNpb246IE5wbU1vZHVsZU1vbmdvZGJWZXJzaW9uLFxuICAgIG1vZHVsZTogTW9uZ29EQlxuICB9XG59O1xuXG4vLyBPbGRlciB2ZXJzaW9uIG9mIHdoYXQgaXMgbm93IGF2YWlsYWJsZSB2aWFcbi8vIE1vbmdvSW50ZXJuYWxzLk5wbU1vZHVsZXMubW9uZ29kYi5tb2R1bGUuICBJdCB3YXMgbmV2ZXIgZG9jdW1lbnRlZCwgYnV0XG4vLyBwZW9wbGUgZG8gdXNlIGl0LlxuLy8gWFhYIENPTVBBVCBXSVRIIDEuMC4zLjJcbk1vbmdvSW50ZXJuYWxzLk5wbU1vZHVsZSA9IE1vbmdvREI7XG5cbmNvbnN0IEZJTEVfQVNTRVRfU1VGRklYID0gJ0Fzc2V0JztcbmNvbnN0IEFTU0VUU19GT0xERVIgPSAnYXNzZXRzJztcbmNvbnN0IEFQUF9GT0xERVIgPSAnYXBwJztcblxuLy8gVGhpcyBpcyB1c2VkIHRvIGFkZCBvciByZW1vdmUgRUpTT04gZnJvbSB0aGUgYmVnaW5uaW5nIG9mIGV2ZXJ5dGhpbmcgbmVzdGVkXG4vLyBpbnNpZGUgYW4gRUpTT04gY3VzdG9tIHR5cGUuIEl0IHNob3VsZCBvbmx5IGJlIGNhbGxlZCBvbiBwdXJlIEpTT04hXG52YXIgcmVwbGFjZU5hbWVzID0gZnVuY3Rpb24gKGZpbHRlciwgdGhpbmcpIHtcbiAgaWYgKHR5cGVvZiB0aGluZyA9PT0gXCJvYmplY3RcIiAmJiB0aGluZyAhPT0gbnVsbCkge1xuICAgIGlmIChfLmlzQXJyYXkodGhpbmcpKSB7XG4gICAgICByZXR1cm4gXy5tYXAodGhpbmcsIF8uYmluZChyZXBsYWNlTmFtZXMsIG51bGwsIGZpbHRlcikpO1xuICAgIH1cbiAgICB2YXIgcmV0ID0ge307XG4gICAgXy5lYWNoKHRoaW5nLCBmdW5jdGlvbiAodmFsdWUsIGtleSkge1xuICAgICAgcmV0W2ZpbHRlcihrZXkpXSA9IHJlcGxhY2VOYW1lcyhmaWx0ZXIsIHZhbHVlKTtcbiAgICB9KTtcbiAgICByZXR1cm4gcmV0O1xuICB9XG4gIHJldHVybiB0aGluZztcbn07XG5cbi8vIEVuc3VyZSB0aGF0IEVKU09OLmNsb25lIGtlZXBzIGEgVGltZXN0YW1wIGFzIGEgVGltZXN0YW1wIChpbnN0ZWFkIG9mIGp1c3Rcbi8vIGRvaW5nIGEgc3RydWN0dXJhbCBjbG9uZSkuXG4vLyBYWFggaG93IG9rIGlzIHRoaXM/IHdoYXQgaWYgdGhlcmUgYXJlIG11bHRpcGxlIGNvcGllcyBvZiBNb25nb0RCIGxvYWRlZD9cbk1vbmdvREIuVGltZXN0YW1wLnByb3RvdHlwZS5jbG9uZSA9IGZ1bmN0aW9uICgpIHtcbiAgLy8gVGltZXN0YW1wcyBzaG91bGQgYmUgaW1tdXRhYmxlLlxuICByZXR1cm4gdGhpcztcbn07XG5cbnZhciBtYWtlTW9uZ29MZWdhbCA9IGZ1bmN0aW9uIChuYW1lKSB7IHJldHVybiBcIkVKU09OXCIgKyBuYW1lOyB9O1xudmFyIHVubWFrZU1vbmdvTGVnYWwgPSBmdW5jdGlvbiAobmFtZSkgeyByZXR1cm4gbmFtZS5zdWJzdHIoNSk7IH07XG5cbnZhciByZXBsYWNlTW9uZ29BdG9tV2l0aE1ldGVvciA9IGZ1bmN0aW9uIChkb2N1bWVudCkge1xuICBpZiAoZG9jdW1lbnQgaW5zdGFuY2VvZiBNb25nb0RCLkJpbmFyeSkge1xuICAgIHZhciBidWZmZXIgPSBkb2N1bWVudC52YWx1ZSh0cnVlKTtcbiAgICByZXR1cm4gbmV3IFVpbnQ4QXJyYXkoYnVmZmVyKTtcbiAgfVxuICBpZiAoZG9jdW1lbnQgaW5zdGFuY2VvZiBNb25nb0RCLk9iamVjdElEKSB7XG4gICAgcmV0dXJuIG5ldyBNb25nby5PYmplY3RJRChkb2N1bWVudC50b0hleFN0cmluZygpKTtcbiAgfVxuICBpZiAoZG9jdW1lbnQgaW5zdGFuY2VvZiBNb25nb0RCLkRlY2ltYWwxMjgpIHtcbiAgICByZXR1cm4gRGVjaW1hbChkb2N1bWVudC50b1N0cmluZygpKTtcbiAgfVxuICBpZiAoZG9jdW1lbnRbXCJFSlNPTiR0eXBlXCJdICYmIGRvY3VtZW50W1wiRUpTT04kdmFsdWVcIl0gJiYgXy5zaXplKGRvY3VtZW50KSA9PT0gMikge1xuICAgIHJldHVybiBFSlNPTi5mcm9tSlNPTlZhbHVlKHJlcGxhY2VOYW1lcyh1bm1ha2VNb25nb0xlZ2FsLCBkb2N1bWVudCkpO1xuICB9XG4gIGlmIChkb2N1bWVudCBpbnN0YW5jZW9mIE1vbmdvREIuVGltZXN0YW1wKSB7XG4gICAgLy8gRm9yIG5vdywgdGhlIE1ldGVvciByZXByZXNlbnRhdGlvbiBvZiBhIE1vbmdvIHRpbWVzdGFtcCB0eXBlIChub3QgYSBkYXRlIVxuICAgIC8vIHRoaXMgaXMgYSB3ZWlyZCBpbnRlcm5hbCB0aGluZyB1c2VkIGluIHRoZSBvcGxvZyEpIGlzIHRoZSBzYW1lIGFzIHRoZVxuICAgIC8vIE1vbmdvIHJlcHJlc2VudGF0aW9uLiBXZSBuZWVkIHRvIGRvIHRoaXMgZXhwbGljaXRseSBvciBlbHNlIHdlIHdvdWxkIGRvIGFcbiAgICAvLyBzdHJ1Y3R1cmFsIGNsb25lIGFuZCBsb3NlIHRoZSBwcm90b3R5cGUuXG4gICAgcmV0dXJuIGRvY3VtZW50O1xuICB9XG4gIHJldHVybiB1bmRlZmluZWQ7XG59O1xuXG52YXIgcmVwbGFjZU1ldGVvckF0b21XaXRoTW9uZ28gPSBmdW5jdGlvbiAoZG9jdW1lbnQpIHtcbiAgaWYgKEVKU09OLmlzQmluYXJ5KGRvY3VtZW50KSkge1xuICAgIC8vIFRoaXMgZG9lcyBtb3JlIGNvcGllcyB0aGFuIHdlJ2QgbGlrZSwgYnV0IGlzIG5lY2Vzc2FyeSBiZWNhdXNlXG4gICAgLy8gTW9uZ29EQi5CU09OIG9ubHkgbG9va3MgbGlrZSBpdCB0YWtlcyBhIFVpbnQ4QXJyYXkgKGFuZCBkb2Vzbid0IGFjdHVhbGx5XG4gICAgLy8gc2VyaWFsaXplIGl0IGNvcnJlY3RseSkuXG4gICAgcmV0dXJuIG5ldyBNb25nb0RCLkJpbmFyeShCdWZmZXIuZnJvbShkb2N1bWVudCkpO1xuICB9XG4gIGlmIChkb2N1bWVudCBpbnN0YW5jZW9mIE1vbmdvLk9iamVjdElEKSB7XG4gICAgcmV0dXJuIG5ldyBNb25nb0RCLk9iamVjdElEKGRvY3VtZW50LnRvSGV4U3RyaW5nKCkpO1xuICB9XG4gIGlmIChkb2N1bWVudCBpbnN0YW5jZW9mIE1vbmdvREIuVGltZXN0YW1wKSB7XG4gICAgLy8gRm9yIG5vdywgdGhlIE1ldGVvciByZXByZXNlbnRhdGlvbiBvZiBhIE1vbmdvIHRpbWVzdGFtcCB0eXBlIChub3QgYSBkYXRlIVxuICAgIC8vIHRoaXMgaXMgYSB3ZWlyZCBpbnRlcm5hbCB0aGluZyB1c2VkIGluIHRoZSBvcGxvZyEpIGlzIHRoZSBzYW1lIGFzIHRoZVxuICAgIC8vIE1vbmdvIHJlcHJlc2VudGF0aW9uLiBXZSBuZWVkIHRvIGRvIHRoaXMgZXhwbGljaXRseSBvciBlbHNlIHdlIHdvdWxkIGRvIGFcbiAgICAvLyBzdHJ1Y3R1cmFsIGNsb25lIGFuZCBsb3NlIHRoZSBwcm90b3R5cGUuXG4gICAgcmV0dXJuIGRvY3VtZW50O1xuICB9XG4gIGlmIChkb2N1bWVudCBpbnN0YW5jZW9mIERlY2ltYWwpIHtcbiAgICByZXR1cm4gTW9uZ29EQi5EZWNpbWFsMTI4LmZyb21TdHJpbmcoZG9jdW1lbnQudG9TdHJpbmcoKSk7XG4gIH1cbiAgaWYgKEVKU09OLl9pc0N1c3RvbVR5cGUoZG9jdW1lbnQpKSB7XG4gICAgcmV0dXJuIHJlcGxhY2VOYW1lcyhtYWtlTW9uZ29MZWdhbCwgRUpTT04udG9KU09OVmFsdWUoZG9jdW1lbnQpKTtcbiAgfVxuICAvLyBJdCBpcyBub3Qgb3JkaW5hcmlseSBwb3NzaWJsZSB0byBzdGljayBkb2xsYXItc2lnbiBrZXlzIGludG8gbW9uZ29cbiAgLy8gc28gd2UgZG9uJ3QgYm90aGVyIGNoZWNraW5nIGZvciB0aGluZ3MgdGhhdCBuZWVkIGVzY2FwaW5nIGF0IHRoaXMgdGltZS5cbiAgcmV0dXJuIHVuZGVmaW5lZDtcbn07XG5cbnZhciByZXBsYWNlVHlwZXMgPSBmdW5jdGlvbiAoZG9jdW1lbnQsIGF0b21UcmFuc2Zvcm1lcikge1xuICBpZiAodHlwZW9mIGRvY3VtZW50ICE9PSAnb2JqZWN0JyB8fCBkb2N1bWVudCA9PT0gbnVsbClcbiAgICByZXR1cm4gZG9jdW1lbnQ7XG5cbiAgdmFyIHJlcGxhY2VkVG9wTGV2ZWxBdG9tID0gYXRvbVRyYW5zZm9ybWVyKGRvY3VtZW50KTtcbiAgaWYgKHJlcGxhY2VkVG9wTGV2ZWxBdG9tICE9PSB1bmRlZmluZWQpXG4gICAgcmV0dXJuIHJlcGxhY2VkVG9wTGV2ZWxBdG9tO1xuXG4gIHZhciByZXQgPSBkb2N1bWVudDtcbiAgXy5lYWNoKGRvY3VtZW50LCBmdW5jdGlvbiAodmFsLCBrZXkpIHtcbiAgICB2YXIgdmFsUmVwbGFjZWQgPSByZXBsYWNlVHlwZXModmFsLCBhdG9tVHJhbnNmb3JtZXIpO1xuICAgIGlmICh2YWwgIT09IHZhbFJlcGxhY2VkKSB7XG4gICAgICAvLyBMYXp5IGNsb25lLiBTaGFsbG93IGNvcHkuXG4gICAgICBpZiAocmV0ID09PSBkb2N1bWVudClcbiAgICAgICAgcmV0ID0gXy5jbG9uZShkb2N1bWVudCk7XG4gICAgICByZXRba2V5XSA9IHZhbFJlcGxhY2VkO1xuICAgIH1cbiAgfSk7XG4gIHJldHVybiByZXQ7XG59O1xuXG5cbk1vbmdvQ29ubmVjdGlvbiA9IGZ1bmN0aW9uICh1cmwsIG9wdGlvbnMpIHtcbiAgdmFyIHNlbGYgPSB0aGlzO1xuICBvcHRpb25zID0gb3B0aW9ucyB8fCB7fTtcbiAgc2VsZi5fb2JzZXJ2ZU11bHRpcGxleGVycyA9IHt9O1xuICBzZWxmLl9vbkZhaWxvdmVySG9vayA9IG5ldyBIb29rO1xuXG4gIGNvbnN0IHVzZXJPcHRpb25zID0ge1xuICAgIC4uLihNb25nby5fY29ubmVjdGlvbk9wdGlvbnMgfHwge30pLFxuICAgIC4uLihNZXRlb3Iuc2V0dGluZ3M/LnBhY2thZ2VzPy5tb25nbz8ub3B0aW9ucyB8fCB7fSlcbiAgfTtcblxuICB2YXIgbW9uZ29PcHRpb25zID0gT2JqZWN0LmFzc2lnbih7XG4gICAgaWdub3JlVW5kZWZpbmVkOiB0cnVlLFxuICB9LCB1c2VyT3B0aW9ucyk7XG5cblxuXG4gIC8vIEludGVybmFsbHkgdGhlIG9wbG9nIGNvbm5lY3Rpb25zIHNwZWNpZnkgdGhlaXIgb3duIG1heFBvb2xTaXplXG4gIC8vIHdoaWNoIHdlIGRvbid0IHdhbnQgdG8gb3ZlcndyaXRlIHdpdGggYW55IHVzZXIgZGVmaW5lZCB2YWx1ZVxuICBpZiAoXy5oYXMob3B0aW9ucywgJ21heFBvb2xTaXplJykpIHtcbiAgICAvLyBJZiB3ZSBqdXN0IHNldCB0aGlzIGZvciBcInNlcnZlclwiLCByZXBsU2V0IHdpbGwgb3ZlcnJpZGUgaXQuIElmIHdlIGp1c3RcbiAgICAvLyBzZXQgaXQgZm9yIHJlcGxTZXQsIGl0IHdpbGwgYmUgaWdub3JlZCBpZiB3ZSdyZSBub3QgdXNpbmcgYSByZXBsU2V0LlxuICAgIG1vbmdvT3B0aW9ucy5tYXhQb29sU2l6ZSA9IG9wdGlvbnMubWF4UG9vbFNpemU7XG4gIH1cblxuICAvLyBUcmFuc2Zvcm0gb3B0aW9ucyBsaWtlIFwidGxzQ0FGaWxlQXNzZXRcIjogXCJmaWxlbmFtZS5wZW1cIiBpbnRvXG4gIC8vIFwidGxzQ0FGaWxlXCI6IFwiLzxmdWxscGF0aD4vZmlsZW5hbWUucGVtXCJcbiAgT2JqZWN0LmVudHJpZXMobW9uZ29PcHRpb25zIHx8IHt9KVxuICAgIC5maWx0ZXIoKFtrZXldKSA9PiBrZXkgJiYga2V5LmVuZHNXaXRoKEZJTEVfQVNTRVRfU1VGRklYKSlcbiAgICAuZm9yRWFjaCgoW2tleSwgdmFsdWVdKSA9PiB7XG4gICAgICBjb25zdCBvcHRpb25OYW1lID0ga2V5LnJlcGxhY2UoRklMRV9BU1NFVF9TVUZGSVgsICcnKTtcbiAgICAgIG1vbmdvT3B0aW9uc1tvcHRpb25OYW1lXSA9IHBhdGguam9pbihBc3NldHMuZ2V0U2VydmVyRGlyKCksXG4gICAgICAgIEFTU0VUU19GT0xERVIsIEFQUF9GT0xERVIsIHZhbHVlKTtcbiAgICAgIGRlbGV0ZSBtb25nb09wdGlvbnNba2V5XTtcbiAgICB9KTtcblxuICBzZWxmLmRiID0gbnVsbDtcbiAgLy8gV2Uga2VlcCB0cmFjayBvZiB0aGUgUmVwbFNldCdzIHByaW1hcnksIHNvIHRoYXQgd2UgY2FuIHRyaWdnZXIgaG9va3Mgd2hlblxuICAvLyBpdCBjaGFuZ2VzLiAgVGhlIE5vZGUgZHJpdmVyJ3Mgam9pbmVkIGNhbGxiYWNrIHNlZW1zIHRvIGZpcmUgd2F5IHRvb1xuICAvLyBvZnRlbiwgd2hpY2ggaXMgd2h5IHdlIG5lZWQgdG8gdHJhY2sgaXQgb3Vyc2VsdmVzLlxuICBzZWxmLl9wcmltYXJ5ID0gbnVsbDtcbiAgc2VsZi5fb3Bsb2dIYW5kbGUgPSBudWxsO1xuICBzZWxmLl9kb2NGZXRjaGVyID0gbnVsbDtcblxuXG4gIHZhciBjb25uZWN0RnV0dXJlID0gbmV3IEZ1dHVyZTtcbiAgbmV3IE1vbmdvREIuTW9uZ29DbGllbnQoXG4gICAgdXJsLFxuICAgIG1vbmdvT3B0aW9uc1xuICApLmNvbm5lY3QoXG4gICAgTWV0ZW9yLmJpbmRFbnZpcm9ubWVudChcbiAgICAgIGZ1bmN0aW9uIChlcnIsIGNsaWVudCkge1xuICAgICAgICBpZiAoZXJyKSB7XG4gICAgICAgICAgdGhyb3cgZXJyO1xuICAgICAgICB9XG5cbiAgICAgICAgdmFyIGRiID0gY2xpZW50LmRiKCk7XG4gICAgICAgIHRyeSB7XG4gICAgICAgICAgY29uc3QgaGVsbG9Eb2N1bWVudCA9IGRiLmFkbWluKCkuY29tbWFuZCh7aGVsbG86IDF9KS5hd2FpdCgpO1xuICAgICAgICAgIC8vIEZpcnN0LCBmaWd1cmUgb3V0IHdoYXQgdGhlIGN1cnJlbnQgcHJpbWFyeSBpcywgaWYgYW55LlxuICAgICAgICAgIGlmIChoZWxsb0RvY3VtZW50LnByaW1hcnkpIHtcbiAgICAgICAgICAgIHNlbGYuX3ByaW1hcnkgPSBoZWxsb0RvY3VtZW50LnByaW1hcnk7XG4gICAgICAgICAgfVxuICAgICAgICB9Y2F0Y2goXyl7XG4gICAgICAgICAgLy8gaXNtYXN0ZXIgY29tbWFuZCBpcyBzdXBwb3J0ZWQgb24gb2xkZXIgbW9uZ29kYiB2ZXJzaW9uc1xuICAgICAgICAgIGNvbnN0IGlzTWFzdGVyRG9jdW1lbnQgPSBkYi5hZG1pbigpLmNvbW1hbmQoe2lzbWFzdGVyOjF9KS5hd2FpdCgpO1xuICAgICAgICAgIC8vIEZpcnN0LCBmaWd1cmUgb3V0IHdoYXQgdGhlIGN1cnJlbnQgcHJpbWFyeSBpcywgaWYgYW55LlxuICAgICAgICAgIGlmIChpc01hc3RlckRvY3VtZW50LnByaW1hcnkpIHtcbiAgICAgICAgICAgIHNlbGYuX3ByaW1hcnkgPSBpc01hc3RlckRvY3VtZW50LnByaW1hcnk7XG4gICAgICAgICAgfVxuICAgICAgICB9XG5cbiAgICAgICAgY2xpZW50LnRvcG9sb2d5Lm9uKFxuICAgICAgICAgICdqb2luZWQnLCBNZXRlb3IuYmluZEVudmlyb25tZW50KGZ1bmN0aW9uIChraW5kLCBkb2MpIHtcbiAgICAgICAgICAgIGlmIChraW5kID09PSAncHJpbWFyeScpIHtcbiAgICAgICAgICAgICAgaWYgKGRvYy5wcmltYXJ5ICE9PSBzZWxmLl9wcmltYXJ5KSB7XG4gICAgICAgICAgICAgICAgc2VsZi5fcHJpbWFyeSA9IGRvYy5wcmltYXJ5O1xuICAgICAgICAgICAgICAgIHNlbGYuX29uRmFpbG92ZXJIb29rLmVhY2goZnVuY3Rpb24gKGNhbGxiYWNrKSB7XG4gICAgICAgICAgICAgICAgICBjYWxsYmFjaygpO1xuICAgICAgICAgICAgICAgICAgcmV0dXJuIHRydWU7XG4gICAgICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH0gZWxzZSBpZiAoZG9jLm1lID09PSBzZWxmLl9wcmltYXJ5KSB7XG4gICAgICAgICAgICAgIC8vIFRoZSB0aGluZyB3ZSB0aG91Z2h0IHdhcyBwcmltYXJ5IGlzIG5vdyBzb21ldGhpbmcgb3RoZXIgdGhhblxuICAgICAgICAgICAgICAvLyBwcmltYXJ5LiAgRm9yZ2V0IHRoYXQgd2UgdGhvdWdodCBpdCB3YXMgcHJpbWFyeS4gIChUaGlzIG1lYW5zXG4gICAgICAgICAgICAgIC8vIHRoYXQgaWYgYSBzZXJ2ZXIgc3RvcHMgYmVpbmcgcHJpbWFyeSBhbmQgdGhlbiBzdGFydHMgYmVpbmdcbiAgICAgICAgICAgICAgLy8gcHJpbWFyeSBhZ2FpbiB3aXRob3V0IGFub3RoZXIgc2VydmVyIGJlY29taW5nIHByaW1hcnkgaW4gdGhlXG4gICAgICAgICAgICAgIC8vIG1pZGRsZSwgd2UnbGwgY29ycmVjdGx5IGNvdW50IGl0IGFzIGEgZmFpbG92ZXIuKVxuICAgICAgICAgICAgICBzZWxmLl9wcmltYXJ5ID0gbnVsbDtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICB9KSk7XG5cbiAgICAgICAgLy8gQWxsb3cgdGhlIGNvbnN0cnVjdG9yIHRvIHJldHVybi5cbiAgICAgICAgY29ubmVjdEZ1dHVyZVsncmV0dXJuJ10oeyBjbGllbnQsIGRiIH0pO1xuICAgICAgfSxcbiAgICAgIGNvbm5lY3RGdXR1cmUucmVzb2x2ZXIoKSAgLy8gb25FeGNlcHRpb25cbiAgICApXG4gICk7XG5cbiAgLy8gV2FpdCBmb3IgdGhlIGNvbm5lY3Rpb24gdG8gYmUgc3VjY2Vzc2Z1bCAodGhyb3dzIG9uIGZhaWx1cmUpIGFuZCBhc3NpZ24gdGhlXG4gIC8vIHJlc3VsdHMgKGBjbGllbnRgIGFuZCBgZGJgKSB0byBgc2VsZmAuXG4gIE9iamVjdC5hc3NpZ24oc2VsZiwgY29ubmVjdEZ1dHVyZS53YWl0KCkpO1xuXG4gIGlmIChvcHRpb25zLm9wbG9nVXJsICYmICEgUGFja2FnZVsnZGlzYWJsZS1vcGxvZyddKSB7XG4gICAgc2VsZi5fb3Bsb2dIYW5kbGUgPSBuZXcgT3Bsb2dIYW5kbGUob3B0aW9ucy5vcGxvZ1VybCwgc2VsZi5kYi5kYXRhYmFzZU5hbWUpO1xuICAgIHNlbGYuX2RvY0ZldGNoZXIgPSBuZXcgRG9jRmV0Y2hlcihzZWxmKTtcbiAgfVxufTtcblxuTW9uZ29Db25uZWN0aW9uLnByb3RvdHlwZS5jbG9zZSA9IGZ1bmN0aW9uKCkge1xuICB2YXIgc2VsZiA9IHRoaXM7XG5cbiAgaWYgKCEgc2VsZi5kYilcbiAgICB0aHJvdyBFcnJvcihcImNsb3NlIGNhbGxlZCBiZWZvcmUgQ29ubmVjdGlvbiBjcmVhdGVkP1wiKTtcblxuICAvLyBYWFggcHJvYmFibHkgdW50ZXN0ZWRcbiAgdmFyIG9wbG9nSGFuZGxlID0gc2VsZi5fb3Bsb2dIYW5kbGU7XG4gIHNlbGYuX29wbG9nSGFuZGxlID0gbnVsbDtcbiAgaWYgKG9wbG9nSGFuZGxlKVxuICAgIG9wbG9nSGFuZGxlLnN0b3AoKTtcblxuICAvLyBVc2UgRnV0dXJlLndyYXAgc28gdGhhdCBlcnJvcnMgZ2V0IHRocm93bi4gVGhpcyBoYXBwZW5zIHRvXG4gIC8vIHdvcmsgZXZlbiBvdXRzaWRlIGEgZmliZXIgc2luY2UgdGhlICdjbG9zZScgbWV0aG9kIGlzIG5vdFxuICAvLyBhY3R1YWxseSBhc3luY2hyb25vdXMuXG4gIEZ1dHVyZS53cmFwKF8uYmluZChzZWxmLmNsaWVudC5jbG9zZSwgc2VsZi5jbGllbnQpKSh0cnVlKS53YWl0KCk7XG59O1xuXG4vLyBSZXR1cm5zIHRoZSBNb25nbyBDb2xsZWN0aW9uIG9iamVjdDsgbWF5IHlpZWxkLlxuTW9uZ29Db25uZWN0aW9uLnByb3RvdHlwZS5yYXdDb2xsZWN0aW9uID0gZnVuY3Rpb24gKGNvbGxlY3Rpb25OYW1lKSB7XG4gIHZhciBzZWxmID0gdGhpcztcblxuICBpZiAoISBzZWxmLmRiKVxuICAgIHRocm93IEVycm9yKFwicmF3Q29sbGVjdGlvbiBjYWxsZWQgYmVmb3JlIENvbm5lY3Rpb24gY3JlYXRlZD9cIik7XG5cbiAgcmV0dXJuIHNlbGYuZGIuY29sbGVjdGlvbihjb2xsZWN0aW9uTmFtZSk7XG59O1xuXG5Nb25nb0Nvbm5lY3Rpb24ucHJvdG90eXBlLl9jcmVhdGVDYXBwZWRDb2xsZWN0aW9uID0gZnVuY3Rpb24gKFxuICAgIGNvbGxlY3Rpb25OYW1lLCBieXRlU2l6ZSwgbWF4RG9jdW1lbnRzKSB7XG4gIHZhciBzZWxmID0gdGhpcztcblxuICBpZiAoISBzZWxmLmRiKVxuICAgIHRocm93IEVycm9yKFwiX2NyZWF0ZUNhcHBlZENvbGxlY3Rpb24gY2FsbGVkIGJlZm9yZSBDb25uZWN0aW9uIGNyZWF0ZWQ/XCIpO1xuXG4gIHZhciBmdXR1cmUgPSBuZXcgRnV0dXJlKCk7XG4gIHNlbGYuZGIuY3JlYXRlQ29sbGVjdGlvbihcbiAgICBjb2xsZWN0aW9uTmFtZSxcbiAgICB7IGNhcHBlZDogdHJ1ZSwgc2l6ZTogYnl0ZVNpemUsIG1heDogbWF4RG9jdW1lbnRzIH0sXG4gICAgZnV0dXJlLnJlc29sdmVyKCkpO1xuICBmdXR1cmUud2FpdCgpO1xufTtcblxuLy8gVGhpcyBzaG91bGQgYmUgY2FsbGVkIHN5bmNocm9ub3VzbHkgd2l0aCBhIHdyaXRlLCB0byBjcmVhdGUgYVxuLy8gdHJhbnNhY3Rpb24gb24gdGhlIGN1cnJlbnQgd3JpdGUgZmVuY2UsIGlmIGFueS4gQWZ0ZXIgd2UgY2FuIHJlYWRcbi8vIHRoZSB3cml0ZSwgYW5kIGFmdGVyIG9ic2VydmVycyBoYXZlIGJlZW4gbm90aWZpZWQgKG9yIGF0IGxlYXN0LFxuLy8gYWZ0ZXIgdGhlIG9ic2VydmVyIG5vdGlmaWVycyBoYXZlIGFkZGVkIHRoZW1zZWx2ZXMgdG8gdGhlIHdyaXRlXG4vLyBmZW5jZSksIHlvdSBzaG91bGQgY2FsbCAnY29tbWl0dGVkKCknIG9uIHRoZSBvYmplY3QgcmV0dXJuZWQuXG5Nb25nb0Nvbm5lY3Rpb24ucHJvdG90eXBlLl9tYXliZUJlZ2luV3JpdGUgPSBmdW5jdGlvbiAoKSB7XG4gIHZhciBmZW5jZSA9IEREUFNlcnZlci5fQ3VycmVudFdyaXRlRmVuY2UuZ2V0KCk7XG4gIGlmIChmZW5jZSkge1xuICAgIHJldHVybiBmZW5jZS5iZWdpbldyaXRlKCk7XG4gIH0gZWxzZSB7XG4gICAgcmV0dXJuIHtjb21taXR0ZWQ6IGZ1bmN0aW9uICgpIHt9fTtcbiAgfVxufTtcblxuLy8gSW50ZXJuYWwgaW50ZXJmYWNlOiBhZGRzIGEgY2FsbGJhY2sgd2hpY2ggaXMgY2FsbGVkIHdoZW4gdGhlIE1vbmdvIHByaW1hcnlcbi8vIGNoYW5nZXMuIFJldHVybnMgYSBzdG9wIGhhbmRsZS5cbk1vbmdvQ29ubmVjdGlvbi5wcm90b3R5cGUuX29uRmFpbG92ZXIgPSBmdW5jdGlvbiAoY2FsbGJhY2spIHtcbiAgcmV0dXJuIHRoaXMuX29uRmFpbG92ZXJIb29rLnJlZ2lzdGVyKGNhbGxiYWNrKTtcbn07XG5cblxuLy8vLy8vLy8vLy8vIFB1YmxpYyBBUEkgLy8vLy8vLy8vL1xuXG4vLyBUaGUgd3JpdGUgbWV0aG9kcyBibG9jayB1bnRpbCB0aGUgZGF0YWJhc2UgaGFzIGNvbmZpcm1lZCB0aGUgd3JpdGUgKGl0IG1heVxuLy8gbm90IGJlIHJlcGxpY2F0ZWQgb3Igc3RhYmxlIG9uIGRpc2ssIGJ1dCBvbmUgc2VydmVyIGhhcyBjb25maXJtZWQgaXQpIGlmIG5vXG4vLyBjYWxsYmFjayBpcyBwcm92aWRlZC4gSWYgYSBjYWxsYmFjayBpcyBwcm92aWRlZCwgdGhlbiB0aGV5IGNhbGwgdGhlIGNhbGxiYWNrXG4vLyB3aGVuIHRoZSB3cml0ZSBpcyBjb25maXJtZWQuIFRoZXkgcmV0dXJuIG5vdGhpbmcgb24gc3VjY2VzcywgYW5kIHJhaXNlIGFuXG4vLyBleGNlcHRpb24gb24gZmFpbHVyZS5cbi8vXG4vLyBBZnRlciBtYWtpbmcgYSB3cml0ZSAod2l0aCBpbnNlcnQsIHVwZGF0ZSwgcmVtb3ZlKSwgb2JzZXJ2ZXJzIGFyZVxuLy8gbm90aWZpZWQgYXN5bmNocm9ub3VzbHkuIElmIHlvdSB3YW50IHRvIHJlY2VpdmUgYSBjYWxsYmFjayBvbmNlIGFsbFxuLy8gb2YgdGhlIG9ic2VydmVyIG5vdGlmaWNhdGlvbnMgaGF2ZSBsYW5kZWQgZm9yIHlvdXIgd3JpdGUsIGRvIHRoZVxuLy8gd3JpdGVzIGluc2lkZSBhIHdyaXRlIGZlbmNlIChzZXQgRERQU2VydmVyLl9DdXJyZW50V3JpdGVGZW5jZSB0byBhIG5ld1xuLy8gX1dyaXRlRmVuY2UsIGFuZCB0aGVuIHNldCBhIGNhbGxiYWNrIG9uIHRoZSB3cml0ZSBmZW5jZS4pXG4vL1xuLy8gU2luY2Ugb3VyIGV4ZWN1dGlvbiBlbnZpcm9ubWVudCBpcyBzaW5nbGUtdGhyZWFkZWQsIHRoaXMgaXNcbi8vIHdlbGwtZGVmaW5lZCAtLSBhIHdyaXRlIFwiaGFzIGJlZW4gbWFkZVwiIGlmIGl0J3MgcmV0dXJuZWQsIGFuZCBhblxuLy8gb2JzZXJ2ZXIgXCJoYXMgYmVlbiBub3RpZmllZFwiIGlmIGl0cyBjYWxsYmFjayBoYXMgcmV0dXJuZWQuXG5cbnZhciB3cml0ZUNhbGxiYWNrID0gZnVuY3Rpb24gKHdyaXRlLCByZWZyZXNoLCBjYWxsYmFjaykge1xuICByZXR1cm4gZnVuY3Rpb24gKGVyciwgcmVzdWx0KSB7XG4gICAgaWYgKCEgZXJyKSB7XG4gICAgICAvLyBYWFggV2UgZG9uJ3QgaGF2ZSB0byBydW4gdGhpcyBvbiBlcnJvciwgcmlnaHQ/XG4gICAgICB0cnkge1xuICAgICAgICByZWZyZXNoKCk7XG4gICAgICB9IGNhdGNoIChyZWZyZXNoRXJyKSB7XG4gICAgICAgIGlmIChjYWxsYmFjaykge1xuICAgICAgICAgIGNhbGxiYWNrKHJlZnJlc2hFcnIpO1xuICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICB0aHJvdyByZWZyZXNoRXJyO1xuICAgICAgICB9XG4gICAgICB9XG4gICAgfVxuICAgIHdyaXRlLmNvbW1pdHRlZCgpO1xuICAgIGlmIChjYWxsYmFjaykge1xuICAgICAgY2FsbGJhY2soZXJyLCByZXN1bHQpO1xuICAgIH0gZWxzZSBpZiAoZXJyKSB7XG4gICAgICB0aHJvdyBlcnI7XG4gICAgfVxuICB9O1xufTtcblxudmFyIGJpbmRFbnZpcm9ubWVudEZvcldyaXRlID0gZnVuY3Rpb24gKGNhbGxiYWNrKSB7XG4gIHJldHVybiBNZXRlb3IuYmluZEVudmlyb25tZW50KGNhbGxiYWNrLCBcIk1vbmdvIHdyaXRlXCIpO1xufTtcblxuTW9uZ29Db25uZWN0aW9uLnByb3RvdHlwZS5faW5zZXJ0ID0gZnVuY3Rpb24gKGNvbGxlY3Rpb25fbmFtZSwgZG9jdW1lbnQsXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgY2FsbGJhY2spIHtcbiAgdmFyIHNlbGYgPSB0aGlzO1xuXG4gIHZhciBzZW5kRXJyb3IgPSBmdW5jdGlvbiAoZSkge1xuICAgIGlmIChjYWxsYmFjaylcbiAgICAgIHJldHVybiBjYWxsYmFjayhlKTtcbiAgICB0aHJvdyBlO1xuICB9O1xuXG4gIGlmIChjb2xsZWN0aW9uX25hbWUgPT09IFwiX19fbWV0ZW9yX2ZhaWx1cmVfdGVzdF9jb2xsZWN0aW9uXCIpIHtcbiAgICB2YXIgZSA9IG5ldyBFcnJvcihcIkZhaWx1cmUgdGVzdFwiKTtcbiAgICBlLl9leHBlY3RlZEJ5VGVzdCA9IHRydWU7XG4gICAgc2VuZEVycm9yKGUpO1xuICAgIHJldHVybjtcbiAgfVxuXG4gIGlmICghKExvY2FsQ29sbGVjdGlvbi5faXNQbGFpbk9iamVjdChkb2N1bWVudCkgJiZcbiAgICAgICAgIUVKU09OLl9pc0N1c3RvbVR5cGUoZG9jdW1lbnQpKSkge1xuICAgIHNlbmRFcnJvcihuZXcgRXJyb3IoXG4gICAgICBcIk9ubHkgcGxhaW4gb2JqZWN0cyBtYXkgYmUgaW5zZXJ0ZWQgaW50byBNb25nb0RCXCIpKTtcbiAgICByZXR1cm47XG4gIH1cblxuICB2YXIgd3JpdGUgPSBzZWxmLl9tYXliZUJlZ2luV3JpdGUoKTtcbiAgdmFyIHJlZnJlc2ggPSBmdW5jdGlvbiAoKSB7XG4gICAgTWV0ZW9yLnJlZnJlc2goe2NvbGxlY3Rpb246IGNvbGxlY3Rpb25fbmFtZSwgaWQ6IGRvY3VtZW50Ll9pZCB9KTtcbiAgfTtcbiAgY2FsbGJhY2sgPSBiaW5kRW52aXJvbm1lbnRGb3JXcml0ZSh3cml0ZUNhbGxiYWNrKHdyaXRlLCByZWZyZXNoLCBjYWxsYmFjaykpO1xuICB0cnkge1xuICAgIHZhciBjb2xsZWN0aW9uID0gc2VsZi5yYXdDb2xsZWN0aW9uKGNvbGxlY3Rpb25fbmFtZSk7XG4gICAgY29sbGVjdGlvbi5pbnNlcnRPbmUoXG4gICAgICByZXBsYWNlVHlwZXMoZG9jdW1lbnQsIHJlcGxhY2VNZXRlb3JBdG9tV2l0aE1vbmdvKSxcbiAgICAgIHtcbiAgICAgICAgc2FmZTogdHJ1ZSxcbiAgICAgIH1cbiAgICApLnRoZW4oKHtpbnNlcnRlZElkfSkgPT4ge1xuICAgICAgY2FsbGJhY2sobnVsbCwgaW5zZXJ0ZWRJZCk7XG4gICAgfSkuY2F0Y2goKGUpID0+IHtcbiAgICAgIGNhbGxiYWNrKGUsIG51bGwpXG4gICAgfSk7XG4gIH0gY2F0Y2ggKGVycikge1xuICAgIHdyaXRlLmNvbW1pdHRlZCgpO1xuICAgIHRocm93IGVycjtcbiAgfVxufTtcblxuLy8gQ2F1c2UgcXVlcmllcyB0aGF0IG1heSBiZSBhZmZlY3RlZCBieSB0aGUgc2VsZWN0b3IgdG8gcG9sbCBpbiB0aGlzIHdyaXRlXG4vLyBmZW5jZS5cbk1vbmdvQ29ubmVjdGlvbi5wcm90b3R5cGUuX3JlZnJlc2ggPSBmdW5jdGlvbiAoY29sbGVjdGlvbk5hbWUsIHNlbGVjdG9yKSB7XG4gIHZhciByZWZyZXNoS2V5ID0ge2NvbGxlY3Rpb246IGNvbGxlY3Rpb25OYW1lfTtcbiAgLy8gSWYgd2Uga25vdyB3aGljaCBkb2N1bWVudHMgd2UncmUgcmVtb3ZpbmcsIGRvbid0IHBvbGwgcXVlcmllcyB0aGF0IGFyZVxuICAvLyBzcGVjaWZpYyB0byBvdGhlciBkb2N1bWVudHMuIChOb3RlIHRoYXQgbXVsdGlwbGUgbm90aWZpY2F0aW9ucyBoZXJlIHNob3VsZFxuICAvLyBub3QgY2F1c2UgbXVsdGlwbGUgcG9sbHMsIHNpbmNlIGFsbCBvdXIgbGlzdGVuZXIgaXMgZG9pbmcgaXMgZW5xdWV1ZWluZyBhXG4gIC8vIHBvbGwuKVxuICB2YXIgc3BlY2lmaWNJZHMgPSBMb2NhbENvbGxlY3Rpb24uX2lkc01hdGNoZWRCeVNlbGVjdG9yKHNlbGVjdG9yKTtcbiAgaWYgKHNwZWNpZmljSWRzKSB7XG4gICAgXy5lYWNoKHNwZWNpZmljSWRzLCBmdW5jdGlvbiAoaWQpIHtcbiAgICAgIE1ldGVvci5yZWZyZXNoKF8uZXh0ZW5kKHtpZDogaWR9LCByZWZyZXNoS2V5KSk7XG4gICAgfSk7XG4gIH0gZWxzZSB7XG4gICAgTWV0ZW9yLnJlZnJlc2gocmVmcmVzaEtleSk7XG4gIH1cbn07XG5cbk1vbmdvQ29ubmVjdGlvbi5wcm90b3R5cGUuX3JlbW92ZSA9IGZ1bmN0aW9uIChjb2xsZWN0aW9uX25hbWUsIHNlbGVjdG9yLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNhbGxiYWNrKSB7XG4gIHZhciBzZWxmID0gdGhpcztcblxuICBpZiAoY29sbGVjdGlvbl9uYW1lID09PSBcIl9fX21ldGVvcl9mYWlsdXJlX3Rlc3RfY29sbGVjdGlvblwiKSB7XG4gICAgdmFyIGUgPSBuZXcgRXJyb3IoXCJGYWlsdXJlIHRlc3RcIik7XG4gICAgZS5fZXhwZWN0ZWRCeVRlc3QgPSB0cnVlO1xuICAgIGlmIChjYWxsYmFjaykge1xuICAgICAgcmV0dXJuIGNhbGxiYWNrKGUpO1xuICAgIH0gZWxzZSB7XG4gICAgICB0aHJvdyBlO1xuICAgIH1cbiAgfVxuXG4gIHZhciB3cml0ZSA9IHNlbGYuX21heWJlQmVnaW5Xcml0ZSgpO1xuICB2YXIgcmVmcmVzaCA9IGZ1bmN0aW9uICgpIHtcbiAgICBzZWxmLl9yZWZyZXNoKGNvbGxlY3Rpb25fbmFtZSwgc2VsZWN0b3IpO1xuICB9O1xuICBjYWxsYmFjayA9IGJpbmRFbnZpcm9ubWVudEZvcldyaXRlKHdyaXRlQ2FsbGJhY2sod3JpdGUsIHJlZnJlc2gsIGNhbGxiYWNrKSk7XG5cbiAgdHJ5IHtcbiAgICB2YXIgY29sbGVjdGlvbiA9IHNlbGYucmF3Q29sbGVjdGlvbihjb2xsZWN0aW9uX25hbWUpO1xuICAgIGNvbGxlY3Rpb25cbiAgICAgIC5kZWxldGVNYW55KHJlcGxhY2VUeXBlcyhzZWxlY3RvciwgcmVwbGFjZU1ldGVvckF0b21XaXRoTW9uZ28pLCB7XG4gICAgICAgIHNhZmU6IHRydWUsXG4gICAgICB9KVxuICAgICAgLnRoZW4oKHsgZGVsZXRlZENvdW50IH0pID0+IHtcbiAgICAgICAgY2FsbGJhY2sobnVsbCwgdHJhbnNmb3JtUmVzdWx0KHsgcmVzdWx0IDoge21vZGlmaWVkQ291bnQgOiBkZWxldGVkQ291bnR9IH0pLm51bWJlckFmZmVjdGVkKTtcbiAgICAgIH0pLmNhdGNoKChlcnIpID0+IHtcbiAgICAgIGNhbGxiYWNrKGVycik7XG4gICAgfSk7XG4gIH0gY2F0Y2ggKGVycikge1xuICAgIHdyaXRlLmNvbW1pdHRlZCgpO1xuICAgIHRocm93IGVycjtcbiAgfVxufTtcblxuTW9uZ29Db25uZWN0aW9uLnByb3RvdHlwZS5fZHJvcENvbGxlY3Rpb24gPSBmdW5jdGlvbiAoY29sbGVjdGlvbk5hbWUsIGNiKSB7XG4gIHZhciBzZWxmID0gdGhpcztcblxuICB2YXIgd3JpdGUgPSBzZWxmLl9tYXliZUJlZ2luV3JpdGUoKTtcbiAgdmFyIHJlZnJlc2ggPSBmdW5jdGlvbiAoKSB7XG4gICAgTWV0ZW9yLnJlZnJlc2goe2NvbGxlY3Rpb246IGNvbGxlY3Rpb25OYW1lLCBpZDogbnVsbCxcbiAgICAgICAgICAgICAgICAgICAgZHJvcENvbGxlY3Rpb246IHRydWV9KTtcbiAgfTtcbiAgY2IgPSBiaW5kRW52aXJvbm1lbnRGb3JXcml0ZSh3cml0ZUNhbGxiYWNrKHdyaXRlLCByZWZyZXNoLCBjYikpO1xuXG4gIHRyeSB7XG4gICAgdmFyIGNvbGxlY3Rpb24gPSBzZWxmLnJhd0NvbGxlY3Rpb24oY29sbGVjdGlvbk5hbWUpO1xuICAgIGNvbGxlY3Rpb24uZHJvcChjYik7XG4gIH0gY2F0Y2ggKGUpIHtcbiAgICB3cml0ZS5jb21taXR0ZWQoKTtcbiAgICB0aHJvdyBlO1xuICB9XG59O1xuXG4vLyBGb3IgdGVzdGluZyBvbmx5LiAgU2xpZ2h0bHkgYmV0dGVyIHRoYW4gYGMucmF3RGF0YWJhc2UoKS5kcm9wRGF0YWJhc2UoKWBcbi8vIGJlY2F1c2UgaXQgbGV0cyB0aGUgdGVzdCdzIGZlbmNlIHdhaXQgZm9yIGl0IHRvIGJlIGNvbXBsZXRlLlxuTW9uZ29Db25uZWN0aW9uLnByb3RvdHlwZS5fZHJvcERhdGFiYXNlID0gZnVuY3Rpb24gKGNiKSB7XG4gIHZhciBzZWxmID0gdGhpcztcblxuICB2YXIgd3JpdGUgPSBzZWxmLl9tYXliZUJlZ2luV3JpdGUoKTtcbiAgdmFyIHJlZnJlc2ggPSBmdW5jdGlvbiAoKSB7XG4gICAgTWV0ZW9yLnJlZnJlc2goeyBkcm9wRGF0YWJhc2U6IHRydWUgfSk7XG4gIH07XG4gIGNiID0gYmluZEVudmlyb25tZW50Rm9yV3JpdGUod3JpdGVDYWxsYmFjayh3cml0ZSwgcmVmcmVzaCwgY2IpKTtcblxuICB0cnkge1xuICAgIHNlbGYuZGIuZHJvcERhdGFiYXNlKGNiKTtcbiAgfSBjYXRjaCAoZSkge1xuICAgIHdyaXRlLmNvbW1pdHRlZCgpO1xuICAgIHRocm93IGU7XG4gIH1cbn07XG5cbk1vbmdvQ29ubmVjdGlvbi5wcm90b3R5cGUuX3VwZGF0ZSA9IGZ1bmN0aW9uIChjb2xsZWN0aW9uX25hbWUsIHNlbGVjdG9yLCBtb2QsXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgb3B0aW9ucywgY2FsbGJhY2spIHtcbiAgdmFyIHNlbGYgPSB0aGlzO1xuXG4gIGlmICghIGNhbGxiYWNrICYmIG9wdGlvbnMgaW5zdGFuY2VvZiBGdW5jdGlvbikge1xuICAgIGNhbGxiYWNrID0gb3B0aW9ucztcbiAgICBvcHRpb25zID0gbnVsbDtcbiAgfVxuXG4gIGlmIChjb2xsZWN0aW9uX25hbWUgPT09IFwiX19fbWV0ZW9yX2ZhaWx1cmVfdGVzdF9jb2xsZWN0aW9uXCIpIHtcbiAgICB2YXIgZSA9IG5ldyBFcnJvcihcIkZhaWx1cmUgdGVzdFwiKTtcbiAgICBlLl9leHBlY3RlZEJ5VGVzdCA9IHRydWU7XG4gICAgaWYgKGNhbGxiYWNrKSB7XG4gICAgICByZXR1cm4gY2FsbGJhY2soZSk7XG4gICAgfSBlbHNlIHtcbiAgICAgIHRocm93IGU7XG4gICAgfVxuICB9XG5cbiAgLy8gZXhwbGljaXQgc2FmZXR5IGNoZWNrLiBudWxsIGFuZCB1bmRlZmluZWQgY2FuIGNyYXNoIHRoZSBtb25nb1xuICAvLyBkcml2ZXIuIEFsdGhvdWdoIHRoZSBub2RlIGRyaXZlciBhbmQgbWluaW1vbmdvIGRvICdzdXBwb3J0J1xuICAvLyBub24tb2JqZWN0IG1vZGlmaWVyIGluIHRoYXQgdGhleSBkb24ndCBjcmFzaCwgdGhleSBhcmUgbm90XG4gIC8vIG1lYW5pbmdmdWwgb3BlcmF0aW9ucyBhbmQgZG8gbm90IGRvIGFueXRoaW5nLiBEZWZlbnNpdmVseSB0aHJvdyBhblxuICAvLyBlcnJvciBoZXJlLlxuICBpZiAoIW1vZCB8fCB0eXBlb2YgbW9kICE9PSAnb2JqZWN0JylcbiAgICB0aHJvdyBuZXcgRXJyb3IoXCJJbnZhbGlkIG1vZGlmaWVyLiBNb2RpZmllciBtdXN0IGJlIGFuIG9iamVjdC5cIik7XG5cbiAgaWYgKCEoTG9jYWxDb2xsZWN0aW9uLl9pc1BsYWluT2JqZWN0KG1vZCkgJiZcbiAgICAgICAgIUVKU09OLl9pc0N1c3RvbVR5cGUobW9kKSkpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoXG4gICAgICBcIk9ubHkgcGxhaW4gb2JqZWN0cyBtYXkgYmUgdXNlZCBhcyByZXBsYWNlbWVudFwiICtcbiAgICAgICAgXCIgZG9jdW1lbnRzIGluIE1vbmdvREJcIik7XG4gIH1cblxuICBpZiAoIW9wdGlvbnMpIG9wdGlvbnMgPSB7fTtcblxuICB2YXIgd3JpdGUgPSBzZWxmLl9tYXliZUJlZ2luV3JpdGUoKTtcbiAgdmFyIHJlZnJlc2ggPSBmdW5jdGlvbiAoKSB7XG4gICAgc2VsZi5fcmVmcmVzaChjb2xsZWN0aW9uX25hbWUsIHNlbGVjdG9yKTtcbiAgfTtcbiAgY2FsbGJhY2sgPSB3cml0ZUNhbGxiYWNrKHdyaXRlLCByZWZyZXNoLCBjYWxsYmFjayk7XG4gIHRyeSB7XG4gICAgdmFyIGNvbGxlY3Rpb24gPSBzZWxmLnJhd0NvbGxlY3Rpb24oY29sbGVjdGlvbl9uYW1lKTtcbiAgICB2YXIgbW9uZ29PcHRzID0ge3NhZmU6IHRydWV9O1xuICAgIC8vIEFkZCBzdXBwb3J0IGZvciBmaWx0ZXJlZCBwb3NpdGlvbmFsIG9wZXJhdG9yXG4gICAgaWYgKG9wdGlvbnMuYXJyYXlGaWx0ZXJzICE9PSB1bmRlZmluZWQpIG1vbmdvT3B0cy5hcnJheUZpbHRlcnMgPSBvcHRpb25zLmFycmF5RmlsdGVycztcbiAgICAvLyBleHBsaWN0bHkgZW51bWVyYXRlIG9wdGlvbnMgdGhhdCBtaW5pbW9uZ28gc3VwcG9ydHNcbiAgICBpZiAob3B0aW9ucy51cHNlcnQpIG1vbmdvT3B0cy51cHNlcnQgPSB0cnVlO1xuICAgIGlmIChvcHRpb25zLm11bHRpKSBtb25nb09wdHMubXVsdGkgPSB0cnVlO1xuICAgIC8vIExldHMgeW91IGdldCBhIG1vcmUgbW9yZSBmdWxsIHJlc3VsdCBmcm9tIE1vbmdvREIuIFVzZSB3aXRoIGNhdXRpb246XG4gICAgLy8gbWlnaHQgbm90IHdvcmsgd2l0aCBDLnVwc2VydCAoYXMgb3Bwb3NlZCB0byBDLnVwZGF0ZSh7dXBzZXJ0OnRydWV9KSBvclxuICAgIC8vIHdpdGggc2ltdWxhdGVkIHVwc2VydC5cbiAgICBpZiAob3B0aW9ucy5mdWxsUmVzdWx0KSBtb25nb09wdHMuZnVsbFJlc3VsdCA9IHRydWU7XG5cbiAgICB2YXIgbW9uZ29TZWxlY3RvciA9IHJlcGxhY2VUeXBlcyhzZWxlY3RvciwgcmVwbGFjZU1ldGVvckF0b21XaXRoTW9uZ28pO1xuICAgIHZhciBtb25nb01vZCA9IHJlcGxhY2VUeXBlcyhtb2QsIHJlcGxhY2VNZXRlb3JBdG9tV2l0aE1vbmdvKTtcblxuICAgIHZhciBpc01vZGlmeSA9IExvY2FsQ29sbGVjdGlvbi5faXNNb2RpZmljYXRpb25Nb2QobW9uZ29Nb2QpO1xuXG4gICAgaWYgKG9wdGlvbnMuX2ZvcmJpZFJlcGxhY2UgJiYgIWlzTW9kaWZ5KSB7XG4gICAgICB2YXIgZXJyID0gbmV3IEVycm9yKFwiSW52YWxpZCBtb2RpZmllci4gUmVwbGFjZW1lbnRzIGFyZSBmb3JiaWRkZW4uXCIpO1xuICAgICAgaWYgKGNhbGxiYWNrKSB7XG4gICAgICAgIHJldHVybiBjYWxsYmFjayhlcnIpO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgdGhyb3cgZXJyO1xuICAgICAgfVxuICAgIH1cblxuICAgIC8vIFdlJ3ZlIGFscmVhZHkgcnVuIHJlcGxhY2VUeXBlcy9yZXBsYWNlTWV0ZW9yQXRvbVdpdGhNb25nbyBvblxuICAgIC8vIHNlbGVjdG9yIGFuZCBtb2QuICBXZSBhc3N1bWUgaXQgZG9lc24ndCBtYXR0ZXIsIGFzIGZhciBhc1xuICAgIC8vIHRoZSBiZWhhdmlvciBvZiBtb2RpZmllcnMgaXMgY29uY2VybmVkLCB3aGV0aGVyIGBfbW9kaWZ5YFxuICAgIC8vIGlzIHJ1biBvbiBFSlNPTiBvciBvbiBtb25nby1jb252ZXJ0ZWQgRUpTT04uXG5cbiAgICAvLyBSdW4gdGhpcyBjb2RlIHVwIGZyb250IHNvIHRoYXQgaXQgZmFpbHMgZmFzdCBpZiBzb21lb25lIHVzZXNcbiAgICAvLyBhIE1vbmdvIHVwZGF0ZSBvcGVyYXRvciB3ZSBkb24ndCBzdXBwb3J0LlxuICAgIGxldCBrbm93bklkO1xuICAgIGlmIChvcHRpb25zLnVwc2VydCkge1xuICAgICAgdHJ5IHtcbiAgICAgICAgbGV0IG5ld0RvYyA9IExvY2FsQ29sbGVjdGlvbi5fY3JlYXRlVXBzZXJ0RG9jdW1lbnQoc2VsZWN0b3IsIG1vZCk7XG4gICAgICAgIGtub3duSWQgPSBuZXdEb2MuX2lkO1xuICAgICAgfSBjYXRjaCAoZXJyKSB7XG4gICAgICAgIGlmIChjYWxsYmFjaykge1xuICAgICAgICAgIHJldHVybiBjYWxsYmFjayhlcnIpO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIHRocm93IGVycjtcbiAgICAgICAgfVxuICAgICAgfVxuICAgIH1cblxuICAgIGlmIChvcHRpb25zLnVwc2VydCAmJlxuICAgICAgICAhIGlzTW9kaWZ5ICYmXG4gICAgICAgICEga25vd25JZCAmJlxuICAgICAgICBvcHRpb25zLmluc2VydGVkSWQgJiZcbiAgICAgICAgISAob3B0aW9ucy5pbnNlcnRlZElkIGluc3RhbmNlb2YgTW9uZ28uT2JqZWN0SUQgJiZcbiAgICAgICAgICAgb3B0aW9ucy5nZW5lcmF0ZWRJZCkpIHtcbiAgICAgIC8vIEluIGNhc2Ugb2YgYW4gdXBzZXJ0IHdpdGggYSByZXBsYWNlbWVudCwgd2hlcmUgdGhlcmUgaXMgbm8gX2lkIGRlZmluZWRcbiAgICAgIC8vIGluIGVpdGhlciB0aGUgcXVlcnkgb3IgdGhlIHJlcGxhY2VtZW50IGRvYywgbW9uZ28gd2lsbCBnZW5lcmF0ZSBhbiBpZCBpdHNlbGYuXG4gICAgICAvLyBUaGVyZWZvcmUgd2UgbmVlZCB0aGlzIHNwZWNpYWwgc3RyYXRlZ3kgaWYgd2Ugd2FudCB0byBjb250cm9sIHRoZSBpZCBvdXJzZWx2ZXMuXG5cbiAgICAgIC8vIFdlIGRvbid0IG5lZWQgdG8gZG8gdGhpcyB3aGVuOlxuICAgICAgLy8gLSBUaGlzIGlzIG5vdCBhIHJlcGxhY2VtZW50LCBzbyB3ZSBjYW4gYWRkIGFuIF9pZCB0byAkc2V0T25JbnNlcnRcbiAgICAgIC8vIC0gVGhlIGlkIGlzIGRlZmluZWQgYnkgcXVlcnkgb3IgbW9kIHdlIGNhbiBqdXN0IGFkZCBpdCB0byB0aGUgcmVwbGFjZW1lbnQgZG9jXG4gICAgICAvLyAtIFRoZSB1c2VyIGRpZCBub3Qgc3BlY2lmeSBhbnkgaWQgcHJlZmVyZW5jZSBhbmQgdGhlIGlkIGlzIGEgTW9uZ28gT2JqZWN0SWQsXG4gICAgICAvLyAgICAgdGhlbiB3ZSBjYW4ganVzdCBsZXQgTW9uZ28gZ2VuZXJhdGUgdGhlIGlkXG5cbiAgICAgIHNpbXVsYXRlVXBzZXJ0V2l0aEluc2VydGVkSWQoXG4gICAgICAgIGNvbGxlY3Rpb24sIG1vbmdvU2VsZWN0b3IsIG1vbmdvTW9kLCBvcHRpb25zLFxuICAgICAgICAvLyBUaGlzIGNhbGxiYWNrIGRvZXMgbm90IG5lZWQgdG8gYmUgYmluZEVudmlyb25tZW50J2VkIGJlY2F1c2VcbiAgICAgICAgLy8gc2ltdWxhdGVVcHNlcnRXaXRoSW5zZXJ0ZWRJZCgpIHdyYXBzIGl0IGFuZCB0aGVuIHBhc3NlcyBpdCB0aHJvdWdoXG4gICAgICAgIC8vIGJpbmRFbnZpcm9ubWVudEZvcldyaXRlLlxuICAgICAgICBmdW5jdGlvbiAoZXJyb3IsIHJlc3VsdCkge1xuICAgICAgICAgIC8vIElmIHdlIGdvdCBoZXJlIHZpYSBhIHVwc2VydCgpIGNhbGwsIHRoZW4gb3B0aW9ucy5fcmV0dXJuT2JqZWN0IHdpbGxcbiAgICAgICAgICAvLyBiZSBzZXQgYW5kIHdlIHNob3VsZCByZXR1cm4gdGhlIHdob2xlIG9iamVjdC4gT3RoZXJ3aXNlLCB3ZSBzaG91bGRcbiAgICAgICAgICAvLyBqdXN0IHJldHVybiB0aGUgbnVtYmVyIG9mIGFmZmVjdGVkIGRvY3MgdG8gbWF0Y2ggdGhlIG1vbmdvIEFQSS5cbiAgICAgICAgICBpZiAocmVzdWx0ICYmICEgb3B0aW9ucy5fcmV0dXJuT2JqZWN0KSB7XG4gICAgICAgICAgICBjYWxsYmFjayhlcnJvciwgcmVzdWx0Lm51bWJlckFmZmVjdGVkKTtcbiAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgY2FsbGJhY2soZXJyb3IsIHJlc3VsdCk7XG4gICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICApO1xuICAgIH0gZWxzZSB7XG5cbiAgICAgIGlmIChvcHRpb25zLnVwc2VydCAmJiAha25vd25JZCAmJiBvcHRpb25zLmluc2VydGVkSWQgJiYgaXNNb2RpZnkpIHtcbiAgICAgICAgaWYgKCFtb25nb01vZC5oYXNPd25Qcm9wZXJ0eSgnJHNldE9uSW5zZXJ0JykpIHtcbiAgICAgICAgICBtb25nb01vZC4kc2V0T25JbnNlcnQgPSB7fTtcbiAgICAgICAgfVxuICAgICAgICBrbm93bklkID0gb3B0aW9ucy5pbnNlcnRlZElkO1xuICAgICAgICBPYmplY3QuYXNzaWduKG1vbmdvTW9kLiRzZXRPbkluc2VydCwgcmVwbGFjZVR5cGVzKHtfaWQ6IG9wdGlvbnMuaW5zZXJ0ZWRJZH0sIHJlcGxhY2VNZXRlb3JBdG9tV2l0aE1vbmdvKSk7XG4gICAgICB9XG5cbiAgICAgIGNvbnN0IHN0cmluZ3MgPSBPYmplY3Qua2V5cyhtb25nb01vZCkuZmlsdGVyKChrZXkpID0+ICFrZXkuc3RhcnRzV2l0aChcIiRcIikpO1xuICAgICAgbGV0IHVwZGF0ZU1ldGhvZCA9IHN0cmluZ3MubGVuZ3RoID4gMCA/ICdyZXBsYWNlT25lJyA6ICd1cGRhdGVNYW55JztcbiAgICAgIHVwZGF0ZU1ldGhvZCA9XG4gICAgICAgIHVwZGF0ZU1ldGhvZCA9PT0gJ3VwZGF0ZU1hbnknICYmICFtb25nb09wdHMubXVsdGlcbiAgICAgICAgICA/ICd1cGRhdGVPbmUnXG4gICAgICAgICAgOiB1cGRhdGVNZXRob2Q7XG4gICAgICBjb2xsZWN0aW9uW3VwZGF0ZU1ldGhvZF0uYmluZChjb2xsZWN0aW9uKShcbiAgICAgICAgbW9uZ29TZWxlY3RvciwgbW9uZ29Nb2QsIG1vbmdvT3B0cyxcbiAgICAgICAgICAvLyBtb25nbyBkcml2ZXIgbm93IHJldHVybnMgdW5kZWZpbmVkIGZvciBlcnIgaW4gdGhlIGNhbGxiYWNrXG4gICAgICAgICAgYmluZEVudmlyb25tZW50Rm9yV3JpdGUoZnVuY3Rpb24gKGVyciA9IG51bGwsIHJlc3VsdCkge1xuICAgICAgICAgIGlmICghIGVycikge1xuICAgICAgICAgICAgdmFyIG1ldGVvclJlc3VsdCA9IHRyYW5zZm9ybVJlc3VsdCh7cmVzdWx0fSk7XG4gICAgICAgICAgICBpZiAobWV0ZW9yUmVzdWx0ICYmIG9wdGlvbnMuX3JldHVybk9iamVjdCkge1xuICAgICAgICAgICAgICAvLyBJZiB0aGlzIHdhcyBhbiB1cHNlcnQoKSBjYWxsLCBhbmQgd2UgZW5kZWQgdXBcbiAgICAgICAgICAgICAgLy8gaW5zZXJ0aW5nIGEgbmV3IGRvYyBhbmQgd2Uga25vdyBpdHMgaWQsIHRoZW5cbiAgICAgICAgICAgICAgLy8gcmV0dXJuIHRoYXQgaWQgYXMgd2VsbC5cbiAgICAgICAgICAgICAgaWYgKG9wdGlvbnMudXBzZXJ0ICYmIG1ldGVvclJlc3VsdC5pbnNlcnRlZElkKSB7XG4gICAgICAgICAgICAgICAgaWYgKGtub3duSWQpIHtcbiAgICAgICAgICAgICAgICAgIG1ldGVvclJlc3VsdC5pbnNlcnRlZElkID0ga25vd25JZDtcbiAgICAgICAgICAgICAgICB9IGVsc2UgaWYgKG1ldGVvclJlc3VsdC5pbnNlcnRlZElkIGluc3RhbmNlb2YgTW9uZ29EQi5PYmplY3RJRCkge1xuICAgICAgICAgICAgICAgICAgbWV0ZW9yUmVzdWx0Lmluc2VydGVkSWQgPSBuZXcgTW9uZ28uT2JqZWN0SUQobWV0ZW9yUmVzdWx0Lmluc2VydGVkSWQudG9IZXhTdHJpbmcoKSk7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICB9XG5cbiAgICAgICAgICAgICAgY2FsbGJhY2soZXJyLCBtZXRlb3JSZXN1bHQpO1xuICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgY2FsbGJhY2soZXJyLCBtZXRlb3JSZXN1bHQubnVtYmVyQWZmZWN0ZWQpO1xuICAgICAgICAgICAgfVxuICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICBjYWxsYmFjayhlcnIpO1xuICAgICAgICAgIH1cbiAgICAgICAgfSkpO1xuICAgIH1cbiAgfSBjYXRjaCAoZSkge1xuICAgIHdyaXRlLmNvbW1pdHRlZCgpO1xuICAgIHRocm93IGU7XG4gIH1cbn07XG5cbnZhciB0cmFuc2Zvcm1SZXN1bHQgPSBmdW5jdGlvbiAoZHJpdmVyUmVzdWx0KSB7XG4gIHZhciBtZXRlb3JSZXN1bHQgPSB7IG51bWJlckFmZmVjdGVkOiAwIH07XG4gIGlmIChkcml2ZXJSZXN1bHQpIHtcbiAgICB2YXIgbW9uZ29SZXN1bHQgPSBkcml2ZXJSZXN1bHQucmVzdWx0O1xuICAgIC8vIE9uIHVwZGF0ZXMgd2l0aCB1cHNlcnQ6dHJ1ZSwgdGhlIGluc2VydGVkIHZhbHVlcyBjb21lIGFzIGEgbGlzdCBvZlxuICAgIC8vIHVwc2VydGVkIHZhbHVlcyAtLSBldmVuIHdpdGggb3B0aW9ucy5tdWx0aSwgd2hlbiB0aGUgdXBzZXJ0IGRvZXMgaW5zZXJ0LFxuICAgIC8vIGl0IG9ubHkgaW5zZXJ0cyBvbmUgZWxlbWVudC5cbiAgICBpZiAobW9uZ29SZXN1bHQudXBzZXJ0ZWRDb3VudCkge1xuICAgICAgbWV0ZW9yUmVzdWx0Lm51bWJlckFmZmVjdGVkID0gbW9uZ29SZXN1bHQudXBzZXJ0ZWRDb3VudDtcblxuICAgICAgaWYgKG1vbmdvUmVzdWx0LnVwc2VydGVkSWQpIHtcbiAgICAgICAgbWV0ZW9yUmVzdWx0Lmluc2VydGVkSWQgPSBtb25nb1Jlc3VsdC51cHNlcnRlZElkO1xuICAgICAgfVxuICAgIH0gZWxzZSB7XG4gICAgICAvLyBuIHdhcyB1c2VkIGJlZm9yZSBNb25nbyA1LjAsIGluIE1vbmdvIDUuMCB3ZSBhcmUgbm90IHJlY2VpdmluZyB0aGlzIG5cbiAgICAgIC8vIGZpZWxkIGFuZCBzbyB3ZSBhcmUgdXNpbmcgbW9kaWZpZWRDb3VudCBpbnN0ZWFkXG4gICAgICBtZXRlb3JSZXN1bHQubnVtYmVyQWZmZWN0ZWQgPSBtb25nb1Jlc3VsdC5uIHx8IG1vbmdvUmVzdWx0Lm1hdGNoZWRDb3VudCB8fCBtb25nb1Jlc3VsdC5tb2RpZmllZENvdW50O1xuICAgIH1cbiAgfVxuXG4gIHJldHVybiBtZXRlb3JSZXN1bHQ7XG59O1xuXG5cbnZhciBOVU1fT1BUSU1JU1RJQ19UUklFUyA9IDM7XG5cbi8vIGV4cG9zZWQgZm9yIHRlc3Rpbmdcbk1vbmdvQ29ubmVjdGlvbi5faXNDYW5ub3RDaGFuZ2VJZEVycm9yID0gZnVuY3Rpb24gKGVycikge1xuXG4gIC8vIE1vbmdvIDMuMi4qIHJldHVybnMgZXJyb3IgYXMgbmV4dCBPYmplY3Q6XG4gIC8vIHtuYW1lOiBTdHJpbmcsIGNvZGU6IE51bWJlciwgZXJybXNnOiBTdHJpbmd9XG4gIC8vIE9sZGVyIE1vbmdvIHJldHVybnM6XG4gIC8vIHtuYW1lOiBTdHJpbmcsIGNvZGU6IE51bWJlciwgZXJyOiBTdHJpbmd9XG4gIHZhciBlcnJvciA9IGVyci5lcnJtc2cgfHwgZXJyLmVycjtcblxuICAvLyBXZSBkb24ndCB1c2UgdGhlIGVycm9yIGNvZGUgaGVyZVxuICAvLyBiZWNhdXNlIHRoZSBlcnJvciBjb2RlIHdlIG9ic2VydmVkIGl0IHByb2R1Y2luZyAoMTY4MzcpIGFwcGVhcnMgdG8gYmVcbiAgLy8gYSBmYXIgbW9yZSBnZW5lcmljIGVycm9yIGNvZGUgYmFzZWQgb24gZXhhbWluaW5nIHRoZSBzb3VyY2UuXG4gIGlmIChlcnJvci5pbmRleE9mKCdUaGUgX2lkIGZpZWxkIGNhbm5vdCBiZSBjaGFuZ2VkJykgPT09IDBcbiAgICB8fCBlcnJvci5pbmRleE9mKFwidGhlIChpbW11dGFibGUpIGZpZWxkICdfaWQnIHdhcyBmb3VuZCB0byBoYXZlIGJlZW4gYWx0ZXJlZCB0byBfaWRcIikgIT09IC0xKSB7XG4gICAgcmV0dXJuIHRydWU7XG4gIH1cblxuICByZXR1cm4gZmFsc2U7XG59O1xuXG52YXIgc2ltdWxhdGVVcHNlcnRXaXRoSW5zZXJ0ZWRJZCA9IGZ1bmN0aW9uIChjb2xsZWN0aW9uLCBzZWxlY3RvciwgbW9kLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgb3B0aW9ucywgY2FsbGJhY2spIHtcbiAgLy8gU1RSQVRFR1k6IEZpcnN0IHRyeSBkb2luZyBhbiB1cHNlcnQgd2l0aCBhIGdlbmVyYXRlZCBJRC5cbiAgLy8gSWYgdGhpcyB0aHJvd3MgYW4gZXJyb3IgYWJvdXQgY2hhbmdpbmcgdGhlIElEIG9uIGFuIGV4aXN0aW5nIGRvY3VtZW50XG4gIC8vIHRoZW4gd2l0aG91dCBhZmZlY3RpbmcgdGhlIGRhdGFiYXNlLCB3ZSBrbm93IHdlIHNob3VsZCBwcm9iYWJseSB0cnlcbiAgLy8gYW4gdXBkYXRlIHdpdGhvdXQgdGhlIGdlbmVyYXRlZCBJRC4gSWYgaXQgYWZmZWN0ZWQgMCBkb2N1bWVudHMsXG4gIC8vIHRoZW4gd2l0aG91dCBhZmZlY3RpbmcgdGhlIGRhdGFiYXNlLCB3ZSB0aGUgZG9jdW1lbnQgdGhhdCBmaXJzdFxuICAvLyBnYXZlIHRoZSBlcnJvciBpcyBwcm9iYWJseSByZW1vdmVkIGFuZCB3ZSBuZWVkIHRvIHRyeSBhbiBpbnNlcnQgYWdhaW5cbiAgLy8gV2UgZ28gYmFjayB0byBzdGVwIG9uZSBhbmQgcmVwZWF0LlxuICAvLyBMaWtlIGFsbCBcIm9wdGltaXN0aWMgd3JpdGVcIiBzY2hlbWVzLCB3ZSByZWx5IG9uIHRoZSBmYWN0IHRoYXQgaXQnc1xuICAvLyB1bmxpa2VseSBvdXIgd3JpdGVzIHdpbGwgY29udGludWUgdG8gYmUgaW50ZXJmZXJlZCB3aXRoIHVuZGVyIG5vcm1hbFxuICAvLyBjaXJjdW1zdGFuY2VzICh0aG91Z2ggc3VmZmljaWVudGx5IGhlYXZ5IGNvbnRlbnRpb24gd2l0aCB3cml0ZXJzXG4gIC8vIGRpc2FncmVlaW5nIG9uIHRoZSBleGlzdGVuY2Ugb2YgYW4gb2JqZWN0IHdpbGwgY2F1c2Ugd3JpdGVzIHRvIGZhaWxcbiAgLy8gaW4gdGhlb3J5KS5cblxuICB2YXIgaW5zZXJ0ZWRJZCA9IG9wdGlvbnMuaW5zZXJ0ZWRJZDsgLy8gbXVzdCBleGlzdFxuICB2YXIgbW9uZ29PcHRzRm9yVXBkYXRlID0ge1xuICAgIHNhZmU6IHRydWUsXG4gICAgbXVsdGk6IG9wdGlvbnMubXVsdGlcbiAgfTtcbiAgdmFyIG1vbmdvT3B0c0Zvckluc2VydCA9IHtcbiAgICBzYWZlOiB0cnVlLFxuICAgIHVwc2VydDogdHJ1ZVxuICB9O1xuXG4gIHZhciByZXBsYWNlbWVudFdpdGhJZCA9IE9iamVjdC5hc3NpZ24oXG4gICAgcmVwbGFjZVR5cGVzKHtfaWQ6IGluc2VydGVkSWR9LCByZXBsYWNlTWV0ZW9yQXRvbVdpdGhNb25nbyksXG4gICAgbW9kKTtcblxuICB2YXIgdHJpZXMgPSBOVU1fT1BUSU1JU1RJQ19UUklFUztcblxuICB2YXIgZG9VcGRhdGUgPSBmdW5jdGlvbiAoKSB7XG4gICAgdHJpZXMtLTtcbiAgICBpZiAoISB0cmllcykge1xuICAgICAgY2FsbGJhY2sobmV3IEVycm9yKFwiVXBzZXJ0IGZhaWxlZCBhZnRlciBcIiArIE5VTV9PUFRJTUlTVElDX1RSSUVTICsgXCIgdHJpZXMuXCIpKTtcbiAgICB9IGVsc2Uge1xuICAgICAgbGV0IG1ldGhvZCA9IGNvbGxlY3Rpb24udXBkYXRlTWFueTtcbiAgICAgIGlmKCFPYmplY3Qua2V5cyhtb2QpLnNvbWUoa2V5ID0+IGtleS5zdGFydHNXaXRoKFwiJFwiKSkpe1xuICAgICAgICBtZXRob2QgPSBjb2xsZWN0aW9uLnJlcGxhY2VPbmUuYmluZChjb2xsZWN0aW9uKTtcbiAgICAgIH1cbiAgICAgIG1ldGhvZChcbiAgICAgICAgc2VsZWN0b3IsXG4gICAgICAgIG1vZCxcbiAgICAgICAgbW9uZ29PcHRzRm9yVXBkYXRlLFxuICAgICAgICBiaW5kRW52aXJvbm1lbnRGb3JXcml0ZShmdW5jdGlvbihlcnIsIHJlc3VsdCkge1xuICAgICAgICAgIGlmIChlcnIpIHtcbiAgICAgICAgICAgIGNhbGxiYWNrKGVycik7XG4gICAgICAgICAgfSBlbHNlIGlmIChyZXN1bHQgJiYgKHJlc3VsdC5tb2RpZmllZENvdW50IHx8IHJlc3VsdC51cHNlcnRlZENvdW50KSkge1xuICAgICAgICAgICAgY2FsbGJhY2sobnVsbCwge1xuICAgICAgICAgICAgICBudW1iZXJBZmZlY3RlZDogcmVzdWx0Lm1vZGlmaWVkQ291bnQgfHwgcmVzdWx0LnVwc2VydGVkQ291bnQsXG4gICAgICAgICAgICAgIGluc2VydGVkSWQ6IHJlc3VsdC51cHNlcnRlZElkIHx8IHVuZGVmaW5lZCxcbiAgICAgICAgICAgIH0pO1xuICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICBkb0NvbmRpdGlvbmFsSW5zZXJ0KCk7XG4gICAgICAgICAgfVxuICAgICAgICB9KVxuICAgICAgKTtcbiAgICB9XG4gIH07XG5cbiAgdmFyIGRvQ29uZGl0aW9uYWxJbnNlcnQgPSBmdW5jdGlvbigpIHtcbiAgICBjb2xsZWN0aW9uLnJlcGxhY2VPbmUoXG4gICAgICBzZWxlY3RvcixcbiAgICAgIHJlcGxhY2VtZW50V2l0aElkLFxuICAgICAgbW9uZ29PcHRzRm9ySW5zZXJ0LFxuICAgICAgYmluZEVudmlyb25tZW50Rm9yV3JpdGUoZnVuY3Rpb24oZXJyLCByZXN1bHQpIHtcbiAgICAgICAgaWYgKGVycikge1xuICAgICAgICAgIC8vIGZpZ3VyZSBvdXQgaWYgdGhpcyBpcyBhXG4gICAgICAgICAgLy8gXCJjYW5ub3QgY2hhbmdlIF9pZCBvZiBkb2N1bWVudFwiIGVycm9yLCBhbmRcbiAgICAgICAgICAvLyBpZiBzbywgdHJ5IGRvVXBkYXRlKCkgYWdhaW4sIHVwIHRvIDMgdGltZXMuXG4gICAgICAgICAgaWYgKE1vbmdvQ29ubmVjdGlvbi5faXNDYW5ub3RDaGFuZ2VJZEVycm9yKGVycikpIHtcbiAgICAgICAgICAgIGRvVXBkYXRlKCk7XG4gICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIGNhbGxiYWNrKGVycik7XG4gICAgICAgICAgfVxuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIGNhbGxiYWNrKG51bGwsIHtcbiAgICAgICAgICAgIG51bWJlckFmZmVjdGVkOiByZXN1bHQudXBzZXJ0ZWRDb3VudCxcbiAgICAgICAgICAgIGluc2VydGVkSWQ6IHJlc3VsdC51cHNlcnRlZElkLFxuICAgICAgICAgIH0pO1xuICAgICAgICB9XG4gICAgICB9KVxuICAgICk7XG4gIH07XG5cbiAgZG9VcGRhdGUoKTtcbn07XG5cbl8uZWFjaChbXCJpbnNlcnRcIiwgXCJ1cGRhdGVcIiwgXCJyZW1vdmVcIiwgXCJkcm9wQ29sbGVjdGlvblwiLCBcImRyb3BEYXRhYmFzZVwiXSwgZnVuY3Rpb24gKG1ldGhvZCkge1xuICBNb25nb0Nvbm5lY3Rpb24ucHJvdG90eXBlW21ldGhvZF0gPSBmdW5jdGlvbiAoLyogYXJndW1lbnRzICovKSB7XG4gICAgdmFyIHNlbGYgPSB0aGlzO1xuICAgIHJldHVybiBNZXRlb3Iud3JhcEFzeW5jKHNlbGZbXCJfXCIgKyBtZXRob2RdKS5hcHBseShzZWxmLCBhcmd1bWVudHMpO1xuICB9O1xufSk7XG5cbi8vIFhYWCBNb25nb0Nvbm5lY3Rpb24udXBzZXJ0KCkgZG9lcyBub3QgcmV0dXJuIHRoZSBpZCBvZiB0aGUgaW5zZXJ0ZWQgZG9jdW1lbnRcbi8vIHVubGVzcyB5b3Ugc2V0IGl0IGV4cGxpY2l0bHkgaW4gdGhlIHNlbGVjdG9yIG9yIG1vZGlmaWVyIChhcyBhIHJlcGxhY2VtZW50XG4vLyBkb2MpLlxuTW9uZ29Db25uZWN0aW9uLnByb3RvdHlwZS51cHNlcnQgPSBmdW5jdGlvbiAoY29sbGVjdGlvbk5hbWUsIHNlbGVjdG9yLCBtb2QsXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBvcHRpb25zLCBjYWxsYmFjaykge1xuICB2YXIgc2VsZiA9IHRoaXM7XG4gIGlmICh0eXBlb2Ygb3B0aW9ucyA9PT0gXCJmdW5jdGlvblwiICYmICEgY2FsbGJhY2spIHtcbiAgICBjYWxsYmFjayA9IG9wdGlvbnM7XG4gICAgb3B0aW9ucyA9IHt9O1xuICB9XG5cbiAgcmV0dXJuIHNlbGYudXBkYXRlKGNvbGxlY3Rpb25OYW1lLCBzZWxlY3RvciwgbW9kLFxuICAgICAgICAgICAgICAgICAgICAgXy5leHRlbmQoe30sIG9wdGlvbnMsIHtcbiAgICAgICAgICAgICAgICAgICAgICAgdXBzZXJ0OiB0cnVlLFxuICAgICAgICAgICAgICAgICAgICAgICBfcmV0dXJuT2JqZWN0OiB0cnVlXG4gICAgICAgICAgICAgICAgICAgICB9KSwgY2FsbGJhY2spO1xufTtcblxuTW9uZ29Db25uZWN0aW9uLnByb3RvdHlwZS5maW5kID0gZnVuY3Rpb24gKGNvbGxlY3Rpb25OYW1lLCBzZWxlY3Rvciwgb3B0aW9ucykge1xuICB2YXIgc2VsZiA9IHRoaXM7XG5cbiAgaWYgKGFyZ3VtZW50cy5sZW5ndGggPT09IDEpXG4gICAgc2VsZWN0b3IgPSB7fTtcblxuICByZXR1cm4gbmV3IEN1cnNvcihcbiAgICBzZWxmLCBuZXcgQ3Vyc29yRGVzY3JpcHRpb24oY29sbGVjdGlvbk5hbWUsIHNlbGVjdG9yLCBvcHRpb25zKSk7XG59O1xuXG5Nb25nb0Nvbm5lY3Rpb24ucHJvdG90eXBlLmZpbmRPbmUgPSBmdW5jdGlvbiAoY29sbGVjdGlvbl9uYW1lLCBzZWxlY3RvcixcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBvcHRpb25zKSB7XG4gIHZhciBzZWxmID0gdGhpcztcbiAgaWYgKGFyZ3VtZW50cy5sZW5ndGggPT09IDEpXG4gICAgc2VsZWN0b3IgPSB7fTtcblxuICBvcHRpb25zID0gb3B0aW9ucyB8fCB7fTtcbiAgb3B0aW9ucy5saW1pdCA9IDE7XG4gIHJldHVybiBzZWxmLmZpbmQoY29sbGVjdGlvbl9uYW1lLCBzZWxlY3Rvciwgb3B0aW9ucykuZmV0Y2goKVswXTtcbn07XG5cbi8vIFdlJ2xsIGFjdHVhbGx5IGRlc2lnbiBhbiBpbmRleCBBUEkgbGF0ZXIuIEZvciBub3csIHdlIGp1c3QgcGFzcyB0aHJvdWdoIHRvXG4vLyBNb25nbydzLCBidXQgbWFrZSBpdCBzeW5jaHJvbm91cy5cbk1vbmdvQ29ubmVjdGlvbi5wcm90b3R5cGUuY3JlYXRlSW5kZXggPSBmdW5jdGlvbiAoY29sbGVjdGlvbk5hbWUsIGluZGV4LFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgb3B0aW9ucykge1xuICB2YXIgc2VsZiA9IHRoaXM7XG5cbiAgLy8gV2UgZXhwZWN0IHRoaXMgZnVuY3Rpb24gdG8gYmUgY2FsbGVkIGF0IHN0YXJ0dXAsIG5vdCBmcm9tIHdpdGhpbiBhIG1ldGhvZCxcbiAgLy8gc28gd2UgZG9uJ3QgaW50ZXJhY3Qgd2l0aCB0aGUgd3JpdGUgZmVuY2UuXG4gIHZhciBjb2xsZWN0aW9uID0gc2VsZi5yYXdDb2xsZWN0aW9uKGNvbGxlY3Rpb25OYW1lKTtcbiAgdmFyIGZ1dHVyZSA9IG5ldyBGdXR1cmU7XG4gIHZhciBpbmRleE5hbWUgPSBjb2xsZWN0aW9uLmNyZWF0ZUluZGV4KGluZGV4LCBvcHRpb25zLCBmdXR1cmUucmVzb2x2ZXIoKSk7XG4gIGZ1dHVyZS53YWl0KCk7XG59O1xuXG5Nb25nb0Nvbm5lY3Rpb24ucHJvdG90eXBlLl9lbnN1cmVJbmRleCA9IE1vbmdvQ29ubmVjdGlvbi5wcm90b3R5cGUuY3JlYXRlSW5kZXg7XG5cbk1vbmdvQ29ubmVjdGlvbi5wcm90b3R5cGUuX2Ryb3BJbmRleCA9IGZ1bmN0aW9uIChjb2xsZWN0aW9uTmFtZSwgaW5kZXgpIHtcbiAgdmFyIHNlbGYgPSB0aGlzO1xuXG4gIC8vIFRoaXMgZnVuY3Rpb24gaXMgb25seSB1c2VkIGJ5IHRlc3QgY29kZSwgbm90IHdpdGhpbiBhIG1ldGhvZCwgc28gd2UgZG9uJ3RcbiAgLy8gaW50ZXJhY3Qgd2l0aCB0aGUgd3JpdGUgZmVuY2UuXG4gIHZhciBjb2xsZWN0aW9uID0gc2VsZi5yYXdDb2xsZWN0aW9uKGNvbGxlY3Rpb25OYW1lKTtcbiAgdmFyIGZ1dHVyZSA9IG5ldyBGdXR1cmU7XG4gIHZhciBpbmRleE5hbWUgPSBjb2xsZWN0aW9uLmRyb3BJbmRleChpbmRleCwgZnV0dXJlLnJlc29sdmVyKCkpO1xuICBmdXR1cmUud2FpdCgpO1xufTtcblxuLy8gQ1VSU09SU1xuXG4vLyBUaGVyZSBhcmUgc2V2ZXJhbCBjbGFzc2VzIHdoaWNoIHJlbGF0ZSB0byBjdXJzb3JzOlxuLy9cbi8vIEN1cnNvckRlc2NyaXB0aW9uIHJlcHJlc2VudHMgdGhlIGFyZ3VtZW50cyB1c2VkIHRvIGNvbnN0cnVjdCBhIGN1cnNvcjpcbi8vIGNvbGxlY3Rpb25OYW1lLCBzZWxlY3RvciwgYW5kIChmaW5kKSBvcHRpb25zLiAgQmVjYXVzZSBpdCBpcyB1c2VkIGFzIGEga2V5XG4vLyBmb3IgY3Vyc29yIGRlLWR1cCwgZXZlcnl0aGluZyBpbiBpdCBzaG91bGQgZWl0aGVyIGJlIEpTT04tc3RyaW5naWZpYWJsZSBvclxuLy8gbm90IGFmZmVjdCBvYnNlcnZlQ2hhbmdlcyBvdXRwdXQgKGVnLCBvcHRpb25zLnRyYW5zZm9ybSBmdW5jdGlvbnMgYXJlIG5vdFxuLy8gc3RyaW5naWZpYWJsZSBidXQgZG8gbm90IGFmZmVjdCBvYnNlcnZlQ2hhbmdlcykuXG4vL1xuLy8gU3luY2hyb25vdXNDdXJzb3IgaXMgYSB3cmFwcGVyIGFyb3VuZCBhIE1vbmdvREIgY3Vyc29yXG4vLyB3aGljaCBpbmNsdWRlcyBmdWxseS1zeW5jaHJvbm91cyB2ZXJzaW9ucyBvZiBmb3JFYWNoLCBldGMuXG4vL1xuLy8gQ3Vyc29yIGlzIHRoZSBjdXJzb3Igb2JqZWN0IHJldHVybmVkIGZyb20gZmluZCgpLCB3aGljaCBpbXBsZW1lbnRzIHRoZVxuLy8gZG9jdW1lbnRlZCBNb25nby5Db2xsZWN0aW9uIGN1cnNvciBBUEkuICBJdCB3cmFwcyBhIEN1cnNvckRlc2NyaXB0aW9uIGFuZCBhXG4vLyBTeW5jaHJvbm91c0N1cnNvciAobGF6aWx5OiBpdCBkb2Vzbid0IGNvbnRhY3QgTW9uZ28gdW50aWwgeW91IGNhbGwgYSBtZXRob2Rcbi8vIGxpa2UgZmV0Y2ggb3IgZm9yRWFjaCBvbiBpdCkuXG4vL1xuLy8gT2JzZXJ2ZUhhbmRsZSBpcyB0aGUgXCJvYnNlcnZlIGhhbmRsZVwiIHJldHVybmVkIGZyb20gb2JzZXJ2ZUNoYW5nZXMuIEl0IGhhcyBhXG4vLyByZWZlcmVuY2UgdG8gYW4gT2JzZXJ2ZU11bHRpcGxleGVyLlxuLy9cbi8vIE9ic2VydmVNdWx0aXBsZXhlciBhbGxvd3MgbXVsdGlwbGUgaWRlbnRpY2FsIE9ic2VydmVIYW5kbGVzIHRvIGJlIGRyaXZlbiBieSBhXG4vLyBzaW5nbGUgb2JzZXJ2ZSBkcml2ZXIuXG4vL1xuLy8gVGhlcmUgYXJlIHR3byBcIm9ic2VydmUgZHJpdmVyc1wiIHdoaWNoIGRyaXZlIE9ic2VydmVNdWx0aXBsZXhlcnM6XG4vLyAgIC0gUG9sbGluZ09ic2VydmVEcml2ZXIgY2FjaGVzIHRoZSByZXN1bHRzIG9mIGEgcXVlcnkgYW5kIHJlcnVucyBpdCB3aGVuXG4vLyAgICAgbmVjZXNzYXJ5LlxuLy8gICAtIE9wbG9nT2JzZXJ2ZURyaXZlciBmb2xsb3dzIHRoZSBNb25nbyBvcGVyYXRpb24gbG9nIHRvIGRpcmVjdGx5IG9ic2VydmVcbi8vICAgICBkYXRhYmFzZSBjaGFuZ2VzLlxuLy8gQm90aCBpbXBsZW1lbnRhdGlvbnMgZm9sbG93IHRoZSBzYW1lIHNpbXBsZSBpbnRlcmZhY2U6IHdoZW4geW91IGNyZWF0ZSB0aGVtLFxuLy8gdGhleSBzdGFydCBzZW5kaW5nIG9ic2VydmVDaGFuZ2VzIGNhbGxiYWNrcyAoYW5kIGEgcmVhZHkoKSBpbnZvY2F0aW9uKSB0b1xuLy8gdGhlaXIgT2JzZXJ2ZU11bHRpcGxleGVyLCBhbmQgeW91IHN0b3AgdGhlbSBieSBjYWxsaW5nIHRoZWlyIHN0b3AoKSBtZXRob2QuXG5cbkN1cnNvckRlc2NyaXB0aW9uID0gZnVuY3Rpb24gKGNvbGxlY3Rpb25OYW1lLCBzZWxlY3Rvciwgb3B0aW9ucykge1xuICB2YXIgc2VsZiA9IHRoaXM7XG4gIHNlbGYuY29sbGVjdGlvbk5hbWUgPSBjb2xsZWN0aW9uTmFtZTtcbiAgc2VsZi5zZWxlY3RvciA9IE1vbmdvLkNvbGxlY3Rpb24uX3Jld3JpdGVTZWxlY3RvcihzZWxlY3Rvcik7XG4gIHNlbGYub3B0aW9ucyA9IG9wdGlvbnMgfHwge307XG59O1xuXG5DdXJzb3IgPSBmdW5jdGlvbiAobW9uZ28sIGN1cnNvckRlc2NyaXB0aW9uKSB7XG4gIHZhciBzZWxmID0gdGhpcztcblxuICBzZWxmLl9tb25nbyA9IG1vbmdvO1xuICBzZWxmLl9jdXJzb3JEZXNjcmlwdGlvbiA9IGN1cnNvckRlc2NyaXB0aW9uO1xuICBzZWxmLl9zeW5jaHJvbm91c0N1cnNvciA9IG51bGw7XG59O1xuXG5fLmVhY2goWydmb3JFYWNoJywgJ21hcCcsICdmZXRjaCcsICdjb3VudCcsIFN5bWJvbC5pdGVyYXRvcl0sIGZ1bmN0aW9uIChtZXRob2QpIHtcbiAgQ3Vyc29yLnByb3RvdHlwZVttZXRob2RdID0gZnVuY3Rpb24gKCkge1xuICAgIHZhciBzZWxmID0gdGhpcztcblxuICAgIC8vIFlvdSBjYW4gb25seSBvYnNlcnZlIGEgdGFpbGFibGUgY3Vyc29yLlxuICAgIGlmIChzZWxmLl9jdXJzb3JEZXNjcmlwdGlvbi5vcHRpb25zLnRhaWxhYmxlKVxuICAgICAgdGhyb3cgbmV3IEVycm9yKFwiQ2Fubm90IGNhbGwgXCIgKyBtZXRob2QgKyBcIiBvbiBhIHRhaWxhYmxlIGN1cnNvclwiKTtcblxuICAgIGlmICghc2VsZi5fc3luY2hyb25vdXNDdXJzb3IpIHtcbiAgICAgIHNlbGYuX3N5bmNocm9ub3VzQ3Vyc29yID0gc2VsZi5fbW9uZ28uX2NyZWF0ZVN5bmNocm9ub3VzQ3Vyc29yKFxuICAgICAgICBzZWxmLl9jdXJzb3JEZXNjcmlwdGlvbiwge1xuICAgICAgICAgIC8vIE1ha2Ugc3VyZSB0aGF0IHRoZSBcInNlbGZcIiBhcmd1bWVudCB0byBmb3JFYWNoL21hcCBjYWxsYmFja3MgaXMgdGhlXG4gICAgICAgICAgLy8gQ3Vyc29yLCBub3QgdGhlIFN5bmNocm9ub3VzQ3Vyc29yLlxuICAgICAgICAgIHNlbGZGb3JJdGVyYXRpb246IHNlbGYsXG4gICAgICAgICAgdXNlVHJhbnNmb3JtOiB0cnVlXG4gICAgICAgIH0pO1xuICAgIH1cblxuICAgIHJldHVybiBzZWxmLl9zeW5jaHJvbm91c0N1cnNvclttZXRob2RdLmFwcGx5KFxuICAgICAgc2VsZi5fc3luY2hyb25vdXNDdXJzb3IsIGFyZ3VtZW50cyk7XG4gIH07XG59KTtcblxuQ3Vyc29yLnByb3RvdHlwZS5nZXRUcmFuc2Zvcm0gPSBmdW5jdGlvbiAoKSB7XG4gIHJldHVybiB0aGlzLl9jdXJzb3JEZXNjcmlwdGlvbi5vcHRpb25zLnRyYW5zZm9ybTtcbn07XG5cbi8vIFdoZW4geW91IGNhbGwgTWV0ZW9yLnB1Ymxpc2goKSB3aXRoIGEgZnVuY3Rpb24gdGhhdCByZXR1cm5zIGEgQ3Vyc29yLCB3ZSBuZWVkXG4vLyB0byB0cmFuc211dGUgaXQgaW50byB0aGUgZXF1aXZhbGVudCBzdWJzY3JpcHRpb24uICBUaGlzIGlzIHRoZSBmdW5jdGlvbiB0aGF0XG4vLyBkb2VzIHRoYXQuXG5cbkN1cnNvci5wcm90b3R5cGUuX3B1Ymxpc2hDdXJzb3IgPSBmdW5jdGlvbiAoc3ViKSB7XG4gIHZhciBzZWxmID0gdGhpcztcbiAgdmFyIGNvbGxlY3Rpb24gPSBzZWxmLl9jdXJzb3JEZXNjcmlwdGlvbi5jb2xsZWN0aW9uTmFtZTtcbiAgcmV0dXJuIE1vbmdvLkNvbGxlY3Rpb24uX3B1Ymxpc2hDdXJzb3Ioc2VsZiwgc3ViLCBjb2xsZWN0aW9uKTtcbn07XG5cbi8vIFVzZWQgdG8gZ3VhcmFudGVlIHRoYXQgcHVibGlzaCBmdW5jdGlvbnMgcmV0dXJuIGF0IG1vc3Qgb25lIGN1cnNvciBwZXJcbi8vIGNvbGxlY3Rpb24uIFByaXZhdGUsIGJlY2F1c2Ugd2UgbWlnaHQgbGF0ZXIgaGF2ZSBjdXJzb3JzIHRoYXQgaW5jbHVkZVxuLy8gZG9jdW1lbnRzIGZyb20gbXVsdGlwbGUgY29sbGVjdGlvbnMgc29tZWhvdy5cbkN1cnNvci5wcm90b3R5cGUuX2dldENvbGxlY3Rpb25OYW1lID0gZnVuY3Rpb24gKCkge1xuICB2YXIgc2VsZiA9IHRoaXM7XG4gIHJldHVybiBzZWxmLl9jdXJzb3JEZXNjcmlwdGlvbi5jb2xsZWN0aW9uTmFtZTtcbn07XG5cbkN1cnNvci5wcm90b3R5cGUub2JzZXJ2ZSA9IGZ1bmN0aW9uIChjYWxsYmFja3MpIHtcbiAgdmFyIHNlbGYgPSB0aGlzO1xuICByZXR1cm4gTG9jYWxDb2xsZWN0aW9uLl9vYnNlcnZlRnJvbU9ic2VydmVDaGFuZ2VzKHNlbGYsIGNhbGxiYWNrcyk7XG59O1xuXG5DdXJzb3IucHJvdG90eXBlLm9ic2VydmVDaGFuZ2VzID0gZnVuY3Rpb24gKGNhbGxiYWNrcywgb3B0aW9ucyA9IHt9KSB7XG4gIHZhciBzZWxmID0gdGhpcztcbiAgdmFyIG1ldGhvZHMgPSBbXG4gICAgJ2FkZGVkQXQnLFxuICAgICdhZGRlZCcsXG4gICAgJ2NoYW5nZWRBdCcsXG4gICAgJ2NoYW5nZWQnLFxuICAgICdyZW1vdmVkQXQnLFxuICAgICdyZW1vdmVkJyxcbiAgICAnbW92ZWRUbydcbiAgXTtcbiAgdmFyIG9yZGVyZWQgPSBMb2NhbENvbGxlY3Rpb24uX29ic2VydmVDaGFuZ2VzQ2FsbGJhY2tzQXJlT3JkZXJlZChjYWxsYmFja3MpO1xuXG4gIGxldCBleGNlcHRpb25OYW1lID0gY2FsbGJhY2tzLl9mcm9tT2JzZXJ2ZSA/ICdvYnNlcnZlJyA6ICdvYnNlcnZlQ2hhbmdlcyc7XG4gIGV4Y2VwdGlvbk5hbWUgKz0gJyBjYWxsYmFjayc7XG4gIG1ldGhvZHMuZm9yRWFjaChmdW5jdGlvbiAobWV0aG9kKSB7XG4gICAgaWYgKGNhbGxiYWNrc1ttZXRob2RdICYmIHR5cGVvZiBjYWxsYmFja3NbbWV0aG9kXSA9PSBcImZ1bmN0aW9uXCIpIHtcbiAgICAgIGNhbGxiYWNrc1ttZXRob2RdID0gTWV0ZW9yLmJpbmRFbnZpcm9ubWVudChjYWxsYmFja3NbbWV0aG9kXSwgbWV0aG9kICsgZXhjZXB0aW9uTmFtZSk7XG4gICAgfVxuICB9KTtcblxuICByZXR1cm4gc2VsZi5fbW9uZ28uX29ic2VydmVDaGFuZ2VzKFxuICAgIHNlbGYuX2N1cnNvckRlc2NyaXB0aW9uLCBvcmRlcmVkLCBjYWxsYmFja3MsIG9wdGlvbnMubm9uTXV0YXRpbmdDYWxsYmFja3MpO1xufTtcblxuTW9uZ29Db25uZWN0aW9uLnByb3RvdHlwZS5fY3JlYXRlU3luY2hyb25vdXNDdXJzb3IgPSBmdW5jdGlvbihcbiAgICBjdXJzb3JEZXNjcmlwdGlvbiwgb3B0aW9ucykge1xuICB2YXIgc2VsZiA9IHRoaXM7XG4gIG9wdGlvbnMgPSBfLnBpY2sob3B0aW9ucyB8fCB7fSwgJ3NlbGZGb3JJdGVyYXRpb24nLCAndXNlVHJhbnNmb3JtJyk7XG5cbiAgdmFyIGNvbGxlY3Rpb24gPSBzZWxmLnJhd0NvbGxlY3Rpb24oY3Vyc29yRGVzY3JpcHRpb24uY29sbGVjdGlvbk5hbWUpO1xuICB2YXIgY3Vyc29yT3B0aW9ucyA9IGN1cnNvckRlc2NyaXB0aW9uLm9wdGlvbnM7XG4gIHZhciBtb25nb09wdGlvbnMgPSB7XG4gICAgc29ydDogY3Vyc29yT3B0aW9ucy5zb3J0LFxuICAgIGxpbWl0OiBjdXJzb3JPcHRpb25zLmxpbWl0LFxuICAgIHNraXA6IGN1cnNvck9wdGlvbnMuc2tpcCxcbiAgICBwcm9qZWN0aW9uOiBjdXJzb3JPcHRpb25zLmZpZWxkcyB8fCBjdXJzb3JPcHRpb25zLnByb2plY3Rpb24sXG4gICAgcmVhZFByZWZlcmVuY2U6IGN1cnNvck9wdGlvbnMucmVhZFByZWZlcmVuY2UsXG4gIH07XG5cbiAgLy8gRG8gd2Ugd2FudCBhIHRhaWxhYmxlIGN1cnNvciAod2hpY2ggb25seSB3b3JrcyBvbiBjYXBwZWQgY29sbGVjdGlvbnMpP1xuICBpZiAoY3Vyc29yT3B0aW9ucy50YWlsYWJsZSkge1xuICAgIG1vbmdvT3B0aW9ucy5udW1iZXJPZlJldHJpZXMgPSAtMTtcbiAgfVxuXG4gIHZhciBkYkN1cnNvciA9IGNvbGxlY3Rpb24uZmluZChcbiAgICByZXBsYWNlVHlwZXMoY3Vyc29yRGVzY3JpcHRpb24uc2VsZWN0b3IsIHJlcGxhY2VNZXRlb3JBdG9tV2l0aE1vbmdvKSxcbiAgICBtb25nb09wdGlvbnMpO1xuXG4gIC8vIERvIHdlIHdhbnQgYSB0YWlsYWJsZSBjdXJzb3IgKHdoaWNoIG9ubHkgd29ya3Mgb24gY2FwcGVkIGNvbGxlY3Rpb25zKT9cbiAgaWYgKGN1cnNvck9wdGlvbnMudGFpbGFibGUpIHtcbiAgICAvLyBXZSB3YW50IGEgdGFpbGFibGUgY3Vyc29yLi4uXG4gICAgZGJDdXJzb3IuYWRkQ3Vyc29yRmxhZyhcInRhaWxhYmxlXCIsIHRydWUpXG4gICAgLy8gLi4uIGFuZCBmb3IgdGhlIHNlcnZlciB0byB3YWl0IGEgYml0IGlmIGFueSBnZXRNb3JlIGhhcyBubyBkYXRhIChyYXRoZXJcbiAgICAvLyB0aGFuIG1ha2luZyB1cyBwdXQgdGhlIHJlbGV2YW50IHNsZWVwcyBpbiB0aGUgY2xpZW50KS4uLlxuICAgIGRiQ3Vyc29yLmFkZEN1cnNvckZsYWcoXCJhd2FpdERhdGFcIiwgdHJ1ZSlcblxuICAgIC8vIEFuZCBpZiB0aGlzIGlzIG9uIHRoZSBvcGxvZyBjb2xsZWN0aW9uIGFuZCB0aGUgY3Vyc29yIHNwZWNpZmllcyBhICd0cycsXG4gICAgLy8gdGhlbiBzZXQgdGhlIHVuZG9jdW1lbnRlZCBvcGxvZyByZXBsYXkgZmxhZywgd2hpY2ggZG9lcyBhIHNwZWNpYWwgc2NhbiB0b1xuICAgIC8vIGZpbmQgdGhlIGZpcnN0IGRvY3VtZW50IChpbnN0ZWFkIG9mIGNyZWF0aW5nIGFuIGluZGV4IG9uIHRzKS4gVGhpcyBpcyBhXG4gICAgLy8gdmVyeSBoYXJkLWNvZGVkIE1vbmdvIGZsYWcgd2hpY2ggb25seSB3b3JrcyBvbiB0aGUgb3Bsb2cgY29sbGVjdGlvbiBhbmRcbiAgICAvLyBvbmx5IHdvcmtzIHdpdGggdGhlIHRzIGZpZWxkLlxuICAgIGlmIChjdXJzb3JEZXNjcmlwdGlvbi5jb2xsZWN0aW9uTmFtZSA9PT0gT1BMT0dfQ09MTEVDVElPTiAmJlxuICAgICAgICBjdXJzb3JEZXNjcmlwdGlvbi5zZWxlY3Rvci50cykge1xuICAgICAgZGJDdXJzb3IuYWRkQ3Vyc29yRmxhZyhcIm9wbG9nUmVwbGF5XCIsIHRydWUpXG4gICAgfVxuICB9XG5cbiAgaWYgKHR5cGVvZiBjdXJzb3JPcHRpb25zLm1heFRpbWVNcyAhPT0gJ3VuZGVmaW5lZCcpIHtcbiAgICBkYkN1cnNvciA9IGRiQ3Vyc29yLm1heFRpbWVNUyhjdXJzb3JPcHRpb25zLm1heFRpbWVNcyk7XG4gIH1cbiAgaWYgKHR5cGVvZiBjdXJzb3JPcHRpb25zLmhpbnQgIT09ICd1bmRlZmluZWQnKSB7XG4gICAgZGJDdXJzb3IgPSBkYkN1cnNvci5oaW50KGN1cnNvck9wdGlvbnMuaGludCk7XG4gIH1cblxuICByZXR1cm4gbmV3IFN5bmNocm9ub3VzQ3Vyc29yKGRiQ3Vyc29yLCBjdXJzb3JEZXNjcmlwdGlvbiwgb3B0aW9ucyk7XG59O1xuXG52YXIgU3luY2hyb25vdXNDdXJzb3IgPSBmdW5jdGlvbiAoZGJDdXJzb3IsIGN1cnNvckRlc2NyaXB0aW9uLCBvcHRpb25zKSB7XG4gIHZhciBzZWxmID0gdGhpcztcbiAgb3B0aW9ucyA9IF8ucGljayhvcHRpb25zIHx8IHt9LCAnc2VsZkZvckl0ZXJhdGlvbicsICd1c2VUcmFuc2Zvcm0nKTtcblxuICBzZWxmLl9kYkN1cnNvciA9IGRiQ3Vyc29yO1xuICBzZWxmLl9jdXJzb3JEZXNjcmlwdGlvbiA9IGN1cnNvckRlc2NyaXB0aW9uO1xuICAvLyBUaGUgXCJzZWxmXCIgYXJndW1lbnQgcGFzc2VkIHRvIGZvckVhY2gvbWFwIGNhbGxiYWNrcy4gSWYgd2UncmUgd3JhcHBlZFxuICAvLyBpbnNpZGUgYSB1c2VyLXZpc2libGUgQ3Vyc29yLCB3ZSB3YW50IHRvIHByb3ZpZGUgdGhlIG91dGVyIGN1cnNvciFcbiAgc2VsZi5fc2VsZkZvckl0ZXJhdGlvbiA9IG9wdGlvbnMuc2VsZkZvckl0ZXJhdGlvbiB8fCBzZWxmO1xuICBpZiAob3B0aW9ucy51c2VUcmFuc2Zvcm0gJiYgY3Vyc29yRGVzY3JpcHRpb24ub3B0aW9ucy50cmFuc2Zvcm0pIHtcbiAgICBzZWxmLl90cmFuc2Zvcm0gPSBMb2NhbENvbGxlY3Rpb24ud3JhcFRyYW5zZm9ybShcbiAgICAgIGN1cnNvckRlc2NyaXB0aW9uLm9wdGlvbnMudHJhbnNmb3JtKTtcbiAgfSBlbHNlIHtcbiAgICBzZWxmLl90cmFuc2Zvcm0gPSBudWxsO1xuICB9XG5cbiAgc2VsZi5fc3luY2hyb25vdXNDb3VudCA9IEZ1dHVyZS53cmFwKGRiQ3Vyc29yLmNvdW50LmJpbmQoZGJDdXJzb3IpKTtcbiAgc2VsZi5fdmlzaXRlZElkcyA9IG5ldyBMb2NhbENvbGxlY3Rpb24uX0lkTWFwO1xufTtcblxuXy5leHRlbmQoU3luY2hyb25vdXNDdXJzb3IucHJvdG90eXBlLCB7XG4gIC8vIFJldHVybnMgYSBQcm9taXNlIGZvciB0aGUgbmV4dCBvYmplY3QgZnJvbSB0aGUgdW5kZXJseWluZyBjdXJzb3IgKGJlZm9yZVxuICAvLyB0aGUgTW9uZ28tPk1ldGVvciB0eXBlIHJlcGxhY2VtZW50KS5cbiAgX3Jhd05leHRPYmplY3RQcm9taXNlOiBmdW5jdGlvbiAoKSB7XG4gICAgY29uc3Qgc2VsZiA9IHRoaXM7XG4gICAgcmV0dXJuIG5ldyBQcm9taXNlKChyZXNvbHZlLCByZWplY3QpID0+IHtcbiAgICAgIHNlbGYuX2RiQ3Vyc29yLm5leHQoKGVyciwgZG9jKSA9PiB7XG4gICAgICAgIGlmIChlcnIpIHtcbiAgICAgICAgICByZWplY3QoZXJyKTtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICByZXNvbHZlKGRvYyk7XG4gICAgICAgIH1cbiAgICAgIH0pO1xuICAgIH0pO1xuICB9LFxuXG4gIC8vIFJldHVybnMgYSBQcm9taXNlIGZvciB0aGUgbmV4dCBvYmplY3QgZnJvbSB0aGUgY3Vyc29yLCBza2lwcGluZyB0aG9zZSB3aG9zZVxuICAvLyBJRHMgd2UndmUgYWxyZWFkeSBzZWVuIGFuZCByZXBsYWNpbmcgTW9uZ28gYXRvbXMgd2l0aCBNZXRlb3IgYXRvbXMuXG4gIF9uZXh0T2JqZWN0UHJvbWlzZTogYXN5bmMgZnVuY3Rpb24gKCkge1xuICAgIHZhciBzZWxmID0gdGhpcztcblxuICAgIHdoaWxlICh0cnVlKSB7XG4gICAgICB2YXIgZG9jID0gYXdhaXQgc2VsZi5fcmF3TmV4dE9iamVjdFByb21pc2UoKTtcblxuICAgICAgaWYgKCFkb2MpIHJldHVybiBudWxsO1xuICAgICAgZG9jID0gcmVwbGFjZVR5cGVzKGRvYywgcmVwbGFjZU1vbmdvQXRvbVdpdGhNZXRlb3IpO1xuXG4gICAgICBpZiAoIXNlbGYuX2N1cnNvckRlc2NyaXB0aW9uLm9wdGlvbnMudGFpbGFibGUgJiYgXy5oYXMoZG9jLCAnX2lkJykpIHtcbiAgICAgICAgLy8gRGlkIE1vbmdvIGdpdmUgdXMgZHVwbGljYXRlIGRvY3VtZW50cyBpbiB0aGUgc2FtZSBjdXJzb3I/IElmIHNvLFxuICAgICAgICAvLyBpZ25vcmUgdGhpcyBvbmUuIChEbyB0aGlzIGJlZm9yZSB0aGUgdHJhbnNmb3JtLCBzaW5jZSB0cmFuc2Zvcm0gbWlnaHRcbiAgICAgICAgLy8gcmV0dXJuIHNvbWUgdW5yZWxhdGVkIHZhbHVlLikgV2UgZG9uJ3QgZG8gdGhpcyBmb3IgdGFpbGFibGUgY3Vyc29ycyxcbiAgICAgICAgLy8gYmVjYXVzZSB3ZSB3YW50IHRvIG1haW50YWluIE8oMSkgbWVtb3J5IHVzYWdlLiBBbmQgaWYgdGhlcmUgaXNuJ3QgX2lkXG4gICAgICAgIC8vIGZvciBzb21lIHJlYXNvbiAobWF5YmUgaXQncyB0aGUgb3Bsb2cpLCB0aGVuIHdlIGRvbid0IGRvIHRoaXMgZWl0aGVyLlxuICAgICAgICAvLyAoQmUgY2FyZWZ1bCB0byBkbyB0aGlzIGZvciBmYWxzZXkgYnV0IGV4aXN0aW5nIF9pZCwgdGhvdWdoLilcbiAgICAgICAgaWYgKHNlbGYuX3Zpc2l0ZWRJZHMuaGFzKGRvYy5faWQpKSBjb250aW51ZTtcbiAgICAgICAgc2VsZi5fdmlzaXRlZElkcy5zZXQoZG9jLl9pZCwgdHJ1ZSk7XG4gICAgICB9XG5cbiAgICAgIGlmIChzZWxmLl90cmFuc2Zvcm0pXG4gICAgICAgIGRvYyA9IHNlbGYuX3RyYW5zZm9ybShkb2MpO1xuXG4gICAgICByZXR1cm4gZG9jO1xuICAgIH1cbiAgfSxcblxuICAvLyBSZXR1cm5zIGEgcHJvbWlzZSB3aGljaCBpcyByZXNvbHZlZCB3aXRoIHRoZSBuZXh0IG9iamVjdCAobGlrZSB3aXRoXG4gIC8vIF9uZXh0T2JqZWN0UHJvbWlzZSkgb3IgcmVqZWN0ZWQgaWYgdGhlIGN1cnNvciBkb2Vzbid0IHJldHVybiB3aXRoaW5cbiAgLy8gdGltZW91dE1TIG1zLlxuICBfbmV4dE9iamVjdFByb21pc2VXaXRoVGltZW91dDogZnVuY3Rpb24gKHRpbWVvdXRNUykge1xuICAgIGNvbnN0IHNlbGYgPSB0aGlzO1xuICAgIGlmICghdGltZW91dE1TKSB7XG4gICAgICByZXR1cm4gc2VsZi5fbmV4dE9iamVjdFByb21pc2UoKTtcbiAgICB9XG4gICAgY29uc3QgbmV4dE9iamVjdFByb21pc2UgPSBzZWxmLl9uZXh0T2JqZWN0UHJvbWlzZSgpO1xuICAgIGNvbnN0IHRpbWVvdXRFcnIgPSBuZXcgRXJyb3IoJ0NsaWVudC1zaWRlIHRpbWVvdXQgd2FpdGluZyBmb3IgbmV4dCBvYmplY3QnKTtcbiAgICBjb25zdCB0aW1lb3V0UHJvbWlzZSA9IG5ldyBQcm9taXNlKChyZXNvbHZlLCByZWplY3QpID0+IHtcbiAgICAgIGNvbnN0IHRpbWVyID0gc2V0VGltZW91dCgoKSA9PiB7XG4gICAgICAgIHJlamVjdCh0aW1lb3V0RXJyKTtcbiAgICAgIH0sIHRpbWVvdXRNUyk7XG4gICAgfSk7XG4gICAgcmV0dXJuIFByb21pc2UucmFjZShbbmV4dE9iamVjdFByb21pc2UsIHRpbWVvdXRQcm9taXNlXSlcbiAgICAgIC5jYXRjaCgoZXJyKSA9PiB7XG4gICAgICAgIGlmIChlcnIgPT09IHRpbWVvdXRFcnIpIHtcbiAgICAgICAgICBzZWxmLmNsb3NlKCk7XG4gICAgICAgIH1cbiAgICAgICAgdGhyb3cgZXJyO1xuICAgICAgfSk7XG4gIH0sXG5cbiAgX25leHRPYmplY3Q6IGZ1bmN0aW9uICgpIHtcbiAgICB2YXIgc2VsZiA9IHRoaXM7XG4gICAgcmV0dXJuIHNlbGYuX25leHRPYmplY3RQcm9taXNlKCkuYXdhaXQoKTtcbiAgfSxcblxuICBmb3JFYWNoOiBmdW5jdGlvbiAoY2FsbGJhY2ssIHRoaXNBcmcpIHtcbiAgICB2YXIgc2VsZiA9IHRoaXM7XG5cbiAgICAvLyBHZXQgYmFjayB0byB0aGUgYmVnaW5uaW5nLlxuICAgIHNlbGYuX3Jld2luZCgpO1xuXG4gICAgLy8gV2UgaW1wbGVtZW50IHRoZSBsb29wIG91cnNlbGYgaW5zdGVhZCBvZiB1c2luZyBzZWxmLl9kYkN1cnNvci5lYWNoLFxuICAgIC8vIGJlY2F1c2UgXCJlYWNoXCIgd2lsbCBjYWxsIGl0cyBjYWxsYmFjayBvdXRzaWRlIG9mIGEgZmliZXIgd2hpY2ggbWFrZXMgaXRcbiAgICAvLyBtdWNoIG1vcmUgY29tcGxleCB0byBtYWtlIHRoaXMgZnVuY3Rpb24gc3luY2hyb25vdXMuXG4gICAgdmFyIGluZGV4ID0gMDtcbiAgICB3aGlsZSAodHJ1ZSkge1xuICAgICAgdmFyIGRvYyA9IHNlbGYuX25leHRPYmplY3QoKTtcbiAgICAgIGlmICghZG9jKSByZXR1cm47XG4gICAgICBjYWxsYmFjay5jYWxsKHRoaXNBcmcsIGRvYywgaW5kZXgrKywgc2VsZi5fc2VsZkZvckl0ZXJhdGlvbik7XG4gICAgfVxuICB9LFxuXG4gIC8vIFhYWCBBbGxvdyBvdmVybGFwcGluZyBjYWxsYmFjayBleGVjdXRpb25zIGlmIGNhbGxiYWNrIHlpZWxkcy5cbiAgbWFwOiBmdW5jdGlvbiAoY2FsbGJhY2ssIHRoaXNBcmcpIHtcbiAgICB2YXIgc2VsZiA9IHRoaXM7XG4gICAgdmFyIHJlcyA9IFtdO1xuICAgIHNlbGYuZm9yRWFjaChmdW5jdGlvbiAoZG9jLCBpbmRleCkge1xuICAgICAgcmVzLnB1c2goY2FsbGJhY2suY2FsbCh0aGlzQXJnLCBkb2MsIGluZGV4LCBzZWxmLl9zZWxmRm9ySXRlcmF0aW9uKSk7XG4gICAgfSk7XG4gICAgcmV0dXJuIHJlcztcbiAgfSxcblxuICBfcmV3aW5kOiBmdW5jdGlvbiAoKSB7XG4gICAgdmFyIHNlbGYgPSB0aGlzO1xuXG4gICAgLy8ga25vd24gdG8gYmUgc3luY2hyb25vdXNcbiAgICBzZWxmLl9kYkN1cnNvci5yZXdpbmQoKTtcblxuICAgIHNlbGYuX3Zpc2l0ZWRJZHMgPSBuZXcgTG9jYWxDb2xsZWN0aW9uLl9JZE1hcDtcbiAgfSxcblxuICAvLyBNb3N0bHkgdXNhYmxlIGZvciB0YWlsYWJsZSBjdXJzb3JzLlxuICBjbG9zZTogZnVuY3Rpb24gKCkge1xuICAgIHZhciBzZWxmID0gdGhpcztcblxuICAgIHNlbGYuX2RiQ3Vyc29yLmNsb3NlKCk7XG4gIH0sXG5cbiAgZmV0Y2g6IGZ1bmN0aW9uICgpIHtcbiAgICB2YXIgc2VsZiA9IHRoaXM7XG4gICAgcmV0dXJuIHNlbGYubWFwKF8uaWRlbnRpdHkpO1xuICB9LFxuXG4gIGNvdW50OiBmdW5jdGlvbiAoKSB7XG4gICAgdmFyIHNlbGYgPSB0aGlzO1xuICAgIHJldHVybiBzZWxmLl9zeW5jaHJvbm91c0NvdW50KCkud2FpdCgpO1xuICB9LFxuXG4gIC8vIFRoaXMgbWV0aG9kIGlzIE5PVCB3cmFwcGVkIGluIEN1cnNvci5cbiAgZ2V0UmF3T2JqZWN0czogZnVuY3Rpb24gKG9yZGVyZWQpIHtcbiAgICB2YXIgc2VsZiA9IHRoaXM7XG4gICAgaWYgKG9yZGVyZWQpIHtcbiAgICAgIHJldHVybiBzZWxmLmZldGNoKCk7XG4gICAgfSBlbHNlIHtcbiAgICAgIHZhciByZXN1bHRzID0gbmV3IExvY2FsQ29sbGVjdGlvbi5fSWRNYXA7XG4gICAgICBzZWxmLmZvckVhY2goZnVuY3Rpb24gKGRvYykge1xuICAgICAgICByZXN1bHRzLnNldChkb2MuX2lkLCBkb2MpO1xuICAgICAgfSk7XG4gICAgICByZXR1cm4gcmVzdWx0cztcbiAgICB9XG4gIH1cbn0pO1xuXG5TeW5jaHJvbm91c0N1cnNvci5wcm90b3R5cGVbU3ltYm9sLml0ZXJhdG9yXSA9IGZ1bmN0aW9uICgpIHtcbiAgdmFyIHNlbGYgPSB0aGlzO1xuXG4gIC8vIEdldCBiYWNrIHRvIHRoZSBiZWdpbm5pbmcuXG4gIHNlbGYuX3Jld2luZCgpO1xuXG4gIHJldHVybiB7XG4gICAgbmV4dCgpIHtcbiAgICAgIGNvbnN0IGRvYyA9IHNlbGYuX25leHRPYmplY3QoKTtcbiAgICAgIHJldHVybiBkb2MgPyB7XG4gICAgICAgIHZhbHVlOiBkb2NcbiAgICAgIH0gOiB7XG4gICAgICAgIGRvbmU6IHRydWVcbiAgICAgIH07XG4gICAgfVxuICB9O1xufTtcblxuLy8gVGFpbHMgdGhlIGN1cnNvciBkZXNjcmliZWQgYnkgY3Vyc29yRGVzY3JpcHRpb24sIG1vc3QgbGlrZWx5IG9uIHRoZVxuLy8gb3Bsb2cuIENhbGxzIGRvY0NhbGxiYWNrIHdpdGggZWFjaCBkb2N1bWVudCBmb3VuZC4gSWdub3JlcyBlcnJvcnMgYW5kIGp1c3Rcbi8vIHJlc3RhcnRzIHRoZSB0YWlsIG9uIGVycm9yLlxuLy9cbi8vIElmIHRpbWVvdXRNUyBpcyBzZXQsIHRoZW4gaWYgd2UgZG9uJ3QgZ2V0IGEgbmV3IGRvY3VtZW50IGV2ZXJ5IHRpbWVvdXRNUyxcbi8vIGtpbGwgYW5kIHJlc3RhcnQgdGhlIGN1cnNvci4gVGhpcyBpcyBwcmltYXJpbHkgYSB3b3JrYXJvdW5kIGZvciAjODU5OC5cbk1vbmdvQ29ubmVjdGlvbi5wcm90b3R5cGUudGFpbCA9IGZ1bmN0aW9uIChjdXJzb3JEZXNjcmlwdGlvbiwgZG9jQ2FsbGJhY2ssIHRpbWVvdXRNUykge1xuICB2YXIgc2VsZiA9IHRoaXM7XG4gIGlmICghY3Vyc29yRGVzY3JpcHRpb24ub3B0aW9ucy50YWlsYWJsZSlcbiAgICB0aHJvdyBuZXcgRXJyb3IoXCJDYW4gb25seSB0YWlsIGEgdGFpbGFibGUgY3Vyc29yXCIpO1xuXG4gIHZhciBjdXJzb3IgPSBzZWxmLl9jcmVhdGVTeW5jaHJvbm91c0N1cnNvcihjdXJzb3JEZXNjcmlwdGlvbik7XG5cbiAgdmFyIHN0b3BwZWQgPSBmYWxzZTtcbiAgdmFyIGxhc3RUUztcbiAgdmFyIGxvb3AgPSBmdW5jdGlvbiAoKSB7XG4gICAgdmFyIGRvYyA9IG51bGw7XG4gICAgd2hpbGUgKHRydWUpIHtcbiAgICAgIGlmIChzdG9wcGVkKVxuICAgICAgICByZXR1cm47XG4gICAgICB0cnkge1xuICAgICAgICBkb2MgPSBjdXJzb3IuX25leHRPYmplY3RQcm9taXNlV2l0aFRpbWVvdXQodGltZW91dE1TKS5hd2FpdCgpO1xuICAgICAgfSBjYXRjaCAoZXJyKSB7XG4gICAgICAgIC8vIFRoZXJlJ3Mgbm8gZ29vZCB3YXkgdG8gZmlndXJlIG91dCBpZiB0aGlzIHdhcyBhY3R1YWxseSBhbiBlcnJvciBmcm9tXG4gICAgICAgIC8vIE1vbmdvLCBvciBqdXN0IGNsaWVudC1zaWRlIChpbmNsdWRpbmcgb3VyIG93biB0aW1lb3V0IGVycm9yKS4gQWhcbiAgICAgICAgLy8gd2VsbC4gQnV0IGVpdGhlciB3YXksIHdlIG5lZWQgdG8gcmV0cnkgdGhlIGN1cnNvciAodW5sZXNzIHRoZSBmYWlsdXJlXG4gICAgICAgIC8vIHdhcyBiZWNhdXNlIHRoZSBvYnNlcnZlIGdvdCBzdG9wcGVkKS5cbiAgICAgICAgZG9jID0gbnVsbDtcbiAgICAgIH1cbiAgICAgIC8vIFNpbmNlIHdlIGF3YWl0ZWQgYSBwcm9taXNlIGFib3ZlLCB3ZSBuZWVkIHRvIGNoZWNrIGFnYWluIHRvIHNlZSBpZlxuICAgICAgLy8gd2UndmUgYmVlbiBzdG9wcGVkIGJlZm9yZSBjYWxsaW5nIHRoZSBjYWxsYmFjay5cbiAgICAgIGlmIChzdG9wcGVkKVxuICAgICAgICByZXR1cm47XG4gICAgICBpZiAoZG9jKSB7XG4gICAgICAgIC8vIElmIGEgdGFpbGFibGUgY3Vyc29yIGNvbnRhaW5zIGEgXCJ0c1wiIGZpZWxkLCB1c2UgaXQgdG8gcmVjcmVhdGUgdGhlXG4gICAgICAgIC8vIGN1cnNvciBvbiBlcnJvci4gKFwidHNcIiBpcyBhIHN0YW5kYXJkIHRoYXQgTW9uZ28gdXNlcyBpbnRlcm5hbGx5IGZvclxuICAgICAgICAvLyB0aGUgb3Bsb2csIGFuZCB0aGVyZSdzIGEgc3BlY2lhbCBmbGFnIHRoYXQgbGV0cyB5b3UgZG8gYmluYXJ5IHNlYXJjaFxuICAgICAgICAvLyBvbiBpdCBpbnN0ZWFkIG9mIG5lZWRpbmcgdG8gdXNlIGFuIGluZGV4LilcbiAgICAgICAgbGFzdFRTID0gZG9jLnRzO1xuICAgICAgICBkb2NDYWxsYmFjayhkb2MpO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgdmFyIG5ld1NlbGVjdG9yID0gXy5jbG9uZShjdXJzb3JEZXNjcmlwdGlvbi5zZWxlY3Rvcik7XG4gICAgICAgIGlmIChsYXN0VFMpIHtcbiAgICAgICAgICBuZXdTZWxlY3Rvci50cyA9IHskZ3Q6IGxhc3RUU307XG4gICAgICAgIH1cbiAgICAgICAgY3Vyc29yID0gc2VsZi5fY3JlYXRlU3luY2hyb25vdXNDdXJzb3IobmV3IEN1cnNvckRlc2NyaXB0aW9uKFxuICAgICAgICAgIGN1cnNvckRlc2NyaXB0aW9uLmNvbGxlY3Rpb25OYW1lLFxuICAgICAgICAgIG5ld1NlbGVjdG9yLFxuICAgICAgICAgIGN1cnNvckRlc2NyaXB0aW9uLm9wdGlvbnMpKTtcbiAgICAgICAgLy8gTW9uZ28gZmFpbG92ZXIgdGFrZXMgbWFueSBzZWNvbmRzLiAgUmV0cnkgaW4gYSBiaXQuICAoV2l0aG91dCB0aGlzXG4gICAgICAgIC8vIHNldFRpbWVvdXQsIHdlIHBlZyB0aGUgQ1BVIGF0IDEwMCUgYW5kIG5ldmVyIG5vdGljZSB0aGUgYWN0dWFsXG4gICAgICAgIC8vIGZhaWxvdmVyLlxuICAgICAgICBNZXRlb3Iuc2V0VGltZW91dChsb29wLCAxMDApO1xuICAgICAgICBicmVhaztcbiAgICAgIH1cbiAgICB9XG4gIH07XG5cbiAgTWV0ZW9yLmRlZmVyKGxvb3ApO1xuXG4gIHJldHVybiB7XG4gICAgc3RvcDogZnVuY3Rpb24gKCkge1xuICAgICAgc3RvcHBlZCA9IHRydWU7XG4gICAgICBjdXJzb3IuY2xvc2UoKTtcbiAgICB9XG4gIH07XG59O1xuXG5Nb25nb0Nvbm5lY3Rpb24ucHJvdG90eXBlLl9vYnNlcnZlQ2hhbmdlcyA9IGZ1bmN0aW9uIChcbiAgICBjdXJzb3JEZXNjcmlwdGlvbiwgb3JkZXJlZCwgY2FsbGJhY2tzLCBub25NdXRhdGluZ0NhbGxiYWNrcykge1xuICB2YXIgc2VsZiA9IHRoaXM7XG5cbiAgaWYgKGN1cnNvckRlc2NyaXB0aW9uLm9wdGlvbnMudGFpbGFibGUpIHtcbiAgICByZXR1cm4gc2VsZi5fb2JzZXJ2ZUNoYW5nZXNUYWlsYWJsZShjdXJzb3JEZXNjcmlwdGlvbiwgb3JkZXJlZCwgY2FsbGJhY2tzKTtcbiAgfVxuXG4gIC8vIFlvdSBtYXkgbm90IGZpbHRlciBvdXQgX2lkIHdoZW4gb2JzZXJ2aW5nIGNoYW5nZXMsIGJlY2F1c2UgdGhlIGlkIGlzIGEgY29yZVxuICAvLyBwYXJ0IG9mIHRoZSBvYnNlcnZlQ2hhbmdlcyBBUEkuXG4gIGNvbnN0IGZpZWxkc09wdGlvbnMgPSBjdXJzb3JEZXNjcmlwdGlvbi5vcHRpb25zLnByb2plY3Rpb24gfHwgY3Vyc29yRGVzY3JpcHRpb24ub3B0aW9ucy5maWVsZHM7XG4gIGlmIChmaWVsZHNPcHRpb25zICYmXG4gICAgICAoZmllbGRzT3B0aW9ucy5faWQgPT09IDAgfHxcbiAgICAgICBmaWVsZHNPcHRpb25zLl9pZCA9PT0gZmFsc2UpKSB7XG4gICAgdGhyb3cgRXJyb3IoXCJZb3UgbWF5IG5vdCBvYnNlcnZlIGEgY3Vyc29yIHdpdGgge2ZpZWxkczoge19pZDogMH19XCIpO1xuICB9XG5cbiAgdmFyIG9ic2VydmVLZXkgPSBFSlNPTi5zdHJpbmdpZnkoXG4gICAgXy5leHRlbmQoe29yZGVyZWQ6IG9yZGVyZWR9LCBjdXJzb3JEZXNjcmlwdGlvbikpO1xuXG4gIHZhciBtdWx0aXBsZXhlciwgb2JzZXJ2ZURyaXZlcjtcbiAgdmFyIGZpcnN0SGFuZGxlID0gZmFsc2U7XG5cbiAgLy8gRmluZCBhIG1hdGNoaW5nIE9ic2VydmVNdWx0aXBsZXhlciwgb3IgY3JlYXRlIGEgbmV3IG9uZS4gVGhpcyBuZXh0IGJsb2NrIGlzXG4gIC8vIGd1YXJhbnRlZWQgdG8gbm90IHlpZWxkIChhbmQgaXQgZG9lc24ndCBjYWxsIGFueXRoaW5nIHRoYXQgY2FuIG9ic2VydmUgYVxuICAvLyBuZXcgcXVlcnkpLCBzbyBubyBvdGhlciBjYWxscyB0byB0aGlzIGZ1bmN0aW9uIGNhbiBpbnRlcmxlYXZlIHdpdGggaXQuXG4gIE1ldGVvci5fbm9ZaWVsZHNBbGxvd2VkKGZ1bmN0aW9uICgpIHtcbiAgICBpZiAoXy5oYXMoc2VsZi5fb2JzZXJ2ZU11bHRpcGxleGVycywgb2JzZXJ2ZUtleSkpIHtcbiAgICAgIG11bHRpcGxleGVyID0gc2VsZi5fb2JzZXJ2ZU11bHRpcGxleGVyc1tvYnNlcnZlS2V5XTtcbiAgICB9IGVsc2Uge1xuICAgICAgZmlyc3RIYW5kbGUgPSB0cnVlO1xuICAgICAgLy8gQ3JlYXRlIGEgbmV3IE9ic2VydmVNdWx0aXBsZXhlci5cbiAgICAgIG11bHRpcGxleGVyID0gbmV3IE9ic2VydmVNdWx0aXBsZXhlcih7XG4gICAgICAgIG9yZGVyZWQ6IG9yZGVyZWQsXG4gICAgICAgIG9uU3RvcDogZnVuY3Rpb24gKCkge1xuICAgICAgICAgIGRlbGV0ZSBzZWxmLl9vYnNlcnZlTXVsdGlwbGV4ZXJzW29ic2VydmVLZXldO1xuICAgICAgICAgIG9ic2VydmVEcml2ZXIuc3RvcCgpO1xuICAgICAgICB9XG4gICAgICB9KTtcbiAgICAgIHNlbGYuX29ic2VydmVNdWx0aXBsZXhlcnNbb2JzZXJ2ZUtleV0gPSBtdWx0aXBsZXhlcjtcbiAgICB9XG4gIH0pO1xuXG4gIHZhciBvYnNlcnZlSGFuZGxlID0gbmV3IE9ic2VydmVIYW5kbGUobXVsdGlwbGV4ZXIsXG4gICAgY2FsbGJhY2tzLFxuICAgIG5vbk11dGF0aW5nQ2FsbGJhY2tzLFxuICApO1xuXG4gIGlmIChmaXJzdEhhbmRsZSkge1xuICAgIHZhciBtYXRjaGVyLCBzb3J0ZXI7XG4gICAgdmFyIGNhblVzZU9wbG9nID0gXy5hbGwoW1xuICAgICAgZnVuY3Rpb24gKCkge1xuICAgICAgICAvLyBBdCBhIGJhcmUgbWluaW11bSwgdXNpbmcgdGhlIG9wbG9nIHJlcXVpcmVzIHVzIHRvIGhhdmUgYW4gb3Bsb2csIHRvXG4gICAgICAgIC8vIHdhbnQgdW5vcmRlcmVkIGNhbGxiYWNrcywgYW5kIHRvIG5vdCB3YW50IGEgY2FsbGJhY2sgb24gdGhlIHBvbGxzXG4gICAgICAgIC8vIHRoYXQgd29uJ3QgaGFwcGVuLlxuICAgICAgICByZXR1cm4gc2VsZi5fb3Bsb2dIYW5kbGUgJiYgIW9yZGVyZWQgJiZcbiAgICAgICAgICAhY2FsbGJhY2tzLl90ZXN0T25seVBvbGxDYWxsYmFjaztcbiAgICAgIH0sIGZ1bmN0aW9uICgpIHtcbiAgICAgICAgLy8gV2UgbmVlZCB0byBiZSBhYmxlIHRvIGNvbXBpbGUgdGhlIHNlbGVjdG9yLiBGYWxsIGJhY2sgdG8gcG9sbGluZyBmb3JcbiAgICAgICAgLy8gc29tZSBuZXdmYW5nbGVkICRzZWxlY3RvciB0aGF0IG1pbmltb25nbyBkb2Vzbid0IHN1cHBvcnQgeWV0LlxuICAgICAgICB0cnkge1xuICAgICAgICAgIG1hdGNoZXIgPSBuZXcgTWluaW1vbmdvLk1hdGNoZXIoY3Vyc29yRGVzY3JpcHRpb24uc2VsZWN0b3IpO1xuICAgICAgICAgIHJldHVybiB0cnVlO1xuICAgICAgICB9IGNhdGNoIChlKSB7XG4gICAgICAgICAgLy8gWFhYIG1ha2UgYWxsIGNvbXBpbGF0aW9uIGVycm9ycyBNaW5pbW9uZ29FcnJvciBvciBzb21ldGhpbmdcbiAgICAgICAgICAvLyAgICAgc28gdGhhdCB0aGlzIGRvZXNuJ3QgaWdub3JlIHVucmVsYXRlZCBleGNlcHRpb25zXG4gICAgICAgICAgcmV0dXJuIGZhbHNlO1xuICAgICAgICB9XG4gICAgICB9LCBmdW5jdGlvbiAoKSB7XG4gICAgICAgIC8vIC4uLiBhbmQgdGhlIHNlbGVjdG9yIGl0c2VsZiBuZWVkcyB0byBzdXBwb3J0IG9wbG9nLlxuICAgICAgICByZXR1cm4gT3Bsb2dPYnNlcnZlRHJpdmVyLmN1cnNvclN1cHBvcnRlZChjdXJzb3JEZXNjcmlwdGlvbiwgbWF0Y2hlcik7XG4gICAgICB9LCBmdW5jdGlvbiAoKSB7XG4gICAgICAgIC8vIEFuZCB3ZSBuZWVkIHRvIGJlIGFibGUgdG8gY29tcGlsZSB0aGUgc29ydCwgaWYgYW55LiAgZWcsIGNhbid0IGJlXG4gICAgICAgIC8vIHskbmF0dXJhbDogMX0uXG4gICAgICAgIGlmICghY3Vyc29yRGVzY3JpcHRpb24ub3B0aW9ucy5zb3J0KVxuICAgICAgICAgIHJldHVybiB0cnVlO1xuICAgICAgICB0cnkge1xuICAgICAgICAgIHNvcnRlciA9IG5ldyBNaW5pbW9uZ28uU29ydGVyKGN1cnNvckRlc2NyaXB0aW9uLm9wdGlvbnMuc29ydCk7XG4gICAgICAgICAgcmV0dXJuIHRydWU7XG4gICAgICAgIH0gY2F0Y2ggKGUpIHtcbiAgICAgICAgICAvLyBYWFggbWFrZSBhbGwgY29tcGlsYXRpb24gZXJyb3JzIE1pbmltb25nb0Vycm9yIG9yIHNvbWV0aGluZ1xuICAgICAgICAgIC8vICAgICBzbyB0aGF0IHRoaXMgZG9lc24ndCBpZ25vcmUgdW5yZWxhdGVkIGV4Y2VwdGlvbnNcbiAgICAgICAgICByZXR1cm4gZmFsc2U7XG4gICAgICAgIH1cbiAgICAgIH1dLCBmdW5jdGlvbiAoZikgeyByZXR1cm4gZigpOyB9KTsgIC8vIGludm9rZSBlYWNoIGZ1bmN0aW9uXG5cbiAgICB2YXIgZHJpdmVyQ2xhc3MgPSBjYW5Vc2VPcGxvZyA/IE9wbG9nT2JzZXJ2ZURyaXZlciA6IFBvbGxpbmdPYnNlcnZlRHJpdmVyO1xuICAgIG9ic2VydmVEcml2ZXIgPSBuZXcgZHJpdmVyQ2xhc3Moe1xuICAgICAgY3Vyc29yRGVzY3JpcHRpb246IGN1cnNvckRlc2NyaXB0aW9uLFxuICAgICAgbW9uZ29IYW5kbGU6IHNlbGYsXG4gICAgICBtdWx0aXBsZXhlcjogbXVsdGlwbGV4ZXIsXG4gICAgICBvcmRlcmVkOiBvcmRlcmVkLFxuICAgICAgbWF0Y2hlcjogbWF0Y2hlciwgIC8vIGlnbm9yZWQgYnkgcG9sbGluZ1xuICAgICAgc29ydGVyOiBzb3J0ZXIsICAvLyBpZ25vcmVkIGJ5IHBvbGxpbmdcbiAgICAgIF90ZXN0T25seVBvbGxDYWxsYmFjazogY2FsbGJhY2tzLl90ZXN0T25seVBvbGxDYWxsYmFja1xuICAgIH0pO1xuXG4gICAgLy8gVGhpcyBmaWVsZCBpcyBvbmx5IHNldCBmb3IgdXNlIGluIHRlc3RzLlxuICAgIG11bHRpcGxleGVyLl9vYnNlcnZlRHJpdmVyID0gb2JzZXJ2ZURyaXZlcjtcbiAgfVxuXG4gIC8vIEJsb2NrcyB1bnRpbCB0aGUgaW5pdGlhbCBhZGRzIGhhdmUgYmVlbiBzZW50LlxuICBtdWx0aXBsZXhlci5hZGRIYW5kbGVBbmRTZW5kSW5pdGlhbEFkZHMob2JzZXJ2ZUhhbmRsZSk7XG5cbiAgcmV0dXJuIG9ic2VydmVIYW5kbGU7XG59O1xuXG4vLyBMaXN0ZW4gZm9yIHRoZSBpbnZhbGlkYXRpb24gbWVzc2FnZXMgdGhhdCB3aWxsIHRyaWdnZXIgdXMgdG8gcG9sbCB0aGVcbi8vIGRhdGFiYXNlIGZvciBjaGFuZ2VzLiBJZiB0aGlzIHNlbGVjdG9yIHNwZWNpZmllcyBzcGVjaWZpYyBJRHMsIHNwZWNpZnkgdGhlbVxuLy8gaGVyZSwgc28gdGhhdCB1cGRhdGVzIHRvIGRpZmZlcmVudCBzcGVjaWZpYyBJRHMgZG9uJ3QgY2F1c2UgdXMgdG8gcG9sbC5cbi8vIGxpc3RlbkNhbGxiYWNrIGlzIHRoZSBzYW1lIGtpbmQgb2YgKG5vdGlmaWNhdGlvbiwgY29tcGxldGUpIGNhbGxiYWNrIHBhc3NlZFxuLy8gdG8gSW52YWxpZGF0aW9uQ3Jvc3NiYXIubGlzdGVuLlxuXG5saXN0ZW5BbGwgPSBmdW5jdGlvbiAoY3Vyc29yRGVzY3JpcHRpb24sIGxpc3RlbkNhbGxiYWNrKSB7XG4gIHZhciBsaXN0ZW5lcnMgPSBbXTtcbiAgZm9yRWFjaFRyaWdnZXIoY3Vyc29yRGVzY3JpcHRpb24sIGZ1bmN0aW9uICh0cmlnZ2VyKSB7XG4gICAgbGlzdGVuZXJzLnB1c2goRERQU2VydmVyLl9JbnZhbGlkYXRpb25Dcm9zc2Jhci5saXN0ZW4oXG4gICAgICB0cmlnZ2VyLCBsaXN0ZW5DYWxsYmFjaykpO1xuICB9KTtcblxuICByZXR1cm4ge1xuICAgIHN0b3A6IGZ1bmN0aW9uICgpIHtcbiAgICAgIF8uZWFjaChsaXN0ZW5lcnMsIGZ1bmN0aW9uIChsaXN0ZW5lcikge1xuICAgICAgICBsaXN0ZW5lci5zdG9wKCk7XG4gICAgICB9KTtcbiAgICB9XG4gIH07XG59O1xuXG5mb3JFYWNoVHJpZ2dlciA9IGZ1bmN0aW9uIChjdXJzb3JEZXNjcmlwdGlvbiwgdHJpZ2dlckNhbGxiYWNrKSB7XG4gIHZhciBrZXkgPSB7Y29sbGVjdGlvbjogY3Vyc29yRGVzY3JpcHRpb24uY29sbGVjdGlvbk5hbWV9O1xuICB2YXIgc3BlY2lmaWNJZHMgPSBMb2NhbENvbGxlY3Rpb24uX2lkc01hdGNoZWRCeVNlbGVjdG9yKFxuICAgIGN1cnNvckRlc2NyaXB0aW9uLnNlbGVjdG9yKTtcbiAgaWYgKHNwZWNpZmljSWRzKSB7XG4gICAgXy5lYWNoKHNwZWNpZmljSWRzLCBmdW5jdGlvbiAoaWQpIHtcbiAgICAgIHRyaWdnZXJDYWxsYmFjayhfLmV4dGVuZCh7aWQ6IGlkfSwga2V5KSk7XG4gICAgfSk7XG4gICAgdHJpZ2dlckNhbGxiYWNrKF8uZXh0ZW5kKHtkcm9wQ29sbGVjdGlvbjogdHJ1ZSwgaWQ6IG51bGx9LCBrZXkpKTtcbiAgfSBlbHNlIHtcbiAgICB0cmlnZ2VyQ2FsbGJhY2soa2V5KTtcbiAgfVxuICAvLyBFdmVyeW9uZSBjYXJlcyBhYm91dCB0aGUgZGF0YWJhc2UgYmVpbmcgZHJvcHBlZC5cbiAgdHJpZ2dlckNhbGxiYWNrKHsgZHJvcERhdGFiYXNlOiB0cnVlIH0pO1xufTtcblxuLy8gb2JzZXJ2ZUNoYW5nZXMgZm9yIHRhaWxhYmxlIGN1cnNvcnMgb24gY2FwcGVkIGNvbGxlY3Rpb25zLlxuLy9cbi8vIFNvbWUgZGlmZmVyZW5jZXMgZnJvbSBub3JtYWwgY3Vyc29yczpcbi8vICAgLSBXaWxsIG5ldmVyIHByb2R1Y2UgYW55dGhpbmcgb3RoZXIgdGhhbiAnYWRkZWQnIG9yICdhZGRlZEJlZm9yZScuIElmIHlvdVxuLy8gICAgIGRvIHVwZGF0ZSBhIGRvY3VtZW50IHRoYXQgaGFzIGFscmVhZHkgYmVlbiBwcm9kdWNlZCwgdGhpcyB3aWxsIG5vdCBub3RpY2Vcbi8vICAgICBpdC5cbi8vICAgLSBJZiB5b3UgZGlzY29ubmVjdCBhbmQgcmVjb25uZWN0IGZyb20gTW9uZ28sIGl0IHdpbGwgZXNzZW50aWFsbHkgcmVzdGFydFxuLy8gICAgIHRoZSBxdWVyeSwgd2hpY2ggd2lsbCBsZWFkIHRvIGR1cGxpY2F0ZSByZXN1bHRzLiBUaGlzIGlzIHByZXR0eSBiYWQsXG4vLyAgICAgYnV0IGlmIHlvdSBpbmNsdWRlIGEgZmllbGQgY2FsbGVkICd0cycgd2hpY2ggaXMgaW5zZXJ0ZWQgYXNcbi8vICAgICBuZXcgTW9uZ29JbnRlcm5hbHMuTW9uZ29UaW1lc3RhbXAoMCwgMCkgKHdoaWNoIGlzIGluaXRpYWxpemVkIHRvIHRoZVxuLy8gICAgIGN1cnJlbnQgTW9uZ28tc3R5bGUgdGltZXN0YW1wKSwgd2UnbGwgYmUgYWJsZSB0byBmaW5kIHRoZSBwbGFjZSB0b1xuLy8gICAgIHJlc3RhcnQgcHJvcGVybHkuIChUaGlzIGZpZWxkIGlzIHNwZWNpZmljYWxseSB1bmRlcnN0b29kIGJ5IE1vbmdvIHdpdGggYW5cbi8vICAgICBvcHRpbWl6YXRpb24gd2hpY2ggYWxsb3dzIGl0IHRvIGZpbmQgdGhlIHJpZ2h0IHBsYWNlIHRvIHN0YXJ0IHdpdGhvdXRcbi8vICAgICBhbiBpbmRleCBvbiB0cy4gSXQncyBob3cgdGhlIG9wbG9nIHdvcmtzLilcbi8vICAgLSBObyBjYWxsYmFja3MgYXJlIHRyaWdnZXJlZCBzeW5jaHJvbm91c2x5IHdpdGggdGhlIGNhbGwgKHRoZXJlJ3Mgbm9cbi8vICAgICBkaWZmZXJlbnRpYXRpb24gYmV0d2VlbiBcImluaXRpYWwgZGF0YVwiIGFuZCBcImxhdGVyIGNoYW5nZXNcIjsgZXZlcnl0aGluZ1xuLy8gICAgIHRoYXQgbWF0Y2hlcyB0aGUgcXVlcnkgZ2V0cyBzZW50IGFzeW5jaHJvbm91c2x5KS5cbi8vICAgLSBEZS1kdXBsaWNhdGlvbiBpcyBub3QgaW1wbGVtZW50ZWQuXG4vLyAgIC0gRG9lcyBub3QgeWV0IGludGVyYWN0IHdpdGggdGhlIHdyaXRlIGZlbmNlLiBQcm9iYWJseSwgdGhpcyBzaG91bGQgd29yayBieVxuLy8gICAgIGlnbm9yaW5nIHJlbW92ZXMgKHdoaWNoIGRvbid0IHdvcmsgb24gY2FwcGVkIGNvbGxlY3Rpb25zKSBhbmQgdXBkYXRlc1xuLy8gICAgICh3aGljaCBkb24ndCBhZmZlY3QgdGFpbGFibGUgY3Vyc29ycyksIGFuZCBqdXN0IGtlZXBpbmcgdHJhY2sgb2YgdGhlIElEXG4vLyAgICAgb2YgdGhlIGluc2VydGVkIG9iamVjdCwgYW5kIGNsb3NpbmcgdGhlIHdyaXRlIGZlbmNlIG9uY2UgeW91IGdldCB0byB0aGF0XG4vLyAgICAgSUQgKG9yIHRpbWVzdGFtcD8pLiAgVGhpcyBkb2Vzbid0IHdvcmsgd2VsbCBpZiB0aGUgZG9jdW1lbnQgZG9lc24ndCBtYXRjaFxuLy8gICAgIHRoZSBxdWVyeSwgdGhvdWdoLiAgT24gdGhlIG90aGVyIGhhbmQsIHRoZSB3cml0ZSBmZW5jZSBjYW4gY2xvc2Vcbi8vICAgICBpbW1lZGlhdGVseSBpZiBpdCBkb2VzIG5vdCBtYXRjaCB0aGUgcXVlcnkuIFNvIGlmIHdlIHRydXN0IG1pbmltb25nb1xuLy8gICAgIGVub3VnaCB0byBhY2N1cmF0ZWx5IGV2YWx1YXRlIHRoZSBxdWVyeSBhZ2FpbnN0IHRoZSB3cml0ZSBmZW5jZSwgd2Vcbi8vICAgICBzaG91bGQgYmUgYWJsZSB0byBkbyB0aGlzLi4uICBPZiBjb3Vyc2UsIG1pbmltb25nbyBkb2Vzbid0IGV2ZW4gc3VwcG9ydFxuLy8gICAgIE1vbmdvIFRpbWVzdGFtcHMgeWV0LlxuTW9uZ29Db25uZWN0aW9uLnByb3RvdHlwZS5fb2JzZXJ2ZUNoYW5nZXNUYWlsYWJsZSA9IGZ1bmN0aW9uIChcbiAgICBjdXJzb3JEZXNjcmlwdGlvbiwgb3JkZXJlZCwgY2FsbGJhY2tzKSB7XG4gIHZhciBzZWxmID0gdGhpcztcblxuICAvLyBUYWlsYWJsZSBjdXJzb3JzIG9ubHkgZXZlciBjYWxsIGFkZGVkL2FkZGVkQmVmb3JlIGNhbGxiYWNrcywgc28gaXQncyBhblxuICAvLyBlcnJvciBpZiB5b3UgZGlkbid0IHByb3ZpZGUgdGhlbS5cbiAgaWYgKChvcmRlcmVkICYmICFjYWxsYmFja3MuYWRkZWRCZWZvcmUpIHx8XG4gICAgICAoIW9yZGVyZWQgJiYgIWNhbGxiYWNrcy5hZGRlZCkpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoXCJDYW4ndCBvYnNlcnZlIGFuIFwiICsgKG9yZGVyZWQgPyBcIm9yZGVyZWRcIiA6IFwidW5vcmRlcmVkXCIpXG4gICAgICAgICAgICAgICAgICAgICsgXCIgdGFpbGFibGUgY3Vyc29yIHdpdGhvdXQgYSBcIlxuICAgICAgICAgICAgICAgICAgICArIChvcmRlcmVkID8gXCJhZGRlZEJlZm9yZVwiIDogXCJhZGRlZFwiKSArIFwiIGNhbGxiYWNrXCIpO1xuICB9XG5cbiAgcmV0dXJuIHNlbGYudGFpbChjdXJzb3JEZXNjcmlwdGlvbiwgZnVuY3Rpb24gKGRvYykge1xuICAgIHZhciBpZCA9IGRvYy5faWQ7XG4gICAgZGVsZXRlIGRvYy5faWQ7XG4gICAgLy8gVGhlIHRzIGlzIGFuIGltcGxlbWVudGF0aW9uIGRldGFpbC4gSGlkZSBpdC5cbiAgICBkZWxldGUgZG9jLnRzO1xuICAgIGlmIChvcmRlcmVkKSB7XG4gICAgICBjYWxsYmFja3MuYWRkZWRCZWZvcmUoaWQsIGRvYywgbnVsbCk7XG4gICAgfSBlbHNlIHtcbiAgICAgIGNhbGxiYWNrcy5hZGRlZChpZCwgZG9jKTtcbiAgICB9XG4gIH0pO1xufTtcblxuLy8gWFhYIFdlIHByb2JhYmx5IG5lZWQgdG8gZmluZCBhIGJldHRlciB3YXkgdG8gZXhwb3NlIHRoaXMuIFJpZ2h0IG5vd1xuLy8gaXQncyBvbmx5IHVzZWQgYnkgdGVzdHMsIGJ1dCBpbiBmYWN0IHlvdSBuZWVkIGl0IGluIG5vcm1hbFxuLy8gb3BlcmF0aW9uIHRvIGludGVyYWN0IHdpdGggY2FwcGVkIGNvbGxlY3Rpb25zLlxuTW9uZ29JbnRlcm5hbHMuTW9uZ29UaW1lc3RhbXAgPSBNb25nb0RCLlRpbWVzdGFtcDtcblxuTW9uZ29JbnRlcm5hbHMuQ29ubmVjdGlvbiA9IE1vbmdvQ29ubmVjdGlvbjtcbiIsInZhciBGdXR1cmUgPSBOcG0ucmVxdWlyZSgnZmliZXJzL2Z1dHVyZScpO1xuXG5pbXBvcnQgeyBOcG1Nb2R1bGVNb25nb2RiIH0gZnJvbSBcIm1ldGVvci9ucG0tbW9uZ29cIjtcbmNvbnN0IHsgTG9uZyB9ID0gTnBtTW9kdWxlTW9uZ29kYjtcblxuT1BMT0dfQ09MTEVDVElPTiA9ICdvcGxvZy5ycyc7XG5cbnZhciBUT09fRkFSX0JFSElORCA9IHByb2Nlc3MuZW52Lk1FVEVPUl9PUExPR19UT09fRkFSX0JFSElORCB8fCAyMDAwO1xudmFyIFRBSUxfVElNRU9VVCA9ICtwcm9jZXNzLmVudi5NRVRFT1JfT1BMT0dfVEFJTF9USU1FT1VUIHx8IDMwMDAwO1xuXG52YXIgc2hvd1RTID0gZnVuY3Rpb24gKHRzKSB7XG4gIHJldHVybiBcIlRpbWVzdGFtcChcIiArIHRzLmdldEhpZ2hCaXRzKCkgKyBcIiwgXCIgKyB0cy5nZXRMb3dCaXRzKCkgKyBcIilcIjtcbn07XG5cbmlkRm9yT3AgPSBmdW5jdGlvbiAob3ApIHtcbiAgaWYgKG9wLm9wID09PSAnZCcpXG4gICAgcmV0dXJuIG9wLm8uX2lkO1xuICBlbHNlIGlmIChvcC5vcCA9PT0gJ2knKVxuICAgIHJldHVybiBvcC5vLl9pZDtcbiAgZWxzZSBpZiAob3Aub3AgPT09ICd1JylcbiAgICByZXR1cm4gb3AubzIuX2lkO1xuICBlbHNlIGlmIChvcC5vcCA9PT0gJ2MnKVxuICAgIHRocm93IEVycm9yKFwiT3BlcmF0b3IgJ2MnIGRvZXNuJ3Qgc3VwcGx5IGFuIG9iamVjdCB3aXRoIGlkOiBcIiArXG4gICAgICAgICAgICAgICAgRUpTT04uc3RyaW5naWZ5KG9wKSk7XG4gIGVsc2VcbiAgICB0aHJvdyBFcnJvcihcIlVua25vd24gb3A6IFwiICsgRUpTT04uc3RyaW5naWZ5KG9wKSk7XG59O1xuXG5PcGxvZ0hhbmRsZSA9IGZ1bmN0aW9uIChvcGxvZ1VybCwgZGJOYW1lKSB7XG4gIHZhciBzZWxmID0gdGhpcztcbiAgc2VsZi5fb3Bsb2dVcmwgPSBvcGxvZ1VybDtcbiAgc2VsZi5fZGJOYW1lID0gZGJOYW1lO1xuXG4gIHNlbGYuX29wbG9nTGFzdEVudHJ5Q29ubmVjdGlvbiA9IG51bGw7XG4gIHNlbGYuX29wbG9nVGFpbENvbm5lY3Rpb24gPSBudWxsO1xuICBzZWxmLl9zdG9wcGVkID0gZmFsc2U7XG4gIHNlbGYuX3RhaWxIYW5kbGUgPSBudWxsO1xuICBzZWxmLl9yZWFkeUZ1dHVyZSA9IG5ldyBGdXR1cmUoKTtcbiAgc2VsZi5fY3Jvc3NiYXIgPSBuZXcgRERQU2VydmVyLl9Dcm9zc2Jhcih7XG4gICAgZmFjdFBhY2thZ2U6IFwibW9uZ28tbGl2ZWRhdGFcIiwgZmFjdE5hbWU6IFwib3Bsb2ctd2F0Y2hlcnNcIlxuICB9KTtcbiAgc2VsZi5fYmFzZU9wbG9nU2VsZWN0b3IgPSB7XG4gICAgbnM6IG5ldyBSZWdFeHAoXCJeKD86XCIgKyBbXG4gICAgICBNZXRlb3IuX2VzY2FwZVJlZ0V4cChzZWxmLl9kYk5hbWUgKyBcIi5cIiksXG4gICAgICBNZXRlb3IuX2VzY2FwZVJlZ0V4cChcImFkbWluLiRjbWRcIiksXG4gICAgXS5qb2luKFwifFwiKSArIFwiKVwiKSxcblxuICAgICRvcjogW1xuICAgICAgeyBvcDogeyAkaW46IFsnaScsICd1JywgJ2QnXSB9IH0sXG4gICAgICAvLyBkcm9wIGNvbGxlY3Rpb25cbiAgICAgIHsgb3A6ICdjJywgJ28uZHJvcCc6IHsgJGV4aXN0czogdHJ1ZSB9IH0sXG4gICAgICB7IG9wOiAnYycsICdvLmRyb3BEYXRhYmFzZSc6IDEgfSxcbiAgICAgIHsgb3A6ICdjJywgJ28uYXBwbHlPcHMnOiB7ICRleGlzdHM6IHRydWUgfSB9LFxuICAgIF1cbiAgfTtcblxuICAvLyBEYXRhIHN0cnVjdHVyZXMgdG8gc3VwcG9ydCB3YWl0VW50aWxDYXVnaHRVcCgpLiBFYWNoIG9wbG9nIGVudHJ5IGhhcyBhXG4gIC8vIE1vbmdvVGltZXN0YW1wIG9iamVjdCBvbiBpdCAod2hpY2ggaXMgbm90IHRoZSBzYW1lIGFzIGEgRGF0ZSAtLS0gaXQncyBhXG4gIC8vIGNvbWJpbmF0aW9uIG9mIHRpbWUgYW5kIGFuIGluY3JlbWVudGluZyBjb3VudGVyOyBzZWVcbiAgLy8gaHR0cDovL2RvY3MubW9uZ29kYi5vcmcvbWFudWFsL3JlZmVyZW5jZS9ic29uLXR5cGVzLyN0aW1lc3RhbXBzKS5cbiAgLy9cbiAgLy8gX2NhdGNoaW5nVXBGdXR1cmVzIGlzIGFuIGFycmF5IG9mIHt0czogTW9uZ29UaW1lc3RhbXAsIGZ1dHVyZTogRnV0dXJlfVxuICAvLyBvYmplY3RzLCBzb3J0ZWQgYnkgYXNjZW5kaW5nIHRpbWVzdGFtcC4gX2xhc3RQcm9jZXNzZWRUUyBpcyB0aGVcbiAgLy8gTW9uZ29UaW1lc3RhbXAgb2YgdGhlIGxhc3Qgb3Bsb2cgZW50cnkgd2UndmUgcHJvY2Vzc2VkLlxuICAvL1xuICAvLyBFYWNoIHRpbWUgd2UgY2FsbCB3YWl0VW50aWxDYXVnaHRVcCwgd2UgdGFrZSBhIHBlZWsgYXQgdGhlIGZpbmFsIG9wbG9nXG4gIC8vIGVudHJ5IGluIHRoZSBkYi4gIElmIHdlJ3ZlIGFscmVhZHkgcHJvY2Vzc2VkIGl0IChpZSwgaXQgaXMgbm90IGdyZWF0ZXIgdGhhblxuICAvLyBfbGFzdFByb2Nlc3NlZFRTKSwgd2FpdFVudGlsQ2F1Z2h0VXAgaW1tZWRpYXRlbHkgcmV0dXJucy4gT3RoZXJ3aXNlLFxuICAvLyB3YWl0VW50aWxDYXVnaHRVcCBtYWtlcyBhIG5ldyBGdXR1cmUgYW5kIGluc2VydHMgaXQgYWxvbmcgd2l0aCB0aGUgZmluYWxcbiAgLy8gdGltZXN0YW1wIGVudHJ5IHRoYXQgaXQgcmVhZCwgaW50byBfY2F0Y2hpbmdVcEZ1dHVyZXMuIHdhaXRVbnRpbENhdWdodFVwXG4gIC8vIHRoZW4gd2FpdHMgb24gdGhhdCBmdXR1cmUsIHdoaWNoIGlzIHJlc29sdmVkIG9uY2UgX2xhc3RQcm9jZXNzZWRUUyBpc1xuICAvLyBpbmNyZW1lbnRlZCB0byBiZSBwYXN0IGl0cyB0aW1lc3RhbXAgYnkgdGhlIHdvcmtlciBmaWJlci5cbiAgLy9cbiAgLy8gWFhYIHVzZSBhIHByaW9yaXR5IHF1ZXVlIG9yIHNvbWV0aGluZyBlbHNlIHRoYXQncyBmYXN0ZXIgdGhhbiBhbiBhcnJheVxuICBzZWxmLl9jYXRjaGluZ1VwRnV0dXJlcyA9IFtdO1xuICBzZWxmLl9sYXN0UHJvY2Vzc2VkVFMgPSBudWxsO1xuXG4gIHNlbGYuX29uU2tpcHBlZEVudHJpZXNIb29rID0gbmV3IEhvb2soe1xuICAgIGRlYnVnUHJpbnRFeGNlcHRpb25zOiBcIm9uU2tpcHBlZEVudHJpZXMgY2FsbGJhY2tcIlxuICB9KTtcblxuICBzZWxmLl9lbnRyeVF1ZXVlID0gbmV3IE1ldGVvci5fRG91YmxlRW5kZWRRdWV1ZSgpO1xuICBzZWxmLl93b3JrZXJBY3RpdmUgPSBmYWxzZTtcblxuICBzZWxmLl9zdGFydFRhaWxpbmcoKTtcbn07XG5cbk9iamVjdC5hc3NpZ24oT3Bsb2dIYW5kbGUucHJvdG90eXBlLCB7XG4gIHN0b3A6IGZ1bmN0aW9uICgpIHtcbiAgICB2YXIgc2VsZiA9IHRoaXM7XG4gICAgaWYgKHNlbGYuX3N0b3BwZWQpXG4gICAgICByZXR1cm47XG4gICAgc2VsZi5fc3RvcHBlZCA9IHRydWU7XG4gICAgaWYgKHNlbGYuX3RhaWxIYW5kbGUpXG4gICAgICBzZWxmLl90YWlsSGFuZGxlLnN0b3AoKTtcbiAgICAvLyBYWFggc2hvdWxkIGNsb3NlIGNvbm5lY3Rpb25zIHRvb1xuICB9LFxuICBvbk9wbG9nRW50cnk6IGZ1bmN0aW9uICh0cmlnZ2VyLCBjYWxsYmFjaykge1xuICAgIHZhciBzZWxmID0gdGhpcztcbiAgICBpZiAoc2VsZi5fc3RvcHBlZClcbiAgICAgIHRocm93IG5ldyBFcnJvcihcIkNhbGxlZCBvbk9wbG9nRW50cnkgb24gc3RvcHBlZCBoYW5kbGUhXCIpO1xuXG4gICAgLy8gQ2FsbGluZyBvbk9wbG9nRW50cnkgcmVxdWlyZXMgdXMgdG8gd2FpdCBmb3IgdGhlIHRhaWxpbmcgdG8gYmUgcmVhZHkuXG4gICAgc2VsZi5fcmVhZHlGdXR1cmUud2FpdCgpO1xuXG4gICAgdmFyIG9yaWdpbmFsQ2FsbGJhY2sgPSBjYWxsYmFjaztcbiAgICBjYWxsYmFjayA9IE1ldGVvci5iaW5kRW52aXJvbm1lbnQoZnVuY3Rpb24gKG5vdGlmaWNhdGlvbikge1xuICAgICAgb3JpZ2luYWxDYWxsYmFjayhub3RpZmljYXRpb24pO1xuICAgIH0sIGZ1bmN0aW9uIChlcnIpIHtcbiAgICAgIE1ldGVvci5fZGVidWcoXCJFcnJvciBpbiBvcGxvZyBjYWxsYmFja1wiLCBlcnIpO1xuICAgIH0pO1xuICAgIHZhciBsaXN0ZW5IYW5kbGUgPSBzZWxmLl9jcm9zc2Jhci5saXN0ZW4odHJpZ2dlciwgY2FsbGJhY2spO1xuICAgIHJldHVybiB7XG4gICAgICBzdG9wOiBmdW5jdGlvbiAoKSB7XG4gICAgICAgIGxpc3RlbkhhbmRsZS5zdG9wKCk7XG4gICAgICB9XG4gICAgfTtcbiAgfSxcbiAgLy8gUmVnaXN0ZXIgYSBjYWxsYmFjayB0byBiZSBpbnZva2VkIGFueSB0aW1lIHdlIHNraXAgb3Bsb2cgZW50cmllcyAoZWcsXG4gIC8vIGJlY2F1c2Ugd2UgYXJlIHRvbyBmYXIgYmVoaW5kKS5cbiAgb25Ta2lwcGVkRW50cmllczogZnVuY3Rpb24gKGNhbGxiYWNrKSB7XG4gICAgdmFyIHNlbGYgPSB0aGlzO1xuICAgIGlmIChzZWxmLl9zdG9wcGVkKVxuICAgICAgdGhyb3cgbmV3IEVycm9yKFwiQ2FsbGVkIG9uU2tpcHBlZEVudHJpZXMgb24gc3RvcHBlZCBoYW5kbGUhXCIpO1xuICAgIHJldHVybiBzZWxmLl9vblNraXBwZWRFbnRyaWVzSG9vay5yZWdpc3RlcihjYWxsYmFjayk7XG4gIH0sXG4gIC8vIENhbGxzIGBjYWxsYmFja2Agb25jZSB0aGUgb3Bsb2cgaGFzIGJlZW4gcHJvY2Vzc2VkIHVwIHRvIGEgcG9pbnQgdGhhdCBpc1xuICAvLyByb3VnaGx5IFwibm93XCI6IHNwZWNpZmljYWxseSwgb25jZSB3ZSd2ZSBwcm9jZXNzZWQgYWxsIG9wcyB0aGF0IGFyZVxuICAvLyBjdXJyZW50bHkgdmlzaWJsZS5cbiAgLy8gWFhYIGJlY29tZSBjb252aW5jZWQgdGhhdCB0aGlzIGlzIGFjdHVhbGx5IHNhZmUgZXZlbiBpZiBvcGxvZ0Nvbm5lY3Rpb25cbiAgLy8gaXMgc29tZSBraW5kIG9mIHBvb2xcbiAgd2FpdFVudGlsQ2F1Z2h0VXA6IGZ1bmN0aW9uICgpIHtcbiAgICB2YXIgc2VsZiA9IHRoaXM7XG4gICAgaWYgKHNlbGYuX3N0b3BwZWQpXG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXCJDYWxsZWQgd2FpdFVudGlsQ2F1Z2h0VXAgb24gc3RvcHBlZCBoYW5kbGUhXCIpO1xuXG4gICAgLy8gQ2FsbGluZyB3YWl0VW50aWxDYXVnaHRVcCByZXF1cmllcyB1cyB0byB3YWl0IGZvciB0aGUgb3Bsb2cgY29ubmVjdGlvbiB0b1xuICAgIC8vIGJlIHJlYWR5LlxuICAgIHNlbGYuX3JlYWR5RnV0dXJlLndhaXQoKTtcbiAgICB2YXIgbGFzdEVudHJ5O1xuXG4gICAgd2hpbGUgKCFzZWxmLl9zdG9wcGVkKSB7XG4gICAgICAvLyBXZSBuZWVkIHRvIG1ha2UgdGhlIHNlbGVjdG9yIGF0IGxlYXN0IGFzIHJlc3RyaWN0aXZlIGFzIHRoZSBhY3R1YWxcbiAgICAgIC8vIHRhaWxpbmcgc2VsZWN0b3IgKGllLCB3ZSBuZWVkIHRvIHNwZWNpZnkgdGhlIERCIG5hbWUpIG9yIGVsc2Ugd2UgbWlnaHRcbiAgICAgIC8vIGZpbmQgYSBUUyB0aGF0IHdvbid0IHNob3cgdXAgaW4gdGhlIGFjdHVhbCB0YWlsIHN0cmVhbS5cbiAgICAgIHRyeSB7XG4gICAgICAgIGxhc3RFbnRyeSA9IHNlbGYuX29wbG9nTGFzdEVudHJ5Q29ubmVjdGlvbi5maW5kT25lKFxuICAgICAgICAgIE9QTE9HX0NPTExFQ1RJT04sIHNlbGYuX2Jhc2VPcGxvZ1NlbGVjdG9yLFxuICAgICAgICAgIHtmaWVsZHM6IHt0czogMX0sIHNvcnQ6IHskbmF0dXJhbDogLTF9fSk7XG4gICAgICAgIGJyZWFrO1xuICAgICAgfSBjYXRjaCAoZSkge1xuICAgICAgICAvLyBEdXJpbmcgZmFpbG92ZXIgKGVnKSBpZiB3ZSBnZXQgYW4gZXhjZXB0aW9uIHdlIHNob3VsZCBsb2cgYW5kIHJldHJ5XG4gICAgICAgIC8vIGluc3RlYWQgb2YgY3Jhc2hpbmcuXG4gICAgICAgIE1ldGVvci5fZGVidWcoXCJHb3QgZXhjZXB0aW9uIHdoaWxlIHJlYWRpbmcgbGFzdCBlbnRyeVwiLCBlKTtcbiAgICAgICAgTWV0ZW9yLl9zbGVlcEZvck1zKDEwMCk7XG4gICAgICB9XG4gICAgfVxuXG4gICAgaWYgKHNlbGYuX3N0b3BwZWQpXG4gICAgICByZXR1cm47XG5cbiAgICBpZiAoIWxhc3RFbnRyeSkge1xuICAgICAgLy8gUmVhbGx5LCBub3RoaW5nIGluIHRoZSBvcGxvZz8gV2VsbCwgd2UndmUgcHJvY2Vzc2VkIGV2ZXJ5dGhpbmcuXG4gICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgdmFyIHRzID0gbGFzdEVudHJ5LnRzO1xuICAgIGlmICghdHMpXG4gICAgICB0aHJvdyBFcnJvcihcIm9wbG9nIGVudHJ5IHdpdGhvdXQgdHM6IFwiICsgRUpTT04uc3RyaW5naWZ5KGxhc3RFbnRyeSkpO1xuXG4gICAgaWYgKHNlbGYuX2xhc3RQcm9jZXNzZWRUUyAmJiB0cy5sZXNzVGhhbk9yRXF1YWwoc2VsZi5fbGFzdFByb2Nlc3NlZFRTKSkge1xuICAgICAgLy8gV2UndmUgYWxyZWFkeSBjYXVnaHQgdXAgdG8gaGVyZS5cbiAgICAgIHJldHVybjtcbiAgICB9XG5cblxuICAgIC8vIEluc2VydCB0aGUgZnV0dXJlIGludG8gb3VyIGxpc3QuIEFsbW9zdCBhbHdheXMsIHRoaXMgd2lsbCBiZSBhdCB0aGUgZW5kLFxuICAgIC8vIGJ1dCBpdCdzIGNvbmNlaXZhYmxlIHRoYXQgaWYgd2UgZmFpbCBvdmVyIGZyb20gb25lIHByaW1hcnkgdG8gYW5vdGhlcixcbiAgICAvLyB0aGUgb3Bsb2cgZW50cmllcyB3ZSBzZWUgd2lsbCBnbyBiYWNrd2FyZHMuXG4gICAgdmFyIGluc2VydEFmdGVyID0gc2VsZi5fY2F0Y2hpbmdVcEZ1dHVyZXMubGVuZ3RoO1xuICAgIHdoaWxlIChpbnNlcnRBZnRlciAtIDEgPiAwICYmIHNlbGYuX2NhdGNoaW5nVXBGdXR1cmVzW2luc2VydEFmdGVyIC0gMV0udHMuZ3JlYXRlclRoYW4odHMpKSB7XG4gICAgICBpbnNlcnRBZnRlci0tO1xuICAgIH1cbiAgICB2YXIgZiA9IG5ldyBGdXR1cmU7XG4gICAgc2VsZi5fY2F0Y2hpbmdVcEZ1dHVyZXMuc3BsaWNlKGluc2VydEFmdGVyLCAwLCB7dHM6IHRzLCBmdXR1cmU6IGZ9KTtcbiAgICBmLndhaXQoKTtcbiAgfSxcbiAgX3N0YXJ0VGFpbGluZzogZnVuY3Rpb24gKCkge1xuICAgIHZhciBzZWxmID0gdGhpcztcbiAgICAvLyBGaXJzdCwgbWFrZSBzdXJlIHRoYXQgd2UncmUgdGFsa2luZyB0byB0aGUgbG9jYWwgZGF0YWJhc2UuXG4gICAgdmFyIG1vbmdvZGJVcmkgPSBOcG0ucmVxdWlyZSgnbW9uZ29kYi11cmknKTtcbiAgICBpZiAobW9uZ29kYlVyaS5wYXJzZShzZWxmLl9vcGxvZ1VybCkuZGF0YWJhc2UgIT09ICdsb2NhbCcpIHtcbiAgICAgIHRocm93IEVycm9yKFwiJE1PTkdPX09QTE9HX1VSTCBtdXN0IGJlIHNldCB0byB0aGUgJ2xvY2FsJyBkYXRhYmFzZSBvZiBcIiArXG4gICAgICAgICAgICAgICAgICBcImEgTW9uZ28gcmVwbGljYSBzZXRcIik7XG4gICAgfVxuXG4gICAgLy8gV2UgbWFrZSB0d28gc2VwYXJhdGUgY29ubmVjdGlvbnMgdG8gTW9uZ28uIFRoZSBOb2RlIE1vbmdvIGRyaXZlclxuICAgIC8vIGltcGxlbWVudHMgYSBuYWl2ZSByb3VuZC1yb2JpbiBjb25uZWN0aW9uIHBvb2w6IGVhY2ggXCJjb25uZWN0aW9uXCIgaXMgYVxuICAgIC8vIHBvb2wgb2Ygc2V2ZXJhbCAoNSBieSBkZWZhdWx0KSBUQ1AgY29ubmVjdGlvbnMsIGFuZCBlYWNoIHJlcXVlc3QgaXNcbiAgICAvLyByb3RhdGVkIHRocm91Z2ggdGhlIHBvb2xzLiBUYWlsYWJsZSBjdXJzb3IgcXVlcmllcyBibG9jayBvbiB0aGUgc2VydmVyXG4gICAgLy8gdW50aWwgdGhlcmUgaXMgc29tZSBkYXRhIHRvIHJldHVybiAob3IgdW50aWwgYSBmZXcgc2Vjb25kcyBoYXZlXG4gICAgLy8gcGFzc2VkKS4gU28gaWYgdGhlIGNvbm5lY3Rpb24gcG9vbCB1c2VkIGZvciB0YWlsaW5nIGN1cnNvcnMgaXMgdGhlIHNhbWVcbiAgICAvLyBwb29sIHVzZWQgZm9yIG90aGVyIHF1ZXJpZXMsIHRoZSBvdGhlciBxdWVyaWVzIHdpbGwgYmUgZGVsYXllZCBieSBzZWNvbmRzXG4gICAgLy8gMS81IG9mIHRoZSB0aW1lLlxuICAgIC8vXG4gICAgLy8gVGhlIHRhaWwgY29ubmVjdGlvbiB3aWxsIG9ubHkgZXZlciBiZSBydW5uaW5nIGEgc2luZ2xlIHRhaWwgY29tbWFuZCwgc29cbiAgICAvLyBpdCBvbmx5IG5lZWRzIHRvIG1ha2Ugb25lIHVuZGVybHlpbmcgVENQIGNvbm5lY3Rpb24uXG4gICAgc2VsZi5fb3Bsb2dUYWlsQ29ubmVjdGlvbiA9IG5ldyBNb25nb0Nvbm5lY3Rpb24oXG4gICAgICBzZWxmLl9vcGxvZ1VybCwge21heFBvb2xTaXplOiAxfSk7XG4gICAgLy8gWFhYIGJldHRlciBkb2NzLCBidXQ6IGl0J3MgdG8gZ2V0IG1vbm90b25pYyByZXN1bHRzXG4gICAgLy8gWFhYIGlzIGl0IHNhZmUgdG8gc2F5IFwiaWYgdGhlcmUncyBhbiBpbiBmbGlnaHQgcXVlcnksIGp1c3QgdXNlIGl0c1xuICAgIC8vICAgICByZXN1bHRzXCI/IEkgZG9uJ3QgdGhpbmsgc28gYnV0IHNob3VsZCBjb25zaWRlciB0aGF0XG4gICAgc2VsZi5fb3Bsb2dMYXN0RW50cnlDb25uZWN0aW9uID0gbmV3IE1vbmdvQ29ubmVjdGlvbihcbiAgICAgIHNlbGYuX29wbG9nVXJsLCB7bWF4UG9vbFNpemU6IDF9KTtcblxuICAgIC8vIE5vdywgbWFrZSBzdXJlIHRoYXQgdGhlcmUgYWN0dWFsbHkgaXMgYSByZXBsIHNldCBoZXJlLiBJZiBub3QsIG9wbG9nXG4gICAgLy8gdGFpbGluZyB3b24ndCBldmVyIGZpbmQgYW55dGhpbmchXG4gICAgLy8gTW9yZSBvbiB0aGUgaXNNYXN0ZXJEb2NcbiAgICAvLyBodHRwczovL2RvY3MubW9uZ29kYi5jb20vbWFudWFsL3JlZmVyZW5jZS9jb21tYW5kL2lzTWFzdGVyL1xuICAgIHZhciBmID0gbmV3IEZ1dHVyZTtcbiAgICBzZWxmLl9vcGxvZ0xhc3RFbnRyeUNvbm5lY3Rpb24uZGIuYWRtaW4oKS5jb21tYW5kKFxuICAgICAgeyBpc21hc3RlcjogMSB9LCBmLnJlc29sdmVyKCkpO1xuICAgIHZhciBpc01hc3RlckRvYyA9IGYud2FpdCgpO1xuXG4gICAgaWYgKCEoaXNNYXN0ZXJEb2MgJiYgaXNNYXN0ZXJEb2Muc2V0TmFtZSkpIHtcbiAgICAgIHRocm93IEVycm9yKFwiJE1PTkdPX09QTE9HX1VSTCBtdXN0IGJlIHNldCB0byB0aGUgJ2xvY2FsJyBkYXRhYmFzZSBvZiBcIiArXG4gICAgICAgICAgICAgICAgICBcImEgTW9uZ28gcmVwbGljYSBzZXRcIik7XG4gICAgfVxuXG4gICAgLy8gRmluZCB0aGUgbGFzdCBvcGxvZyBlbnRyeS5cbiAgICB2YXIgbGFzdE9wbG9nRW50cnkgPSBzZWxmLl9vcGxvZ0xhc3RFbnRyeUNvbm5lY3Rpb24uZmluZE9uZShcbiAgICAgIE9QTE9HX0NPTExFQ1RJT04sIHt9LCB7c29ydDogeyRuYXR1cmFsOiAtMX0sIGZpZWxkczoge3RzOiAxfX0pO1xuXG4gICAgdmFyIG9wbG9nU2VsZWN0b3IgPSBfLmNsb25lKHNlbGYuX2Jhc2VPcGxvZ1NlbGVjdG9yKTtcbiAgICBpZiAobGFzdE9wbG9nRW50cnkpIHtcbiAgICAgIC8vIFN0YXJ0IGFmdGVyIHRoZSBsYXN0IGVudHJ5IHRoYXQgY3VycmVudGx5IGV4aXN0cy5cbiAgICAgIG9wbG9nU2VsZWN0b3IudHMgPSB7JGd0OiBsYXN0T3Bsb2dFbnRyeS50c307XG4gICAgICAvLyBJZiB0aGVyZSBhcmUgYW55IGNhbGxzIHRvIGNhbGxXaGVuUHJvY2Vzc2VkTGF0ZXN0IGJlZm9yZSBhbnkgb3RoZXJcbiAgICAgIC8vIG9wbG9nIGVudHJpZXMgc2hvdyB1cCwgYWxsb3cgY2FsbFdoZW5Qcm9jZXNzZWRMYXRlc3QgdG8gY2FsbCBpdHNcbiAgICAgIC8vIGNhbGxiYWNrIGltbWVkaWF0ZWx5LlxuICAgICAgc2VsZi5fbGFzdFByb2Nlc3NlZFRTID0gbGFzdE9wbG9nRW50cnkudHM7XG4gICAgfVxuXG4gICAgdmFyIGN1cnNvckRlc2NyaXB0aW9uID0gbmV3IEN1cnNvckRlc2NyaXB0aW9uKFxuICAgICAgT1BMT0dfQ09MTEVDVElPTiwgb3Bsb2dTZWxlY3Rvciwge3RhaWxhYmxlOiB0cnVlfSk7XG5cbiAgICAvLyBTdGFydCB0YWlsaW5nIHRoZSBvcGxvZy5cbiAgICAvL1xuICAgIC8vIFdlIHJlc3RhcnQgdGhlIGxvdy1sZXZlbCBvcGxvZyBxdWVyeSBldmVyeSAzMCBzZWNvbmRzIGlmIHdlIGRpZG4ndCBnZXQgYVxuICAgIC8vIGRvYy4gVGhpcyBpcyBhIHdvcmthcm91bmQgZm9yICM4NTk4OiB0aGUgTm9kZSBNb25nbyBkcml2ZXIgaGFzIGF0IGxlYXN0XG4gICAgLy8gb25lIGJ1ZyB0aGF0IGNhbiBsZWFkIHRvIHF1ZXJ5IGNhbGxiYWNrcyBuZXZlciBnZXR0aW5nIGNhbGxlZCAoZXZlbiB3aXRoXG4gICAgLy8gYW4gZXJyb3IpIHdoZW4gbGVhZGVyc2hpcCBmYWlsb3ZlciBvY2N1ci5cbiAgICBzZWxmLl90YWlsSGFuZGxlID0gc2VsZi5fb3Bsb2dUYWlsQ29ubmVjdGlvbi50YWlsKFxuICAgICAgY3Vyc29yRGVzY3JpcHRpb24sXG4gICAgICBmdW5jdGlvbiAoZG9jKSB7XG4gICAgICAgIHNlbGYuX2VudHJ5UXVldWUucHVzaChkb2MpO1xuICAgICAgICBzZWxmLl9tYXliZVN0YXJ0V29ya2VyKCk7XG4gICAgICB9LFxuICAgICAgVEFJTF9USU1FT1VUXG4gICAgKTtcbiAgICBzZWxmLl9yZWFkeUZ1dHVyZS5yZXR1cm4oKTtcbiAgfSxcblxuICBfbWF5YmVTdGFydFdvcmtlcjogZnVuY3Rpb24gKCkge1xuICAgIHZhciBzZWxmID0gdGhpcztcbiAgICBpZiAoc2VsZi5fd29ya2VyQWN0aXZlKSByZXR1cm47XG4gICAgc2VsZi5fd29ya2VyQWN0aXZlID0gdHJ1ZTtcblxuICAgIE1ldGVvci5kZWZlcihmdW5jdGlvbiAoKSB7XG4gICAgICAvLyBNYXkgYmUgY2FsbGVkIHJlY3Vyc2l2ZWx5IGluIGNhc2Ugb2YgdHJhbnNhY3Rpb25zLlxuICAgICAgZnVuY3Rpb24gaGFuZGxlRG9jKGRvYykge1xuICAgICAgICBpZiAoZG9jLm5zID09PSBcImFkbWluLiRjbWRcIikge1xuICAgICAgICAgIGlmIChkb2Muby5hcHBseU9wcykge1xuICAgICAgICAgICAgLy8gVGhpcyB3YXMgYSBzdWNjZXNzZnVsIHRyYW5zYWN0aW9uLCBzbyB3ZSBuZWVkIHRvIGFwcGx5IHRoZVxuICAgICAgICAgICAgLy8gb3BlcmF0aW9ucyB0aGF0IHdlcmUgaW52b2x2ZWQuXG4gICAgICAgICAgICBsZXQgbmV4dFRpbWVzdGFtcCA9IGRvYy50cztcbiAgICAgICAgICAgIGRvYy5vLmFwcGx5T3BzLmZvckVhY2gob3AgPT4ge1xuICAgICAgICAgICAgICAvLyBTZWUgaHR0cHM6Ly9naXRodWIuY29tL21ldGVvci9tZXRlb3IvaXNzdWVzLzEwNDIwLlxuICAgICAgICAgICAgICBpZiAoIW9wLnRzKSB7XG4gICAgICAgICAgICAgICAgb3AudHMgPSBuZXh0VGltZXN0YW1wO1xuICAgICAgICAgICAgICAgIG5leHRUaW1lc3RhbXAgPSBuZXh0VGltZXN0YW1wLmFkZChMb25nLk9ORSk7XG4gICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgaGFuZGxlRG9jKG9wKTtcbiAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICAgIH1cbiAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoXCJVbmtub3duIGNvbW1hbmQgXCIgKyBFSlNPTi5zdHJpbmdpZnkoZG9jKSk7XG4gICAgICAgIH1cblxuICAgICAgICBjb25zdCB0cmlnZ2VyID0ge1xuICAgICAgICAgIGRyb3BDb2xsZWN0aW9uOiBmYWxzZSxcbiAgICAgICAgICBkcm9wRGF0YWJhc2U6IGZhbHNlLFxuICAgICAgICAgIG9wOiBkb2MsXG4gICAgICAgIH07XG5cbiAgICAgICAgaWYgKHR5cGVvZiBkb2MubnMgPT09IFwic3RyaW5nXCIgJiZcbiAgICAgICAgICAgIGRvYy5ucy5zdGFydHNXaXRoKHNlbGYuX2RiTmFtZSArIFwiLlwiKSkge1xuICAgICAgICAgIHRyaWdnZXIuY29sbGVjdGlvbiA9IGRvYy5ucy5zbGljZShzZWxmLl9kYk5hbWUubGVuZ3RoICsgMSk7XG4gICAgICAgIH1cblxuICAgICAgICAvLyBJcyBpdCBhIHNwZWNpYWwgY29tbWFuZCBhbmQgdGhlIGNvbGxlY3Rpb24gbmFtZSBpcyBoaWRkZW5cbiAgICAgICAgLy8gc29tZXdoZXJlIGluIG9wZXJhdG9yP1xuICAgICAgICBpZiAodHJpZ2dlci5jb2xsZWN0aW9uID09PSBcIiRjbWRcIikge1xuICAgICAgICAgIGlmIChkb2Muby5kcm9wRGF0YWJhc2UpIHtcbiAgICAgICAgICAgIGRlbGV0ZSB0cmlnZ2VyLmNvbGxlY3Rpb247XG4gICAgICAgICAgICB0cmlnZ2VyLmRyb3BEYXRhYmFzZSA9IHRydWU7XG4gICAgICAgICAgfSBlbHNlIGlmIChfLmhhcyhkb2MubywgXCJkcm9wXCIpKSB7XG4gICAgICAgICAgICB0cmlnZ2VyLmNvbGxlY3Rpb24gPSBkb2Muby5kcm9wO1xuICAgICAgICAgICAgdHJpZ2dlci5kcm9wQ29sbGVjdGlvbiA9IHRydWU7XG4gICAgICAgICAgICB0cmlnZ2VyLmlkID0gbnVsbDtcbiAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgdGhyb3cgRXJyb3IoXCJVbmtub3duIGNvbW1hbmQgXCIgKyBFSlNPTi5zdHJpbmdpZnkoZG9jKSk7XG4gICAgICAgICAgfVxuXG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgLy8gQWxsIG90aGVyIG9wcyBoYXZlIGFuIGlkLlxuICAgICAgICAgIHRyaWdnZXIuaWQgPSBpZEZvck9wKGRvYyk7XG4gICAgICAgIH1cblxuICAgICAgICBzZWxmLl9jcm9zc2Jhci5maXJlKHRyaWdnZXIpO1xuICAgICAgfVxuXG4gICAgICB0cnkge1xuICAgICAgICB3aGlsZSAoISBzZWxmLl9zdG9wcGVkICYmXG4gICAgICAgICAgICAgICAhIHNlbGYuX2VudHJ5UXVldWUuaXNFbXB0eSgpKSB7XG4gICAgICAgICAgLy8gQXJlIHdlIHRvbyBmYXIgYmVoaW5kPyBKdXN0IHRlbGwgb3VyIG9ic2VydmVycyB0aGF0IHRoZXkgbmVlZCB0b1xuICAgICAgICAgIC8vIHJlcG9sbCwgYW5kIGRyb3Agb3VyIHF1ZXVlLlxuICAgICAgICAgIGlmIChzZWxmLl9lbnRyeVF1ZXVlLmxlbmd0aCA+IFRPT19GQVJfQkVISU5EKSB7XG4gICAgICAgICAgICB2YXIgbGFzdEVudHJ5ID0gc2VsZi5fZW50cnlRdWV1ZS5wb3AoKTtcbiAgICAgICAgICAgIHNlbGYuX2VudHJ5UXVldWUuY2xlYXIoKTtcblxuICAgICAgICAgICAgc2VsZi5fb25Ta2lwcGVkRW50cmllc0hvb2suZWFjaChmdW5jdGlvbiAoY2FsbGJhY2spIHtcbiAgICAgICAgICAgICAgY2FsbGJhY2soKTtcbiAgICAgICAgICAgICAgcmV0dXJuIHRydWU7XG4gICAgICAgICAgICB9KTtcblxuICAgICAgICAgICAgLy8gRnJlZSBhbnkgd2FpdFVudGlsQ2F1Z2h0VXAoKSBjYWxscyB0aGF0IHdlcmUgd2FpdGluZyBmb3IgdXMgdG9cbiAgICAgICAgICAgIC8vIHBhc3Mgc29tZXRoaW5nIHRoYXQgd2UganVzdCBza2lwcGVkLlxuICAgICAgICAgICAgc2VsZi5fc2V0TGFzdFByb2Nlc3NlZFRTKGxhc3RFbnRyeS50cyk7XG4gICAgICAgICAgICBjb250aW51ZTtcbiAgICAgICAgICB9XG5cbiAgICAgICAgICBjb25zdCBkb2MgPSBzZWxmLl9lbnRyeVF1ZXVlLnNoaWZ0KCk7XG5cbiAgICAgICAgICAvLyBGaXJlIHRyaWdnZXIocykgZm9yIHRoaXMgZG9jLlxuICAgICAgICAgIGhhbmRsZURvYyhkb2MpO1xuXG4gICAgICAgICAgLy8gTm93IHRoYXQgd2UndmUgcHJvY2Vzc2VkIHRoaXMgb3BlcmF0aW9uLCBwcm9jZXNzIHBlbmRpbmdcbiAgICAgICAgICAvLyBzZXF1ZW5jZXJzLlxuICAgICAgICAgIGlmIChkb2MudHMpIHtcbiAgICAgICAgICAgIHNlbGYuX3NldExhc3RQcm9jZXNzZWRUUyhkb2MudHMpO1xuICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICB0aHJvdyBFcnJvcihcIm9wbG9nIGVudHJ5IHdpdGhvdXQgdHM6IFwiICsgRUpTT04uc3RyaW5naWZ5KGRvYykpO1xuICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgfSBmaW5hbGx5IHtcbiAgICAgICAgc2VsZi5fd29ya2VyQWN0aXZlID0gZmFsc2U7XG4gICAgICB9XG4gICAgfSk7XG4gIH0sXG5cbiAgX3NldExhc3RQcm9jZXNzZWRUUzogZnVuY3Rpb24gKHRzKSB7XG4gICAgdmFyIHNlbGYgPSB0aGlzO1xuICAgIHNlbGYuX2xhc3RQcm9jZXNzZWRUUyA9IHRzO1xuICAgIHdoaWxlICghXy5pc0VtcHR5KHNlbGYuX2NhdGNoaW5nVXBGdXR1cmVzKSAmJiBzZWxmLl9jYXRjaGluZ1VwRnV0dXJlc1swXS50cy5sZXNzVGhhbk9yRXF1YWwoc2VsZi5fbGFzdFByb2Nlc3NlZFRTKSkge1xuICAgICAgdmFyIHNlcXVlbmNlciA9IHNlbGYuX2NhdGNoaW5nVXBGdXR1cmVzLnNoaWZ0KCk7XG4gICAgICBzZXF1ZW5jZXIuZnV0dXJlLnJldHVybigpO1xuICAgIH1cbiAgfSxcblxuICAvL01ldGhvZHMgdXNlZCBvbiB0ZXN0cyB0byBkaW5hbWljYWxseSBjaGFuZ2UgVE9PX0ZBUl9CRUhJTkRcbiAgX2RlZmluZVRvb0ZhckJlaGluZDogZnVuY3Rpb24odmFsdWUpIHtcbiAgICBUT09fRkFSX0JFSElORCA9IHZhbHVlO1xuICB9LFxuICBfcmVzZXRUb29GYXJCZWhpbmQ6IGZ1bmN0aW9uKCkge1xuICAgIFRPT19GQVJfQkVISU5EID0gcHJvY2Vzcy5lbnYuTUVURU9SX09QTE9HX1RPT19GQVJfQkVISU5EIHx8IDIwMDA7XG4gIH1cbn0pO1xuIiwidmFyIEZ1dHVyZSA9IE5wbS5yZXF1aXJlKCdmaWJlcnMvZnV0dXJlJyk7XG5cbk9ic2VydmVNdWx0aXBsZXhlciA9IGZ1bmN0aW9uIChvcHRpb25zKSB7XG4gIHZhciBzZWxmID0gdGhpcztcblxuICBpZiAoIW9wdGlvbnMgfHwgIV8uaGFzKG9wdGlvbnMsICdvcmRlcmVkJykpXG4gICAgdGhyb3cgRXJyb3IoXCJtdXN0IHNwZWNpZmllZCBvcmRlcmVkXCIpO1xuXG4gIFBhY2thZ2VbJ2ZhY3RzLWJhc2UnXSAmJiBQYWNrYWdlWydmYWN0cy1iYXNlJ10uRmFjdHMuaW5jcmVtZW50U2VydmVyRmFjdChcbiAgICBcIm1vbmdvLWxpdmVkYXRhXCIsIFwib2JzZXJ2ZS1tdWx0aXBsZXhlcnNcIiwgMSk7XG5cbiAgc2VsZi5fb3JkZXJlZCA9IG9wdGlvbnMub3JkZXJlZDtcbiAgc2VsZi5fb25TdG9wID0gb3B0aW9ucy5vblN0b3AgfHwgZnVuY3Rpb24gKCkge307XG4gIHNlbGYuX3F1ZXVlID0gbmV3IE1ldGVvci5fU3luY2hyb25vdXNRdWV1ZSgpO1xuICBzZWxmLl9oYW5kbGVzID0ge307XG4gIHNlbGYuX3JlYWR5RnV0dXJlID0gbmV3IEZ1dHVyZTtcbiAgc2VsZi5fY2FjaGUgPSBuZXcgTG9jYWxDb2xsZWN0aW9uLl9DYWNoaW5nQ2hhbmdlT2JzZXJ2ZXIoe1xuICAgIG9yZGVyZWQ6IG9wdGlvbnMub3JkZXJlZH0pO1xuICAvLyBOdW1iZXIgb2YgYWRkSGFuZGxlQW5kU2VuZEluaXRpYWxBZGRzIHRhc2tzIHNjaGVkdWxlZCBidXQgbm90IHlldFxuICAvLyBydW5uaW5nLiByZW1vdmVIYW5kbGUgdXNlcyB0aGlzIHRvIGtub3cgaWYgaXQncyB0aW1lIHRvIGNhbGwgdGhlIG9uU3RvcFxuICAvLyBjYWxsYmFjay5cbiAgc2VsZi5fYWRkSGFuZGxlVGFza3NTY2hlZHVsZWRCdXROb3RQZXJmb3JtZWQgPSAwO1xuXG4gIF8uZWFjaChzZWxmLmNhbGxiYWNrTmFtZXMoKSwgZnVuY3Rpb24gKGNhbGxiYWNrTmFtZSkge1xuICAgIHNlbGZbY2FsbGJhY2tOYW1lXSA9IGZ1bmN0aW9uICgvKiAuLi4gKi8pIHtcbiAgICAgIHNlbGYuX2FwcGx5Q2FsbGJhY2soY2FsbGJhY2tOYW1lLCBfLnRvQXJyYXkoYXJndW1lbnRzKSk7XG4gICAgfTtcbiAgfSk7XG59O1xuXG5fLmV4dGVuZChPYnNlcnZlTXVsdGlwbGV4ZXIucHJvdG90eXBlLCB7XG4gIGFkZEhhbmRsZUFuZFNlbmRJbml0aWFsQWRkczogZnVuY3Rpb24gKGhhbmRsZSkge1xuICAgIHZhciBzZWxmID0gdGhpcztcblxuICAgIC8vIENoZWNrIHRoaXMgYmVmb3JlIGNhbGxpbmcgcnVuVGFzayAoZXZlbiB0aG91Z2ggcnVuVGFzayBkb2VzIHRoZSBzYW1lXG4gICAgLy8gY2hlY2spIHNvIHRoYXQgd2UgZG9uJ3QgbGVhayBhbiBPYnNlcnZlTXVsdGlwbGV4ZXIgb24gZXJyb3IgYnlcbiAgICAvLyBpbmNyZW1lbnRpbmcgX2FkZEhhbmRsZVRhc2tzU2NoZWR1bGVkQnV0Tm90UGVyZm9ybWVkIGFuZCBuZXZlclxuICAgIC8vIGRlY3JlbWVudGluZyBpdC5cbiAgICBpZiAoIXNlbGYuX3F1ZXVlLnNhZmVUb1J1blRhc2soKSlcbiAgICAgIHRocm93IG5ldyBFcnJvcihcIkNhbid0IGNhbGwgb2JzZXJ2ZUNoYW5nZXMgZnJvbSBhbiBvYnNlcnZlIGNhbGxiYWNrIG9uIHRoZSBzYW1lIHF1ZXJ5XCIpO1xuICAgICsrc2VsZi5fYWRkSGFuZGxlVGFza3NTY2hlZHVsZWRCdXROb3RQZXJmb3JtZWQ7XG5cbiAgICBQYWNrYWdlWydmYWN0cy1iYXNlJ10gJiYgUGFja2FnZVsnZmFjdHMtYmFzZSddLkZhY3RzLmluY3JlbWVudFNlcnZlckZhY3QoXG4gICAgICBcIm1vbmdvLWxpdmVkYXRhXCIsIFwib2JzZXJ2ZS1oYW5kbGVzXCIsIDEpO1xuXG4gICAgc2VsZi5fcXVldWUucnVuVGFzayhmdW5jdGlvbiAoKSB7XG4gICAgICBzZWxmLl9oYW5kbGVzW2hhbmRsZS5faWRdID0gaGFuZGxlO1xuICAgICAgLy8gU2VuZCBvdXQgd2hhdGV2ZXIgYWRkcyB3ZSBoYXZlIHNvIGZhciAod2hldGhlciBvciBub3Qgd2UgdGhlXG4gICAgICAvLyBtdWx0aXBsZXhlciBpcyByZWFkeSkuXG4gICAgICBzZWxmLl9zZW5kQWRkcyhoYW5kbGUpO1xuICAgICAgLS1zZWxmLl9hZGRIYW5kbGVUYXNrc1NjaGVkdWxlZEJ1dE5vdFBlcmZvcm1lZDtcbiAgICB9KTtcbiAgICAvLyAqb3V0c2lkZSogdGhlIHRhc2ssIHNpbmNlIG90aGVyd2lzZSB3ZSdkIGRlYWRsb2NrXG4gICAgc2VsZi5fcmVhZHlGdXR1cmUud2FpdCgpO1xuICB9LFxuXG4gIC8vIFJlbW92ZSBhbiBvYnNlcnZlIGhhbmRsZS4gSWYgaXQgd2FzIHRoZSBsYXN0IG9ic2VydmUgaGFuZGxlLCBjYWxsIHRoZVxuICAvLyBvblN0b3AgY2FsbGJhY2s7IHlvdSBjYW5ub3QgYWRkIGFueSBtb3JlIG9ic2VydmUgaGFuZGxlcyBhZnRlciB0aGlzLlxuICAvL1xuICAvLyBUaGlzIGlzIG5vdCBzeW5jaHJvbml6ZWQgd2l0aCBwb2xscyBhbmQgaGFuZGxlIGFkZGl0aW9uczogdGhpcyBtZWFucyB0aGF0XG4gIC8vIHlvdSBjYW4gc2FmZWx5IGNhbGwgaXQgZnJvbSB3aXRoaW4gYW4gb2JzZXJ2ZSBjYWxsYmFjaywgYnV0IGl0IGFsc28gbWVhbnNcbiAgLy8gdGhhdCB3ZSBoYXZlIHRvIGJlIGNhcmVmdWwgd2hlbiB3ZSBpdGVyYXRlIG92ZXIgX2hhbmRsZXMuXG4gIHJlbW92ZUhhbmRsZTogZnVuY3Rpb24gKGlkKSB7XG4gICAgdmFyIHNlbGYgPSB0aGlzO1xuXG4gICAgLy8gVGhpcyBzaG91bGQgbm90IGJlIHBvc3NpYmxlOiB5b3UgY2FuIG9ubHkgY2FsbCByZW1vdmVIYW5kbGUgYnkgaGF2aW5nXG4gICAgLy8gYWNjZXNzIHRvIHRoZSBPYnNlcnZlSGFuZGxlLCB3aGljaCBpc24ndCByZXR1cm5lZCB0byB1c2VyIGNvZGUgdW50aWwgdGhlXG4gICAgLy8gbXVsdGlwbGV4IGlzIHJlYWR5LlxuICAgIGlmICghc2VsZi5fcmVhZHkoKSlcbiAgICAgIHRocm93IG5ldyBFcnJvcihcIkNhbid0IHJlbW92ZSBoYW5kbGVzIHVudGlsIHRoZSBtdWx0aXBsZXggaXMgcmVhZHlcIik7XG5cbiAgICBkZWxldGUgc2VsZi5faGFuZGxlc1tpZF07XG5cbiAgICBQYWNrYWdlWydmYWN0cy1iYXNlJ10gJiYgUGFja2FnZVsnZmFjdHMtYmFzZSddLkZhY3RzLmluY3JlbWVudFNlcnZlckZhY3QoXG4gICAgICBcIm1vbmdvLWxpdmVkYXRhXCIsIFwib2JzZXJ2ZS1oYW5kbGVzXCIsIC0xKTtcblxuICAgIGlmIChfLmlzRW1wdHkoc2VsZi5faGFuZGxlcykgJiZcbiAgICAgICAgc2VsZi5fYWRkSGFuZGxlVGFza3NTY2hlZHVsZWRCdXROb3RQZXJmb3JtZWQgPT09IDApIHtcbiAgICAgIHNlbGYuX3N0b3AoKTtcbiAgICB9XG4gIH0sXG4gIF9zdG9wOiBmdW5jdGlvbiAob3B0aW9ucykge1xuICAgIHZhciBzZWxmID0gdGhpcztcbiAgICBvcHRpb25zID0gb3B0aW9ucyB8fCB7fTtcblxuICAgIC8vIEl0IHNob3VsZG4ndCBiZSBwb3NzaWJsZSBmb3IgdXMgdG8gc3RvcCB3aGVuIGFsbCBvdXIgaGFuZGxlcyBzdGlsbFxuICAgIC8vIGhhdmVuJ3QgYmVlbiByZXR1cm5lZCBmcm9tIG9ic2VydmVDaGFuZ2VzIVxuICAgIGlmICghIHNlbGYuX3JlYWR5KCkgJiYgISBvcHRpb25zLmZyb21RdWVyeUVycm9yKVxuICAgICAgdGhyb3cgRXJyb3IoXCJzdXJwcmlzaW5nIF9zdG9wOiBub3QgcmVhZHlcIik7XG5cbiAgICAvLyBDYWxsIHN0b3AgY2FsbGJhY2sgKHdoaWNoIGtpbGxzIHRoZSB1bmRlcmx5aW5nIHByb2Nlc3Mgd2hpY2ggc2VuZHMgdXNcbiAgICAvLyBjYWxsYmFja3MgYW5kIHJlbW92ZXMgdXMgZnJvbSB0aGUgY29ubmVjdGlvbidzIGRpY3Rpb25hcnkpLlxuICAgIHNlbGYuX29uU3RvcCgpO1xuICAgIFBhY2thZ2VbJ2ZhY3RzLWJhc2UnXSAmJiBQYWNrYWdlWydmYWN0cy1iYXNlJ10uRmFjdHMuaW5jcmVtZW50U2VydmVyRmFjdChcbiAgICAgIFwibW9uZ28tbGl2ZWRhdGFcIiwgXCJvYnNlcnZlLW11bHRpcGxleGVyc1wiLCAtMSk7XG5cbiAgICAvLyBDYXVzZSBmdXR1cmUgYWRkSGFuZGxlQW5kU2VuZEluaXRpYWxBZGRzIGNhbGxzIHRvIHRocm93IChidXQgdGhlIG9uU3RvcFxuICAgIC8vIGNhbGxiYWNrIHNob3VsZCBtYWtlIG91ciBjb25uZWN0aW9uIGZvcmdldCBhYm91dCB1cykuXG4gICAgc2VsZi5faGFuZGxlcyA9IG51bGw7XG4gIH0sXG5cbiAgLy8gQWxsb3dzIGFsbCBhZGRIYW5kbGVBbmRTZW5kSW5pdGlhbEFkZHMgY2FsbHMgdG8gcmV0dXJuLCBvbmNlIGFsbCBwcmVjZWRpbmdcbiAgLy8gYWRkcyBoYXZlIGJlZW4gcHJvY2Vzc2VkLiBEb2VzIG5vdCBibG9jay5cbiAgcmVhZHk6IGZ1bmN0aW9uICgpIHtcbiAgICB2YXIgc2VsZiA9IHRoaXM7XG4gICAgc2VsZi5fcXVldWUucXVldWVUYXNrKGZ1bmN0aW9uICgpIHtcbiAgICAgIGlmIChzZWxmLl9yZWFkeSgpKVxuICAgICAgICB0aHJvdyBFcnJvcihcImNhbid0IG1ha2UgT2JzZXJ2ZU11bHRpcGxleCByZWFkeSB0d2ljZSFcIik7XG4gICAgICBzZWxmLl9yZWFkeUZ1dHVyZS5yZXR1cm4oKTtcbiAgICB9KTtcbiAgfSxcblxuICAvLyBJZiB0cnlpbmcgdG8gZXhlY3V0ZSB0aGUgcXVlcnkgcmVzdWx0cyBpbiBhbiBlcnJvciwgY2FsbCB0aGlzLiBUaGlzIGlzXG4gIC8vIGludGVuZGVkIGZvciBwZXJtYW5lbnQgZXJyb3JzLCBub3QgdHJhbnNpZW50IG5ldHdvcmsgZXJyb3JzIHRoYXQgY291bGQgYmVcbiAgLy8gZml4ZWQuIEl0IHNob3VsZCBvbmx5IGJlIGNhbGxlZCBiZWZvcmUgcmVhZHkoKSwgYmVjYXVzZSBpZiB5b3UgY2FsbGVkIHJlYWR5XG4gIC8vIHRoYXQgbWVhbnQgdGhhdCB5b3UgbWFuYWdlZCB0byBydW4gdGhlIHF1ZXJ5IG9uY2UuIEl0IHdpbGwgc3RvcCB0aGlzXG4gIC8vIE9ic2VydmVNdWx0aXBsZXggYW5kIGNhdXNlIGFkZEhhbmRsZUFuZFNlbmRJbml0aWFsQWRkcyBjYWxscyAoYW5kIHRodXNcbiAgLy8gb2JzZXJ2ZUNoYW5nZXMgY2FsbHMpIHRvIHRocm93IHRoZSBlcnJvci5cbiAgcXVlcnlFcnJvcjogZnVuY3Rpb24gKGVycikge1xuICAgIHZhciBzZWxmID0gdGhpcztcbiAgICBzZWxmLl9xdWV1ZS5ydW5UYXNrKGZ1bmN0aW9uICgpIHtcbiAgICAgIGlmIChzZWxmLl9yZWFkeSgpKVxuICAgICAgICB0aHJvdyBFcnJvcihcImNhbid0IGNsYWltIHF1ZXJ5IGhhcyBhbiBlcnJvciBhZnRlciBpdCB3b3JrZWQhXCIpO1xuICAgICAgc2VsZi5fc3RvcCh7ZnJvbVF1ZXJ5RXJyb3I6IHRydWV9KTtcbiAgICAgIHNlbGYuX3JlYWR5RnV0dXJlLnRocm93KGVycik7XG4gICAgfSk7XG4gIH0sXG5cbiAgLy8gQ2FsbHMgXCJjYlwiIG9uY2UgdGhlIGVmZmVjdHMgb2YgYWxsIFwicmVhZHlcIiwgXCJhZGRIYW5kbGVBbmRTZW5kSW5pdGlhbEFkZHNcIlxuICAvLyBhbmQgb2JzZXJ2ZSBjYWxsYmFja3Mgd2hpY2ggY2FtZSBiZWZvcmUgdGhpcyBjYWxsIGhhdmUgYmVlbiBwcm9wYWdhdGVkIHRvXG4gIC8vIGFsbCBoYW5kbGVzLiBcInJlYWR5XCIgbXVzdCBoYXZlIGFscmVhZHkgYmVlbiBjYWxsZWQgb24gdGhpcyBtdWx0aXBsZXhlci5cbiAgb25GbHVzaDogZnVuY3Rpb24gKGNiKSB7XG4gICAgdmFyIHNlbGYgPSB0aGlzO1xuICAgIHNlbGYuX3F1ZXVlLnF1ZXVlVGFzayhmdW5jdGlvbiAoKSB7XG4gICAgICBpZiAoIXNlbGYuX3JlYWR5KCkpXG4gICAgICAgIHRocm93IEVycm9yKFwib25seSBjYWxsIG9uRmx1c2ggb24gYSBtdWx0aXBsZXhlciB0aGF0IHdpbGwgYmUgcmVhZHlcIik7XG4gICAgICBjYigpO1xuICAgIH0pO1xuICB9LFxuICBjYWxsYmFja05hbWVzOiBmdW5jdGlvbiAoKSB7XG4gICAgdmFyIHNlbGYgPSB0aGlzO1xuICAgIGlmIChzZWxmLl9vcmRlcmVkKVxuICAgICAgcmV0dXJuIFtcImFkZGVkQmVmb3JlXCIsIFwiY2hhbmdlZFwiLCBcIm1vdmVkQmVmb3JlXCIsIFwicmVtb3ZlZFwiXTtcbiAgICBlbHNlXG4gICAgICByZXR1cm4gW1wiYWRkZWRcIiwgXCJjaGFuZ2VkXCIsIFwicmVtb3ZlZFwiXTtcbiAgfSxcbiAgX3JlYWR5OiBmdW5jdGlvbiAoKSB7XG4gICAgcmV0dXJuIHRoaXMuX3JlYWR5RnV0dXJlLmlzUmVzb2x2ZWQoKTtcbiAgfSxcbiAgX2FwcGx5Q2FsbGJhY2s6IGZ1bmN0aW9uIChjYWxsYmFja05hbWUsIGFyZ3MpIHtcbiAgICB2YXIgc2VsZiA9IHRoaXM7XG4gICAgc2VsZi5fcXVldWUucXVldWVUYXNrKGZ1bmN0aW9uICgpIHtcbiAgICAgIC8vIElmIHdlIHN0b3BwZWQgaW4gdGhlIG1lYW50aW1lLCBkbyBub3RoaW5nLlxuICAgICAgaWYgKCFzZWxmLl9oYW5kbGVzKVxuICAgICAgICByZXR1cm47XG5cbiAgICAgIC8vIEZpcnN0LCBhcHBseSB0aGUgY2hhbmdlIHRvIHRoZSBjYWNoZS5cbiAgICAgIHNlbGYuX2NhY2hlLmFwcGx5Q2hhbmdlW2NhbGxiYWNrTmFtZV0uYXBwbHkobnVsbCwgYXJncyk7XG5cbiAgICAgIC8vIElmIHdlIGhhdmVuJ3QgZmluaXNoZWQgdGhlIGluaXRpYWwgYWRkcywgdGhlbiB3ZSBzaG91bGQgb25seSBiZSBnZXR0aW5nXG4gICAgICAvLyBhZGRzLlxuICAgICAgaWYgKCFzZWxmLl9yZWFkeSgpICYmXG4gICAgICAgICAgKGNhbGxiYWNrTmFtZSAhPT0gJ2FkZGVkJyAmJiBjYWxsYmFja05hbWUgIT09ICdhZGRlZEJlZm9yZScpKSB7XG4gICAgICAgIHRocm93IG5ldyBFcnJvcihcIkdvdCBcIiArIGNhbGxiYWNrTmFtZSArIFwiIGR1cmluZyBpbml0aWFsIGFkZHNcIik7XG4gICAgICB9XG5cbiAgICAgIC8vIE5vdyBtdWx0aXBsZXggdGhlIGNhbGxiYWNrcyBvdXQgdG8gYWxsIG9ic2VydmUgaGFuZGxlcy4gSXQncyBPSyBpZlxuICAgICAgLy8gdGhlc2UgY2FsbHMgeWllbGQ7IHNpbmNlIHdlJ3JlIGluc2lkZSBhIHRhc2ssIG5vIG90aGVyIHVzZSBvZiBvdXIgcXVldWVcbiAgICAgIC8vIGNhbiBjb250aW51ZSB1bnRpbCB0aGVzZSBhcmUgZG9uZS4gKEJ1dCB3ZSBkbyBoYXZlIHRvIGJlIGNhcmVmdWwgdG8gbm90XG4gICAgICAvLyB1c2UgYSBoYW5kbGUgdGhhdCBnb3QgcmVtb3ZlZCwgYmVjYXVzZSByZW1vdmVIYW5kbGUgZG9lcyBub3QgdXNlIHRoZVxuICAgICAgLy8gcXVldWU7IHRodXMsIHdlIGl0ZXJhdGUgb3ZlciBhbiBhcnJheSBvZiBrZXlzIHRoYXQgd2UgY29udHJvbC4pXG4gICAgICBfLmVhY2goXy5rZXlzKHNlbGYuX2hhbmRsZXMpLCBmdW5jdGlvbiAoaGFuZGxlSWQpIHtcbiAgICAgICAgdmFyIGhhbmRsZSA9IHNlbGYuX2hhbmRsZXMgJiYgc2VsZi5faGFuZGxlc1toYW5kbGVJZF07XG4gICAgICAgIGlmICghaGFuZGxlKVxuICAgICAgICAgIHJldHVybjtcbiAgICAgICAgdmFyIGNhbGxiYWNrID0gaGFuZGxlWydfJyArIGNhbGxiYWNrTmFtZV07XG4gICAgICAgIC8vIGNsb25lIGFyZ3VtZW50cyBzbyB0aGF0IGNhbGxiYWNrcyBjYW4gbXV0YXRlIHRoZWlyIGFyZ3VtZW50c1xuICAgICAgICBjYWxsYmFjayAmJiBjYWxsYmFjay5hcHBseShudWxsLFxuICAgICAgICAgIGhhbmRsZS5ub25NdXRhdGluZ0NhbGxiYWNrcyA/IGFyZ3MgOiBFSlNPTi5jbG9uZShhcmdzKSk7XG4gICAgICB9KTtcbiAgICB9KTtcbiAgfSxcblxuICAvLyBTZW5kcyBpbml0aWFsIGFkZHMgdG8gYSBoYW5kbGUuIEl0IHNob3VsZCBvbmx5IGJlIGNhbGxlZCBmcm9tIHdpdGhpbiBhIHRhc2tcbiAgLy8gKHRoZSB0YXNrIHRoYXQgaXMgcHJvY2Vzc2luZyB0aGUgYWRkSGFuZGxlQW5kU2VuZEluaXRpYWxBZGRzIGNhbGwpLiBJdFxuICAvLyBzeW5jaHJvbm91c2x5IGludm9rZXMgdGhlIGhhbmRsZSdzIGFkZGVkIG9yIGFkZGVkQmVmb3JlOyB0aGVyZSdzIG5vIG5lZWQgdG9cbiAgLy8gZmx1c2ggdGhlIHF1ZXVlIGFmdGVyd2FyZHMgdG8gZW5zdXJlIHRoYXQgdGhlIGNhbGxiYWNrcyBnZXQgb3V0LlxuICBfc2VuZEFkZHM6IGZ1bmN0aW9uIChoYW5kbGUpIHtcbiAgICB2YXIgc2VsZiA9IHRoaXM7XG4gICAgaWYgKHNlbGYuX3F1ZXVlLnNhZmVUb1J1blRhc2soKSlcbiAgICAgIHRocm93IEVycm9yKFwiX3NlbmRBZGRzIG1heSBvbmx5IGJlIGNhbGxlZCBmcm9tIHdpdGhpbiBhIHRhc2shXCIpO1xuICAgIHZhciBhZGQgPSBzZWxmLl9vcmRlcmVkID8gaGFuZGxlLl9hZGRlZEJlZm9yZSA6IGhhbmRsZS5fYWRkZWQ7XG4gICAgaWYgKCFhZGQpXG4gICAgICByZXR1cm47XG4gICAgLy8gbm90ZTogZG9jcyBtYXkgYmUgYW4gX0lkTWFwIG9yIGFuIE9yZGVyZWREaWN0XG4gICAgc2VsZi5fY2FjaGUuZG9jcy5mb3JFYWNoKGZ1bmN0aW9uIChkb2MsIGlkKSB7XG4gICAgICBpZiAoIV8uaGFzKHNlbGYuX2hhbmRsZXMsIGhhbmRsZS5faWQpKVxuICAgICAgICB0aHJvdyBFcnJvcihcImhhbmRsZSBnb3QgcmVtb3ZlZCBiZWZvcmUgc2VuZGluZyBpbml0aWFsIGFkZHMhXCIpO1xuICAgICAgY29uc3QgeyBfaWQsIC4uLmZpZWxkcyB9ID0gaGFuZGxlLm5vbk11dGF0aW5nQ2FsbGJhY2tzID8gZG9jXG4gICAgICAgIDogRUpTT04uY2xvbmUoZG9jKTtcbiAgICAgIGlmIChzZWxmLl9vcmRlcmVkKVxuICAgICAgICBhZGQoaWQsIGZpZWxkcywgbnVsbCk7IC8vIHdlJ3JlIGdvaW5nIGluIG9yZGVyLCBzbyBhZGQgYXQgZW5kXG4gICAgICBlbHNlXG4gICAgICAgIGFkZChpZCwgZmllbGRzKTtcbiAgICB9KTtcbiAgfVxufSk7XG5cblxudmFyIG5leHRPYnNlcnZlSGFuZGxlSWQgPSAxO1xuXG4vLyBXaGVuIHRoZSBjYWxsYmFja3MgZG8gbm90IG11dGF0ZSB0aGUgYXJndW1lbnRzLCB3ZSBjYW4gc2tpcCBhIGxvdCBvZiBkYXRhIGNsb25lc1xuT2JzZXJ2ZUhhbmRsZSA9IGZ1bmN0aW9uIChtdWx0aXBsZXhlciwgY2FsbGJhY2tzLCBub25NdXRhdGluZ0NhbGxiYWNrcyA9IGZhbHNlKSB7XG4gIHZhciBzZWxmID0gdGhpcztcbiAgLy8gVGhlIGVuZCB1c2VyIGlzIG9ubHkgc3VwcG9zZWQgdG8gY2FsbCBzdG9wKCkuICBUaGUgb3RoZXIgZmllbGRzIGFyZVxuICAvLyBhY2Nlc3NpYmxlIHRvIHRoZSBtdWx0aXBsZXhlciwgdGhvdWdoLlxuICBzZWxmLl9tdWx0aXBsZXhlciA9IG11bHRpcGxleGVyO1xuICBfLmVhY2gobXVsdGlwbGV4ZXIuY2FsbGJhY2tOYW1lcygpLCBmdW5jdGlvbiAobmFtZSkge1xuICAgIGlmIChjYWxsYmFja3NbbmFtZV0pIHtcbiAgICAgIHNlbGZbJ18nICsgbmFtZV0gPSBjYWxsYmFja3NbbmFtZV07XG4gICAgfSBlbHNlIGlmIChuYW1lID09PSBcImFkZGVkQmVmb3JlXCIgJiYgY2FsbGJhY2tzLmFkZGVkKSB7XG4gICAgICAvLyBTcGVjaWFsIGNhc2U6IGlmIHlvdSBzcGVjaWZ5IFwiYWRkZWRcIiBhbmQgXCJtb3ZlZEJlZm9yZVwiLCB5b3UgZ2V0IGFuXG4gICAgICAvLyBvcmRlcmVkIG9ic2VydmUgd2hlcmUgZm9yIHNvbWUgcmVhc29uIHlvdSBkb24ndCBnZXQgb3JkZXJpbmcgZGF0YSBvblxuICAgICAgLy8gdGhlIGFkZHMuICBJIGR1bm5vLCB3ZSB3cm90ZSB0ZXN0cyBmb3IgaXQsIHRoZXJlIG11c3QgaGF2ZSBiZWVuIGFcbiAgICAgIC8vIHJlYXNvbi5cbiAgICAgIHNlbGYuX2FkZGVkQmVmb3JlID0gZnVuY3Rpb24gKGlkLCBmaWVsZHMsIGJlZm9yZSkge1xuICAgICAgICBjYWxsYmFja3MuYWRkZWQoaWQsIGZpZWxkcyk7XG4gICAgICB9O1xuICAgIH1cbiAgfSk7XG4gIHNlbGYuX3N0b3BwZWQgPSBmYWxzZTtcbiAgc2VsZi5faWQgPSBuZXh0T2JzZXJ2ZUhhbmRsZUlkKys7XG4gIHNlbGYubm9uTXV0YXRpbmdDYWxsYmFja3MgPSBub25NdXRhdGluZ0NhbGxiYWNrcztcbn07XG5PYnNlcnZlSGFuZGxlLnByb3RvdHlwZS5zdG9wID0gZnVuY3Rpb24gKCkge1xuICB2YXIgc2VsZiA9IHRoaXM7XG4gIGlmIChzZWxmLl9zdG9wcGVkKVxuICAgIHJldHVybjtcbiAgc2VsZi5fc3RvcHBlZCA9IHRydWU7XG4gIHNlbGYuX211bHRpcGxleGVyLnJlbW92ZUhhbmRsZShzZWxmLl9pZCk7XG59O1xuIiwidmFyIEZpYmVyID0gTnBtLnJlcXVpcmUoJ2ZpYmVycycpO1xuXG5leHBvcnQgY2xhc3MgRG9jRmV0Y2hlciB7XG4gIGNvbnN0cnVjdG9yKG1vbmdvQ29ubmVjdGlvbikge1xuICAgIHRoaXMuX21vbmdvQ29ubmVjdGlvbiA9IG1vbmdvQ29ubmVjdGlvbjtcbiAgICAvLyBNYXAgZnJvbSBvcCAtPiBbY2FsbGJhY2tdXG4gICAgdGhpcy5fY2FsbGJhY2tzRm9yT3AgPSBuZXcgTWFwO1xuICB9XG5cbiAgLy8gRmV0Y2hlcyBkb2N1bWVudCBcImlkXCIgZnJvbSBjb2xsZWN0aW9uTmFtZSwgcmV0dXJuaW5nIGl0IG9yIG51bGwgaWYgbm90XG4gIC8vIGZvdW5kLlxuICAvL1xuICAvLyBJZiB5b3UgbWFrZSBtdWx0aXBsZSBjYWxscyB0byBmZXRjaCgpIHdpdGggdGhlIHNhbWUgb3AgcmVmZXJlbmNlLFxuICAvLyBEb2NGZXRjaGVyIG1heSBhc3N1bWUgdGhhdCB0aGV5IGFsbCByZXR1cm4gdGhlIHNhbWUgZG9jdW1lbnQuIChJdCBkb2VzXG4gIC8vIG5vdCBjaGVjayB0byBzZWUgaWYgY29sbGVjdGlvbk5hbWUvaWQgbWF0Y2guKVxuICAvL1xuICAvLyBZb3UgbWF5IGFzc3VtZSB0aGF0IGNhbGxiYWNrIGlzIG5ldmVyIGNhbGxlZCBzeW5jaHJvbm91c2x5IChhbmQgaW4gZmFjdFxuICAvLyBPcGxvZ09ic2VydmVEcml2ZXIgZG9lcyBzbykuXG4gIGZldGNoKGNvbGxlY3Rpb25OYW1lLCBpZCwgb3AsIGNhbGxiYWNrKSB7XG4gICAgY29uc3Qgc2VsZiA9IHRoaXM7XG5cbiAgICBjaGVjayhjb2xsZWN0aW9uTmFtZSwgU3RyaW5nKTtcbiAgICBjaGVjayhvcCwgT2JqZWN0KTtcblxuICAgIC8vIElmIHRoZXJlJ3MgYWxyZWFkeSBhbiBpbi1wcm9ncmVzcyBmZXRjaCBmb3IgdGhpcyBjYWNoZSBrZXksIHlpZWxkIHVudGlsXG4gICAgLy8gaXQncyBkb25lIGFuZCByZXR1cm4gd2hhdGV2ZXIgaXQgcmV0dXJucy5cbiAgICBpZiAoc2VsZi5fY2FsbGJhY2tzRm9yT3AuaGFzKG9wKSkge1xuICAgICAgc2VsZi5fY2FsbGJhY2tzRm9yT3AuZ2V0KG9wKS5wdXNoKGNhbGxiYWNrKTtcbiAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICBjb25zdCBjYWxsYmFja3MgPSBbY2FsbGJhY2tdO1xuICAgIHNlbGYuX2NhbGxiYWNrc0Zvck9wLnNldChvcCwgY2FsbGJhY2tzKTtcblxuICAgIEZpYmVyKGZ1bmN0aW9uICgpIHtcbiAgICAgIHRyeSB7XG4gICAgICAgIHZhciBkb2MgPSBzZWxmLl9tb25nb0Nvbm5lY3Rpb24uZmluZE9uZShcbiAgICAgICAgICBjb2xsZWN0aW9uTmFtZSwge19pZDogaWR9KSB8fCBudWxsO1xuICAgICAgICAvLyBSZXR1cm4gZG9jIHRvIGFsbCByZWxldmFudCBjYWxsYmFja3MuIE5vdGUgdGhhdCB0aGlzIGFycmF5IGNhblxuICAgICAgICAvLyBjb250aW51ZSB0byBncm93IGR1cmluZyBjYWxsYmFjayBleGNlY3V0aW9uLlxuICAgICAgICB3aGlsZSAoY2FsbGJhY2tzLmxlbmd0aCA+IDApIHtcbiAgICAgICAgICAvLyBDbG9uZSB0aGUgZG9jdW1lbnQgc28gdGhhdCB0aGUgdmFyaW91cyBjYWxscyB0byBmZXRjaCBkb24ndCByZXR1cm5cbiAgICAgICAgICAvLyBvYmplY3RzIHRoYXQgYXJlIGludGVydHdpbmdsZWQgd2l0aCBlYWNoIG90aGVyLiBDbG9uZSBiZWZvcmVcbiAgICAgICAgICAvLyBwb3BwaW5nIHRoZSBmdXR1cmUsIHNvIHRoYXQgaWYgY2xvbmUgdGhyb3dzLCB0aGUgZXJyb3IgZ2V0cyBwYXNzZWRcbiAgICAgICAgICAvLyB0byB0aGUgbmV4dCBjYWxsYmFjay5cbiAgICAgICAgICBjYWxsYmFja3MucG9wKCkobnVsbCwgRUpTT04uY2xvbmUoZG9jKSk7XG4gICAgICAgIH1cbiAgICAgIH0gY2F0Y2ggKGUpIHtcbiAgICAgICAgd2hpbGUgKGNhbGxiYWNrcy5sZW5ndGggPiAwKSB7XG4gICAgICAgICAgY2FsbGJhY2tzLnBvcCgpKGUpO1xuICAgICAgICB9XG4gICAgICB9IGZpbmFsbHkge1xuICAgICAgICAvLyBYWFggY29uc2lkZXIga2VlcGluZyB0aGUgZG9jIGFyb3VuZCBmb3IgYSBwZXJpb2Qgb2YgdGltZSBiZWZvcmVcbiAgICAgICAgLy8gcmVtb3ZpbmcgZnJvbSB0aGUgY2FjaGVcbiAgICAgICAgc2VsZi5fY2FsbGJhY2tzRm9yT3AuZGVsZXRlKG9wKTtcbiAgICAgIH1cbiAgICB9KS5ydW4oKTtcbiAgfVxufVxuIiwidmFyIFBPTExJTkdfVEhST1RUTEVfTVMgPSArcHJvY2Vzcy5lbnYuTUVURU9SX1BPTExJTkdfVEhST1RUTEVfTVMgfHwgNTA7XG52YXIgUE9MTElOR19JTlRFUlZBTF9NUyA9ICtwcm9jZXNzLmVudi5NRVRFT1JfUE9MTElOR19JTlRFUlZBTF9NUyB8fCAxMCAqIDEwMDA7XG5cblBvbGxpbmdPYnNlcnZlRHJpdmVyID0gZnVuY3Rpb24gKG9wdGlvbnMpIHtcbiAgdmFyIHNlbGYgPSB0aGlzO1xuXG4gIHNlbGYuX2N1cnNvckRlc2NyaXB0aW9uID0gb3B0aW9ucy5jdXJzb3JEZXNjcmlwdGlvbjtcbiAgc2VsZi5fbW9uZ29IYW5kbGUgPSBvcHRpb25zLm1vbmdvSGFuZGxlO1xuICBzZWxmLl9vcmRlcmVkID0gb3B0aW9ucy5vcmRlcmVkO1xuICBzZWxmLl9tdWx0aXBsZXhlciA9IG9wdGlvbnMubXVsdGlwbGV4ZXI7XG4gIHNlbGYuX3N0b3BDYWxsYmFja3MgPSBbXTtcbiAgc2VsZi5fc3RvcHBlZCA9IGZhbHNlO1xuXG4gIHNlbGYuX3N5bmNocm9ub3VzQ3Vyc29yID0gc2VsZi5fbW9uZ29IYW5kbGUuX2NyZWF0ZVN5bmNocm9ub3VzQ3Vyc29yKFxuICAgIHNlbGYuX2N1cnNvckRlc2NyaXB0aW9uKTtcblxuICAvLyBwcmV2aW91cyByZXN1bHRzIHNuYXBzaG90LiAgb24gZWFjaCBwb2xsIGN5Y2xlLCBkaWZmcyBhZ2FpbnN0XG4gIC8vIHJlc3VsdHMgZHJpdmVzIHRoZSBjYWxsYmFja3MuXG4gIHNlbGYuX3Jlc3VsdHMgPSBudWxsO1xuXG4gIC8vIFRoZSBudW1iZXIgb2YgX3BvbGxNb25nbyBjYWxscyB0aGF0IGhhdmUgYmVlbiBhZGRlZCB0byBzZWxmLl90YXNrUXVldWUgYnV0XG4gIC8vIGhhdmUgbm90IHN0YXJ0ZWQgcnVubmluZy4gVXNlZCB0byBtYWtlIHN1cmUgd2UgbmV2ZXIgc2NoZWR1bGUgbW9yZSB0aGFuIG9uZVxuICAvLyBfcG9sbE1vbmdvIChvdGhlciB0aGFuIHBvc3NpYmx5IHRoZSBvbmUgdGhhdCBpcyBjdXJyZW50bHkgcnVubmluZykuIEl0J3NcbiAgLy8gYWxzbyB1c2VkIGJ5IF9zdXNwZW5kUG9sbGluZyB0byBwcmV0ZW5kIHRoZXJlJ3MgYSBwb2xsIHNjaGVkdWxlZC4gVXN1YWxseSxcbiAgLy8gaXQncyBlaXRoZXIgMCAoZm9yIFwibm8gcG9sbHMgc2NoZWR1bGVkIG90aGVyIHRoYW4gbWF5YmUgb25lIGN1cnJlbnRseVxuICAvLyBydW5uaW5nXCIpIG9yIDEgKGZvciBcImEgcG9sbCBzY2hlZHVsZWQgdGhhdCBpc24ndCBydW5uaW5nIHlldFwiKSwgYnV0IGl0IGNhblxuICAvLyBhbHNvIGJlIDIgaWYgaW5jcmVtZW50ZWQgYnkgX3N1c3BlbmRQb2xsaW5nLlxuICBzZWxmLl9wb2xsc1NjaGVkdWxlZEJ1dE5vdFN0YXJ0ZWQgPSAwO1xuICBzZWxmLl9wZW5kaW5nV3JpdGVzID0gW107IC8vIHBlb3BsZSB0byBub3RpZnkgd2hlbiBwb2xsaW5nIGNvbXBsZXRlc1xuXG4gIC8vIE1ha2Ugc3VyZSB0byBjcmVhdGUgYSBzZXBhcmF0ZWx5IHRocm90dGxlZCBmdW5jdGlvbiBmb3IgZWFjaFxuICAvLyBQb2xsaW5nT2JzZXJ2ZURyaXZlciBvYmplY3QuXG4gIHNlbGYuX2Vuc3VyZVBvbGxJc1NjaGVkdWxlZCA9IF8udGhyb3R0bGUoXG4gICAgc2VsZi5fdW50aHJvdHRsZWRFbnN1cmVQb2xsSXNTY2hlZHVsZWQsXG4gICAgc2VsZi5fY3Vyc29yRGVzY3JpcHRpb24ub3B0aW9ucy5wb2xsaW5nVGhyb3R0bGVNcyB8fCBQT0xMSU5HX1RIUk9UVExFX01TIC8qIG1zICovKTtcblxuICAvLyBYWFggZmlndXJlIG91dCBpZiB3ZSBzdGlsbCBuZWVkIGEgcXVldWVcbiAgc2VsZi5fdGFza1F1ZXVlID0gbmV3IE1ldGVvci5fU3luY2hyb25vdXNRdWV1ZSgpO1xuXG4gIHZhciBsaXN0ZW5lcnNIYW5kbGUgPSBsaXN0ZW5BbGwoXG4gICAgc2VsZi5fY3Vyc29yRGVzY3JpcHRpb24sIGZ1bmN0aW9uIChub3RpZmljYXRpb24pIHtcbiAgICAgIC8vIFdoZW4gc29tZW9uZSBkb2VzIGEgdHJhbnNhY3Rpb24gdGhhdCBtaWdodCBhZmZlY3QgdXMsIHNjaGVkdWxlIGEgcG9sbFxuICAgICAgLy8gb2YgdGhlIGRhdGFiYXNlLiBJZiB0aGF0IHRyYW5zYWN0aW9uIGhhcHBlbnMgaW5zaWRlIG9mIGEgd3JpdGUgZmVuY2UsXG4gICAgICAvLyBibG9jayB0aGUgZmVuY2UgdW50aWwgd2UndmUgcG9sbGVkIGFuZCBub3RpZmllZCBvYnNlcnZlcnMuXG4gICAgICB2YXIgZmVuY2UgPSBERFBTZXJ2ZXIuX0N1cnJlbnRXcml0ZUZlbmNlLmdldCgpO1xuICAgICAgaWYgKGZlbmNlKVxuICAgICAgICBzZWxmLl9wZW5kaW5nV3JpdGVzLnB1c2goZmVuY2UuYmVnaW5Xcml0ZSgpKTtcbiAgICAgIC8vIEVuc3VyZSBhIHBvbGwgaXMgc2NoZWR1bGVkLi4uIGJ1dCBpZiB3ZSBhbHJlYWR5IGtub3cgdGhhdCBvbmUgaXMsXG4gICAgICAvLyBkb24ndCBoaXQgdGhlIHRocm90dGxlZCBfZW5zdXJlUG9sbElzU2NoZWR1bGVkIGZ1bmN0aW9uICh3aGljaCBtaWdodFxuICAgICAgLy8gbGVhZCB0byB1cyBjYWxsaW5nIGl0IHVubmVjZXNzYXJpbHkgaW4gPHBvbGxpbmdUaHJvdHRsZU1zPiBtcykuXG4gICAgICBpZiAoc2VsZi5fcG9sbHNTY2hlZHVsZWRCdXROb3RTdGFydGVkID09PSAwKVxuICAgICAgICBzZWxmLl9lbnN1cmVQb2xsSXNTY2hlZHVsZWQoKTtcbiAgICB9XG4gICk7XG4gIHNlbGYuX3N0b3BDYWxsYmFja3MucHVzaChmdW5jdGlvbiAoKSB7IGxpc3RlbmVyc0hhbmRsZS5zdG9wKCk7IH0pO1xuXG4gIC8vIGV2ZXJ5IG9uY2UgYW5kIGEgd2hpbGUsIHBvbGwgZXZlbiBpZiB3ZSBkb24ndCB0aGluayB3ZSdyZSBkaXJ0eSwgZm9yXG4gIC8vIGV2ZW50dWFsIGNvbnNpc3RlbmN5IHdpdGggZGF0YWJhc2Ugd3JpdGVzIGZyb20gb3V0c2lkZSB0aGUgTWV0ZW9yXG4gIC8vIHVuaXZlcnNlLlxuICAvL1xuICAvLyBGb3IgdGVzdGluZywgdGhlcmUncyBhbiB1bmRvY3VtZW50ZWQgY2FsbGJhY2sgYXJndW1lbnQgdG8gb2JzZXJ2ZUNoYW5nZXNcbiAgLy8gd2hpY2ggZGlzYWJsZXMgdGltZS1iYXNlZCBwb2xsaW5nIGFuZCBnZXRzIGNhbGxlZCBhdCB0aGUgYmVnaW5uaW5nIG9mIGVhY2hcbiAgLy8gcG9sbC5cbiAgaWYgKG9wdGlvbnMuX3Rlc3RPbmx5UG9sbENhbGxiYWNrKSB7XG4gICAgc2VsZi5fdGVzdE9ubHlQb2xsQ2FsbGJhY2sgPSBvcHRpb25zLl90ZXN0T25seVBvbGxDYWxsYmFjaztcbiAgfSBlbHNlIHtcbiAgICB2YXIgcG9sbGluZ0ludGVydmFsID1cbiAgICAgICAgICBzZWxmLl9jdXJzb3JEZXNjcmlwdGlvbi5vcHRpb25zLnBvbGxpbmdJbnRlcnZhbE1zIHx8XG4gICAgICAgICAgc2VsZi5fY3Vyc29yRGVzY3JpcHRpb24ub3B0aW9ucy5fcG9sbGluZ0ludGVydmFsIHx8IC8vIENPTVBBVCB3aXRoIDEuMlxuICAgICAgICAgIFBPTExJTkdfSU5URVJWQUxfTVM7XG4gICAgdmFyIGludGVydmFsSGFuZGxlID0gTWV0ZW9yLnNldEludGVydmFsKFxuICAgICAgXy5iaW5kKHNlbGYuX2Vuc3VyZVBvbGxJc1NjaGVkdWxlZCwgc2VsZiksIHBvbGxpbmdJbnRlcnZhbCk7XG4gICAgc2VsZi5fc3RvcENhbGxiYWNrcy5wdXNoKGZ1bmN0aW9uICgpIHtcbiAgICAgIE1ldGVvci5jbGVhckludGVydmFsKGludGVydmFsSGFuZGxlKTtcbiAgICB9KTtcbiAgfVxuXG4gIC8vIE1ha2Ugc3VyZSB3ZSBhY3R1YWxseSBwb2xsIHNvb24hXG4gIHNlbGYuX3VudGhyb3R0bGVkRW5zdXJlUG9sbElzU2NoZWR1bGVkKCk7XG5cbiAgUGFja2FnZVsnZmFjdHMtYmFzZSddICYmIFBhY2thZ2VbJ2ZhY3RzLWJhc2UnXS5GYWN0cy5pbmNyZW1lbnRTZXJ2ZXJGYWN0KFxuICAgIFwibW9uZ28tbGl2ZWRhdGFcIiwgXCJvYnNlcnZlLWRyaXZlcnMtcG9sbGluZ1wiLCAxKTtcbn07XG5cbl8uZXh0ZW5kKFBvbGxpbmdPYnNlcnZlRHJpdmVyLnByb3RvdHlwZSwge1xuICAvLyBUaGlzIGlzIGFsd2F5cyBjYWxsZWQgdGhyb3VnaCBfLnRocm90dGxlIChleGNlcHQgb25jZSBhdCBzdGFydHVwKS5cbiAgX3VudGhyb3R0bGVkRW5zdXJlUG9sbElzU2NoZWR1bGVkOiBmdW5jdGlvbiAoKSB7XG4gICAgdmFyIHNlbGYgPSB0aGlzO1xuICAgIGlmIChzZWxmLl9wb2xsc1NjaGVkdWxlZEJ1dE5vdFN0YXJ0ZWQgPiAwKVxuICAgICAgcmV0dXJuO1xuICAgICsrc2VsZi5fcG9sbHNTY2hlZHVsZWRCdXROb3RTdGFydGVkO1xuICAgIHNlbGYuX3Rhc2tRdWV1ZS5xdWV1ZVRhc2soZnVuY3Rpb24gKCkge1xuICAgICAgc2VsZi5fcG9sbE1vbmdvKCk7XG4gICAgfSk7XG4gIH0sXG5cbiAgLy8gdGVzdC1vbmx5IGludGVyZmFjZSBmb3IgY29udHJvbGxpbmcgcG9sbGluZy5cbiAgLy9cbiAgLy8gX3N1c3BlbmRQb2xsaW5nIGJsb2NrcyB1bnRpbCBhbnkgY3VycmVudGx5IHJ1bm5pbmcgYW5kIHNjaGVkdWxlZCBwb2xscyBhcmVcbiAgLy8gZG9uZSwgYW5kIHByZXZlbnRzIGFueSBmdXJ0aGVyIHBvbGxzIGZyb20gYmVpbmcgc2NoZWR1bGVkLiAobmV3XG4gIC8vIE9ic2VydmVIYW5kbGVzIGNhbiBiZSBhZGRlZCBhbmQgcmVjZWl2ZSB0aGVpciBpbml0aWFsIGFkZGVkIGNhbGxiYWNrcyxcbiAgLy8gdGhvdWdoLilcbiAgLy9cbiAgLy8gX3Jlc3VtZVBvbGxpbmcgaW1tZWRpYXRlbHkgcG9sbHMsIGFuZCBhbGxvd3MgZnVydGhlciBwb2xscyB0byBvY2N1ci5cbiAgX3N1c3BlbmRQb2xsaW5nOiBmdW5jdGlvbigpIHtcbiAgICB2YXIgc2VsZiA9IHRoaXM7XG4gICAgLy8gUHJldGVuZCB0aGF0IHRoZXJlJ3MgYW5vdGhlciBwb2xsIHNjaGVkdWxlZCAod2hpY2ggd2lsbCBwcmV2ZW50XG4gICAgLy8gX2Vuc3VyZVBvbGxJc1NjaGVkdWxlZCBmcm9tIHF1ZXVlaW5nIGFueSBtb3JlIHBvbGxzKS5cbiAgICArK3NlbGYuX3BvbGxzU2NoZWR1bGVkQnV0Tm90U3RhcnRlZDtcbiAgICAvLyBOb3cgYmxvY2sgdW50aWwgYWxsIGN1cnJlbnRseSBydW5uaW5nIG9yIHNjaGVkdWxlZCBwb2xscyBhcmUgZG9uZS5cbiAgICBzZWxmLl90YXNrUXVldWUucnVuVGFzayhmdW5jdGlvbigpIHt9KTtcblxuICAgIC8vIENvbmZpcm0gdGhhdCB0aGVyZSBpcyBvbmx5IG9uZSBcInBvbGxcIiAodGhlIGZha2Ugb25lIHdlJ3JlIHByZXRlbmRpbmcgdG9cbiAgICAvLyBoYXZlKSBzY2hlZHVsZWQuXG4gICAgaWYgKHNlbGYuX3BvbGxzU2NoZWR1bGVkQnV0Tm90U3RhcnRlZCAhPT0gMSlcbiAgICAgIHRocm93IG5ldyBFcnJvcihcIl9wb2xsc1NjaGVkdWxlZEJ1dE5vdFN0YXJ0ZWQgaXMgXCIgK1xuICAgICAgICAgICAgICAgICAgICAgIHNlbGYuX3BvbGxzU2NoZWR1bGVkQnV0Tm90U3RhcnRlZCk7XG4gIH0sXG4gIF9yZXN1bWVQb2xsaW5nOiBmdW5jdGlvbigpIHtcbiAgICB2YXIgc2VsZiA9IHRoaXM7XG4gICAgLy8gV2Ugc2hvdWxkIGJlIGluIHRoZSBzYW1lIHN0YXRlIGFzIGluIHRoZSBlbmQgb2YgX3N1c3BlbmRQb2xsaW5nLlxuICAgIGlmIChzZWxmLl9wb2xsc1NjaGVkdWxlZEJ1dE5vdFN0YXJ0ZWQgIT09IDEpXG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXCJfcG9sbHNTY2hlZHVsZWRCdXROb3RTdGFydGVkIGlzIFwiICtcbiAgICAgICAgICAgICAgICAgICAgICBzZWxmLl9wb2xsc1NjaGVkdWxlZEJ1dE5vdFN0YXJ0ZWQpO1xuICAgIC8vIFJ1biBhIHBvbGwgc3luY2hyb25vdXNseSAod2hpY2ggd2lsbCBjb3VudGVyYWN0IHRoZVxuICAgIC8vICsrX3BvbGxzU2NoZWR1bGVkQnV0Tm90U3RhcnRlZCBmcm9tIF9zdXNwZW5kUG9sbGluZykuXG4gICAgc2VsZi5fdGFza1F1ZXVlLnJ1blRhc2soZnVuY3Rpb24gKCkge1xuICAgICAgc2VsZi5fcG9sbE1vbmdvKCk7XG4gICAgfSk7XG4gIH0sXG5cbiAgX3BvbGxNb25nbzogZnVuY3Rpb24gKCkge1xuICAgIHZhciBzZWxmID0gdGhpcztcbiAgICAtLXNlbGYuX3BvbGxzU2NoZWR1bGVkQnV0Tm90U3RhcnRlZDtcblxuICAgIGlmIChzZWxmLl9zdG9wcGVkKVxuICAgICAgcmV0dXJuO1xuXG4gICAgdmFyIGZpcnN0ID0gZmFsc2U7XG4gICAgdmFyIG5ld1Jlc3VsdHM7XG4gICAgdmFyIG9sZFJlc3VsdHMgPSBzZWxmLl9yZXN1bHRzO1xuICAgIGlmICghb2xkUmVzdWx0cykge1xuICAgICAgZmlyc3QgPSB0cnVlO1xuICAgICAgLy8gWFhYIG1heWJlIHVzZSBPcmRlcmVkRGljdCBpbnN0ZWFkP1xuICAgICAgb2xkUmVzdWx0cyA9IHNlbGYuX29yZGVyZWQgPyBbXSA6IG5ldyBMb2NhbENvbGxlY3Rpb24uX0lkTWFwO1xuICAgIH1cblxuICAgIHNlbGYuX3Rlc3RPbmx5UG9sbENhbGxiYWNrICYmIHNlbGYuX3Rlc3RPbmx5UG9sbENhbGxiYWNrKCk7XG5cbiAgICAvLyBTYXZlIHRoZSBsaXN0IG9mIHBlbmRpbmcgd3JpdGVzIHdoaWNoIHRoaXMgcm91bmQgd2lsbCBjb21taXQuXG4gICAgdmFyIHdyaXRlc0ZvckN5Y2xlID0gc2VsZi5fcGVuZGluZ1dyaXRlcztcbiAgICBzZWxmLl9wZW5kaW5nV3JpdGVzID0gW107XG5cbiAgICAvLyBHZXQgdGhlIG5ldyBxdWVyeSByZXN1bHRzLiAoVGhpcyB5aWVsZHMuKVxuICAgIHRyeSB7XG4gICAgICBuZXdSZXN1bHRzID0gc2VsZi5fc3luY2hyb25vdXNDdXJzb3IuZ2V0UmF3T2JqZWN0cyhzZWxmLl9vcmRlcmVkKTtcbiAgICB9IGNhdGNoIChlKSB7XG4gICAgICBpZiAoZmlyc3QgJiYgdHlwZW9mKGUuY29kZSkgPT09ICdudW1iZXInKSB7XG4gICAgICAgIC8vIFRoaXMgaXMgYW4gZXJyb3IgZG9jdW1lbnQgc2VudCB0byB1cyBieSBtb25nb2QsIG5vdCBhIGNvbm5lY3Rpb25cbiAgICAgICAgLy8gZXJyb3IgZ2VuZXJhdGVkIGJ5IHRoZSBjbGllbnQuIEFuZCB3ZSd2ZSBuZXZlciBzZWVuIHRoaXMgcXVlcnkgd29ya1xuICAgICAgICAvLyBzdWNjZXNzZnVsbHkuIFByb2JhYmx5IGl0J3MgYSBiYWQgc2VsZWN0b3Igb3Igc29tZXRoaW5nLCBzbyB3ZSBzaG91bGRcbiAgICAgICAgLy8gTk9UIHJldHJ5LiBJbnN0ZWFkLCB3ZSBzaG91bGQgaGFsdCB0aGUgb2JzZXJ2ZSAod2hpY2ggZW5kcyB1cCBjYWxsaW5nXG4gICAgICAgIC8vIGBzdG9wYCBvbiB1cykuXG4gICAgICAgIHNlbGYuX211bHRpcGxleGVyLnF1ZXJ5RXJyb3IoXG4gICAgICAgICAgbmV3IEVycm9yKFxuICAgICAgICAgICAgXCJFeGNlcHRpb24gd2hpbGUgcG9sbGluZyBxdWVyeSBcIiArXG4gICAgICAgICAgICAgIEpTT04uc3RyaW5naWZ5KHNlbGYuX2N1cnNvckRlc2NyaXB0aW9uKSArIFwiOiBcIiArIGUubWVzc2FnZSkpO1xuICAgICAgICByZXR1cm47XG4gICAgICB9XG5cbiAgICAgIC8vIGdldFJhd09iamVjdHMgY2FuIHRocm93IGlmIHdlJ3JlIGhhdmluZyB0cm91YmxlIHRhbGtpbmcgdG8gdGhlXG4gICAgICAvLyBkYXRhYmFzZS4gIFRoYXQncyBmaW5lIC0tLSB3ZSB3aWxsIHJlcG9sbCBsYXRlciBhbnl3YXkuIEJ1dCB3ZSBzaG91bGRcbiAgICAgIC8vIG1ha2Ugc3VyZSBub3QgdG8gbG9zZSB0cmFjayBvZiB0aGlzIGN5Y2xlJ3Mgd3JpdGVzLlxuICAgICAgLy8gKEl0IGFsc28gY2FuIHRocm93IGlmIHRoZXJlJ3MganVzdCBzb21ldGhpbmcgaW52YWxpZCBhYm91dCB0aGlzIHF1ZXJ5O1xuICAgICAgLy8gdW5mb3J0dW5hdGVseSB0aGUgT2JzZXJ2ZURyaXZlciBBUEkgZG9lc24ndCBwcm92aWRlIGEgZ29vZCB3YXkgdG9cbiAgICAgIC8vIFwiY2FuY2VsXCIgdGhlIG9ic2VydmUgZnJvbSB0aGUgaW5zaWRlIGluIHRoaXMgY2FzZS5cbiAgICAgIEFycmF5LnByb3RvdHlwZS5wdXNoLmFwcGx5KHNlbGYuX3BlbmRpbmdXcml0ZXMsIHdyaXRlc0ZvckN5Y2xlKTtcbiAgICAgIE1ldGVvci5fZGVidWcoXCJFeGNlcHRpb24gd2hpbGUgcG9sbGluZyBxdWVyeSBcIiArXG4gICAgICAgICAgICAgICAgICAgIEpTT04uc3RyaW5naWZ5KHNlbGYuX2N1cnNvckRlc2NyaXB0aW9uKSwgZSk7XG4gICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgLy8gUnVuIGRpZmZzLlxuICAgIGlmICghc2VsZi5fc3RvcHBlZCkge1xuICAgICAgTG9jYWxDb2xsZWN0aW9uLl9kaWZmUXVlcnlDaGFuZ2VzKFxuICAgICAgICBzZWxmLl9vcmRlcmVkLCBvbGRSZXN1bHRzLCBuZXdSZXN1bHRzLCBzZWxmLl9tdWx0aXBsZXhlcik7XG4gICAgfVxuXG4gICAgLy8gU2lnbmFscyB0aGUgbXVsdGlwbGV4ZXIgdG8gYWxsb3cgYWxsIG9ic2VydmVDaGFuZ2VzIGNhbGxzIHRoYXQgc2hhcmUgdGhpc1xuICAgIC8vIG11bHRpcGxleGVyIHRvIHJldHVybi4gKFRoaXMgaGFwcGVucyBhc3luY2hyb25vdXNseSwgdmlhIHRoZVxuICAgIC8vIG11bHRpcGxleGVyJ3MgcXVldWUuKVxuICAgIGlmIChmaXJzdClcbiAgICAgIHNlbGYuX211bHRpcGxleGVyLnJlYWR5KCk7XG5cbiAgICAvLyBSZXBsYWNlIHNlbGYuX3Jlc3VsdHMgYXRvbWljYWxseS4gIChUaGlzIGFzc2lnbm1lbnQgaXMgd2hhdCBtYWtlcyBgZmlyc3RgXG4gICAgLy8gc3RheSB0aHJvdWdoIG9uIHRoZSBuZXh0IGN5Y2xlLCBzbyB3ZSd2ZSB3YWl0ZWQgdW50aWwgYWZ0ZXIgd2UndmVcbiAgICAvLyBjb21taXR0ZWQgdG8gcmVhZHktaW5nIHRoZSBtdWx0aXBsZXhlci4pXG4gICAgc2VsZi5fcmVzdWx0cyA9IG5ld1Jlc3VsdHM7XG5cbiAgICAvLyBPbmNlIHRoZSBPYnNlcnZlTXVsdGlwbGV4ZXIgaGFzIHByb2Nlc3NlZCBldmVyeXRoaW5nIHdlJ3ZlIGRvbmUgaW4gdGhpc1xuICAgIC8vIHJvdW5kLCBtYXJrIGFsbCB0aGUgd3JpdGVzIHdoaWNoIGV4aXN0ZWQgYmVmb3JlIHRoaXMgY2FsbCBhc1xuICAgIC8vIGNvbW1taXR0ZWQuIChJZiBuZXcgd3JpdGVzIGhhdmUgc2hvd24gdXAgaW4gdGhlIG1lYW50aW1lLCB0aGVyZSdsbFxuICAgIC8vIGFscmVhZHkgYmUgYW5vdGhlciBfcG9sbE1vbmdvIHRhc2sgc2NoZWR1bGVkLilcbiAgICBzZWxmLl9tdWx0aXBsZXhlci5vbkZsdXNoKGZ1bmN0aW9uICgpIHtcbiAgICAgIF8uZWFjaCh3cml0ZXNGb3JDeWNsZSwgZnVuY3Rpb24gKHcpIHtcbiAgICAgICAgdy5jb21taXR0ZWQoKTtcbiAgICAgIH0pO1xuICAgIH0pO1xuICB9LFxuXG4gIHN0b3A6IGZ1bmN0aW9uICgpIHtcbiAgICB2YXIgc2VsZiA9IHRoaXM7XG4gICAgc2VsZi5fc3RvcHBlZCA9IHRydWU7XG4gICAgXy5lYWNoKHNlbGYuX3N0b3BDYWxsYmFja3MsIGZ1bmN0aW9uIChjKSB7IGMoKTsgfSk7XG4gICAgLy8gUmVsZWFzZSBhbnkgd3JpdGUgZmVuY2VzIHRoYXQgYXJlIHdhaXRpbmcgb24gdXMuXG4gICAgXy5lYWNoKHNlbGYuX3BlbmRpbmdXcml0ZXMsIGZ1bmN0aW9uICh3KSB7XG4gICAgICB3LmNvbW1pdHRlZCgpO1xuICAgIH0pO1xuICAgIFBhY2thZ2VbJ2ZhY3RzLWJhc2UnXSAmJiBQYWNrYWdlWydmYWN0cy1iYXNlJ10uRmFjdHMuaW5jcmVtZW50U2VydmVyRmFjdChcbiAgICAgIFwibW9uZ28tbGl2ZWRhdGFcIiwgXCJvYnNlcnZlLWRyaXZlcnMtcG9sbGluZ1wiLCAtMSk7XG4gIH1cbn0pO1xuIiwiaW1wb3J0IHsgb3Bsb2dWMlYxQ29udmVydGVyIH0gZnJvbSBcIi4vb3Bsb2dfdjJfY29udmVydGVyXCI7XG5cbnZhciBGdXR1cmUgPSBOcG0ucmVxdWlyZSgnZmliZXJzL2Z1dHVyZScpO1xuXG52YXIgUEhBU0UgPSB7XG4gIFFVRVJZSU5HOiBcIlFVRVJZSU5HXCIsXG4gIEZFVENISU5HOiBcIkZFVENISU5HXCIsXG4gIFNURUFEWTogXCJTVEVBRFlcIlxufTtcblxuLy8gRXhjZXB0aW9uIHRocm93biBieSBfbmVlZFRvUG9sbFF1ZXJ5IHdoaWNoIHVucm9sbHMgdGhlIHN0YWNrIHVwIHRvIHRoZVxuLy8gZW5jbG9zaW5nIGNhbGwgdG8gZmluaXNoSWZOZWVkVG9Qb2xsUXVlcnkuXG52YXIgU3dpdGNoZWRUb1F1ZXJ5ID0gZnVuY3Rpb24gKCkge307XG52YXIgZmluaXNoSWZOZWVkVG9Qb2xsUXVlcnkgPSBmdW5jdGlvbiAoZikge1xuICByZXR1cm4gZnVuY3Rpb24gKCkge1xuICAgIHRyeSB7XG4gICAgICBmLmFwcGx5KHRoaXMsIGFyZ3VtZW50cyk7XG4gICAgfSBjYXRjaCAoZSkge1xuICAgICAgaWYgKCEoZSBpbnN0YW5jZW9mIFN3aXRjaGVkVG9RdWVyeSkpXG4gICAgICAgIHRocm93IGU7XG4gICAgfVxuICB9O1xufTtcblxudmFyIGN1cnJlbnRJZCA9IDA7XG5cbi8vIE9wbG9nT2JzZXJ2ZURyaXZlciBpcyBhbiBhbHRlcm5hdGl2ZSB0byBQb2xsaW5nT2JzZXJ2ZURyaXZlciB3aGljaCBmb2xsb3dzXG4vLyB0aGUgTW9uZ28gb3BlcmF0aW9uIGxvZyBpbnN0ZWFkIG9mIGp1c3QgcmUtcG9sbGluZyB0aGUgcXVlcnkuIEl0IG9iZXlzIHRoZVxuLy8gc2FtZSBzaW1wbGUgaW50ZXJmYWNlOiBjb25zdHJ1Y3RpbmcgaXQgc3RhcnRzIHNlbmRpbmcgb2JzZXJ2ZUNoYW5nZXNcbi8vIGNhbGxiYWNrcyAoYW5kIGEgcmVhZHkoKSBpbnZvY2F0aW9uKSB0byB0aGUgT2JzZXJ2ZU11bHRpcGxleGVyLCBhbmQgeW91IHN0b3Bcbi8vIGl0IGJ5IGNhbGxpbmcgdGhlIHN0b3AoKSBtZXRob2QuXG5PcGxvZ09ic2VydmVEcml2ZXIgPSBmdW5jdGlvbiAob3B0aW9ucykge1xuICB2YXIgc2VsZiA9IHRoaXM7XG4gIHNlbGYuX3VzZXNPcGxvZyA9IHRydWU7ICAvLyB0ZXN0cyBsb29rIGF0IHRoaXNcblxuICBzZWxmLl9pZCA9IGN1cnJlbnRJZDtcbiAgY3VycmVudElkKys7XG5cbiAgc2VsZi5fY3Vyc29yRGVzY3JpcHRpb24gPSBvcHRpb25zLmN1cnNvckRlc2NyaXB0aW9uO1xuICBzZWxmLl9tb25nb0hhbmRsZSA9IG9wdGlvbnMubW9uZ29IYW5kbGU7XG4gIHNlbGYuX211bHRpcGxleGVyID0gb3B0aW9ucy5tdWx0aXBsZXhlcjtcblxuICBpZiAob3B0aW9ucy5vcmRlcmVkKSB7XG4gICAgdGhyb3cgRXJyb3IoXCJPcGxvZ09ic2VydmVEcml2ZXIgb25seSBzdXBwb3J0cyB1bm9yZGVyZWQgb2JzZXJ2ZUNoYW5nZXNcIik7XG4gIH1cblxuICB2YXIgc29ydGVyID0gb3B0aW9ucy5zb3J0ZXI7XG4gIC8vIFdlIGRvbid0IHN1cHBvcnQgJG5lYXIgYW5kIG90aGVyIGdlby1xdWVyaWVzIHNvIGl0J3MgT0sgdG8gaW5pdGlhbGl6ZSB0aGVcbiAgLy8gY29tcGFyYXRvciBvbmx5IG9uY2UgaW4gdGhlIGNvbnN0cnVjdG9yLlxuICB2YXIgY29tcGFyYXRvciA9IHNvcnRlciAmJiBzb3J0ZXIuZ2V0Q29tcGFyYXRvcigpO1xuXG4gIGlmIChvcHRpb25zLmN1cnNvckRlc2NyaXB0aW9uLm9wdGlvbnMubGltaXQpIHtcbiAgICAvLyBUaGVyZSBhcmUgc2V2ZXJhbCBwcm9wZXJ0aWVzIG9yZGVyZWQgZHJpdmVyIGltcGxlbWVudHM6XG4gICAgLy8gLSBfbGltaXQgaXMgYSBwb3NpdGl2ZSBudW1iZXJcbiAgICAvLyAtIF9jb21wYXJhdG9yIGlzIGEgZnVuY3Rpb24tY29tcGFyYXRvciBieSB3aGljaCB0aGUgcXVlcnkgaXMgb3JkZXJlZFxuICAgIC8vIC0gX3VucHVibGlzaGVkQnVmZmVyIGlzIG5vbi1udWxsIE1pbi9NYXggSGVhcCxcbiAgICAvLyAgICAgICAgICAgICAgICAgICAgICB0aGUgZW1wdHkgYnVmZmVyIGluIFNURUFEWSBwaGFzZSBpbXBsaWVzIHRoYXQgdGhlXG4gICAgLy8gICAgICAgICAgICAgICAgICAgICAgZXZlcnl0aGluZyB0aGF0IG1hdGNoZXMgdGhlIHF1ZXJpZXMgc2VsZWN0b3IgZml0c1xuICAgIC8vICAgICAgICAgICAgICAgICAgICAgIGludG8gcHVibGlzaGVkIHNldC5cbiAgICAvLyAtIF9wdWJsaXNoZWQgLSBNYXggSGVhcCAoYWxzbyBpbXBsZW1lbnRzIElkTWFwIG1ldGhvZHMpXG5cbiAgICB2YXIgaGVhcE9wdGlvbnMgPSB7IElkTWFwOiBMb2NhbENvbGxlY3Rpb24uX0lkTWFwIH07XG4gICAgc2VsZi5fbGltaXQgPSBzZWxmLl9jdXJzb3JEZXNjcmlwdGlvbi5vcHRpb25zLmxpbWl0O1xuICAgIHNlbGYuX2NvbXBhcmF0b3IgPSBjb21wYXJhdG9yO1xuICAgIHNlbGYuX3NvcnRlciA9IHNvcnRlcjtcbiAgICBzZWxmLl91bnB1Ymxpc2hlZEJ1ZmZlciA9IG5ldyBNaW5NYXhIZWFwKGNvbXBhcmF0b3IsIGhlYXBPcHRpb25zKTtcbiAgICAvLyBXZSBuZWVkIHNvbWV0aGluZyB0aGF0IGNhbiBmaW5kIE1heCB2YWx1ZSBpbiBhZGRpdGlvbiB0byBJZE1hcCBpbnRlcmZhY2VcbiAgICBzZWxmLl9wdWJsaXNoZWQgPSBuZXcgTWF4SGVhcChjb21wYXJhdG9yLCBoZWFwT3B0aW9ucyk7XG4gIH0gZWxzZSB7XG4gICAgc2VsZi5fbGltaXQgPSAwO1xuICAgIHNlbGYuX2NvbXBhcmF0b3IgPSBudWxsO1xuICAgIHNlbGYuX3NvcnRlciA9IG51bGw7XG4gICAgc2VsZi5fdW5wdWJsaXNoZWRCdWZmZXIgPSBudWxsO1xuICAgIHNlbGYuX3B1Ymxpc2hlZCA9IG5ldyBMb2NhbENvbGxlY3Rpb24uX0lkTWFwO1xuICB9XG5cbiAgLy8gSW5kaWNhdGVzIGlmIGl0IGlzIHNhZmUgdG8gaW5zZXJ0IGEgbmV3IGRvY3VtZW50IGF0IHRoZSBlbmQgb2YgdGhlIGJ1ZmZlclxuICAvLyBmb3IgdGhpcyBxdWVyeS4gaS5lLiBpdCBpcyBrbm93biB0aGF0IHRoZXJlIGFyZSBubyBkb2N1bWVudHMgbWF0Y2hpbmcgdGhlXG4gIC8vIHNlbGVjdG9yIHRob3NlIGFyZSBub3QgaW4gcHVibGlzaGVkIG9yIGJ1ZmZlci5cbiAgc2VsZi5fc2FmZUFwcGVuZFRvQnVmZmVyID0gZmFsc2U7XG5cbiAgc2VsZi5fc3RvcHBlZCA9IGZhbHNlO1xuICBzZWxmLl9zdG9wSGFuZGxlcyA9IFtdO1xuXG4gIFBhY2thZ2VbJ2ZhY3RzLWJhc2UnXSAmJiBQYWNrYWdlWydmYWN0cy1iYXNlJ10uRmFjdHMuaW5jcmVtZW50U2VydmVyRmFjdChcbiAgICBcIm1vbmdvLWxpdmVkYXRhXCIsIFwib2JzZXJ2ZS1kcml2ZXJzLW9wbG9nXCIsIDEpO1xuXG4gIHNlbGYuX3JlZ2lzdGVyUGhhc2VDaGFuZ2UoUEhBU0UuUVVFUllJTkcpO1xuXG4gIHNlbGYuX21hdGNoZXIgPSBvcHRpb25zLm1hdGNoZXI7XG4gIC8vIHdlIGFyZSBub3cgdXNpbmcgcHJvamVjdGlvbiwgbm90IGZpZWxkcyBpbiB0aGUgY3Vyc29yIGRlc2NyaXB0aW9uIGV2ZW4gaWYgeW91IHBhc3Mge2ZpZWxkc31cbiAgLy8gaW4gdGhlIGN1cnNvciBjb25zdHJ1Y3Rpb25cbiAgdmFyIHByb2plY3Rpb24gPSBzZWxmLl9jdXJzb3JEZXNjcmlwdGlvbi5vcHRpb25zLmZpZWxkcyB8fCBzZWxmLl9jdXJzb3JEZXNjcmlwdGlvbi5vcHRpb25zLnByb2plY3Rpb24gfHwge307XG4gIHNlbGYuX3Byb2plY3Rpb25GbiA9IExvY2FsQ29sbGVjdGlvbi5fY29tcGlsZVByb2plY3Rpb24ocHJvamVjdGlvbik7XG4gIC8vIFByb2plY3Rpb24gZnVuY3Rpb24sIHJlc3VsdCBvZiBjb21iaW5pbmcgaW1wb3J0YW50IGZpZWxkcyBmb3Igc2VsZWN0b3IgYW5kXG4gIC8vIGV4aXN0aW5nIGZpZWxkcyBwcm9qZWN0aW9uXG4gIHNlbGYuX3NoYXJlZFByb2plY3Rpb24gPSBzZWxmLl9tYXRjaGVyLmNvbWJpbmVJbnRvUHJvamVjdGlvbihwcm9qZWN0aW9uKTtcbiAgaWYgKHNvcnRlcilcbiAgICBzZWxmLl9zaGFyZWRQcm9qZWN0aW9uID0gc29ydGVyLmNvbWJpbmVJbnRvUHJvamVjdGlvbihzZWxmLl9zaGFyZWRQcm9qZWN0aW9uKTtcbiAgc2VsZi5fc2hhcmVkUHJvamVjdGlvbkZuID0gTG9jYWxDb2xsZWN0aW9uLl9jb21waWxlUHJvamVjdGlvbihcbiAgICBzZWxmLl9zaGFyZWRQcm9qZWN0aW9uKTtcblxuICBzZWxmLl9uZWVkVG9GZXRjaCA9IG5ldyBMb2NhbENvbGxlY3Rpb24uX0lkTWFwO1xuICBzZWxmLl9jdXJyZW50bHlGZXRjaGluZyA9IG51bGw7XG4gIHNlbGYuX2ZldGNoR2VuZXJhdGlvbiA9IDA7XG5cbiAgc2VsZi5fcmVxdWVyeVdoZW5Eb25lVGhpc1F1ZXJ5ID0gZmFsc2U7XG4gIHNlbGYuX3dyaXRlc1RvQ29tbWl0V2hlbldlUmVhY2hTdGVhZHkgPSBbXTtcblxuICAvLyBJZiB0aGUgb3Bsb2cgaGFuZGxlIHRlbGxzIHVzIHRoYXQgaXQgc2tpcHBlZCBzb21lIGVudHJpZXMgKGJlY2F1c2UgaXQgZ290XG4gIC8vIGJlaGluZCwgc2F5KSwgcmUtcG9sbC5cbiAgc2VsZi5fc3RvcEhhbmRsZXMucHVzaChzZWxmLl9tb25nb0hhbmRsZS5fb3Bsb2dIYW5kbGUub25Ta2lwcGVkRW50cmllcyhcbiAgICBmaW5pc2hJZk5lZWRUb1BvbGxRdWVyeShmdW5jdGlvbiAoKSB7XG4gICAgICBzZWxmLl9uZWVkVG9Qb2xsUXVlcnkoKTtcbiAgICB9KVxuICApKTtcblxuICBmb3JFYWNoVHJpZ2dlcihzZWxmLl9jdXJzb3JEZXNjcmlwdGlvbiwgZnVuY3Rpb24gKHRyaWdnZXIpIHtcbiAgICBzZWxmLl9zdG9wSGFuZGxlcy5wdXNoKHNlbGYuX21vbmdvSGFuZGxlLl9vcGxvZ0hhbmRsZS5vbk9wbG9nRW50cnkoXG4gICAgICB0cmlnZ2VyLCBmdW5jdGlvbiAobm90aWZpY2F0aW9uKSB7XG4gICAgICAgIE1ldGVvci5fbm9ZaWVsZHNBbGxvd2VkKGZpbmlzaElmTmVlZFRvUG9sbFF1ZXJ5KGZ1bmN0aW9uICgpIHtcbiAgICAgICAgICB2YXIgb3AgPSBub3RpZmljYXRpb24ub3A7XG4gICAgICAgICAgaWYgKG5vdGlmaWNhdGlvbi5kcm9wQ29sbGVjdGlvbiB8fCBub3RpZmljYXRpb24uZHJvcERhdGFiYXNlKSB7XG4gICAgICAgICAgICAvLyBOb3RlOiB0aGlzIGNhbGwgaXMgbm90IGFsbG93ZWQgdG8gYmxvY2sgb24gYW55dGhpbmcgKGVzcGVjaWFsbHlcbiAgICAgICAgICAgIC8vIG9uIHdhaXRpbmcgZm9yIG9wbG9nIGVudHJpZXMgdG8gY2F0Y2ggdXApIGJlY2F1c2UgdGhhdCB3aWxsIGJsb2NrXG4gICAgICAgICAgICAvLyBvbk9wbG9nRW50cnkhXG4gICAgICAgICAgICBzZWxmLl9uZWVkVG9Qb2xsUXVlcnkoKTtcbiAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgLy8gQWxsIG90aGVyIG9wZXJhdG9ycyBzaG91bGQgYmUgaGFuZGxlZCBkZXBlbmRpbmcgb24gcGhhc2VcbiAgICAgICAgICAgIGlmIChzZWxmLl9waGFzZSA9PT0gUEhBU0UuUVVFUllJTkcpIHtcbiAgICAgICAgICAgICAgc2VsZi5faGFuZGxlT3Bsb2dFbnRyeVF1ZXJ5aW5nKG9wKTtcbiAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgIHNlbGYuX2hhbmRsZU9wbG9nRW50cnlTdGVhZHlPckZldGNoaW5nKG9wKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICB9XG4gICAgICAgIH0pKTtcbiAgICAgIH1cbiAgICApKTtcbiAgfSk7XG5cbiAgLy8gWFhYIG9yZGVyaW5nIHcuci50LiBldmVyeXRoaW5nIGVsc2U/XG4gIHNlbGYuX3N0b3BIYW5kbGVzLnB1c2gobGlzdGVuQWxsKFxuICAgIHNlbGYuX2N1cnNvckRlc2NyaXB0aW9uLCBmdW5jdGlvbiAobm90aWZpY2F0aW9uKSB7XG4gICAgICAvLyBJZiB3ZSdyZSBub3QgaW4gYSBwcmUtZmlyZSB3cml0ZSBmZW5jZSwgd2UgZG9uJ3QgaGF2ZSB0byBkbyBhbnl0aGluZy5cbiAgICAgIHZhciBmZW5jZSA9IEREUFNlcnZlci5fQ3VycmVudFdyaXRlRmVuY2UuZ2V0KCk7XG4gICAgICBpZiAoIWZlbmNlIHx8IGZlbmNlLmZpcmVkKVxuICAgICAgICByZXR1cm47XG5cbiAgICAgIGlmIChmZW5jZS5fb3Bsb2dPYnNlcnZlRHJpdmVycykge1xuICAgICAgICBmZW5jZS5fb3Bsb2dPYnNlcnZlRHJpdmVyc1tzZWxmLl9pZF0gPSBzZWxmO1xuICAgICAgICByZXR1cm47XG4gICAgICB9XG5cbiAgICAgIGZlbmNlLl9vcGxvZ09ic2VydmVEcml2ZXJzID0ge307XG4gICAgICBmZW5jZS5fb3Bsb2dPYnNlcnZlRHJpdmVyc1tzZWxmLl9pZF0gPSBzZWxmO1xuXG4gICAgICBmZW5jZS5vbkJlZm9yZUZpcmUoZnVuY3Rpb24gKCkge1xuICAgICAgICB2YXIgZHJpdmVycyA9IGZlbmNlLl9vcGxvZ09ic2VydmVEcml2ZXJzO1xuICAgICAgICBkZWxldGUgZmVuY2UuX29wbG9nT2JzZXJ2ZURyaXZlcnM7XG5cbiAgICAgICAgLy8gVGhpcyBmZW5jZSBjYW5ub3QgZmlyZSB1bnRpbCB3ZSd2ZSBjYXVnaHQgdXAgdG8gXCJ0aGlzIHBvaW50XCIgaW4gdGhlXG4gICAgICAgIC8vIG9wbG9nLCBhbmQgYWxsIG9ic2VydmVycyBtYWRlIGl0IGJhY2sgdG8gdGhlIHN0ZWFkeSBzdGF0ZS5cbiAgICAgICAgc2VsZi5fbW9uZ29IYW5kbGUuX29wbG9nSGFuZGxlLndhaXRVbnRpbENhdWdodFVwKCk7XG5cbiAgICAgICAgXy5lYWNoKGRyaXZlcnMsIGZ1bmN0aW9uIChkcml2ZXIpIHtcbiAgICAgICAgICBpZiAoZHJpdmVyLl9zdG9wcGVkKVxuICAgICAgICAgICAgcmV0dXJuO1xuXG4gICAgICAgICAgdmFyIHdyaXRlID0gZmVuY2UuYmVnaW5Xcml0ZSgpO1xuICAgICAgICAgIGlmIChkcml2ZXIuX3BoYXNlID09PSBQSEFTRS5TVEVBRFkpIHtcbiAgICAgICAgICAgIC8vIE1ha2Ugc3VyZSB0aGF0IGFsbCBvZiB0aGUgY2FsbGJhY2tzIGhhdmUgbWFkZSBpdCB0aHJvdWdoIHRoZVxuICAgICAgICAgICAgLy8gbXVsdGlwbGV4ZXIgYW5kIGJlZW4gZGVsaXZlcmVkIHRvIE9ic2VydmVIYW5kbGVzIGJlZm9yZSBjb21taXR0aW5nXG4gICAgICAgICAgICAvLyB3cml0ZXMuXG4gICAgICAgICAgICBkcml2ZXIuX211bHRpcGxleGVyLm9uRmx1c2goZnVuY3Rpb24gKCkge1xuICAgICAgICAgICAgICB3cml0ZS5jb21taXR0ZWQoKTtcbiAgICAgICAgICAgIH0pO1xuICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICBkcml2ZXIuX3dyaXRlc1RvQ29tbWl0V2hlbldlUmVhY2hTdGVhZHkucHVzaCh3cml0ZSk7XG4gICAgICAgICAgfVxuICAgICAgICB9KTtcbiAgICAgIH0pO1xuICAgIH1cbiAgKSk7XG5cbiAgLy8gV2hlbiBNb25nbyBmYWlscyBvdmVyLCB3ZSBuZWVkIHRvIHJlcG9sbCB0aGUgcXVlcnksIGluIGNhc2Ugd2UgcHJvY2Vzc2VkIGFuXG4gIC8vIG9wbG9nIGVudHJ5IHRoYXQgZ290IHJvbGxlZCBiYWNrLlxuICBzZWxmLl9zdG9wSGFuZGxlcy5wdXNoKHNlbGYuX21vbmdvSGFuZGxlLl9vbkZhaWxvdmVyKGZpbmlzaElmTmVlZFRvUG9sbFF1ZXJ5KFxuICAgIGZ1bmN0aW9uICgpIHtcbiAgICAgIHNlbGYuX25lZWRUb1BvbGxRdWVyeSgpO1xuICAgIH0pKSk7XG5cbiAgLy8gR2l2ZSBfb2JzZXJ2ZUNoYW5nZXMgYSBjaGFuY2UgdG8gYWRkIHRoZSBuZXcgT2JzZXJ2ZUhhbmRsZSB0byBvdXJcbiAgLy8gbXVsdGlwbGV4ZXIsIHNvIHRoYXQgdGhlIGFkZGVkIGNhbGxzIGdldCBzdHJlYW1lZC5cbiAgTWV0ZW9yLmRlZmVyKGZpbmlzaElmTmVlZFRvUG9sbFF1ZXJ5KGZ1bmN0aW9uICgpIHtcbiAgICBzZWxmLl9ydW5Jbml0aWFsUXVlcnkoKTtcbiAgfSkpO1xufTtcblxuXy5leHRlbmQoT3Bsb2dPYnNlcnZlRHJpdmVyLnByb3RvdHlwZSwge1xuICBfYWRkUHVibGlzaGVkOiBmdW5jdGlvbiAoaWQsIGRvYykge1xuICAgIHZhciBzZWxmID0gdGhpcztcbiAgICBNZXRlb3IuX25vWWllbGRzQWxsb3dlZChmdW5jdGlvbiAoKSB7XG4gICAgICB2YXIgZmllbGRzID0gXy5jbG9uZShkb2MpO1xuICAgICAgZGVsZXRlIGZpZWxkcy5faWQ7XG4gICAgICBzZWxmLl9wdWJsaXNoZWQuc2V0KGlkLCBzZWxmLl9zaGFyZWRQcm9qZWN0aW9uRm4oZG9jKSk7XG4gICAgICBzZWxmLl9tdWx0aXBsZXhlci5hZGRlZChpZCwgc2VsZi5fcHJvamVjdGlvbkZuKGZpZWxkcykpO1xuXG4gICAgICAvLyBBZnRlciBhZGRpbmcgdGhpcyBkb2N1bWVudCwgdGhlIHB1Ymxpc2hlZCBzZXQgbWlnaHQgYmUgb3ZlcmZsb3dlZFxuICAgICAgLy8gKGV4Y2VlZGluZyBjYXBhY2l0eSBzcGVjaWZpZWQgYnkgbGltaXQpLiBJZiBzbywgcHVzaCB0aGUgbWF4aW11bVxuICAgICAgLy8gZWxlbWVudCB0byB0aGUgYnVmZmVyLCB3ZSBtaWdodCB3YW50IHRvIHNhdmUgaXQgaW4gbWVtb3J5IHRvIHJlZHVjZSB0aGVcbiAgICAgIC8vIGFtb3VudCBvZiBNb25nbyBsb29rdXBzIGluIHRoZSBmdXR1cmUuXG4gICAgICBpZiAoc2VsZi5fbGltaXQgJiYgc2VsZi5fcHVibGlzaGVkLnNpemUoKSA+IHNlbGYuX2xpbWl0KSB7XG4gICAgICAgIC8vIFhYWCBpbiB0aGVvcnkgdGhlIHNpemUgb2YgcHVibGlzaGVkIGlzIG5vIG1vcmUgdGhhbiBsaW1pdCsxXG4gICAgICAgIGlmIChzZWxmLl9wdWJsaXNoZWQuc2l6ZSgpICE9PSBzZWxmLl9saW1pdCArIDEpIHtcbiAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoXCJBZnRlciBhZGRpbmcgdG8gcHVibGlzaGVkLCBcIiArXG4gICAgICAgICAgICAgICAgICAgICAgICAgIChzZWxmLl9wdWJsaXNoZWQuc2l6ZSgpIC0gc2VsZi5fbGltaXQpICtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgXCIgZG9jdW1lbnRzIGFyZSBvdmVyZmxvd2luZyB0aGUgc2V0XCIpO1xuICAgICAgICB9XG5cbiAgICAgICAgdmFyIG92ZXJmbG93aW5nRG9jSWQgPSBzZWxmLl9wdWJsaXNoZWQubWF4RWxlbWVudElkKCk7XG4gICAgICAgIHZhciBvdmVyZmxvd2luZ0RvYyA9IHNlbGYuX3B1Ymxpc2hlZC5nZXQob3ZlcmZsb3dpbmdEb2NJZCk7XG5cbiAgICAgICAgaWYgKEVKU09OLmVxdWFscyhvdmVyZmxvd2luZ0RvY0lkLCBpZCkpIHtcbiAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoXCJUaGUgZG9jdW1lbnQganVzdCBhZGRlZCBpcyBvdmVyZmxvd2luZyB0aGUgcHVibGlzaGVkIHNldFwiKTtcbiAgICAgICAgfVxuXG4gICAgICAgIHNlbGYuX3B1Ymxpc2hlZC5yZW1vdmUob3ZlcmZsb3dpbmdEb2NJZCk7XG4gICAgICAgIHNlbGYuX211bHRpcGxleGVyLnJlbW92ZWQob3ZlcmZsb3dpbmdEb2NJZCk7XG4gICAgICAgIHNlbGYuX2FkZEJ1ZmZlcmVkKG92ZXJmbG93aW5nRG9jSWQsIG92ZXJmbG93aW5nRG9jKTtcbiAgICAgIH1cbiAgICB9KTtcbiAgfSxcbiAgX3JlbW92ZVB1Ymxpc2hlZDogZnVuY3Rpb24gKGlkKSB7XG4gICAgdmFyIHNlbGYgPSB0aGlzO1xuICAgIE1ldGVvci5fbm9ZaWVsZHNBbGxvd2VkKGZ1bmN0aW9uICgpIHtcbiAgICAgIHNlbGYuX3B1Ymxpc2hlZC5yZW1vdmUoaWQpO1xuICAgICAgc2VsZi5fbXVsdGlwbGV4ZXIucmVtb3ZlZChpZCk7XG4gICAgICBpZiAoISBzZWxmLl9saW1pdCB8fCBzZWxmLl9wdWJsaXNoZWQuc2l6ZSgpID09PSBzZWxmLl9saW1pdClcbiAgICAgICAgcmV0dXJuO1xuXG4gICAgICBpZiAoc2VsZi5fcHVibGlzaGVkLnNpemUoKSA+IHNlbGYuX2xpbWl0KVxuICAgICAgICB0aHJvdyBFcnJvcihcInNlbGYuX3B1Ymxpc2hlZCBnb3QgdG9vIGJpZ1wiKTtcblxuICAgICAgLy8gT0ssIHdlIGFyZSBwdWJsaXNoaW5nIGxlc3MgdGhhbiB0aGUgbGltaXQuIE1heWJlIHdlIHNob3VsZCBsb29rIGluIHRoZVxuICAgICAgLy8gYnVmZmVyIHRvIGZpbmQgdGhlIG5leHQgZWxlbWVudCBwYXN0IHdoYXQgd2Ugd2VyZSBwdWJsaXNoaW5nIGJlZm9yZS5cblxuICAgICAgaWYgKCFzZWxmLl91bnB1Ymxpc2hlZEJ1ZmZlci5lbXB0eSgpKSB7XG4gICAgICAgIC8vIFRoZXJlJ3Mgc29tZXRoaW5nIGluIHRoZSBidWZmZXI7IG1vdmUgdGhlIGZpcnN0IHRoaW5nIGluIGl0IHRvXG4gICAgICAgIC8vIF9wdWJsaXNoZWQuXG4gICAgICAgIHZhciBuZXdEb2NJZCA9IHNlbGYuX3VucHVibGlzaGVkQnVmZmVyLm1pbkVsZW1lbnRJZCgpO1xuICAgICAgICB2YXIgbmV3RG9jID0gc2VsZi5fdW5wdWJsaXNoZWRCdWZmZXIuZ2V0KG5ld0RvY0lkKTtcbiAgICAgICAgc2VsZi5fcmVtb3ZlQnVmZmVyZWQobmV3RG9jSWQpO1xuICAgICAgICBzZWxmLl9hZGRQdWJsaXNoZWQobmV3RG9jSWQsIG5ld0RvYyk7XG4gICAgICAgIHJldHVybjtcbiAgICAgIH1cblxuICAgICAgLy8gVGhlcmUncyBub3RoaW5nIGluIHRoZSBidWZmZXIuICBUaGlzIGNvdWxkIG1lYW4gb25lIG9mIGEgZmV3IHRoaW5ncy5cblxuICAgICAgLy8gKGEpIFdlIGNvdWxkIGJlIGluIHRoZSBtaWRkbGUgb2YgcmUtcnVubmluZyB0aGUgcXVlcnkgKHNwZWNpZmljYWxseSwgd2VcbiAgICAgIC8vIGNvdWxkIGJlIGluIF9wdWJsaXNoTmV3UmVzdWx0cykuIEluIHRoYXQgY2FzZSwgX3VucHVibGlzaGVkQnVmZmVyIGlzXG4gICAgICAvLyBlbXB0eSBiZWNhdXNlIHdlIGNsZWFyIGl0IGF0IHRoZSBiZWdpbm5pbmcgb2YgX3B1Ymxpc2hOZXdSZXN1bHRzLiBJblxuICAgICAgLy8gdGhpcyBjYXNlLCBvdXIgY2FsbGVyIGFscmVhZHkga25vd3MgdGhlIGVudGlyZSBhbnN3ZXIgdG8gdGhlIHF1ZXJ5IGFuZFxuICAgICAgLy8gd2UgZG9uJ3QgbmVlZCB0byBkbyBhbnl0aGluZyBmYW5jeSBoZXJlLiAgSnVzdCByZXR1cm4uXG4gICAgICBpZiAoc2VsZi5fcGhhc2UgPT09IFBIQVNFLlFVRVJZSU5HKVxuICAgICAgICByZXR1cm47XG5cbiAgICAgIC8vIChiKSBXZSdyZSBwcmV0dHkgY29uZmlkZW50IHRoYXQgdGhlIHVuaW9uIG9mIF9wdWJsaXNoZWQgYW5kXG4gICAgICAvLyBfdW5wdWJsaXNoZWRCdWZmZXIgY29udGFpbiBhbGwgZG9jdW1lbnRzIHRoYXQgbWF0Y2ggc2VsZWN0b3IuIEJlY2F1c2VcbiAgICAgIC8vIF91bnB1Ymxpc2hlZEJ1ZmZlciBpcyBlbXB0eSwgdGhhdCBtZWFucyB3ZSdyZSBjb25maWRlbnQgdGhhdCBfcHVibGlzaGVkXG4gICAgICAvLyBjb250YWlucyBhbGwgZG9jdW1lbnRzIHRoYXQgbWF0Y2ggc2VsZWN0b3IuIFNvIHdlIGhhdmUgbm90aGluZyB0byBkby5cbiAgICAgIGlmIChzZWxmLl9zYWZlQXBwZW5kVG9CdWZmZXIpXG4gICAgICAgIHJldHVybjtcblxuICAgICAgLy8gKGMpIE1heWJlIHRoZXJlIGFyZSBvdGhlciBkb2N1bWVudHMgb3V0IHRoZXJlIHRoYXQgc2hvdWxkIGJlIGluIG91clxuICAgICAgLy8gYnVmZmVyLiBCdXQgaW4gdGhhdCBjYXNlLCB3aGVuIHdlIGVtcHRpZWQgX3VucHVibGlzaGVkQnVmZmVyIGluXG4gICAgICAvLyBfcmVtb3ZlQnVmZmVyZWQsIHdlIHNob3VsZCBoYXZlIGNhbGxlZCBfbmVlZFRvUG9sbFF1ZXJ5LCB3aGljaCB3aWxsXG4gICAgICAvLyBlaXRoZXIgcHV0IHNvbWV0aGluZyBpbiBfdW5wdWJsaXNoZWRCdWZmZXIgb3Igc2V0IF9zYWZlQXBwZW5kVG9CdWZmZXJcbiAgICAgIC8vIChvciBib3RoKSwgYW5kIGl0IHdpbGwgcHV0IHVzIGluIFFVRVJZSU5HIGZvciB0aGF0IHdob2xlIHRpbWUuIFNvIGluXG4gICAgICAvLyBmYWN0LCB3ZSBzaG91bGRuJ3QgYmUgYWJsZSB0byBnZXQgaGVyZS5cblxuICAgICAgdGhyb3cgbmV3IEVycm9yKFwiQnVmZmVyIGluZXhwbGljYWJseSBlbXB0eVwiKTtcbiAgICB9KTtcbiAgfSxcbiAgX2NoYW5nZVB1Ymxpc2hlZDogZnVuY3Rpb24gKGlkLCBvbGREb2MsIG5ld0RvYykge1xuICAgIHZhciBzZWxmID0gdGhpcztcbiAgICBNZXRlb3IuX25vWWllbGRzQWxsb3dlZChmdW5jdGlvbiAoKSB7XG4gICAgICBzZWxmLl9wdWJsaXNoZWQuc2V0KGlkLCBzZWxmLl9zaGFyZWRQcm9qZWN0aW9uRm4obmV3RG9jKSk7XG4gICAgICB2YXIgcHJvamVjdGVkTmV3ID0gc2VsZi5fcHJvamVjdGlvbkZuKG5ld0RvYyk7XG4gICAgICB2YXIgcHJvamVjdGVkT2xkID0gc2VsZi5fcHJvamVjdGlvbkZuKG9sZERvYyk7XG4gICAgICB2YXIgY2hhbmdlZCA9IERpZmZTZXF1ZW5jZS5tYWtlQ2hhbmdlZEZpZWxkcyhcbiAgICAgICAgcHJvamVjdGVkTmV3LCBwcm9qZWN0ZWRPbGQpO1xuICAgICAgaWYgKCFfLmlzRW1wdHkoY2hhbmdlZCkpXG4gICAgICAgIHNlbGYuX211bHRpcGxleGVyLmNoYW5nZWQoaWQsIGNoYW5nZWQpO1xuICAgIH0pO1xuICB9LFxuICBfYWRkQnVmZmVyZWQ6IGZ1bmN0aW9uIChpZCwgZG9jKSB7XG4gICAgdmFyIHNlbGYgPSB0aGlzO1xuICAgIE1ldGVvci5fbm9ZaWVsZHNBbGxvd2VkKGZ1bmN0aW9uICgpIHtcbiAgICAgIHNlbGYuX3VucHVibGlzaGVkQnVmZmVyLnNldChpZCwgc2VsZi5fc2hhcmVkUHJvamVjdGlvbkZuKGRvYykpO1xuXG4gICAgICAvLyBJZiBzb21ldGhpbmcgaXMgb3ZlcmZsb3dpbmcgdGhlIGJ1ZmZlciwgd2UganVzdCByZW1vdmUgaXQgZnJvbSBjYWNoZVxuICAgICAgaWYgKHNlbGYuX3VucHVibGlzaGVkQnVmZmVyLnNpemUoKSA+IHNlbGYuX2xpbWl0KSB7XG4gICAgICAgIHZhciBtYXhCdWZmZXJlZElkID0gc2VsZi5fdW5wdWJsaXNoZWRCdWZmZXIubWF4RWxlbWVudElkKCk7XG5cbiAgICAgICAgc2VsZi5fdW5wdWJsaXNoZWRCdWZmZXIucmVtb3ZlKG1heEJ1ZmZlcmVkSWQpO1xuXG4gICAgICAgIC8vIFNpbmNlIHNvbWV0aGluZyBtYXRjaGluZyBpcyByZW1vdmVkIGZyb20gY2FjaGUgKGJvdGggcHVibGlzaGVkIHNldCBhbmRcbiAgICAgICAgLy8gYnVmZmVyKSwgc2V0IGZsYWcgdG8gZmFsc2VcbiAgICAgICAgc2VsZi5fc2FmZUFwcGVuZFRvQnVmZmVyID0gZmFsc2U7XG4gICAgICB9XG4gICAgfSk7XG4gIH0sXG4gIC8vIElzIGNhbGxlZCBlaXRoZXIgdG8gcmVtb3ZlIHRoZSBkb2MgY29tcGxldGVseSBmcm9tIG1hdGNoaW5nIHNldCBvciB0byBtb3ZlXG4gIC8vIGl0IHRvIHRoZSBwdWJsaXNoZWQgc2V0IGxhdGVyLlxuICBfcmVtb3ZlQnVmZmVyZWQ6IGZ1bmN0aW9uIChpZCkge1xuICAgIHZhciBzZWxmID0gdGhpcztcbiAgICBNZXRlb3IuX25vWWllbGRzQWxsb3dlZChmdW5jdGlvbiAoKSB7XG4gICAgICBzZWxmLl91bnB1Ymxpc2hlZEJ1ZmZlci5yZW1vdmUoaWQpO1xuICAgICAgLy8gVG8ga2VlcCB0aGUgY29udHJhY3QgXCJidWZmZXIgaXMgbmV2ZXIgZW1wdHkgaW4gU1RFQURZIHBoYXNlIHVubGVzcyB0aGVcbiAgICAgIC8vIGV2ZXJ5dGhpbmcgbWF0Y2hpbmcgZml0cyBpbnRvIHB1Ymxpc2hlZFwiIHRydWUsIHdlIHBvbGwgZXZlcnl0aGluZyBhc1xuICAgICAgLy8gc29vbiBhcyB3ZSBzZWUgdGhlIGJ1ZmZlciBiZWNvbWluZyBlbXB0eS5cbiAgICAgIGlmICghIHNlbGYuX3VucHVibGlzaGVkQnVmZmVyLnNpemUoKSAmJiAhIHNlbGYuX3NhZmVBcHBlbmRUb0J1ZmZlcilcbiAgICAgICAgc2VsZi5fbmVlZFRvUG9sbFF1ZXJ5KCk7XG4gICAgfSk7XG4gIH0sXG4gIC8vIENhbGxlZCB3aGVuIGEgZG9jdW1lbnQgaGFzIGpvaW5lZCB0aGUgXCJNYXRjaGluZ1wiIHJlc3VsdHMgc2V0LlxuICAvLyBUYWtlcyByZXNwb25zaWJpbGl0eSBvZiBrZWVwaW5nIF91bnB1Ymxpc2hlZEJ1ZmZlciBpbiBzeW5jIHdpdGggX3B1Ymxpc2hlZFxuICAvLyBhbmQgdGhlIGVmZmVjdCBvZiBsaW1pdCBlbmZvcmNlZC5cbiAgX2FkZE1hdGNoaW5nOiBmdW5jdGlvbiAoZG9jKSB7XG4gICAgdmFyIHNlbGYgPSB0aGlzO1xuICAgIE1ldGVvci5fbm9ZaWVsZHNBbGxvd2VkKGZ1bmN0aW9uICgpIHtcbiAgICAgIHZhciBpZCA9IGRvYy5faWQ7XG4gICAgICBpZiAoc2VsZi5fcHVibGlzaGVkLmhhcyhpZCkpXG4gICAgICAgIHRocm93IEVycm9yKFwidHJpZWQgdG8gYWRkIHNvbWV0aGluZyBhbHJlYWR5IHB1Ymxpc2hlZCBcIiArIGlkKTtcbiAgICAgIGlmIChzZWxmLl9saW1pdCAmJiBzZWxmLl91bnB1Ymxpc2hlZEJ1ZmZlci5oYXMoaWQpKVxuICAgICAgICB0aHJvdyBFcnJvcihcInRyaWVkIHRvIGFkZCBzb21ldGhpbmcgYWxyZWFkeSBleGlzdGVkIGluIGJ1ZmZlciBcIiArIGlkKTtcblxuICAgICAgdmFyIGxpbWl0ID0gc2VsZi5fbGltaXQ7XG4gICAgICB2YXIgY29tcGFyYXRvciA9IHNlbGYuX2NvbXBhcmF0b3I7XG4gICAgICB2YXIgbWF4UHVibGlzaGVkID0gKGxpbWl0ICYmIHNlbGYuX3B1Ymxpc2hlZC5zaXplKCkgPiAwKSA/XG4gICAgICAgIHNlbGYuX3B1Ymxpc2hlZC5nZXQoc2VsZi5fcHVibGlzaGVkLm1heEVsZW1lbnRJZCgpKSA6IG51bGw7XG4gICAgICB2YXIgbWF4QnVmZmVyZWQgPSAobGltaXQgJiYgc2VsZi5fdW5wdWJsaXNoZWRCdWZmZXIuc2l6ZSgpID4gMClcbiAgICAgICAgPyBzZWxmLl91bnB1Ymxpc2hlZEJ1ZmZlci5nZXQoc2VsZi5fdW5wdWJsaXNoZWRCdWZmZXIubWF4RWxlbWVudElkKCkpXG4gICAgICAgIDogbnVsbDtcbiAgICAgIC8vIFRoZSBxdWVyeSBpcyB1bmxpbWl0ZWQgb3IgZGlkbid0IHB1Ymxpc2ggZW5vdWdoIGRvY3VtZW50cyB5ZXQgb3IgdGhlXG4gICAgICAvLyBuZXcgZG9jdW1lbnQgd291bGQgZml0IGludG8gcHVibGlzaGVkIHNldCBwdXNoaW5nIHRoZSBtYXhpbXVtIGVsZW1lbnRcbiAgICAgIC8vIG91dCwgdGhlbiB3ZSBuZWVkIHRvIHB1Ymxpc2ggdGhlIGRvYy5cbiAgICAgIHZhciB0b1B1Ymxpc2ggPSAhIGxpbWl0IHx8IHNlbGYuX3B1Ymxpc2hlZC5zaXplKCkgPCBsaW1pdCB8fFxuICAgICAgICBjb21wYXJhdG9yKGRvYywgbWF4UHVibGlzaGVkKSA8IDA7XG5cbiAgICAgIC8vIE90aGVyd2lzZSB3ZSBtaWdodCBuZWVkIHRvIGJ1ZmZlciBpdCAob25seSBpbiBjYXNlIG9mIGxpbWl0ZWQgcXVlcnkpLlxuICAgICAgLy8gQnVmZmVyaW5nIGlzIGFsbG93ZWQgaWYgdGhlIGJ1ZmZlciBpcyBub3QgZmlsbGVkIHVwIHlldCBhbmQgYWxsXG4gICAgICAvLyBtYXRjaGluZyBkb2NzIGFyZSBlaXRoZXIgaW4gdGhlIHB1Ymxpc2hlZCBzZXQgb3IgaW4gdGhlIGJ1ZmZlci5cbiAgICAgIHZhciBjYW5BcHBlbmRUb0J1ZmZlciA9ICF0b1B1Ymxpc2ggJiYgc2VsZi5fc2FmZUFwcGVuZFRvQnVmZmVyICYmXG4gICAgICAgIHNlbGYuX3VucHVibGlzaGVkQnVmZmVyLnNpemUoKSA8IGxpbWl0O1xuXG4gICAgICAvLyBPciBpZiBpdCBpcyBzbWFsbCBlbm91Z2ggdG8gYmUgc2FmZWx5IGluc2VydGVkIHRvIHRoZSBtaWRkbGUgb3IgdGhlXG4gICAgICAvLyBiZWdpbm5pbmcgb2YgdGhlIGJ1ZmZlci5cbiAgICAgIHZhciBjYW5JbnNlcnRJbnRvQnVmZmVyID0gIXRvUHVibGlzaCAmJiBtYXhCdWZmZXJlZCAmJlxuICAgICAgICBjb21wYXJhdG9yKGRvYywgbWF4QnVmZmVyZWQpIDw9IDA7XG5cbiAgICAgIHZhciB0b0J1ZmZlciA9IGNhbkFwcGVuZFRvQnVmZmVyIHx8IGNhbkluc2VydEludG9CdWZmZXI7XG5cbiAgICAgIGlmICh0b1B1Ymxpc2gpIHtcbiAgICAgICAgc2VsZi5fYWRkUHVibGlzaGVkKGlkLCBkb2MpO1xuICAgICAgfSBlbHNlIGlmICh0b0J1ZmZlcikge1xuICAgICAgICBzZWxmLl9hZGRCdWZmZXJlZChpZCwgZG9jKTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIC8vIGRyb3BwaW5nIGl0IGFuZCBub3Qgc2F2aW5nIHRvIHRoZSBjYWNoZVxuICAgICAgICBzZWxmLl9zYWZlQXBwZW5kVG9CdWZmZXIgPSBmYWxzZTtcbiAgICAgIH1cbiAgICB9KTtcbiAgfSxcbiAgLy8gQ2FsbGVkIHdoZW4gYSBkb2N1bWVudCBsZWF2ZXMgdGhlIFwiTWF0Y2hpbmdcIiByZXN1bHRzIHNldC5cbiAgLy8gVGFrZXMgcmVzcG9uc2liaWxpdHkgb2Yga2VlcGluZyBfdW5wdWJsaXNoZWRCdWZmZXIgaW4gc3luYyB3aXRoIF9wdWJsaXNoZWRcbiAgLy8gYW5kIHRoZSBlZmZlY3Qgb2YgbGltaXQgZW5mb3JjZWQuXG4gIF9yZW1vdmVNYXRjaGluZzogZnVuY3Rpb24gKGlkKSB7XG4gICAgdmFyIHNlbGYgPSB0aGlzO1xuICAgIE1ldGVvci5fbm9ZaWVsZHNBbGxvd2VkKGZ1bmN0aW9uICgpIHtcbiAgICAgIGlmICghIHNlbGYuX3B1Ymxpc2hlZC5oYXMoaWQpICYmICEgc2VsZi5fbGltaXQpXG4gICAgICAgIHRocm93IEVycm9yKFwidHJpZWQgdG8gcmVtb3ZlIHNvbWV0aGluZyBtYXRjaGluZyBidXQgbm90IGNhY2hlZCBcIiArIGlkKTtcblxuICAgICAgaWYgKHNlbGYuX3B1Ymxpc2hlZC5oYXMoaWQpKSB7XG4gICAgICAgIHNlbGYuX3JlbW92ZVB1Ymxpc2hlZChpZCk7XG4gICAgICB9IGVsc2UgaWYgKHNlbGYuX3VucHVibGlzaGVkQnVmZmVyLmhhcyhpZCkpIHtcbiAgICAgICAgc2VsZi5fcmVtb3ZlQnVmZmVyZWQoaWQpO1xuICAgICAgfVxuICAgIH0pO1xuICB9LFxuICBfaGFuZGxlRG9jOiBmdW5jdGlvbiAoaWQsIG5ld0RvYykge1xuICAgIHZhciBzZWxmID0gdGhpcztcbiAgICBNZXRlb3IuX25vWWllbGRzQWxsb3dlZChmdW5jdGlvbiAoKSB7XG4gICAgICB2YXIgbWF0Y2hlc05vdyA9IG5ld0RvYyAmJiBzZWxmLl9tYXRjaGVyLmRvY3VtZW50TWF0Y2hlcyhuZXdEb2MpLnJlc3VsdDtcblxuICAgICAgdmFyIHB1Ymxpc2hlZEJlZm9yZSA9IHNlbGYuX3B1Ymxpc2hlZC5oYXMoaWQpO1xuICAgICAgdmFyIGJ1ZmZlcmVkQmVmb3JlID0gc2VsZi5fbGltaXQgJiYgc2VsZi5fdW5wdWJsaXNoZWRCdWZmZXIuaGFzKGlkKTtcbiAgICAgIHZhciBjYWNoZWRCZWZvcmUgPSBwdWJsaXNoZWRCZWZvcmUgfHwgYnVmZmVyZWRCZWZvcmU7XG5cbiAgICAgIGlmIChtYXRjaGVzTm93ICYmICFjYWNoZWRCZWZvcmUpIHtcbiAgICAgICAgc2VsZi5fYWRkTWF0Y2hpbmcobmV3RG9jKTtcbiAgICAgIH0gZWxzZSBpZiAoY2FjaGVkQmVmb3JlICYmICFtYXRjaGVzTm93KSB7XG4gICAgICAgIHNlbGYuX3JlbW92ZU1hdGNoaW5nKGlkKTtcbiAgICAgIH0gZWxzZSBpZiAoY2FjaGVkQmVmb3JlICYmIG1hdGNoZXNOb3cpIHtcbiAgICAgICAgdmFyIG9sZERvYyA9IHNlbGYuX3B1Ymxpc2hlZC5nZXQoaWQpO1xuICAgICAgICB2YXIgY29tcGFyYXRvciA9IHNlbGYuX2NvbXBhcmF0b3I7XG4gICAgICAgIHZhciBtaW5CdWZmZXJlZCA9IHNlbGYuX2xpbWl0ICYmIHNlbGYuX3VucHVibGlzaGVkQnVmZmVyLnNpemUoKSAmJlxuICAgICAgICAgIHNlbGYuX3VucHVibGlzaGVkQnVmZmVyLmdldChzZWxmLl91bnB1Ymxpc2hlZEJ1ZmZlci5taW5FbGVtZW50SWQoKSk7XG4gICAgICAgIHZhciBtYXhCdWZmZXJlZDtcblxuICAgICAgICBpZiAocHVibGlzaGVkQmVmb3JlKSB7XG4gICAgICAgICAgLy8gVW5saW1pdGVkIGNhc2Ugd2hlcmUgdGhlIGRvY3VtZW50IHN0YXlzIGluIHB1Ymxpc2hlZCBvbmNlIGl0XG4gICAgICAgICAgLy8gbWF0Y2hlcyBvciB0aGUgY2FzZSB3aGVuIHdlIGRvbid0IGhhdmUgZW5vdWdoIG1hdGNoaW5nIGRvY3MgdG9cbiAgICAgICAgICAvLyBwdWJsaXNoIG9yIHRoZSBjaGFuZ2VkIGJ1dCBtYXRjaGluZyBkb2Mgd2lsbCBzdGF5IGluIHB1Ymxpc2hlZFxuICAgICAgICAgIC8vIGFueXdheXMuXG4gICAgICAgICAgLy9cbiAgICAgICAgICAvLyBYWFg6IFdlIHJlbHkgb24gdGhlIGVtcHRpbmVzcyBvZiBidWZmZXIuIEJlIHN1cmUgdG8gbWFpbnRhaW4gdGhlXG4gICAgICAgICAgLy8gZmFjdCB0aGF0IGJ1ZmZlciBjYW4ndCBiZSBlbXB0eSBpZiB0aGVyZSBhcmUgbWF0Y2hpbmcgZG9jdW1lbnRzIG5vdFxuICAgICAgICAgIC8vIHB1Ymxpc2hlZC4gTm90YWJseSwgd2UgZG9uJ3Qgd2FudCB0byBzY2hlZHVsZSByZXBvbGwgYW5kIGNvbnRpbnVlXG4gICAgICAgICAgLy8gcmVseWluZyBvbiB0aGlzIHByb3BlcnR5LlxuICAgICAgICAgIHZhciBzdGF5c0luUHVibGlzaGVkID0gISBzZWxmLl9saW1pdCB8fFxuICAgICAgICAgICAgc2VsZi5fdW5wdWJsaXNoZWRCdWZmZXIuc2l6ZSgpID09PSAwIHx8XG4gICAgICAgICAgICBjb21wYXJhdG9yKG5ld0RvYywgbWluQnVmZmVyZWQpIDw9IDA7XG5cbiAgICAgICAgICBpZiAoc3RheXNJblB1Ymxpc2hlZCkge1xuICAgICAgICAgICAgc2VsZi5fY2hhbmdlUHVibGlzaGVkKGlkLCBvbGREb2MsIG5ld0RvYyk7XG4gICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIC8vIGFmdGVyIHRoZSBjaGFuZ2UgZG9jIGRvZXNuJ3Qgc3RheSBpbiB0aGUgcHVibGlzaGVkLCByZW1vdmUgaXRcbiAgICAgICAgICAgIHNlbGYuX3JlbW92ZVB1Ymxpc2hlZChpZCk7XG4gICAgICAgICAgICAvLyBidXQgaXQgY2FuIG1vdmUgaW50byBidWZmZXJlZCBub3csIGNoZWNrIGl0XG4gICAgICAgICAgICBtYXhCdWZmZXJlZCA9IHNlbGYuX3VucHVibGlzaGVkQnVmZmVyLmdldChcbiAgICAgICAgICAgICAgc2VsZi5fdW5wdWJsaXNoZWRCdWZmZXIubWF4RWxlbWVudElkKCkpO1xuXG4gICAgICAgICAgICB2YXIgdG9CdWZmZXIgPSBzZWxmLl9zYWZlQXBwZW5kVG9CdWZmZXIgfHxcbiAgICAgICAgICAgICAgICAgIChtYXhCdWZmZXJlZCAmJiBjb21wYXJhdG9yKG5ld0RvYywgbWF4QnVmZmVyZWQpIDw9IDApO1xuXG4gICAgICAgICAgICBpZiAodG9CdWZmZXIpIHtcbiAgICAgICAgICAgICAgc2VsZi5fYWRkQnVmZmVyZWQoaWQsIG5ld0RvYyk7XG4gICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAvLyBUaHJvdyBhd2F5IGZyb20gYm90aCBwdWJsaXNoZWQgc2V0IGFuZCBidWZmZXJcbiAgICAgICAgICAgICAgc2VsZi5fc2FmZUFwcGVuZFRvQnVmZmVyID0gZmFsc2U7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgfVxuICAgICAgICB9IGVsc2UgaWYgKGJ1ZmZlcmVkQmVmb3JlKSB7XG4gICAgICAgICAgb2xkRG9jID0gc2VsZi5fdW5wdWJsaXNoZWRCdWZmZXIuZ2V0KGlkKTtcbiAgICAgICAgICAvLyByZW1vdmUgdGhlIG9sZCB2ZXJzaW9uIG1hbnVhbGx5IGluc3RlYWQgb2YgdXNpbmcgX3JlbW92ZUJ1ZmZlcmVkIHNvXG4gICAgICAgICAgLy8gd2UgZG9uJ3QgdHJpZ2dlciB0aGUgcXVlcnlpbmcgaW1tZWRpYXRlbHkuICBpZiB3ZSBlbmQgdGhpcyBibG9ja1xuICAgICAgICAgIC8vIHdpdGggdGhlIGJ1ZmZlciBlbXB0eSwgd2Ugd2lsbCBuZWVkIHRvIHRyaWdnZXIgdGhlIHF1ZXJ5IHBvbGxcbiAgICAgICAgICAvLyBtYW51YWxseSB0b28uXG4gICAgICAgICAgc2VsZi5fdW5wdWJsaXNoZWRCdWZmZXIucmVtb3ZlKGlkKTtcblxuICAgICAgICAgIHZhciBtYXhQdWJsaXNoZWQgPSBzZWxmLl9wdWJsaXNoZWQuZ2V0KFxuICAgICAgICAgICAgc2VsZi5fcHVibGlzaGVkLm1heEVsZW1lbnRJZCgpKTtcbiAgICAgICAgICBtYXhCdWZmZXJlZCA9IHNlbGYuX3VucHVibGlzaGVkQnVmZmVyLnNpemUoKSAmJlxuICAgICAgICAgICAgICAgIHNlbGYuX3VucHVibGlzaGVkQnVmZmVyLmdldChcbiAgICAgICAgICAgICAgICAgIHNlbGYuX3VucHVibGlzaGVkQnVmZmVyLm1heEVsZW1lbnRJZCgpKTtcblxuICAgICAgICAgIC8vIHRoZSBidWZmZXJlZCBkb2Mgd2FzIHVwZGF0ZWQsIGl0IGNvdWxkIG1vdmUgdG8gcHVibGlzaGVkXG4gICAgICAgICAgdmFyIHRvUHVibGlzaCA9IGNvbXBhcmF0b3IobmV3RG9jLCBtYXhQdWJsaXNoZWQpIDwgMDtcblxuICAgICAgICAgIC8vIG9yIHN0YXlzIGluIGJ1ZmZlciBldmVuIGFmdGVyIHRoZSBjaGFuZ2VcbiAgICAgICAgICB2YXIgc3RheXNJbkJ1ZmZlciA9ICghIHRvUHVibGlzaCAmJiBzZWxmLl9zYWZlQXBwZW5kVG9CdWZmZXIpIHx8XG4gICAgICAgICAgICAgICAgKCF0b1B1Ymxpc2ggJiYgbWF4QnVmZmVyZWQgJiZcbiAgICAgICAgICAgICAgICAgY29tcGFyYXRvcihuZXdEb2MsIG1heEJ1ZmZlcmVkKSA8PSAwKTtcblxuICAgICAgICAgIGlmICh0b1B1Ymxpc2gpIHtcbiAgICAgICAgICAgIHNlbGYuX2FkZFB1Ymxpc2hlZChpZCwgbmV3RG9jKTtcbiAgICAgICAgICB9IGVsc2UgaWYgKHN0YXlzSW5CdWZmZXIpIHtcbiAgICAgICAgICAgIC8vIHN0YXlzIGluIGJ1ZmZlciBidXQgY2hhbmdlc1xuICAgICAgICAgICAgc2VsZi5fdW5wdWJsaXNoZWRCdWZmZXIuc2V0KGlkLCBuZXdEb2MpO1xuICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAvLyBUaHJvdyBhd2F5IGZyb20gYm90aCBwdWJsaXNoZWQgc2V0IGFuZCBidWZmZXJcbiAgICAgICAgICAgIHNlbGYuX3NhZmVBcHBlbmRUb0J1ZmZlciA9IGZhbHNlO1xuICAgICAgICAgICAgLy8gTm9ybWFsbHkgdGhpcyBjaGVjayB3b3VsZCBoYXZlIGJlZW4gZG9uZSBpbiBfcmVtb3ZlQnVmZmVyZWQgYnV0XG4gICAgICAgICAgICAvLyB3ZSBkaWRuJ3QgdXNlIGl0LCBzbyB3ZSBuZWVkIHRvIGRvIGl0IG91cnNlbGYgbm93LlxuICAgICAgICAgICAgaWYgKCEgc2VsZi5fdW5wdWJsaXNoZWRCdWZmZXIuc2l6ZSgpKSB7XG4gICAgICAgICAgICAgIHNlbGYuX25lZWRUb1BvbGxRdWVyeSgpO1xuICAgICAgICAgICAgfVxuICAgICAgICAgIH1cbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoXCJjYWNoZWRCZWZvcmUgaW1wbGllcyBlaXRoZXIgb2YgcHVibGlzaGVkQmVmb3JlIG9yIGJ1ZmZlcmVkQmVmb3JlIGlzIHRydWUuXCIpO1xuICAgICAgICB9XG4gICAgICB9XG4gICAgfSk7XG4gIH0sXG4gIF9mZXRjaE1vZGlmaWVkRG9jdW1lbnRzOiBmdW5jdGlvbiAoKSB7XG4gICAgdmFyIHNlbGYgPSB0aGlzO1xuICAgIE1ldGVvci5fbm9ZaWVsZHNBbGxvd2VkKGZ1bmN0aW9uICgpIHtcbiAgICAgIHNlbGYuX3JlZ2lzdGVyUGhhc2VDaGFuZ2UoUEhBU0UuRkVUQ0hJTkcpO1xuICAgICAgLy8gRGVmZXIsIGJlY2F1c2Ugbm90aGluZyBjYWxsZWQgZnJvbSB0aGUgb3Bsb2cgZW50cnkgaGFuZGxlciBtYXkgeWllbGQsXG4gICAgICAvLyBidXQgZmV0Y2goKSB5aWVsZHMuXG4gICAgICBNZXRlb3IuZGVmZXIoZmluaXNoSWZOZWVkVG9Qb2xsUXVlcnkoZnVuY3Rpb24gKCkge1xuICAgICAgICB3aGlsZSAoIXNlbGYuX3N0b3BwZWQgJiYgIXNlbGYuX25lZWRUb0ZldGNoLmVtcHR5KCkpIHtcbiAgICAgICAgICBpZiAoc2VsZi5fcGhhc2UgPT09IFBIQVNFLlFVRVJZSU5HKSB7XG4gICAgICAgICAgICAvLyBXaGlsZSBmZXRjaGluZywgd2UgZGVjaWRlZCB0byBnbyBpbnRvIFFVRVJZSU5HIG1vZGUsIGFuZCB0aGVuIHdlXG4gICAgICAgICAgICAvLyBzYXcgYW5vdGhlciBvcGxvZyBlbnRyeSwgc28gX25lZWRUb0ZldGNoIGlzIG5vdCBlbXB0eS4gQnV0IHdlXG4gICAgICAgICAgICAvLyBzaG91bGRuJ3QgZmV0Y2ggdGhlc2UgZG9jdW1lbnRzIHVudGlsIEFGVEVSIHRoZSBxdWVyeSBpcyBkb25lLlxuICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgICAgfVxuXG4gICAgICAgICAgLy8gQmVpbmcgaW4gc3RlYWR5IHBoYXNlIGhlcmUgd291bGQgYmUgc3VycHJpc2luZy5cbiAgICAgICAgICBpZiAoc2VsZi5fcGhhc2UgIT09IFBIQVNFLkZFVENISU5HKVxuICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKFwicGhhc2UgaW4gZmV0Y2hNb2RpZmllZERvY3VtZW50czogXCIgKyBzZWxmLl9waGFzZSk7XG5cbiAgICAgICAgICBzZWxmLl9jdXJyZW50bHlGZXRjaGluZyA9IHNlbGYuX25lZWRUb0ZldGNoO1xuICAgICAgICAgIHZhciB0aGlzR2VuZXJhdGlvbiA9ICsrc2VsZi5fZmV0Y2hHZW5lcmF0aW9uO1xuICAgICAgICAgIHNlbGYuX25lZWRUb0ZldGNoID0gbmV3IExvY2FsQ29sbGVjdGlvbi5fSWRNYXA7XG4gICAgICAgICAgdmFyIHdhaXRpbmcgPSAwO1xuICAgICAgICAgIHZhciBmdXQgPSBuZXcgRnV0dXJlO1xuICAgICAgICAgIC8vIFRoaXMgbG9vcCBpcyBzYWZlLCBiZWNhdXNlIF9jdXJyZW50bHlGZXRjaGluZyB3aWxsIG5vdCBiZSB1cGRhdGVkXG4gICAgICAgICAgLy8gZHVyaW5nIHRoaXMgbG9vcCAoaW4gZmFjdCwgaXQgaXMgbmV2ZXIgbXV0YXRlZCkuXG4gICAgICAgICAgc2VsZi5fY3VycmVudGx5RmV0Y2hpbmcuZm9yRWFjaChmdW5jdGlvbiAob3AsIGlkKSB7XG4gICAgICAgICAgICB3YWl0aW5nKys7XG4gICAgICAgICAgICBzZWxmLl9tb25nb0hhbmRsZS5fZG9jRmV0Y2hlci5mZXRjaChcbiAgICAgICAgICAgICAgc2VsZi5fY3Vyc29yRGVzY3JpcHRpb24uY29sbGVjdGlvbk5hbWUsIGlkLCBvcCxcbiAgICAgICAgICAgICAgZmluaXNoSWZOZWVkVG9Qb2xsUXVlcnkoZnVuY3Rpb24gKGVyciwgZG9jKSB7XG4gICAgICAgICAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgICAgICAgIGlmIChlcnIpIHtcbiAgICAgICAgICAgICAgICAgICAgTWV0ZW9yLl9kZWJ1ZyhcIkdvdCBleGNlcHRpb24gd2hpbGUgZmV0Y2hpbmcgZG9jdW1lbnRzXCIsXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgZXJyKTtcbiAgICAgICAgICAgICAgICAgICAgLy8gSWYgd2UgZ2V0IGFuIGVycm9yIGZyb20gdGhlIGZldGNoZXIgKGVnLCB0cm91YmxlXG4gICAgICAgICAgICAgICAgICAgIC8vIGNvbm5lY3RpbmcgdG8gTW9uZ28pLCBsZXQncyBqdXN0IGFiYW5kb24gdGhlIGZldGNoIHBoYXNlXG4gICAgICAgICAgICAgICAgICAgIC8vIGFsdG9nZXRoZXIgYW5kIGZhbGwgYmFjayB0byBwb2xsaW5nLiBJdCdzIG5vdCBsaWtlIHdlJ3JlXG4gICAgICAgICAgICAgICAgICAgIC8vIGdldHRpbmcgbGl2ZSB1cGRhdGVzIGFueXdheS5cbiAgICAgICAgICAgICAgICAgICAgaWYgKHNlbGYuX3BoYXNlICE9PSBQSEFTRS5RVUVSWUlORykge1xuICAgICAgICAgICAgICAgICAgICAgIHNlbGYuX25lZWRUb1BvbGxRdWVyeSgpO1xuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICB9IGVsc2UgaWYgKCFzZWxmLl9zdG9wcGVkICYmIHNlbGYuX3BoYXNlID09PSBQSEFTRS5GRVRDSElOR1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAmJiBzZWxmLl9mZXRjaEdlbmVyYXRpb24gPT09IHRoaXNHZW5lcmF0aW9uKSB7XG4gICAgICAgICAgICAgICAgICAgIC8vIFdlIHJlLWNoZWNrIHRoZSBnZW5lcmF0aW9uIGluIGNhc2Ugd2UndmUgaGFkIGFuIGV4cGxpY2l0XG4gICAgICAgICAgICAgICAgICAgIC8vIF9wb2xsUXVlcnkgY2FsbCAoZWcsIGluIGFub3RoZXIgZmliZXIpIHdoaWNoIHNob3VsZFxuICAgICAgICAgICAgICAgICAgICAvLyBlZmZlY3RpdmVseSBjYW5jZWwgdGhpcyByb3VuZCBvZiBmZXRjaGVzLiAgKF9wb2xsUXVlcnlcbiAgICAgICAgICAgICAgICAgICAgLy8gaW5jcmVtZW50cyB0aGUgZ2VuZXJhdGlvbi4pXG4gICAgICAgICAgICAgICAgICAgIHNlbGYuX2hhbmRsZURvYyhpZCwgZG9jKTtcbiAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICB9IGZpbmFsbHkge1xuICAgICAgICAgICAgICAgICAgd2FpdGluZy0tO1xuICAgICAgICAgICAgICAgICAgLy8gQmVjYXVzZSBmZXRjaCgpIG5ldmVyIGNhbGxzIGl0cyBjYWxsYmFjayBzeW5jaHJvbm91c2x5LFxuICAgICAgICAgICAgICAgICAgLy8gdGhpcyBpcyBzYWZlIChpZSwgd2Ugd29uJ3QgY2FsbCBmdXQucmV0dXJuKCkgYmVmb3JlIHRoZVxuICAgICAgICAgICAgICAgICAgLy8gZm9yRWFjaCBpcyBkb25lKS5cbiAgICAgICAgICAgICAgICAgIGlmICh3YWl0aW5nID09PSAwKVxuICAgICAgICAgICAgICAgICAgICBmdXQucmV0dXJuKCk7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICB9KSk7XG4gICAgICAgICAgfSk7XG4gICAgICAgICAgZnV0LndhaXQoKTtcbiAgICAgICAgICAvLyBFeGl0IG5vdyBpZiB3ZSd2ZSBoYWQgYSBfcG9sbFF1ZXJ5IGNhbGwgKGhlcmUgb3IgaW4gYW5vdGhlciBmaWJlcikuXG4gICAgICAgICAgaWYgKHNlbGYuX3BoYXNlID09PSBQSEFTRS5RVUVSWUlORylcbiAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgICBzZWxmLl9jdXJyZW50bHlGZXRjaGluZyA9IG51bGw7XG4gICAgICAgIH1cbiAgICAgICAgLy8gV2UncmUgZG9uZSBmZXRjaGluZywgc28gd2UgY2FuIGJlIHN0ZWFkeSwgdW5sZXNzIHdlJ3ZlIGhhZCBhXG4gICAgICAgIC8vIF9wb2xsUXVlcnkgY2FsbCAoaGVyZSBvciBpbiBhbm90aGVyIGZpYmVyKS5cbiAgICAgICAgaWYgKHNlbGYuX3BoYXNlICE9PSBQSEFTRS5RVUVSWUlORylcbiAgICAgICAgICBzZWxmLl9iZVN0ZWFkeSgpO1xuICAgICAgfSkpO1xuICAgIH0pO1xuICB9LFxuICBfYmVTdGVhZHk6IGZ1bmN0aW9uICgpIHtcbiAgICB2YXIgc2VsZiA9IHRoaXM7XG4gICAgTWV0ZW9yLl9ub1lpZWxkc0FsbG93ZWQoZnVuY3Rpb24gKCkge1xuICAgICAgc2VsZi5fcmVnaXN0ZXJQaGFzZUNoYW5nZShQSEFTRS5TVEVBRFkpO1xuICAgICAgdmFyIHdyaXRlcyA9IHNlbGYuX3dyaXRlc1RvQ29tbWl0V2hlbldlUmVhY2hTdGVhZHk7XG4gICAgICBzZWxmLl93cml0ZXNUb0NvbW1pdFdoZW5XZVJlYWNoU3RlYWR5ID0gW107XG4gICAgICBzZWxmLl9tdWx0aXBsZXhlci5vbkZsdXNoKGZ1bmN0aW9uICgpIHtcbiAgICAgICAgXy5lYWNoKHdyaXRlcywgZnVuY3Rpb24gKHcpIHtcbiAgICAgICAgICB3LmNvbW1pdHRlZCgpO1xuICAgICAgICB9KTtcbiAgICAgIH0pO1xuICAgIH0pO1xuICB9LFxuICBfaGFuZGxlT3Bsb2dFbnRyeVF1ZXJ5aW5nOiBmdW5jdGlvbiAob3ApIHtcbiAgICB2YXIgc2VsZiA9IHRoaXM7XG4gICAgTWV0ZW9yLl9ub1lpZWxkc0FsbG93ZWQoZnVuY3Rpb24gKCkge1xuICAgICAgc2VsZi5fbmVlZFRvRmV0Y2guc2V0KGlkRm9yT3Aob3ApLCBvcCk7XG4gICAgfSk7XG4gIH0sXG4gIF9oYW5kbGVPcGxvZ0VudHJ5U3RlYWR5T3JGZXRjaGluZzogZnVuY3Rpb24gKG9wKSB7XG4gICAgdmFyIHNlbGYgPSB0aGlzO1xuICAgIE1ldGVvci5fbm9ZaWVsZHNBbGxvd2VkKGZ1bmN0aW9uICgpIHtcbiAgICAgIHZhciBpZCA9IGlkRm9yT3Aob3ApO1xuICAgICAgLy8gSWYgd2UncmUgYWxyZWFkeSBmZXRjaGluZyB0aGlzIG9uZSwgb3IgYWJvdXQgdG8sIHdlIGNhbid0IG9wdGltaXplO1xuICAgICAgLy8gbWFrZSBzdXJlIHRoYXQgd2UgZmV0Y2ggaXQgYWdhaW4gaWYgbmVjZXNzYXJ5LlxuICAgICAgaWYgKHNlbGYuX3BoYXNlID09PSBQSEFTRS5GRVRDSElORyAmJlxuICAgICAgICAgICgoc2VsZi5fY3VycmVudGx5RmV0Y2hpbmcgJiYgc2VsZi5fY3VycmVudGx5RmV0Y2hpbmcuaGFzKGlkKSkgfHxcbiAgICAgICAgICAgc2VsZi5fbmVlZFRvRmV0Y2guaGFzKGlkKSkpIHtcbiAgICAgICAgc2VsZi5fbmVlZFRvRmV0Y2guc2V0KGlkLCBvcCk7XG4gICAgICAgIHJldHVybjtcbiAgICAgIH1cblxuICAgICAgaWYgKG9wLm9wID09PSAnZCcpIHtcbiAgICAgICAgaWYgKHNlbGYuX3B1Ymxpc2hlZC5oYXMoaWQpIHx8XG4gICAgICAgICAgICAoc2VsZi5fbGltaXQgJiYgc2VsZi5fdW5wdWJsaXNoZWRCdWZmZXIuaGFzKGlkKSkpXG4gICAgICAgICAgc2VsZi5fcmVtb3ZlTWF0Y2hpbmcoaWQpO1xuICAgICAgfSBlbHNlIGlmIChvcC5vcCA9PT0gJ2knKSB7XG4gICAgICAgIGlmIChzZWxmLl9wdWJsaXNoZWQuaGFzKGlkKSlcbiAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoXCJpbnNlcnQgZm91bmQgZm9yIGFscmVhZHktZXhpc3RpbmcgSUQgaW4gcHVibGlzaGVkXCIpO1xuICAgICAgICBpZiAoc2VsZi5fdW5wdWJsaXNoZWRCdWZmZXIgJiYgc2VsZi5fdW5wdWJsaXNoZWRCdWZmZXIuaGFzKGlkKSlcbiAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoXCJpbnNlcnQgZm91bmQgZm9yIGFscmVhZHktZXhpc3RpbmcgSUQgaW4gYnVmZmVyXCIpO1xuXG4gICAgICAgIC8vIFhYWCB3aGF0IGlmIHNlbGVjdG9yIHlpZWxkcz8gIGZvciBub3cgaXQgY2FuJ3QgYnV0IGxhdGVyIGl0IGNvdWxkXG4gICAgICAgIC8vIGhhdmUgJHdoZXJlXG4gICAgICAgIGlmIChzZWxmLl9tYXRjaGVyLmRvY3VtZW50TWF0Y2hlcyhvcC5vKS5yZXN1bHQpXG4gICAgICAgICAgc2VsZi5fYWRkTWF0Y2hpbmcob3Aubyk7XG4gICAgICB9IGVsc2UgaWYgKG9wLm9wID09PSAndScpIHtcbiAgICAgICAgLy8gd2UgYXJlIG1hcHBpbmcgdGhlIG5ldyBvcGxvZyBmb3JtYXQgb24gbW9uZ28gNVxuICAgICAgICAvLyB0byB3aGF0IHdlIGtub3cgYmV0dGVyLCAkc2V0XG4gICAgICAgIG9wLm8gPSBvcGxvZ1YyVjFDb252ZXJ0ZXIob3AubylcbiAgICAgICAgLy8gSXMgdGhpcyBhIG1vZGlmaWVyICgkc2V0LyR1bnNldCwgd2hpY2ggbWF5IHJlcXVpcmUgdXMgdG8gcG9sbCB0aGVcbiAgICAgICAgLy8gZGF0YWJhc2UgdG8gZmlndXJlIG91dCBpZiB0aGUgd2hvbGUgZG9jdW1lbnQgbWF0Y2hlcyB0aGUgc2VsZWN0b3IpIG9yXG4gICAgICAgIC8vIGEgcmVwbGFjZW1lbnQgKGluIHdoaWNoIGNhc2Ugd2UgY2FuIGp1c3QgZGlyZWN0bHkgcmUtZXZhbHVhdGUgdGhlXG4gICAgICAgIC8vIHNlbGVjdG9yKT9cbiAgICAgICAgLy8gb3Bsb2cgZm9ybWF0IGhhcyBjaGFuZ2VkIG9uIG1vbmdvZGIgNSwgd2UgaGF2ZSB0byBzdXBwb3J0IGJvdGggbm93XG4gICAgICAgIC8vIGRpZmYgaXMgdGhlIGZvcm1hdCBpbiBNb25nbyA1KyAob3Bsb2cgdjIpXG4gICAgICAgIHZhciBpc1JlcGxhY2UgPSAhXy5oYXMob3AubywgJyRzZXQnKSAmJiAhXy5oYXMob3AubywgJ2RpZmYnKSAmJiAhXy5oYXMob3AubywgJyR1bnNldCcpO1xuICAgICAgICAvLyBJZiB0aGlzIG1vZGlmaWVyIG1vZGlmaWVzIHNvbWV0aGluZyBpbnNpZGUgYW4gRUpTT04gY3VzdG9tIHR5cGUgKGllLFxuICAgICAgICAvLyBhbnl0aGluZyB3aXRoIEVKU09OJCksIHRoZW4gd2UgY2FuJ3QgdHJ5IHRvIHVzZVxuICAgICAgICAvLyBMb2NhbENvbGxlY3Rpb24uX21vZGlmeSwgc2luY2UgdGhhdCBqdXN0IG11dGF0ZXMgdGhlIEVKU09OIGVuY29kaW5nLFxuICAgICAgICAvLyBub3QgdGhlIGFjdHVhbCBvYmplY3QuXG4gICAgICAgIHZhciBjYW5EaXJlY3RseU1vZGlmeURvYyA9XG4gICAgICAgICAgIWlzUmVwbGFjZSAmJiBtb2RpZmllckNhbkJlRGlyZWN0bHlBcHBsaWVkKG9wLm8pO1xuXG4gICAgICAgIHZhciBwdWJsaXNoZWRCZWZvcmUgPSBzZWxmLl9wdWJsaXNoZWQuaGFzKGlkKTtcbiAgICAgICAgdmFyIGJ1ZmZlcmVkQmVmb3JlID0gc2VsZi5fbGltaXQgJiYgc2VsZi5fdW5wdWJsaXNoZWRCdWZmZXIuaGFzKGlkKTtcblxuICAgICAgICBpZiAoaXNSZXBsYWNlKSB7XG4gICAgICAgICAgc2VsZi5faGFuZGxlRG9jKGlkLCBfLmV4dGVuZCh7X2lkOiBpZH0sIG9wLm8pKTtcbiAgICAgICAgfSBlbHNlIGlmICgocHVibGlzaGVkQmVmb3JlIHx8IGJ1ZmZlcmVkQmVmb3JlKSAmJlxuICAgICAgICAgICAgICAgICAgIGNhbkRpcmVjdGx5TW9kaWZ5RG9jKSB7XG4gICAgICAgICAgLy8gT2ggZ3JlYXQsIHdlIGFjdHVhbGx5IGtub3cgd2hhdCB0aGUgZG9jdW1lbnQgaXMsIHNvIHdlIGNhbiBhcHBseVxuICAgICAgICAgIC8vIHRoaXMgZGlyZWN0bHkuXG4gICAgICAgICAgdmFyIG5ld0RvYyA9IHNlbGYuX3B1Ymxpc2hlZC5oYXMoaWQpXG4gICAgICAgICAgICA/IHNlbGYuX3B1Ymxpc2hlZC5nZXQoaWQpIDogc2VsZi5fdW5wdWJsaXNoZWRCdWZmZXIuZ2V0KGlkKTtcbiAgICAgICAgICBuZXdEb2MgPSBFSlNPTi5jbG9uZShuZXdEb2MpO1xuXG4gICAgICAgICAgbmV3RG9jLl9pZCA9IGlkO1xuICAgICAgICAgIHRyeSB7XG4gICAgICAgICAgICBMb2NhbENvbGxlY3Rpb24uX21vZGlmeShuZXdEb2MsIG9wLm8pO1xuICAgICAgICAgIH0gY2F0Y2ggKGUpIHtcbiAgICAgICAgICAgIGlmIChlLm5hbWUgIT09IFwiTWluaW1vbmdvRXJyb3JcIilcbiAgICAgICAgICAgICAgdGhyb3cgZTtcbiAgICAgICAgICAgIC8vIFdlIGRpZG4ndCB1bmRlcnN0YW5kIHRoZSBtb2RpZmllci4gIFJlLWZldGNoLlxuICAgICAgICAgICAgc2VsZi5fbmVlZFRvRmV0Y2guc2V0KGlkLCBvcCk7XG4gICAgICAgICAgICBpZiAoc2VsZi5fcGhhc2UgPT09IFBIQVNFLlNURUFEWSkge1xuICAgICAgICAgICAgICBzZWxmLl9mZXRjaE1vZGlmaWVkRG9jdW1lbnRzKCk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICByZXR1cm47XG4gICAgICAgICAgfVxuICAgICAgICAgIHNlbGYuX2hhbmRsZURvYyhpZCwgc2VsZi5fc2hhcmVkUHJvamVjdGlvbkZuKG5ld0RvYykpO1xuICAgICAgICB9IGVsc2UgaWYgKCFjYW5EaXJlY3RseU1vZGlmeURvYyB8fFxuICAgICAgICAgICAgICAgICAgIHNlbGYuX21hdGNoZXIuY2FuQmVjb21lVHJ1ZUJ5TW9kaWZpZXIob3AubykgfHxcbiAgICAgICAgICAgICAgICAgICAoc2VsZi5fc29ydGVyICYmIHNlbGYuX3NvcnRlci5hZmZlY3RlZEJ5TW9kaWZpZXIob3AubykpKSB7XG4gICAgICAgICAgc2VsZi5fbmVlZFRvRmV0Y2guc2V0KGlkLCBvcCk7XG4gICAgICAgICAgaWYgKHNlbGYuX3BoYXNlID09PSBQSEFTRS5TVEVBRFkpXG4gICAgICAgICAgICBzZWxmLl9mZXRjaE1vZGlmaWVkRG9jdW1lbnRzKCk7XG4gICAgICAgIH1cbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIHRocm93IEVycm9yKFwiWFhYIFNVUlBSSVNJTkcgT1BFUkFUSU9OOiBcIiArIG9wKTtcbiAgICAgIH1cbiAgICB9KTtcbiAgfSxcbiAgLy8gWWllbGRzIVxuICBfcnVuSW5pdGlhbFF1ZXJ5OiBmdW5jdGlvbiAoKSB7XG4gICAgdmFyIHNlbGYgPSB0aGlzO1xuICAgIGlmIChzZWxmLl9zdG9wcGVkKVxuICAgICAgdGhyb3cgbmV3IEVycm9yKFwib3Bsb2cgc3RvcHBlZCBzdXJwcmlzaW5nbHkgZWFybHlcIik7XG5cbiAgICBzZWxmLl9ydW5RdWVyeSh7aW5pdGlhbDogdHJ1ZX0pOyAgLy8geWllbGRzXG5cbiAgICBpZiAoc2VsZi5fc3RvcHBlZClcbiAgICAgIHJldHVybjsgIC8vIGNhbiBoYXBwZW4gb24gcXVlcnlFcnJvclxuXG4gICAgLy8gQWxsb3cgb2JzZXJ2ZUNoYW5nZXMgY2FsbHMgdG8gcmV0dXJuLiAoQWZ0ZXIgdGhpcywgaXQncyBwb3NzaWJsZSBmb3JcbiAgICAvLyBzdG9wKCkgdG8gYmUgY2FsbGVkLilcbiAgICBzZWxmLl9tdWx0aXBsZXhlci5yZWFkeSgpO1xuXG4gICAgc2VsZi5fZG9uZVF1ZXJ5aW5nKCk7ICAvLyB5aWVsZHNcbiAgfSxcblxuICAvLyBJbiB2YXJpb3VzIGNpcmN1bXN0YW5jZXMsIHdlIG1heSBqdXN0IHdhbnQgdG8gc3RvcCBwcm9jZXNzaW5nIHRoZSBvcGxvZyBhbmRcbiAgLy8gcmUtcnVuIHRoZSBpbml0aWFsIHF1ZXJ5LCBqdXN0IGFzIGlmIHdlIHdlcmUgYSBQb2xsaW5nT2JzZXJ2ZURyaXZlci5cbiAgLy9cbiAgLy8gVGhpcyBmdW5jdGlvbiBtYXkgbm90IGJsb2NrLCBiZWNhdXNlIGl0IGlzIGNhbGxlZCBmcm9tIGFuIG9wbG9nIGVudHJ5XG4gIC8vIGhhbmRsZXIuXG4gIC8vXG4gIC8vIFhYWCBXZSBzaG91bGQgY2FsbCB0aGlzIHdoZW4gd2UgZGV0ZWN0IHRoYXQgd2UndmUgYmVlbiBpbiBGRVRDSElORyBmb3IgXCJ0b29cbiAgLy8gbG9uZ1wiLlxuICAvL1xuICAvLyBYWFggV2Ugc2hvdWxkIGNhbGwgdGhpcyB3aGVuIHdlIGRldGVjdCBNb25nbyBmYWlsb3ZlciAoc2luY2UgdGhhdCBtaWdodFxuICAvLyBtZWFuIHRoYXQgc29tZSBvZiB0aGUgb3Bsb2cgZW50cmllcyB3ZSBoYXZlIHByb2Nlc3NlZCBoYXZlIGJlZW4gcm9sbGVkXG4gIC8vIGJhY2spLiBUaGUgTm9kZSBNb25nbyBkcml2ZXIgaXMgaW4gdGhlIG1pZGRsZSBvZiBhIGJ1bmNoIG9mIGh1Z2VcbiAgLy8gcmVmYWN0b3JpbmdzLCBpbmNsdWRpbmcgdGhlIHdheSB0aGF0IGl0IG5vdGlmaWVzIHlvdSB3aGVuIHByaW1hcnlcbiAgLy8gY2hhbmdlcy4gV2lsbCBwdXQgb2ZmIGltcGxlbWVudGluZyB0aGlzIHVudGlsIGRyaXZlciAxLjQgaXMgb3V0LlxuICBfcG9sbFF1ZXJ5OiBmdW5jdGlvbiAoKSB7XG4gICAgdmFyIHNlbGYgPSB0aGlzO1xuICAgIE1ldGVvci5fbm9ZaWVsZHNBbGxvd2VkKGZ1bmN0aW9uICgpIHtcbiAgICAgIGlmIChzZWxmLl9zdG9wcGVkKVxuICAgICAgICByZXR1cm47XG5cbiAgICAgIC8vIFlheSwgd2UgZ2V0IHRvIGZvcmdldCBhYm91dCBhbGwgdGhlIHRoaW5ncyB3ZSB0aG91Z2h0IHdlIGhhZCB0byBmZXRjaC5cbiAgICAgIHNlbGYuX25lZWRUb0ZldGNoID0gbmV3IExvY2FsQ29sbGVjdGlvbi5fSWRNYXA7XG4gICAgICBzZWxmLl9jdXJyZW50bHlGZXRjaGluZyA9IG51bGw7XG4gICAgICArK3NlbGYuX2ZldGNoR2VuZXJhdGlvbjsgIC8vIGlnbm9yZSBhbnkgaW4tZmxpZ2h0IGZldGNoZXNcbiAgICAgIHNlbGYuX3JlZ2lzdGVyUGhhc2VDaGFuZ2UoUEhBU0UuUVVFUllJTkcpO1xuXG4gICAgICAvLyBEZWZlciBzbyB0aGF0IHdlIGRvbid0IHlpZWxkLiAgV2UgZG9uJ3QgbmVlZCBmaW5pc2hJZk5lZWRUb1BvbGxRdWVyeVxuICAgICAgLy8gaGVyZSBiZWNhdXNlIFN3aXRjaGVkVG9RdWVyeSBpcyBub3QgdGhyb3duIGluIFFVRVJZSU5HIG1vZGUuXG4gICAgICBNZXRlb3IuZGVmZXIoZnVuY3Rpb24gKCkge1xuICAgICAgICBzZWxmLl9ydW5RdWVyeSgpO1xuICAgICAgICBzZWxmLl9kb25lUXVlcnlpbmcoKTtcbiAgICAgIH0pO1xuICAgIH0pO1xuICB9LFxuXG4gIC8vIFlpZWxkcyFcbiAgX3J1blF1ZXJ5OiBmdW5jdGlvbiAob3B0aW9ucykge1xuICAgIHZhciBzZWxmID0gdGhpcztcbiAgICBvcHRpb25zID0gb3B0aW9ucyB8fCB7fTtcbiAgICB2YXIgbmV3UmVzdWx0cywgbmV3QnVmZmVyO1xuXG4gICAgLy8gVGhpcyB3aGlsZSBsb29wIGlzIGp1c3QgdG8gcmV0cnkgZmFpbHVyZXMuXG4gICAgd2hpbGUgKHRydWUpIHtcbiAgICAgIC8vIElmIHdlJ3ZlIGJlZW4gc3RvcHBlZCwgd2UgZG9uJ3QgaGF2ZSB0byBydW4gYW55dGhpbmcgYW55IG1vcmUuXG4gICAgICBpZiAoc2VsZi5fc3RvcHBlZClcbiAgICAgICAgcmV0dXJuO1xuXG4gICAgICBuZXdSZXN1bHRzID0gbmV3IExvY2FsQ29sbGVjdGlvbi5fSWRNYXA7XG4gICAgICBuZXdCdWZmZXIgPSBuZXcgTG9jYWxDb2xsZWN0aW9uLl9JZE1hcDtcblxuICAgICAgLy8gUXVlcnkgMnggZG9jdW1lbnRzIGFzIHRoZSBoYWxmIGV4Y2x1ZGVkIGZyb20gdGhlIG9yaWdpbmFsIHF1ZXJ5IHdpbGwgZ29cbiAgICAgIC8vIGludG8gdW5wdWJsaXNoZWQgYnVmZmVyIHRvIHJlZHVjZSBhZGRpdGlvbmFsIE1vbmdvIGxvb2t1cHMgaW4gY2FzZXNcbiAgICAgIC8vIHdoZW4gZG9jdW1lbnRzIGFyZSByZW1vdmVkIGZyb20gdGhlIHB1Ymxpc2hlZCBzZXQgYW5kIG5lZWQgYVxuICAgICAgLy8gcmVwbGFjZW1lbnQuXG4gICAgICAvLyBYWFggbmVlZHMgbW9yZSB0aG91Z2h0IG9uIG5vbi16ZXJvIHNraXBcbiAgICAgIC8vIFhYWCAyIGlzIGEgXCJtYWdpYyBudW1iZXJcIiBtZWFuaW5nIHRoZXJlIGlzIGFuIGV4dHJhIGNodW5rIG9mIGRvY3MgZm9yXG4gICAgICAvLyBidWZmZXIgaWYgc3VjaCBpcyBuZWVkZWQuXG4gICAgICB2YXIgY3Vyc29yID0gc2VsZi5fY3Vyc29yRm9yUXVlcnkoeyBsaW1pdDogc2VsZi5fbGltaXQgKiAyIH0pO1xuICAgICAgdHJ5IHtcbiAgICAgICAgY3Vyc29yLmZvckVhY2goZnVuY3Rpb24gKGRvYywgaSkgeyAgLy8geWllbGRzXG4gICAgICAgICAgaWYgKCFzZWxmLl9saW1pdCB8fCBpIDwgc2VsZi5fbGltaXQpIHtcbiAgICAgICAgICAgIG5ld1Jlc3VsdHMuc2V0KGRvYy5faWQsIGRvYyk7XG4gICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIG5ld0J1ZmZlci5zZXQoZG9jLl9pZCwgZG9jKTtcbiAgICAgICAgICB9XG4gICAgICAgIH0pO1xuICAgICAgICBicmVhaztcbiAgICAgIH0gY2F0Y2ggKGUpIHtcbiAgICAgICAgaWYgKG9wdGlvbnMuaW5pdGlhbCAmJiB0eXBlb2YoZS5jb2RlKSA9PT0gJ251bWJlcicpIHtcbiAgICAgICAgICAvLyBUaGlzIGlzIGFuIGVycm9yIGRvY3VtZW50IHNlbnQgdG8gdXMgYnkgbW9uZ29kLCBub3QgYSBjb25uZWN0aW9uXG4gICAgICAgICAgLy8gZXJyb3IgZ2VuZXJhdGVkIGJ5IHRoZSBjbGllbnQuIEFuZCB3ZSd2ZSBuZXZlciBzZWVuIHRoaXMgcXVlcnkgd29ya1xuICAgICAgICAgIC8vIHN1Y2Nlc3NmdWxseS4gUHJvYmFibHkgaXQncyBhIGJhZCBzZWxlY3RvciBvciBzb21ldGhpbmcsIHNvIHdlXG4gICAgICAgICAgLy8gc2hvdWxkIE5PVCByZXRyeS4gSW5zdGVhZCwgd2Ugc2hvdWxkIGhhbHQgdGhlIG9ic2VydmUgKHdoaWNoIGVuZHNcbiAgICAgICAgICAvLyB1cCBjYWxsaW5nIGBzdG9wYCBvbiB1cykuXG4gICAgICAgICAgc2VsZi5fbXVsdGlwbGV4ZXIucXVlcnlFcnJvcihlKTtcbiAgICAgICAgICByZXR1cm47XG4gICAgICAgIH1cblxuICAgICAgICAvLyBEdXJpbmcgZmFpbG92ZXIgKGVnKSBpZiB3ZSBnZXQgYW4gZXhjZXB0aW9uIHdlIHNob3VsZCBsb2cgYW5kIHJldHJ5XG4gICAgICAgIC8vIGluc3RlYWQgb2YgY3Jhc2hpbmcuXG4gICAgICAgIE1ldGVvci5fZGVidWcoXCJHb3QgZXhjZXB0aW9uIHdoaWxlIHBvbGxpbmcgcXVlcnlcIiwgZSk7XG4gICAgICAgIE1ldGVvci5fc2xlZXBGb3JNcygxMDApO1xuICAgICAgfVxuICAgIH1cblxuICAgIGlmIChzZWxmLl9zdG9wcGVkKVxuICAgICAgcmV0dXJuO1xuXG4gICAgc2VsZi5fcHVibGlzaE5ld1Jlc3VsdHMobmV3UmVzdWx0cywgbmV3QnVmZmVyKTtcbiAgfSxcblxuICAvLyBUcmFuc2l0aW9ucyB0byBRVUVSWUlORyBhbmQgcnVucyBhbm90aGVyIHF1ZXJ5LCBvciAoaWYgYWxyZWFkeSBpbiBRVUVSWUlORylcbiAgLy8gZW5zdXJlcyB0aGF0IHdlIHdpbGwgcXVlcnkgYWdhaW4gbGF0ZXIuXG4gIC8vXG4gIC8vIFRoaXMgZnVuY3Rpb24gbWF5IG5vdCBibG9jaywgYmVjYXVzZSBpdCBpcyBjYWxsZWQgZnJvbSBhbiBvcGxvZyBlbnRyeVxuICAvLyBoYW5kbGVyLiBIb3dldmVyLCBpZiB3ZSB3ZXJlIG5vdCBhbHJlYWR5IGluIHRoZSBRVUVSWUlORyBwaGFzZSwgaXQgdGhyb3dzXG4gIC8vIGFuIGV4Y2VwdGlvbiB0aGF0IGlzIGNhdWdodCBieSB0aGUgY2xvc2VzdCBzdXJyb3VuZGluZ1xuICAvLyBmaW5pc2hJZk5lZWRUb1BvbGxRdWVyeSBjYWxsOyB0aGlzIGVuc3VyZXMgdGhhdCB3ZSBkb24ndCBjb250aW51ZSBydW5uaW5nXG4gIC8vIGNsb3NlIHRoYXQgd2FzIGRlc2lnbmVkIGZvciBhbm90aGVyIHBoYXNlIGluc2lkZSBQSEFTRS5RVUVSWUlORy5cbiAgLy9cbiAgLy8gKEl0J3MgYWxzbyBuZWNlc3Nhcnkgd2hlbmV2ZXIgbG9naWMgaW4gdGhpcyBmaWxlIHlpZWxkcyB0byBjaGVjayB0aGF0IG90aGVyXG4gIC8vIHBoYXNlcyBoYXZlbid0IHB1dCB1cyBpbnRvIFFVRVJZSU5HIG1vZGUsIHRob3VnaDsgZWcsXG4gIC8vIF9mZXRjaE1vZGlmaWVkRG9jdW1lbnRzIGRvZXMgdGhpcy4pXG4gIF9uZWVkVG9Qb2xsUXVlcnk6IGZ1bmN0aW9uICgpIHtcbiAgICB2YXIgc2VsZiA9IHRoaXM7XG4gICAgTWV0ZW9yLl9ub1lpZWxkc0FsbG93ZWQoZnVuY3Rpb24gKCkge1xuICAgICAgaWYgKHNlbGYuX3N0b3BwZWQpXG4gICAgICAgIHJldHVybjtcblxuICAgICAgLy8gSWYgd2UncmUgbm90IGFscmVhZHkgaW4gdGhlIG1pZGRsZSBvZiBhIHF1ZXJ5LCB3ZSBjYW4gcXVlcnkgbm93XG4gICAgICAvLyAocG9zc2libHkgcGF1c2luZyBGRVRDSElORykuXG4gICAgICBpZiAoc2VsZi5fcGhhc2UgIT09IFBIQVNFLlFVRVJZSU5HKSB7XG4gICAgICAgIHNlbGYuX3BvbGxRdWVyeSgpO1xuICAgICAgICB0aHJvdyBuZXcgU3dpdGNoZWRUb1F1ZXJ5O1xuICAgICAgfVxuXG4gICAgICAvLyBXZSdyZSBjdXJyZW50bHkgaW4gUVVFUllJTkcuIFNldCBhIGZsYWcgdG8gZW5zdXJlIHRoYXQgd2UgcnVuIGFub3RoZXJcbiAgICAgIC8vIHF1ZXJ5IHdoZW4gd2UncmUgZG9uZS5cbiAgICAgIHNlbGYuX3JlcXVlcnlXaGVuRG9uZVRoaXNRdWVyeSA9IHRydWU7XG4gICAgfSk7XG4gIH0sXG5cbiAgLy8gWWllbGRzIVxuICBfZG9uZVF1ZXJ5aW5nOiBmdW5jdGlvbiAoKSB7XG4gICAgdmFyIHNlbGYgPSB0aGlzO1xuXG4gICAgaWYgKHNlbGYuX3N0b3BwZWQpXG4gICAgICByZXR1cm47XG4gICAgc2VsZi5fbW9uZ29IYW5kbGUuX29wbG9nSGFuZGxlLndhaXRVbnRpbENhdWdodFVwKCk7ICAvLyB5aWVsZHNcbiAgICBpZiAoc2VsZi5fc3RvcHBlZClcbiAgICAgIHJldHVybjtcbiAgICBpZiAoc2VsZi5fcGhhc2UgIT09IFBIQVNFLlFVRVJZSU5HKVxuICAgICAgdGhyb3cgRXJyb3IoXCJQaGFzZSB1bmV4cGVjdGVkbHkgXCIgKyBzZWxmLl9waGFzZSk7XG5cbiAgICBNZXRlb3IuX25vWWllbGRzQWxsb3dlZChmdW5jdGlvbiAoKSB7XG4gICAgICBpZiAoc2VsZi5fcmVxdWVyeVdoZW5Eb25lVGhpc1F1ZXJ5KSB7XG4gICAgICAgIHNlbGYuX3JlcXVlcnlXaGVuRG9uZVRoaXNRdWVyeSA9IGZhbHNlO1xuICAgICAgICBzZWxmLl9wb2xsUXVlcnkoKTtcbiAgICAgIH0gZWxzZSBpZiAoc2VsZi5fbmVlZFRvRmV0Y2guZW1wdHkoKSkge1xuICAgICAgICBzZWxmLl9iZVN0ZWFkeSgpO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgc2VsZi5fZmV0Y2hNb2RpZmllZERvY3VtZW50cygpO1xuICAgICAgfVxuICAgIH0pO1xuICB9LFxuXG4gIF9jdXJzb3JGb3JRdWVyeTogZnVuY3Rpb24gKG9wdGlvbnNPdmVyd3JpdGUpIHtcbiAgICB2YXIgc2VsZiA9IHRoaXM7XG4gICAgcmV0dXJuIE1ldGVvci5fbm9ZaWVsZHNBbGxvd2VkKGZ1bmN0aW9uICgpIHtcbiAgICAgIC8vIFRoZSBxdWVyeSB3ZSBydW4gaXMgYWxtb3N0IHRoZSBzYW1lIGFzIHRoZSBjdXJzb3Igd2UgYXJlIG9ic2VydmluZyxcbiAgICAgIC8vIHdpdGggYSBmZXcgY2hhbmdlcy4gV2UgbmVlZCB0byByZWFkIGFsbCB0aGUgZmllbGRzIHRoYXQgYXJlIHJlbGV2YW50IHRvXG4gICAgICAvLyB0aGUgc2VsZWN0b3IsIG5vdCBqdXN0IHRoZSBmaWVsZHMgd2UgYXJlIGdvaW5nIHRvIHB1Ymxpc2ggKHRoYXQncyB0aGVcbiAgICAgIC8vIFwic2hhcmVkXCIgcHJvamVjdGlvbikuIEFuZCB3ZSBkb24ndCB3YW50IHRvIGFwcGx5IGFueSB0cmFuc2Zvcm0gaW4gdGhlXG4gICAgICAvLyBjdXJzb3IsIGJlY2F1c2Ugb2JzZXJ2ZUNoYW5nZXMgc2hvdWxkbid0IHVzZSB0aGUgdHJhbnNmb3JtLlxuICAgICAgdmFyIG9wdGlvbnMgPSBfLmNsb25lKHNlbGYuX2N1cnNvckRlc2NyaXB0aW9uLm9wdGlvbnMpO1xuXG4gICAgICAvLyBBbGxvdyB0aGUgY2FsbGVyIHRvIG1vZGlmeSB0aGUgb3B0aW9ucy4gVXNlZnVsIHRvIHNwZWNpZnkgZGlmZmVyZW50XG4gICAgICAvLyBza2lwIGFuZCBsaW1pdCB2YWx1ZXMuXG4gICAgICBfLmV4dGVuZChvcHRpb25zLCBvcHRpb25zT3ZlcndyaXRlKTtcblxuICAgICAgb3B0aW9ucy5maWVsZHMgPSBzZWxmLl9zaGFyZWRQcm9qZWN0aW9uO1xuICAgICAgZGVsZXRlIG9wdGlvbnMudHJhbnNmb3JtO1xuICAgICAgLy8gV2UgYXJlIE5PVCBkZWVwIGNsb25pbmcgZmllbGRzIG9yIHNlbGVjdG9yIGhlcmUsIHdoaWNoIHNob3VsZCBiZSBPSy5cbiAgICAgIHZhciBkZXNjcmlwdGlvbiA9IG5ldyBDdXJzb3JEZXNjcmlwdGlvbihcbiAgICAgICAgc2VsZi5fY3Vyc29yRGVzY3JpcHRpb24uY29sbGVjdGlvbk5hbWUsXG4gICAgICAgIHNlbGYuX2N1cnNvckRlc2NyaXB0aW9uLnNlbGVjdG9yLFxuICAgICAgICBvcHRpb25zKTtcbiAgICAgIHJldHVybiBuZXcgQ3Vyc29yKHNlbGYuX21vbmdvSGFuZGxlLCBkZXNjcmlwdGlvbik7XG4gICAgfSk7XG4gIH0sXG5cblxuICAvLyBSZXBsYWNlIHNlbGYuX3B1Ymxpc2hlZCB3aXRoIG5ld1Jlc3VsdHMgKGJvdGggYXJlIElkTWFwcyksIGludm9raW5nIG9ic2VydmVcbiAgLy8gY2FsbGJhY2tzIG9uIHRoZSBtdWx0aXBsZXhlci5cbiAgLy8gUmVwbGFjZSBzZWxmLl91bnB1Ymxpc2hlZEJ1ZmZlciB3aXRoIG5ld0J1ZmZlci5cbiAgLy9cbiAgLy8gWFhYIFRoaXMgaXMgdmVyeSBzaW1pbGFyIHRvIExvY2FsQ29sbGVjdGlvbi5fZGlmZlF1ZXJ5VW5vcmRlcmVkQ2hhbmdlcy4gV2VcbiAgLy8gc2hvdWxkIHJlYWxseTogKGEpIFVuaWZ5IElkTWFwIGFuZCBPcmRlcmVkRGljdCBpbnRvIFVub3JkZXJlZC9PcmRlcmVkRGljdFxuICAvLyAoYikgUmV3cml0ZSBkaWZmLmpzIHRvIHVzZSB0aGVzZSBjbGFzc2VzIGluc3RlYWQgb2YgYXJyYXlzIGFuZCBvYmplY3RzLlxuICBfcHVibGlzaE5ld1Jlc3VsdHM6IGZ1bmN0aW9uIChuZXdSZXN1bHRzLCBuZXdCdWZmZXIpIHtcbiAgICB2YXIgc2VsZiA9IHRoaXM7XG4gICAgTWV0ZW9yLl9ub1lpZWxkc0FsbG93ZWQoZnVuY3Rpb24gKCkge1xuXG4gICAgICAvLyBJZiB0aGUgcXVlcnkgaXMgbGltaXRlZCBhbmQgdGhlcmUgaXMgYSBidWZmZXIsIHNodXQgZG93biBzbyBpdCBkb2Vzbid0XG4gICAgICAvLyBzdGF5IGluIGEgd2F5LlxuICAgICAgaWYgKHNlbGYuX2xpbWl0KSB7XG4gICAgICAgIHNlbGYuX3VucHVibGlzaGVkQnVmZmVyLmNsZWFyKCk7XG4gICAgICB9XG5cbiAgICAgIC8vIEZpcnN0IHJlbW92ZSBhbnl0aGluZyB0aGF0J3MgZ29uZS4gQmUgY2FyZWZ1bCBub3QgdG8gbW9kaWZ5XG4gICAgICAvLyBzZWxmLl9wdWJsaXNoZWQgd2hpbGUgaXRlcmF0aW5nIG92ZXIgaXQuXG4gICAgICB2YXIgaWRzVG9SZW1vdmUgPSBbXTtcbiAgICAgIHNlbGYuX3B1Ymxpc2hlZC5mb3JFYWNoKGZ1bmN0aW9uIChkb2MsIGlkKSB7XG4gICAgICAgIGlmICghbmV3UmVzdWx0cy5oYXMoaWQpKVxuICAgICAgICAgIGlkc1RvUmVtb3ZlLnB1c2goaWQpO1xuICAgICAgfSk7XG4gICAgICBfLmVhY2goaWRzVG9SZW1vdmUsIGZ1bmN0aW9uIChpZCkge1xuICAgICAgICBzZWxmLl9yZW1vdmVQdWJsaXNoZWQoaWQpO1xuICAgICAgfSk7XG5cbiAgICAgIC8vIE5vdyBkbyBhZGRzIGFuZCBjaGFuZ2VzLlxuICAgICAgLy8gSWYgc2VsZiBoYXMgYSBidWZmZXIgYW5kIGxpbWl0LCB0aGUgbmV3IGZldGNoZWQgcmVzdWx0IHdpbGwgYmVcbiAgICAgIC8vIGxpbWl0ZWQgY29ycmVjdGx5IGFzIHRoZSBxdWVyeSBoYXMgc29ydCBzcGVjaWZpZXIuXG4gICAgICBuZXdSZXN1bHRzLmZvckVhY2goZnVuY3Rpb24gKGRvYywgaWQpIHtcbiAgICAgICAgc2VsZi5faGFuZGxlRG9jKGlkLCBkb2MpO1xuICAgICAgfSk7XG5cbiAgICAgIC8vIFNhbml0eS1jaGVjayB0aGF0IGV2ZXJ5dGhpbmcgd2UgdHJpZWQgdG8gcHV0IGludG8gX3B1Ymxpc2hlZCBlbmRlZCB1cFxuICAgICAgLy8gdGhlcmUuXG4gICAgICAvLyBYWFggaWYgdGhpcyBpcyBzbG93LCByZW1vdmUgaXQgbGF0ZXJcbiAgICAgIGlmIChzZWxmLl9wdWJsaXNoZWQuc2l6ZSgpICE9PSBuZXdSZXN1bHRzLnNpemUoKSkge1xuICAgICAgICBjb25zb2xlLmVycm9yKCdUaGUgTW9uZ28gc2VydmVyIGFuZCB0aGUgTWV0ZW9yIHF1ZXJ5IGRpc2FncmVlIG9uIGhvdyAnICtcbiAgICAgICAgICAnbWFueSBkb2N1bWVudHMgbWF0Y2ggeW91ciBxdWVyeS4gQ3Vyc29yIGRlc2NyaXB0aW9uOiAnLFxuICAgICAgICAgIHNlbGYuX2N1cnNvckRlc2NyaXB0aW9uKTtcbiAgICAgICAgdGhyb3cgRXJyb3IoXG4gICAgICAgICAgXCJUaGUgTW9uZ28gc2VydmVyIGFuZCB0aGUgTWV0ZW9yIHF1ZXJ5IGRpc2FncmVlIG9uIGhvdyBcIiArXG4gICAgICAgICAgICBcIm1hbnkgZG9jdW1lbnRzIG1hdGNoIHlvdXIgcXVlcnkuIE1heWJlIGl0IGlzIGhpdHRpbmcgYSBNb25nbyBcIiArXG4gICAgICAgICAgICBcImVkZ2UgY2FzZT8gVGhlIHF1ZXJ5IGlzOiBcIiArXG4gICAgICAgICAgICBFSlNPTi5zdHJpbmdpZnkoc2VsZi5fY3Vyc29yRGVzY3JpcHRpb24uc2VsZWN0b3IpKTtcbiAgICAgIH1cbiAgICAgIHNlbGYuX3B1Ymxpc2hlZC5mb3JFYWNoKGZ1bmN0aW9uIChkb2MsIGlkKSB7XG4gICAgICAgIGlmICghbmV3UmVzdWx0cy5oYXMoaWQpKVxuICAgICAgICAgIHRocm93IEVycm9yKFwiX3B1Ymxpc2hlZCBoYXMgYSBkb2MgdGhhdCBuZXdSZXN1bHRzIGRvZXNuJ3Q7IFwiICsgaWQpO1xuICAgICAgfSk7XG5cbiAgICAgIC8vIEZpbmFsbHksIHJlcGxhY2UgdGhlIGJ1ZmZlclxuICAgICAgbmV3QnVmZmVyLmZvckVhY2goZnVuY3Rpb24gKGRvYywgaWQpIHtcbiAgICAgICAgc2VsZi5fYWRkQnVmZmVyZWQoaWQsIGRvYyk7XG4gICAgICB9KTtcblxuICAgICAgc2VsZi5fc2FmZUFwcGVuZFRvQnVmZmVyID0gbmV3QnVmZmVyLnNpemUoKSA8IHNlbGYuX2xpbWl0O1xuICAgIH0pO1xuICB9LFxuXG4gIC8vIFRoaXMgc3RvcCBmdW5jdGlvbiBpcyBpbnZva2VkIGZyb20gdGhlIG9uU3RvcCBvZiB0aGUgT2JzZXJ2ZU11bHRpcGxleGVyLCBzb1xuICAvLyBpdCBzaG91bGRuJ3QgYWN0dWFsbHkgYmUgcG9zc2libGUgdG8gY2FsbCBpdCB1bnRpbCB0aGUgbXVsdGlwbGV4ZXIgaXNcbiAgLy8gcmVhZHkuXG4gIC8vXG4gIC8vIEl0J3MgaW1wb3J0YW50IHRvIGNoZWNrIHNlbGYuX3N0b3BwZWQgYWZ0ZXIgZXZlcnkgY2FsbCBpbiB0aGlzIGZpbGUgdGhhdFxuICAvLyBjYW4geWllbGQhXG4gIHN0b3A6IGZ1bmN0aW9uICgpIHtcbiAgICB2YXIgc2VsZiA9IHRoaXM7XG4gICAgaWYgKHNlbGYuX3N0b3BwZWQpXG4gICAgICByZXR1cm47XG4gICAgc2VsZi5fc3RvcHBlZCA9IHRydWU7XG4gICAgXy5lYWNoKHNlbGYuX3N0b3BIYW5kbGVzLCBmdW5jdGlvbiAoaGFuZGxlKSB7XG4gICAgICBoYW5kbGUuc3RvcCgpO1xuICAgIH0pO1xuXG4gICAgLy8gTm90ZTogd2UgKmRvbid0KiB1c2UgbXVsdGlwbGV4ZXIub25GbHVzaCBoZXJlIGJlY2F1c2UgdGhpcyBzdG9wXG4gICAgLy8gY2FsbGJhY2sgaXMgYWN0dWFsbHkgaW52b2tlZCBieSB0aGUgbXVsdGlwbGV4ZXIgaXRzZWxmIHdoZW4gaXQgaGFzXG4gICAgLy8gZGV0ZXJtaW5lZCB0aGF0IHRoZXJlIGFyZSBubyBoYW5kbGVzIGxlZnQuIFNvIG5vdGhpbmcgaXMgYWN0dWFsbHkgZ29pbmdcbiAgICAvLyB0byBnZXQgZmx1c2hlZCAoYW5kIGl0J3MgcHJvYmFibHkgbm90IHZhbGlkIHRvIGNhbGwgbWV0aG9kcyBvbiB0aGVcbiAgICAvLyBkeWluZyBtdWx0aXBsZXhlcikuXG4gICAgXy5lYWNoKHNlbGYuX3dyaXRlc1RvQ29tbWl0V2hlbldlUmVhY2hTdGVhZHksIGZ1bmN0aW9uICh3KSB7XG4gICAgICB3LmNvbW1pdHRlZCgpOyAgLy8gbWF5YmUgeWllbGRzP1xuICAgIH0pO1xuICAgIHNlbGYuX3dyaXRlc1RvQ29tbWl0V2hlbldlUmVhY2hTdGVhZHkgPSBudWxsO1xuXG4gICAgLy8gUHJvYWN0aXZlbHkgZHJvcCByZWZlcmVuY2VzIHRvIHBvdGVudGlhbGx5IGJpZyB0aGluZ3MuXG4gICAgc2VsZi5fcHVibGlzaGVkID0gbnVsbDtcbiAgICBzZWxmLl91bnB1Ymxpc2hlZEJ1ZmZlciA9IG51bGw7XG4gICAgc2VsZi5fbmVlZFRvRmV0Y2ggPSBudWxsO1xuICAgIHNlbGYuX2N1cnJlbnRseUZldGNoaW5nID0gbnVsbDtcbiAgICBzZWxmLl9vcGxvZ0VudHJ5SGFuZGxlID0gbnVsbDtcbiAgICBzZWxmLl9saXN0ZW5lcnNIYW5kbGUgPSBudWxsO1xuXG4gICAgUGFja2FnZVsnZmFjdHMtYmFzZSddICYmIFBhY2thZ2VbJ2ZhY3RzLWJhc2UnXS5GYWN0cy5pbmNyZW1lbnRTZXJ2ZXJGYWN0KFxuICAgICAgXCJtb25nby1saXZlZGF0YVwiLCBcIm9ic2VydmUtZHJpdmVycy1vcGxvZ1wiLCAtMSk7XG4gIH0sXG5cbiAgX3JlZ2lzdGVyUGhhc2VDaGFuZ2U6IGZ1bmN0aW9uIChwaGFzZSkge1xuICAgIHZhciBzZWxmID0gdGhpcztcbiAgICBNZXRlb3IuX25vWWllbGRzQWxsb3dlZChmdW5jdGlvbiAoKSB7XG4gICAgICB2YXIgbm93ID0gbmV3IERhdGU7XG5cbiAgICAgIGlmIChzZWxmLl9waGFzZSkge1xuICAgICAgICB2YXIgdGltZURpZmYgPSBub3cgLSBzZWxmLl9waGFzZVN0YXJ0VGltZTtcbiAgICAgICAgUGFja2FnZVsnZmFjdHMtYmFzZSddICYmIFBhY2thZ2VbJ2ZhY3RzLWJhc2UnXS5GYWN0cy5pbmNyZW1lbnRTZXJ2ZXJGYWN0KFxuICAgICAgICAgIFwibW9uZ28tbGl2ZWRhdGFcIiwgXCJ0aW1lLXNwZW50LWluLVwiICsgc2VsZi5fcGhhc2UgKyBcIi1waGFzZVwiLCB0aW1lRGlmZik7XG4gICAgICB9XG5cbiAgICAgIHNlbGYuX3BoYXNlID0gcGhhc2U7XG4gICAgICBzZWxmLl9waGFzZVN0YXJ0VGltZSA9IG5vdztcbiAgICB9KTtcbiAgfVxufSk7XG5cbi8vIERvZXMgb3VyIG9wbG9nIHRhaWxpbmcgY29kZSBzdXBwb3J0IHRoaXMgY3Vyc29yPyBGb3Igbm93LCB3ZSBhcmUgYmVpbmcgdmVyeVxuLy8gY29uc2VydmF0aXZlIGFuZCBhbGxvd2luZyBvbmx5IHNpbXBsZSBxdWVyaWVzIHdpdGggc2ltcGxlIG9wdGlvbnMuXG4vLyAoVGhpcyBpcyBhIFwic3RhdGljIG1ldGhvZFwiLilcbk9wbG9nT2JzZXJ2ZURyaXZlci5jdXJzb3JTdXBwb3J0ZWQgPSBmdW5jdGlvbiAoY3Vyc29yRGVzY3JpcHRpb24sIG1hdGNoZXIpIHtcbiAgLy8gRmlyc3QsIGNoZWNrIHRoZSBvcHRpb25zLlxuICB2YXIgb3B0aW9ucyA9IGN1cnNvckRlc2NyaXB0aW9uLm9wdGlvbnM7XG5cbiAgLy8gRGlkIHRoZSB1c2VyIHNheSBubyBleHBsaWNpdGx5P1xuICAvLyB1bmRlcnNjb3JlZCB2ZXJzaW9uIG9mIHRoZSBvcHRpb24gaXMgQ09NUEFUIHdpdGggMS4yXG4gIGlmIChvcHRpb25zLmRpc2FibGVPcGxvZyB8fCBvcHRpb25zLl9kaXNhYmxlT3Bsb2cpXG4gICAgcmV0dXJuIGZhbHNlO1xuXG4gIC8vIHNraXAgaXMgbm90IHN1cHBvcnRlZDogdG8gc3VwcG9ydCBpdCB3ZSB3b3VsZCBuZWVkIHRvIGtlZXAgdHJhY2sgb2YgYWxsXG4gIC8vIFwic2tpcHBlZFwiIGRvY3VtZW50cyBvciBhdCBsZWFzdCB0aGVpciBpZHMuXG4gIC8vIGxpbWl0IHcvbyBhIHNvcnQgc3BlY2lmaWVyIGlzIG5vdCBzdXBwb3J0ZWQ6IGN1cnJlbnQgaW1wbGVtZW50YXRpb24gbmVlZHMgYVxuICAvLyBkZXRlcm1pbmlzdGljIHdheSB0byBvcmRlciBkb2N1bWVudHMuXG4gIGlmIChvcHRpb25zLnNraXAgfHwgKG9wdGlvbnMubGltaXQgJiYgIW9wdGlvbnMuc29ydCkpIHJldHVybiBmYWxzZTtcblxuICAvLyBJZiBhIGZpZWxkcyBwcm9qZWN0aW9uIG9wdGlvbiBpcyBnaXZlbiBjaGVjayBpZiBpdCBpcyBzdXBwb3J0ZWQgYnlcbiAgLy8gbWluaW1vbmdvIChzb21lIG9wZXJhdG9ycyBhcmUgbm90IHN1cHBvcnRlZCkuXG4gIGNvbnN0IGZpZWxkcyA9IG9wdGlvbnMuZmllbGRzIHx8IG9wdGlvbnMucHJvamVjdGlvbjtcbiAgaWYgKGZpZWxkcykge1xuICAgIHRyeSB7XG4gICAgICBMb2NhbENvbGxlY3Rpb24uX2NoZWNrU3VwcG9ydGVkUHJvamVjdGlvbihmaWVsZHMpO1xuICAgIH0gY2F0Y2ggKGUpIHtcbiAgICAgIGlmIChlLm5hbWUgPT09IFwiTWluaW1vbmdvRXJyb3JcIikge1xuICAgICAgICByZXR1cm4gZmFsc2U7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICB0aHJvdyBlO1xuICAgICAgfVxuICAgIH1cbiAgfVxuXG4gIC8vIFdlIGRvbid0IGFsbG93IHRoZSBmb2xsb3dpbmcgc2VsZWN0b3JzOlxuICAvLyAgIC0gJHdoZXJlIChub3QgY29uZmlkZW50IHRoYXQgd2UgcHJvdmlkZSB0aGUgc2FtZSBKUyBlbnZpcm9ubWVudFxuICAvLyAgICAgICAgICAgICBhcyBNb25nbywgYW5kIGNhbiB5aWVsZCEpXG4gIC8vICAgLSAkbmVhciAoaGFzIFwiaW50ZXJlc3RpbmdcIiBwcm9wZXJ0aWVzIGluIE1vbmdvREIsIGxpa2UgdGhlIHBvc3NpYmlsaXR5XG4gIC8vICAgICAgICAgICAgb2YgcmV0dXJuaW5nIGFuIElEIG11bHRpcGxlIHRpbWVzLCB0aG91Z2ggZXZlbiBwb2xsaW5nIG1heWJlXG4gIC8vICAgICAgICAgICAgaGF2ZSBhIGJ1ZyB0aGVyZSlcbiAgLy8gICAgICAgICAgIFhYWDogb25jZSB3ZSBzdXBwb3J0IGl0LCB3ZSB3b3VsZCBuZWVkIHRvIHRoaW5rIG1vcmUgb24gaG93IHdlXG4gIC8vICAgICAgICAgICBpbml0aWFsaXplIHRoZSBjb21wYXJhdG9ycyB3aGVuIHdlIGNyZWF0ZSB0aGUgZHJpdmVyLlxuICByZXR1cm4gIW1hdGNoZXIuaGFzV2hlcmUoKSAmJiAhbWF0Y2hlci5oYXNHZW9RdWVyeSgpO1xufTtcblxudmFyIG1vZGlmaWVyQ2FuQmVEaXJlY3RseUFwcGxpZWQgPSBmdW5jdGlvbiAobW9kaWZpZXIpIHtcbiAgcmV0dXJuIF8uYWxsKG1vZGlmaWVyLCBmdW5jdGlvbiAoZmllbGRzLCBvcGVyYXRpb24pIHtcbiAgICByZXR1cm4gXy5hbGwoZmllbGRzLCBmdW5jdGlvbiAodmFsdWUsIGZpZWxkKSB7XG4gICAgICByZXR1cm4gIS9FSlNPTlxcJC8udGVzdChmaWVsZCk7XG4gICAgfSk7XG4gIH0pO1xufTtcblxuTW9uZ29JbnRlcm5hbHMuT3Bsb2dPYnNlcnZlRHJpdmVyID0gT3Bsb2dPYnNlcnZlRHJpdmVyO1xuIiwiLy8gd2UgYXJlIG1hcHBpbmcgdGhlIG5ldyBvcGxvZyBmb3JtYXQgb24gbW9uZ28gNVxuLy8gdG8gd2hhdCB3ZSBrbm93IGJldHRlciwgJHNldCBhbmQgJHVuc2V0IGZvcm1hdFxuLy8gbmV3IG9wbG9nIGZvcm1hdCBleDpcbi8vIHtcbi8vICAnJHYnOiAyLFxuLy8gIGRpZmY6IHsgdTogeyBrZXkxOiAyMDIyLTAxLTA2VDE4OjIzOjE2LjEzMVosIGtleTI6IFtPYmplY3RJRF0gfSB9XG4vLyB9XG5cbmZ1bmN0aW9uIGxvZ0NvbnZlcnRlckNhbGxzKG9wbG9nRW50cnksIHByZWZpeEtleSwga2V5KSB7XG4gIGlmICghcHJvY2Vzcy5lbnYuT1BMT0dfQ09OVkVSVEVSX0RFQlVHKSB7XG4gICAgcmV0dXJuO1xuICB9XG4gIGNvbnNvbGUubG9nKCdDYWxsaW5nIG5lc3RlZE9wbG9nRW50cnlQYXJzZXJzIHdpdGggdGhlIGZvbGxvd2luZyB2YWx1ZXM6ICcpO1xuICBjb25zb2xlLmxvZyhcbiAgICBgT3Bsb2cgZW50cnk6ICR7SlNPTi5zdHJpbmdpZnkoXG4gICAgICBvcGxvZ0VudHJ5XG4gICAgKX0sIHByZWZpeEtleTogJHtwcmVmaXhLZXl9LCBrZXk6ICR7a2V5fWBcbiAgKTtcbn1cblxuLypcbnRoZSBzdHJ1Y3R1cmUgb2YgYW4gZW50cnkgaXM6XG5cblxuLT4gZW50cnk6IGksIHUsIGQgKyBzRmllbGRzLlxuLT4gc0ZpZWxkczogaSwgdSwgZCArIHNGaWVsZHNcbi0+IHNGaWVsZHM6IGFycmF5T3BlcmF0b3IgLT4geyBhOiB0cnVlLCB1MDogMiB9XG4tPiBpLHUsZDogeyBrZXk6IHZhbHVlIH1cbi0+IHZhbHVlOiB7a2V5OiB2YWx1ZX1cblxuaSBhbmQgdSBhcmUgYm90aCAkc2V0XG5kIGlzICR1bnNldFxub24gbW9uZ28gNFxuICovXG5cbmNvbnN0IGlzQXJyYXlPcGVyYXRvciA9IHBvc3NpYmxlQXJyYXlPcGVyYXRvciA9PiB7XG4gIGlmICghcG9zc2libGVBcnJheU9wZXJhdG9yIHx8ICFPYmplY3Qua2V5cyhwb3NzaWJsZUFycmF5T3BlcmF0b3IpLmxlbmd0aClcbiAgICByZXR1cm4gZmFsc2U7XG5cbiAgaWYgKCFwb3NzaWJsZUFycmF5T3BlcmF0b3IuYSkge1xuICAgIHJldHVybiBmYWxzZTtcbiAgfVxuICByZXR1cm4gIU9iamVjdC5rZXlzKHBvc3NpYmxlQXJyYXlPcGVyYXRvcikuZmluZChcbiAgICAgIGtleSA9PiBrZXkgIT09ICdhJyAmJiAha2V5Lm1hdGNoKC9edVxcZCsvKVxuICApO1xufTtcbmZ1bmN0aW9uIGxvZ09wbG9nRW50cnlFcnJvcihvcGxvZ0VudHJ5LCBwcmVmaXhLZXksIGtleSkge1xuICBjb25zb2xlLmxvZygnLS0tJyk7XG4gIGNvbnNvbGUubG9nKFxuICAgICdXQVJOSU5HOiBVbnN1cHBvcnRlZCBvcGxvZyBvcGVyYXRpb24sIHBsZWFzZSBmaWxsIGFuIGlzc3VlIHdpdGggdGhpcyBtZXNzYWdlIGF0IGdpdGh1Yi5jb20vbWV0ZW9yL21ldGVvcidcbiAgKTtcbiAgY29uc29sZS5sb2coXG4gICAgYE9wbG9nIGVudHJ5OiAke0pTT04uc3RyaW5naWZ5KFxuICAgICAgb3Bsb2dFbnRyeVxuICAgICl9LCBwcmVmaXhLZXk6ICR7cHJlZml4S2V5fSwga2V5OiAke2tleX1gXG4gICk7XG4gIGNvbnNvbGUubG9nKCctLS0nKTtcbn1cblxuY29uc3QgbmVzdGVkT3Bsb2dFbnRyeVBhcnNlcnMgPSAob3Bsb2dFbnRyeSwgcHJlZml4S2V5ID0gJycpID0+IHtcbiAgY29uc3QgeyBpID0ge30sIHUgPSB7fSwgZCA9IHt9LCAuLi5zRmllbGRzIH0gPSBvcGxvZ0VudHJ5O1xuICBsb2dDb252ZXJ0ZXJDYWxscyhvcGxvZ0VudHJ5LCBwcmVmaXhLZXksICdFTlRSWV9QT0lOVCcpO1xuICBjb25zdCBzRmllbGRzT3BlcmF0b3JzID0gW107XG4gIE9iamVjdC5lbnRyaWVzKHNGaWVsZHMpLmZvckVhY2goKFtrZXksIHZhbHVlXSkgPT4ge1xuICAgIGNvbnN0IGFjdHVhbEtleU5hbWVXaXRob3V0U1ByZWZpeCA9IGtleS5zdWJzdHJpbmcoMSk7XG4gICAgaWYgKGlzQXJyYXlPcGVyYXRvcih2YWx1ZSB8fCB7fSkpIHtcbiAgICAgIGNvbnN0IHsgYSwgLi4udVBvc2l0aW9uIH0gPSB2YWx1ZTtcbiAgICAgIGlmICh1UG9zaXRpb24pIHtcbiAgICAgICAgZm9yIChjb25zdCBbcG9zaXRpb25LZXksIG5ld0FycmF5SW5kZXhWYWx1ZV0gb2YgT2JqZWN0LmVudHJpZXMoXG4gICAgICAgICAgdVBvc2l0aW9uXG4gICAgICAgICkpIHtcbiAgICAgICAgICBzRmllbGRzT3BlcmF0b3JzLnB1c2goe1xuICAgICAgICAgICAgW25ld0FycmF5SW5kZXhWYWx1ZSA9PT0gbnVsbCA/ICckdW5zZXQnIDogJyRzZXQnXToge1xuICAgICAgICAgICAgICBbYCR7cHJlZml4S2V5fSR7YWN0dWFsS2V5TmFtZVdpdGhvdXRTUHJlZml4fS4ke3Bvc2l0aW9uS2V5LnN1YnN0cmluZyhcbiAgICAgICAgICAgICAgICAxXG4gICAgICAgICAgICAgICl9YF06IG5ld0FycmF5SW5kZXhWYWx1ZSA9PT0gbnVsbCA/IHRydWUgOiBuZXdBcnJheUluZGV4VmFsdWUsXG4gICAgICAgICAgICB9LFxuICAgICAgICAgIH0pO1xuICAgICAgICB9XG4gICAgICB9IGVsc2Uge1xuICAgICAgICBsb2dPcGxvZ0VudHJ5RXJyb3Iob3Bsb2dFbnRyeSwgcHJlZml4S2V5LCBrZXkpO1xuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoXG4gICAgICAgICAgYFVuc3VwcG9ydGVkIG9wbG9nIGFycmF5IGVudHJ5LCBwbGVhc2UgcmV2aWV3IHRoZSBpbnB1dDogJHtKU09OLnN0cmluZ2lmeShcbiAgICAgICAgICAgIHZhbHVlXG4gICAgICAgICAgKX1gXG4gICAgICAgICk7XG4gICAgICB9XG4gICAgfSBlbHNlIHtcbiAgICAgIC8vIHdlIGFyZSBsb29raW5nIGF0IHNvbWV0aGluZyB0aGF0IHdlIGV4cGVjdGVkIHRvIGJlIFwic1NvbWV0aGluZ1wiIGJ1dCBpcyBudWxsIGFmdGVyIHJlbW92aW5nIHNcbiAgICAgIC8vIHRoaXMgaGFwcGVucyBvbiBcImFcIjogdHJ1ZSB3aGljaCBpcyBhIHNpbXBseSBhY2sgdGhhdCBjb21lcyBlbWJlZGVkXG4gICAgICAvLyB3ZSBkb250IG5lZWQgdG8gY2FsbCByZWN1cnNpb24gb24gdGhpcyBjYXNlLCBvbmx5IGlnbm9yZSBpdFxuICAgICAgaWYgKCFhY3R1YWxLZXlOYW1lV2l0aG91dFNQcmVmaXggfHwgYWN0dWFsS2V5TmFtZVdpdGhvdXRTUHJlZml4ID09PSAnJykge1xuICAgICAgICByZXR1cm4gbnVsbDtcbiAgICAgIH1cbiAgICAgIC8vIHdlIGFyZSBsb29raW5nIGF0IGEgXCJzU29tZXRoaW5nXCIgdGhhdCBpcyBhY3R1YWxseSBhIG5lc3RlZCBvYmplY3Qgc2V0XG4gICAgICBsb2dDb252ZXJ0ZXJDYWxscyhvcGxvZ0VudHJ5LCBwcmVmaXhLZXksIGtleSk7XG4gICAgICBzRmllbGRzT3BlcmF0b3JzLnB1c2goXG4gICAgICAgIG5lc3RlZE9wbG9nRW50cnlQYXJzZXJzKFxuICAgICAgICAgIHZhbHVlLFxuICAgICAgICAgIGAke3ByZWZpeEtleX0ke2FjdHVhbEtleU5hbWVXaXRob3V0U1ByZWZpeH0uYFxuICAgICAgICApXG4gICAgICApO1xuICAgIH1cbiAgfSk7XG4gIGNvbnN0ICR1bnNldCA9IE9iamVjdC5rZXlzKGQpLnJlZHVjZSgoYWNjLCBrZXkpID0+IHtcbiAgICByZXR1cm4geyAuLi5hY2MsIFtgJHtwcmVmaXhLZXl9JHtrZXl9YF06IHRydWUgfTtcbiAgfSwge30pO1xuICBjb25zdCBzZXRPYmplY3RTb3VyY2UgPSB7IC4uLmksIC4uLnUgfTtcbiAgY29uc3QgJHNldCA9IE9iamVjdC5rZXlzKHNldE9iamVjdFNvdXJjZSkucmVkdWNlKChhY2MsIGtleSkgPT4ge1xuICAgIGNvbnN0IHByZWZpeGVkS2V5ID0gYCR7cHJlZml4S2V5fSR7a2V5fWA7XG4gICAgcmV0dXJuIHtcbiAgICAgIC4uLmFjYyxcbiAgICAgIC4uLighQXJyYXkuaXNBcnJheShzZXRPYmplY3RTb3VyY2Vba2V5XSkgJiZcbiAgICAgIHR5cGVvZiBzZXRPYmplY3RTb3VyY2Vba2V5XSA9PT0gJ29iamVjdCdcbiAgICAgICAgPyBmbGF0dGVuT2JqZWN0KHsgW3ByZWZpeGVkS2V5XTogc2V0T2JqZWN0U291cmNlW2tleV0gfSlcbiAgICAgICAgOiB7XG4gICAgICAgICAgICBbcHJlZml4ZWRLZXldOiBzZXRPYmplY3RTb3VyY2Vba2V5XSxcbiAgICAgICAgICB9KSxcbiAgICB9O1xuICB9LCB7fSk7XG5cbiAgY29uc3QgYyA9IFsuLi5zRmllbGRzT3BlcmF0b3JzLCB7ICR1bnNldCwgJHNldCB9XTtcbiAgY29uc3QgeyAkc2V0OiBzLCAkdW5zZXQ6IHVuIH0gPSBjLnJlZHVjZShcbiAgICAoYWNjLCB7ICRzZXQ6IHNldCA9IHt9LCAkdW5zZXQ6IHVuc2V0ID0ge30gfSkgPT4ge1xuICAgICAgcmV0dXJuIHtcbiAgICAgICAgJHNldDogeyAuLi5hY2MuJHNldCwgLi4uc2V0IH0sXG4gICAgICAgICR1bnNldDogeyAuLi5hY2MuJHVuc2V0LCAuLi51bnNldCB9LFxuICAgICAgfTtcbiAgICB9LFxuICAgIHt9XG4gICk7XG4gIHJldHVybiB7XG4gICAgLi4uKE9iamVjdC5rZXlzKHMpLmxlbmd0aCA/IHsgJHNldDogcyB9IDoge30pLFxuICAgIC4uLihPYmplY3Qua2V5cyh1bikubGVuZ3RoID8geyAkdW5zZXQ6IHVuIH0gOiB7fSksXG4gIH07XG59O1xuXG5leHBvcnQgY29uc3Qgb3Bsb2dWMlYxQ29udmVydGVyID0gdjJPcGxvZ0VudHJ5ID0+IHtcbiAgaWYgKHYyT3Bsb2dFbnRyeS4kdiAhPT0gMiB8fCAhdjJPcGxvZ0VudHJ5LmRpZmYpIHJldHVybiB2Mk9wbG9nRW50cnk7XG4gIGxvZ0NvbnZlcnRlckNhbGxzKHYyT3Bsb2dFbnRyeSwgJ0lOSVRJQUxfQ0FMTCcsICdJTklUSUFMX0NBTEwnKTtcbiAgcmV0dXJuIHsgJHY6IDIsIC4uLm5lc3RlZE9wbG9nRW50cnlQYXJzZXJzKHYyT3Bsb2dFbnRyeS5kaWZmIHx8IHt9KSB9O1xufTtcblxuZnVuY3Rpb24gZmxhdHRlbk9iamVjdChvYikge1xuICBjb25zdCB0b1JldHVybiA9IHt9O1xuXG4gIGZvciAoY29uc3QgaSBpbiBvYikge1xuICAgIGlmICghb2IuaGFzT3duUHJvcGVydHkoaSkpIGNvbnRpbnVlO1xuXG4gICAgaWYgKCFBcnJheS5pc0FycmF5KG9iW2ldKSAmJiB0eXBlb2Ygb2JbaV0gPT0gJ29iamVjdCcgJiYgb2JbaV0gIT09IG51bGwpIHtcbiAgICAgIGNvbnN0IGZsYXRPYmplY3QgPSBmbGF0dGVuT2JqZWN0KG9iW2ldKTtcbiAgICAgIGxldCBvYmplY3RLZXlzID0gT2JqZWN0LmtleXMoZmxhdE9iamVjdCk7XG4gICAgICBpZiAob2JqZWN0S2V5cy5sZW5ndGggPT09IDApIHtcbiAgICAgICAgcmV0dXJuIG9iO1xuICAgICAgfVxuICAgICAgZm9yIChjb25zdCB4IG9mIG9iamVjdEtleXMpIHtcbiAgICAgICAgdG9SZXR1cm5baSArICcuJyArIHhdID0gZmxhdE9iamVjdFt4XTtcbiAgICAgIH1cbiAgICB9IGVsc2Uge1xuICAgICAgdG9SZXR1cm5baV0gPSBvYltpXTtcbiAgICB9XG4gIH1cbiAgcmV0dXJuIHRvUmV0dXJuO1xufVxuIiwiLy8gc2luZ2xldG9uXG5leHBvcnQgY29uc3QgTG9jYWxDb2xsZWN0aW9uRHJpdmVyID0gbmV3IChjbGFzcyBMb2NhbENvbGxlY3Rpb25Ecml2ZXIge1xuICBjb25zdHJ1Y3RvcigpIHtcbiAgICB0aGlzLm5vQ29ubkNvbGxlY3Rpb25zID0gT2JqZWN0LmNyZWF0ZShudWxsKTtcbiAgfVxuXG4gIG9wZW4obmFtZSwgY29ubikge1xuICAgIGlmICghIG5hbWUpIHtcbiAgICAgIHJldHVybiBuZXcgTG9jYWxDb2xsZWN0aW9uO1xuICAgIH1cblxuICAgIGlmICghIGNvbm4pIHtcbiAgICAgIHJldHVybiBlbnN1cmVDb2xsZWN0aW9uKG5hbWUsIHRoaXMubm9Db25uQ29sbGVjdGlvbnMpO1xuICAgIH1cblxuICAgIGlmICghIGNvbm4uX21vbmdvX2xpdmVkYXRhX2NvbGxlY3Rpb25zKSB7XG4gICAgICBjb25uLl9tb25nb19saXZlZGF0YV9jb2xsZWN0aW9ucyA9IE9iamVjdC5jcmVhdGUobnVsbCk7XG4gICAgfVxuXG4gICAgLy8gWFhYIGlzIHRoZXJlIGEgd2F5IHRvIGtlZXAgdHJhY2sgb2YgYSBjb25uZWN0aW9uJ3MgY29sbGVjdGlvbnMgd2l0aG91dFxuICAgIC8vIGRhbmdsaW5nIGl0IG9mZiB0aGUgY29ubmVjdGlvbiBvYmplY3Q/XG4gICAgcmV0dXJuIGVuc3VyZUNvbGxlY3Rpb24obmFtZSwgY29ubi5fbW9uZ29fbGl2ZWRhdGFfY29sbGVjdGlvbnMpO1xuICB9XG59KTtcblxuZnVuY3Rpb24gZW5zdXJlQ29sbGVjdGlvbihuYW1lLCBjb2xsZWN0aW9ucykge1xuICByZXR1cm4gKG5hbWUgaW4gY29sbGVjdGlvbnMpXG4gICAgPyBjb2xsZWN0aW9uc1tuYW1lXVxuICAgIDogY29sbGVjdGlvbnNbbmFtZV0gPSBuZXcgTG9jYWxDb2xsZWN0aW9uKG5hbWUpO1xufVxuIiwiTW9uZ29JbnRlcm5hbHMuUmVtb3RlQ29sbGVjdGlvbkRyaXZlciA9IGZ1bmN0aW9uIChcbiAgbW9uZ29fdXJsLCBvcHRpb25zKSB7XG4gIHZhciBzZWxmID0gdGhpcztcbiAgc2VsZi5tb25nbyA9IG5ldyBNb25nb0Nvbm5lY3Rpb24obW9uZ29fdXJsLCBvcHRpb25zKTtcbn07XG5cbk9iamVjdC5hc3NpZ24oTW9uZ29JbnRlcm5hbHMuUmVtb3RlQ29sbGVjdGlvbkRyaXZlci5wcm90b3R5cGUsIHtcbiAgb3BlbjogZnVuY3Rpb24gKG5hbWUpIHtcbiAgICB2YXIgc2VsZiA9IHRoaXM7XG4gICAgdmFyIHJldCA9IHt9O1xuICAgIFsnZmluZCcsICdmaW5kT25lJywgJ2luc2VydCcsICd1cGRhdGUnLCAndXBzZXJ0JyxcbiAgICAgICdyZW1vdmUnLCAnX2Vuc3VyZUluZGV4JywgJ2NyZWF0ZUluZGV4JywgJ19kcm9wSW5kZXgnLCAnX2NyZWF0ZUNhcHBlZENvbGxlY3Rpb24nLFxuICAgICAgJ2Ryb3BDb2xsZWN0aW9uJywgJ3Jhd0NvbGxlY3Rpb24nXS5mb3JFYWNoKFxuICAgICAgZnVuY3Rpb24gKG0pIHtcbiAgICAgICAgcmV0W21dID0gXy5iaW5kKHNlbGYubW9uZ29bbV0sIHNlbGYubW9uZ28sIG5hbWUpO1xuICAgICAgfSk7XG4gICAgcmV0dXJuIHJldDtcbiAgfVxufSk7XG5cblxuLy8gQ3JlYXRlIHRoZSBzaW5nbGV0b24gUmVtb3RlQ29sbGVjdGlvbkRyaXZlciBvbmx5IG9uIGRlbWFuZCwgc28gd2Vcbi8vIG9ubHkgcmVxdWlyZSBNb25nbyBjb25maWd1cmF0aW9uIGlmIGl0J3MgYWN0dWFsbHkgdXNlZCAoZWcsIG5vdCBpZlxuLy8geW91J3JlIG9ubHkgdHJ5aW5nIHRvIHJlY2VpdmUgZGF0YSBmcm9tIGEgcmVtb3RlIEREUCBzZXJ2ZXIuKVxuTW9uZ29JbnRlcm5hbHMuZGVmYXVsdFJlbW90ZUNvbGxlY3Rpb25Ecml2ZXIgPSBfLm9uY2UoZnVuY3Rpb24gKCkge1xuICB2YXIgY29ubmVjdGlvbk9wdGlvbnMgPSB7fTtcblxuICB2YXIgbW9uZ29VcmwgPSBwcm9jZXNzLmVudi5NT05HT19VUkw7XG5cbiAgaWYgKHByb2Nlc3MuZW52Lk1PTkdPX09QTE9HX1VSTCkge1xuICAgIGNvbm5lY3Rpb25PcHRpb25zLm9wbG9nVXJsID0gcHJvY2Vzcy5lbnYuTU9OR09fT1BMT0dfVVJMO1xuICB9XG5cbiAgaWYgKCEgbW9uZ29VcmwpXG4gICAgdGhyb3cgbmV3IEVycm9yKFwiTU9OR09fVVJMIG11c3QgYmUgc2V0IGluIGVudmlyb25tZW50XCIpO1xuXG4gIHJldHVybiBuZXcgTW9uZ29JbnRlcm5hbHMuUmVtb3RlQ29sbGVjdGlvbkRyaXZlcihtb25nb1VybCwgY29ubmVjdGlvbk9wdGlvbnMpO1xufSk7XG4iLCIvLyBvcHRpb25zLmNvbm5lY3Rpb24sIGlmIGdpdmVuLCBpcyBhIExpdmVkYXRhQ2xpZW50IG9yIExpdmVkYXRhU2VydmVyXG4vLyBYWFggcHJlc2VudGx5IHRoZXJlIGlzIG5vIHdheSB0byBkZXN0cm95L2NsZWFuIHVwIGEgQ29sbGVjdGlvblxuXG5pbXBvcnQgeyBub3JtYWxpemVQcm9qZWN0aW9uIH0gZnJvbSBcIi4vbW9uZ29fdXRpbHNcIjtcblxuLyoqXG4gKiBAc3VtbWFyeSBOYW1lc3BhY2UgZm9yIE1vbmdvREItcmVsYXRlZCBpdGVtc1xuICogQG5hbWVzcGFjZVxuICovXG5Nb25nbyA9IHt9O1xuXG4vKipcbiAqIEBzdW1tYXJ5IENvbnN0cnVjdG9yIGZvciBhIENvbGxlY3Rpb25cbiAqIEBsb2N1cyBBbnl3aGVyZVxuICogQGluc3RhbmNlbmFtZSBjb2xsZWN0aW9uXG4gKiBAY2xhc3NcbiAqIEBwYXJhbSB7U3RyaW5nfSBuYW1lIFRoZSBuYW1lIG9mIHRoZSBjb2xsZWN0aW9uLiAgSWYgbnVsbCwgY3JlYXRlcyBhbiB1bm1hbmFnZWQgKHVuc3luY2hyb25pemVkKSBsb2NhbCBjb2xsZWN0aW9uLlxuICogQHBhcmFtIHtPYmplY3R9IFtvcHRpb25zXVxuICogQHBhcmFtIHtPYmplY3R9IG9wdGlvbnMuY29ubmVjdGlvbiBUaGUgc2VydmVyIGNvbm5lY3Rpb24gdGhhdCB3aWxsIG1hbmFnZSB0aGlzIGNvbGxlY3Rpb24uIFVzZXMgdGhlIGRlZmF1bHQgY29ubmVjdGlvbiBpZiBub3Qgc3BlY2lmaWVkLiAgUGFzcyB0aGUgcmV0dXJuIHZhbHVlIG9mIGNhbGxpbmcgW2BERFAuY29ubmVjdGBdKCNkZHBfY29ubmVjdCkgdG8gc3BlY2lmeSBhIGRpZmZlcmVudCBzZXJ2ZXIuIFBhc3MgYG51bGxgIHRvIHNwZWNpZnkgbm8gY29ubmVjdGlvbi4gVW5tYW5hZ2VkIChgbmFtZWAgaXMgbnVsbCkgY29sbGVjdGlvbnMgY2Fubm90IHNwZWNpZnkgYSBjb25uZWN0aW9uLlxuICogQHBhcmFtIHtTdHJpbmd9IG9wdGlvbnMuaWRHZW5lcmF0aW9uIFRoZSBtZXRob2Qgb2YgZ2VuZXJhdGluZyB0aGUgYF9pZGAgZmllbGRzIG9mIG5ldyBkb2N1bWVudHMgaW4gdGhpcyBjb2xsZWN0aW9uLiAgUG9zc2libGUgdmFsdWVzOlxuXG4gLSAqKmAnU1RSSU5HJ2AqKjogcmFuZG9tIHN0cmluZ3NcbiAtICoqYCdNT05HTydgKio6ICByYW5kb20gW2BNb25nby5PYmplY3RJRGBdKCNtb25nb19vYmplY3RfaWQpIHZhbHVlc1xuXG5UaGUgZGVmYXVsdCBpZCBnZW5lcmF0aW9uIHRlY2huaXF1ZSBpcyBgJ1NUUklORydgLlxuICogQHBhcmFtIHtGdW5jdGlvbn0gb3B0aW9ucy50cmFuc2Zvcm0gQW4gb3B0aW9uYWwgdHJhbnNmb3JtYXRpb24gZnVuY3Rpb24uIERvY3VtZW50cyB3aWxsIGJlIHBhc3NlZCB0aHJvdWdoIHRoaXMgZnVuY3Rpb24gYmVmb3JlIGJlaW5nIHJldHVybmVkIGZyb20gYGZldGNoYCBvciBgZmluZE9uZWAsIGFuZCBiZWZvcmUgYmVpbmcgcGFzc2VkIHRvIGNhbGxiYWNrcyBvZiBgb2JzZXJ2ZWAsIGBtYXBgLCBgZm9yRWFjaGAsIGBhbGxvd2AsIGFuZCBgZGVueWAuIFRyYW5zZm9ybXMgYXJlICpub3QqIGFwcGxpZWQgZm9yIHRoZSBjYWxsYmFja3Mgb2YgYG9ic2VydmVDaGFuZ2VzYCBvciB0byBjdXJzb3JzIHJldHVybmVkIGZyb20gcHVibGlzaCBmdW5jdGlvbnMuXG4gKiBAcGFyYW0ge0Jvb2xlYW59IG9wdGlvbnMuZGVmaW5lTXV0YXRpb25NZXRob2RzIFNldCB0byBgZmFsc2VgIHRvIHNraXAgc2V0dGluZyB1cCB0aGUgbXV0YXRpb24gbWV0aG9kcyB0aGF0IGVuYWJsZSBpbnNlcnQvdXBkYXRlL3JlbW92ZSBmcm9tIGNsaWVudCBjb2RlLiBEZWZhdWx0IGB0cnVlYC5cbiAqL1xuTW9uZ28uQ29sbGVjdGlvbiA9IGZ1bmN0aW9uIENvbGxlY3Rpb24obmFtZSwgb3B0aW9ucykge1xuICBpZiAoIW5hbWUgJiYgbmFtZSAhPT0gbnVsbCkge1xuICAgIE1ldGVvci5fZGVidWcoXG4gICAgICAnV2FybmluZzogY3JlYXRpbmcgYW5vbnltb3VzIGNvbGxlY3Rpb24uIEl0IHdpbGwgbm90IGJlICcgK1xuICAgICAgICAnc2F2ZWQgb3Igc3luY2hyb25pemVkIG92ZXIgdGhlIG5ldHdvcmsuIChQYXNzIG51bGwgZm9yICcgK1xuICAgICAgICAndGhlIGNvbGxlY3Rpb24gbmFtZSB0byB0dXJuIG9mZiB0aGlzIHdhcm5pbmcuKSdcbiAgICApO1xuICAgIG5hbWUgPSBudWxsO1xuICB9XG5cbiAgaWYgKG5hbWUgIT09IG51bGwgJiYgdHlwZW9mIG5hbWUgIT09ICdzdHJpbmcnKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKFxuICAgICAgJ0ZpcnN0IGFyZ3VtZW50IHRvIG5ldyBNb25nby5Db2xsZWN0aW9uIG11c3QgYmUgYSBzdHJpbmcgb3IgbnVsbCdcbiAgICApO1xuICB9XG5cbiAgaWYgKG9wdGlvbnMgJiYgb3B0aW9ucy5tZXRob2RzKSB7XG4gICAgLy8gQmFja3dhcmRzIGNvbXBhdGliaWxpdHkgaGFjayB3aXRoIG9yaWdpbmFsIHNpZ25hdHVyZSAod2hpY2ggcGFzc2VkXG4gICAgLy8gXCJjb25uZWN0aW9uXCIgZGlyZWN0bHkgaW5zdGVhZCBvZiBpbiBvcHRpb25zLiAoQ29ubmVjdGlvbnMgbXVzdCBoYXZlIGEgXCJtZXRob2RzXCJcbiAgICAvLyBtZXRob2QuKVxuICAgIC8vIFhYWCByZW1vdmUgYmVmb3JlIDEuMFxuICAgIG9wdGlvbnMgPSB7IGNvbm5lY3Rpb246IG9wdGlvbnMgfTtcbiAgfVxuICAvLyBCYWNrd2FyZHMgY29tcGF0aWJpbGl0eTogXCJjb25uZWN0aW9uXCIgdXNlZCB0byBiZSBjYWxsZWQgXCJtYW5hZ2VyXCIuXG4gIGlmIChvcHRpb25zICYmIG9wdGlvbnMubWFuYWdlciAmJiAhb3B0aW9ucy5jb25uZWN0aW9uKSB7XG4gICAgb3B0aW9ucy5jb25uZWN0aW9uID0gb3B0aW9ucy5tYW5hZ2VyO1xuICB9XG5cbiAgb3B0aW9ucyA9IHtcbiAgICBjb25uZWN0aW9uOiB1bmRlZmluZWQsXG4gICAgaWRHZW5lcmF0aW9uOiAnU1RSSU5HJyxcbiAgICB0cmFuc2Zvcm06IG51bGwsXG4gICAgX2RyaXZlcjogdW5kZWZpbmVkLFxuICAgIF9wcmV2ZW50QXV0b3B1Ymxpc2g6IGZhbHNlLFxuICAgIC4uLm9wdGlvbnMsXG4gIH07XG5cbiAgc3dpdGNoIChvcHRpb25zLmlkR2VuZXJhdGlvbikge1xuICAgIGNhc2UgJ01PTkdPJzpcbiAgICAgIHRoaXMuX21ha2VOZXdJRCA9IGZ1bmN0aW9uKCkge1xuICAgICAgICB2YXIgc3JjID0gbmFtZVxuICAgICAgICAgID8gRERQLnJhbmRvbVN0cmVhbSgnL2NvbGxlY3Rpb24vJyArIG5hbWUpXG4gICAgICAgICAgOiBSYW5kb20uaW5zZWN1cmU7XG4gICAgICAgIHJldHVybiBuZXcgTW9uZ28uT2JqZWN0SUQoc3JjLmhleFN0cmluZygyNCkpO1xuICAgICAgfTtcbiAgICAgIGJyZWFrO1xuICAgIGNhc2UgJ1NUUklORyc6XG4gICAgZGVmYXVsdDpcbiAgICAgIHRoaXMuX21ha2VOZXdJRCA9IGZ1bmN0aW9uKCkge1xuICAgICAgICB2YXIgc3JjID0gbmFtZVxuICAgICAgICAgID8gRERQLnJhbmRvbVN0cmVhbSgnL2NvbGxlY3Rpb24vJyArIG5hbWUpXG4gICAgICAgICAgOiBSYW5kb20uaW5zZWN1cmU7XG4gICAgICAgIHJldHVybiBzcmMuaWQoKTtcbiAgICAgIH07XG4gICAgICBicmVhaztcbiAgfVxuXG4gIHRoaXMuX3RyYW5zZm9ybSA9IExvY2FsQ29sbGVjdGlvbi53cmFwVHJhbnNmb3JtKG9wdGlvbnMudHJhbnNmb3JtKTtcblxuICBpZiAoIW5hbWUgfHwgb3B0aW9ucy5jb25uZWN0aW9uID09PSBudWxsKVxuICAgIC8vIG5vdGU6IG5hbWVsZXNzIGNvbGxlY3Rpb25zIG5ldmVyIGhhdmUgYSBjb25uZWN0aW9uXG4gICAgdGhpcy5fY29ubmVjdGlvbiA9IG51bGw7XG4gIGVsc2UgaWYgKG9wdGlvbnMuY29ubmVjdGlvbikgdGhpcy5fY29ubmVjdGlvbiA9IG9wdGlvbnMuY29ubmVjdGlvbjtcbiAgZWxzZSBpZiAoTWV0ZW9yLmlzQ2xpZW50KSB0aGlzLl9jb25uZWN0aW9uID0gTWV0ZW9yLmNvbm5lY3Rpb247XG4gIGVsc2UgdGhpcy5fY29ubmVjdGlvbiA9IE1ldGVvci5zZXJ2ZXI7XG5cbiAgaWYgKCFvcHRpb25zLl9kcml2ZXIpIHtcbiAgICAvLyBYWFggVGhpcyBjaGVjayBhc3N1bWVzIHRoYXQgd2ViYXBwIGlzIGxvYWRlZCBzbyB0aGF0IE1ldGVvci5zZXJ2ZXIgIT09XG4gICAgLy8gbnVsbC4gV2Ugc2hvdWxkIGZ1bGx5IHN1cHBvcnQgdGhlIGNhc2Ugb2YgXCJ3YW50IHRvIHVzZSBhIE1vbmdvLWJhY2tlZFxuICAgIC8vIGNvbGxlY3Rpb24gZnJvbSBOb2RlIGNvZGUgd2l0aG91dCB3ZWJhcHBcIiwgYnV0IHdlIGRvbid0IHlldC5cbiAgICAvLyAjTWV0ZW9yU2VydmVyTnVsbFxuICAgIGlmIChcbiAgICAgIG5hbWUgJiZcbiAgICAgIHRoaXMuX2Nvbm5lY3Rpb24gPT09IE1ldGVvci5zZXJ2ZXIgJiZcbiAgICAgIHR5cGVvZiBNb25nb0ludGVybmFscyAhPT0gJ3VuZGVmaW5lZCcgJiZcbiAgICAgIE1vbmdvSW50ZXJuYWxzLmRlZmF1bHRSZW1vdGVDb2xsZWN0aW9uRHJpdmVyXG4gICAgKSB7XG4gICAgICBvcHRpb25zLl9kcml2ZXIgPSBNb25nb0ludGVybmFscy5kZWZhdWx0UmVtb3RlQ29sbGVjdGlvbkRyaXZlcigpO1xuICAgIH0gZWxzZSB7XG4gICAgICBjb25zdCB7IExvY2FsQ29sbGVjdGlvbkRyaXZlciB9ID0gcmVxdWlyZSgnLi9sb2NhbF9jb2xsZWN0aW9uX2RyaXZlci5qcycpO1xuICAgICAgb3B0aW9ucy5fZHJpdmVyID0gTG9jYWxDb2xsZWN0aW9uRHJpdmVyO1xuICAgIH1cbiAgfVxuXG4gIHRoaXMuX2NvbGxlY3Rpb24gPSBvcHRpb25zLl9kcml2ZXIub3BlbihuYW1lLCB0aGlzLl9jb25uZWN0aW9uKTtcbiAgdGhpcy5fbmFtZSA9IG5hbWU7XG4gIHRoaXMuX2RyaXZlciA9IG9wdGlvbnMuX2RyaXZlcjtcblxuICB0aGlzLl9tYXliZVNldFVwUmVwbGljYXRpb24obmFtZSwgb3B0aW9ucyk7XG5cbiAgLy8gWFhYIGRvbid0IGRlZmluZSB0aGVzZSB1bnRpbCBhbGxvdyBvciBkZW55IGlzIGFjdHVhbGx5IHVzZWQgZm9yIHRoaXNcbiAgLy8gY29sbGVjdGlvbi4gQ291bGQgYmUgaGFyZCBpZiB0aGUgc2VjdXJpdHkgcnVsZXMgYXJlIG9ubHkgZGVmaW5lZCBvbiB0aGVcbiAgLy8gc2VydmVyLlxuICBpZiAob3B0aW9ucy5kZWZpbmVNdXRhdGlvbk1ldGhvZHMgIT09IGZhbHNlKSB7XG4gICAgdHJ5IHtcbiAgICAgIHRoaXMuX2RlZmluZU11dGF0aW9uTWV0aG9kcyh7XG4gICAgICAgIHVzZUV4aXN0aW5nOiBvcHRpb25zLl9zdXBwcmVzc1NhbWVOYW1lRXJyb3IgPT09IHRydWUsXG4gICAgICB9KTtcbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgLy8gVGhyb3cgYSBtb3JlIHVuZGVyc3RhbmRhYmxlIGVycm9yIG9uIHRoZSBzZXJ2ZXIgZm9yIHNhbWUgY29sbGVjdGlvbiBuYW1lXG4gICAgICBpZiAoXG4gICAgICAgIGVycm9yLm1lc3NhZ2UgPT09IGBBIG1ldGhvZCBuYW1lZCAnLyR7bmFtZX0vaW5zZXJ0JyBpcyBhbHJlYWR5IGRlZmluZWRgXG4gICAgICApXG4gICAgICAgIHRocm93IG5ldyBFcnJvcihgVGhlcmUgaXMgYWxyZWFkeSBhIGNvbGxlY3Rpb24gbmFtZWQgXCIke25hbWV9XCJgKTtcbiAgICAgIHRocm93IGVycm9yO1xuICAgIH1cbiAgfVxuXG4gIC8vIGF1dG9wdWJsaXNoXG4gIGlmIChcbiAgICBQYWNrYWdlLmF1dG9wdWJsaXNoICYmXG4gICAgIW9wdGlvbnMuX3ByZXZlbnRBdXRvcHVibGlzaCAmJlxuICAgIHRoaXMuX2Nvbm5lY3Rpb24gJiZcbiAgICB0aGlzLl9jb25uZWN0aW9uLnB1Ymxpc2hcbiAgKSB7XG4gICAgdGhpcy5fY29ubmVjdGlvbi5wdWJsaXNoKG51bGwsICgpID0+IHRoaXMuZmluZCgpLCB7XG4gICAgICBpc19hdXRvOiB0cnVlLFxuICAgIH0pO1xuICB9XG59O1xuXG5PYmplY3QuYXNzaWduKE1vbmdvLkNvbGxlY3Rpb24ucHJvdG90eXBlLCB7XG4gIF9tYXliZVNldFVwUmVwbGljYXRpb24obmFtZSwgeyBfc3VwcHJlc3NTYW1lTmFtZUVycm9yID0gZmFsc2UgfSkge1xuICAgIGNvbnN0IHNlbGYgPSB0aGlzO1xuICAgIGlmICghKHNlbGYuX2Nvbm5lY3Rpb24gJiYgc2VsZi5fY29ubmVjdGlvbi5yZWdpc3RlclN0b3JlKSkge1xuICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIC8vIE9LLCB3ZSdyZSBnb2luZyB0byBiZSBhIHNsYXZlLCByZXBsaWNhdGluZyBzb21lIHJlbW90ZVxuICAgIC8vIGRhdGFiYXNlLCBleGNlcHQgcG9zc2libHkgd2l0aCBzb21lIHRlbXBvcmFyeSBkaXZlcmdlbmNlIHdoaWxlXG4gICAgLy8gd2UgaGF2ZSB1bmFja25vd2xlZGdlZCBSUEMncy5cbiAgICBjb25zdCBvayA9IHNlbGYuX2Nvbm5lY3Rpb24ucmVnaXN0ZXJTdG9yZShuYW1lLCB7XG4gICAgICAvLyBDYWxsZWQgYXQgdGhlIGJlZ2lubmluZyBvZiBhIGJhdGNoIG9mIHVwZGF0ZXMuIGJhdGNoU2l6ZSBpcyB0aGUgbnVtYmVyXG4gICAgICAvLyBvZiB1cGRhdGUgY2FsbHMgdG8gZXhwZWN0LlxuICAgICAgLy9cbiAgICAgIC8vIFhYWCBUaGlzIGludGVyZmFjZSBpcyBwcmV0dHkgamFua3kuIHJlc2V0IHByb2JhYmx5IG91Z2h0IHRvIGdvIGJhY2sgdG9cbiAgICAgIC8vIGJlaW5nIGl0cyBvd24gZnVuY3Rpb24sIGFuZCBjYWxsZXJzIHNob3VsZG4ndCBoYXZlIHRvIGNhbGN1bGF0ZVxuICAgICAgLy8gYmF0Y2hTaXplLiBUaGUgb3B0aW1pemF0aW9uIG9mIG5vdCBjYWxsaW5nIHBhdXNlL3JlbW92ZSBzaG91bGQgYmVcbiAgICAgIC8vIGRlbGF5ZWQgdW50aWwgbGF0ZXI6IHRoZSBmaXJzdCBjYWxsIHRvIHVwZGF0ZSgpIHNob3VsZCBidWZmZXIgaXRzXG4gICAgICAvLyBtZXNzYWdlLCBhbmQgdGhlbiB3ZSBjYW4gZWl0aGVyIGRpcmVjdGx5IGFwcGx5IGl0IGF0IGVuZFVwZGF0ZSB0aW1lIGlmXG4gICAgICAvLyBpdCB3YXMgdGhlIG9ubHkgdXBkYXRlLCBvciBkbyBwYXVzZU9ic2VydmVycy9hcHBseS9hcHBseSBhdCB0aGUgbmV4dFxuICAgICAgLy8gdXBkYXRlKCkgaWYgdGhlcmUncyBhbm90aGVyIG9uZS5cbiAgICAgIGJlZ2luVXBkYXRlKGJhdGNoU2l6ZSwgcmVzZXQpIHtcbiAgICAgICAgLy8gcGF1c2Ugb2JzZXJ2ZXJzIHNvIHVzZXJzIGRvbid0IHNlZSBmbGlja2VyIHdoZW4gdXBkYXRpbmcgc2V2ZXJhbFxuICAgICAgICAvLyBvYmplY3RzIGF0IG9uY2UgKGluY2x1ZGluZyB0aGUgcG9zdC1yZWNvbm5lY3QgcmVzZXQtYW5kLXJlYXBwbHlcbiAgICAgICAgLy8gc3RhZ2UpLCBhbmQgc28gdGhhdCBhIHJlLXNvcnRpbmcgb2YgYSBxdWVyeSBjYW4gdGFrZSBhZHZhbnRhZ2Ugb2YgdGhlXG4gICAgICAgIC8vIGZ1bGwgX2RpZmZRdWVyeSBtb3ZlZCBjYWxjdWxhdGlvbiBpbnN0ZWFkIG9mIGFwcGx5aW5nIGNoYW5nZSBvbmUgYXQgYVxuICAgICAgICAvLyB0aW1lLlxuICAgICAgICBpZiAoYmF0Y2hTaXplID4gMSB8fCByZXNldCkgc2VsZi5fY29sbGVjdGlvbi5wYXVzZU9ic2VydmVycygpO1xuXG4gICAgICAgIGlmIChyZXNldCkgc2VsZi5fY29sbGVjdGlvbi5yZW1vdmUoe30pO1xuICAgICAgfSxcblxuICAgICAgLy8gQXBwbHkgYW4gdXBkYXRlLlxuICAgICAgLy8gWFhYIGJldHRlciBzcGVjaWZ5IHRoaXMgaW50ZXJmYWNlIChub3QgaW4gdGVybXMgb2YgYSB3aXJlIG1lc3NhZ2UpP1xuICAgICAgdXBkYXRlKG1zZykge1xuICAgICAgICB2YXIgbW9uZ29JZCA9IE1vbmdvSUQuaWRQYXJzZShtc2cuaWQpO1xuICAgICAgICB2YXIgZG9jID0gc2VsZi5fY29sbGVjdGlvbi5fZG9jcy5nZXQobW9uZ29JZCk7XG5cbiAgICAgICAgLy9XaGVuIHRoZSBzZXJ2ZXIncyBtZXJnZWJveCBpcyBkaXNhYmxlZCBmb3IgYSBjb2xsZWN0aW9uLCB0aGUgY2xpZW50IG11c3QgZ3JhY2VmdWxseSBoYW5kbGUgaXQgd2hlbjpcbiAgICAgICAgLy8gKldlIHJlY2VpdmUgYW4gYWRkZWQgbWVzc2FnZSBmb3IgYSBkb2N1bWVudCB0aGF0IGlzIGFscmVhZHkgdGhlcmUuIEluc3RlYWQsIGl0IHdpbGwgYmUgY2hhbmdlZFxuICAgICAgICAvLyAqV2UgcmVlaXZlIGEgY2hhbmdlIG1lc3NhZ2UgZm9yIGEgZG9jdW1lbnQgdGhhdCBpcyBub3QgdGhlcmUuIEluc3RlYWQsIGl0IHdpbGwgYmUgYWRkZWRcbiAgICAgICAgLy8gKldlIHJlY2VpdmUgYSByZW1vdmVkIG1lc3NzYWdlIGZvciBhIGRvY3VtZW50IHRoYXQgaXMgbm90IHRoZXJlLiBJbnN0ZWFkLCBub3Rpbmcgd2lsIGhhcHBlbi5cblxuICAgICAgICAvL0NvZGUgaXMgZGVyaXZlZCBmcm9tIGNsaWVudC1zaWRlIGNvZGUgb3JpZ2luYWxseSBpbiBwZWVybGlicmFyeTpjb250cm9sLW1lcmdlYm94XG4gICAgICAgIC8vaHR0cHM6Ly9naXRodWIuY29tL3BlZXJsaWJyYXJ5L21ldGVvci1jb250cm9sLW1lcmdlYm94L2Jsb2IvbWFzdGVyL2NsaWVudC5jb2ZmZWVcblxuICAgICAgICAvL0ZvciBtb3JlIGluZm9ybWF0aW9uLCByZWZlciB0byBkaXNjdXNzaW9uIFwiSW5pdGlhbCBzdXBwb3J0IGZvciBwdWJsaWNhdGlvbiBzdHJhdGVnaWVzIGluIGxpdmVkYXRhIHNlcnZlclwiOlxuICAgICAgICAvL2h0dHBzOi8vZ2l0aHViLmNvbS9tZXRlb3IvbWV0ZW9yL3B1bGwvMTExNTFcbiAgICAgICAgaWYgKE1ldGVvci5pc0NsaWVudCkge1xuICAgICAgICAgIGlmIChtc2cubXNnID09PSAnYWRkZWQnICYmIGRvYykge1xuICAgICAgICAgICAgbXNnLm1zZyA9ICdjaGFuZ2VkJztcbiAgICAgICAgICB9IGVsc2UgaWYgKG1zZy5tc2cgPT09ICdyZW1vdmVkJyAmJiAhZG9jKSB7XG4gICAgICAgICAgICByZXR1cm47XG4gICAgICAgICAgfSBlbHNlIGlmIChtc2cubXNnID09PSAnY2hhbmdlZCcgJiYgIWRvYykge1xuICAgICAgICAgICAgbXNnLm1zZyA9ICdhZGRlZCc7XG4gICAgICAgICAgICBfcmVmID0gbXNnLmZpZWxkcztcbiAgICAgICAgICAgIGZvciAoZmllbGQgaW4gX3JlZikge1xuICAgICAgICAgICAgICB2YWx1ZSA9IF9yZWZbZmllbGRdO1xuICAgICAgICAgICAgICBpZiAodmFsdWUgPT09IHZvaWQgMCkge1xuICAgICAgICAgICAgICAgIGRlbGV0ZSBtc2cuZmllbGRzW2ZpZWxkXTtcbiAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuICAgICAgICAgIH1cbiAgICAgICAgfVxuXG4gICAgICAgIC8vIElzIHRoaXMgYSBcInJlcGxhY2UgdGhlIHdob2xlIGRvY1wiIG1lc3NhZ2UgY29taW5nIGZyb20gdGhlIHF1aWVzY2VuY2VcbiAgICAgICAgLy8gb2YgbWV0aG9kIHdyaXRlcyB0byBhbiBvYmplY3Q/IChOb3RlIHRoYXQgJ3VuZGVmaW5lZCcgaXMgYSB2YWxpZFxuICAgICAgICAvLyB2YWx1ZSBtZWFuaW5nIFwicmVtb3ZlIGl0XCIuKVxuICAgICAgICBpZiAobXNnLm1zZyA9PT0gJ3JlcGxhY2UnKSB7XG4gICAgICAgICAgdmFyIHJlcGxhY2UgPSBtc2cucmVwbGFjZTtcbiAgICAgICAgICBpZiAoIXJlcGxhY2UpIHtcbiAgICAgICAgICAgIGlmIChkb2MpIHNlbGYuX2NvbGxlY3Rpb24ucmVtb3ZlKG1vbmdvSWQpO1xuICAgICAgICAgIH0gZWxzZSBpZiAoIWRvYykge1xuICAgICAgICAgICAgc2VsZi5fY29sbGVjdGlvbi5pbnNlcnQocmVwbGFjZSk7XG4gICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIC8vIFhYWCBjaGVjayB0aGF0IHJlcGxhY2UgaGFzIG5vICQgb3BzXG4gICAgICAgICAgICBzZWxmLl9jb2xsZWN0aW9uLnVwZGF0ZShtb25nb0lkLCByZXBsYWNlKTtcbiAgICAgICAgICB9XG4gICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9IGVsc2UgaWYgKG1zZy5tc2cgPT09ICdhZGRlZCcpIHtcbiAgICAgICAgICBpZiAoZG9jKSB7XG4gICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoXG4gICAgICAgICAgICAgICdFeHBlY3RlZCBub3QgdG8gZmluZCBhIGRvY3VtZW50IGFscmVhZHkgcHJlc2VudCBmb3IgYW4gYWRkJ1xuICAgICAgICAgICAgKTtcbiAgICAgICAgICB9XG4gICAgICAgICAgc2VsZi5fY29sbGVjdGlvbi5pbnNlcnQoeyBfaWQ6IG1vbmdvSWQsIC4uLm1zZy5maWVsZHMgfSk7XG4gICAgICAgIH0gZWxzZSBpZiAobXNnLm1zZyA9PT0gJ3JlbW92ZWQnKSB7XG4gICAgICAgICAgaWYgKCFkb2MpXG4gICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoXG4gICAgICAgICAgICAgICdFeHBlY3RlZCB0byBmaW5kIGEgZG9jdW1lbnQgYWxyZWFkeSBwcmVzZW50IGZvciByZW1vdmVkJ1xuICAgICAgICAgICAgKTtcbiAgICAgICAgICBzZWxmLl9jb2xsZWN0aW9uLnJlbW92ZShtb25nb0lkKTtcbiAgICAgICAgfSBlbHNlIGlmIChtc2cubXNnID09PSAnY2hhbmdlZCcpIHtcbiAgICAgICAgICBpZiAoIWRvYykgdGhyb3cgbmV3IEVycm9yKCdFeHBlY3RlZCB0byBmaW5kIGEgZG9jdW1lbnQgdG8gY2hhbmdlJyk7XG4gICAgICAgICAgY29uc3Qga2V5cyA9IE9iamVjdC5rZXlzKG1zZy5maWVsZHMpO1xuICAgICAgICAgIGlmIChrZXlzLmxlbmd0aCA+IDApIHtcbiAgICAgICAgICAgIHZhciBtb2RpZmllciA9IHt9O1xuICAgICAgICAgICAga2V5cy5mb3JFYWNoKGtleSA9PiB7XG4gICAgICAgICAgICAgIGNvbnN0IHZhbHVlID0gbXNnLmZpZWxkc1trZXldO1xuICAgICAgICAgICAgICBpZiAoRUpTT04uZXF1YWxzKGRvY1trZXldLCB2YWx1ZSkpIHtcbiAgICAgICAgICAgICAgICByZXR1cm47XG4gICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgaWYgKHR5cGVvZiB2YWx1ZSA9PT0gJ3VuZGVmaW5lZCcpIHtcbiAgICAgICAgICAgICAgICBpZiAoIW1vZGlmaWVyLiR1bnNldCkge1xuICAgICAgICAgICAgICAgICAgbW9kaWZpZXIuJHVuc2V0ID0ge307XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIG1vZGlmaWVyLiR1bnNldFtrZXldID0gMTtcbiAgICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICBpZiAoIW1vZGlmaWVyLiRzZXQpIHtcbiAgICAgICAgICAgICAgICAgIG1vZGlmaWVyLiRzZXQgPSB7fTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgbW9kaWZpZXIuJHNldFtrZXldID0gdmFsdWU7XG4gICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgaWYgKE9iamVjdC5rZXlzKG1vZGlmaWVyKS5sZW5ndGggPiAwKSB7XG4gICAgICAgICAgICAgIHNlbGYuX2NvbGxlY3Rpb24udXBkYXRlKG1vbmdvSWQsIG1vZGlmaWVyKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICB9XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgdGhyb3cgbmV3IEVycm9yKFwiSSBkb24ndCBrbm93IGhvdyB0byBkZWFsIHdpdGggdGhpcyBtZXNzYWdlXCIpO1xuICAgICAgICB9XG4gICAgICB9LFxuXG4gICAgICAvLyBDYWxsZWQgYXQgdGhlIGVuZCBvZiBhIGJhdGNoIG9mIHVwZGF0ZXMuXG4gICAgICBlbmRVcGRhdGUoKSB7XG4gICAgICAgIHNlbGYuX2NvbGxlY3Rpb24ucmVzdW1lT2JzZXJ2ZXJzKCk7XG4gICAgICB9LFxuXG4gICAgICAvLyBDYWxsZWQgYXJvdW5kIG1ldGhvZCBzdHViIGludm9jYXRpb25zIHRvIGNhcHR1cmUgdGhlIG9yaWdpbmFsIHZlcnNpb25zXG4gICAgICAvLyBvZiBtb2RpZmllZCBkb2N1bWVudHMuXG4gICAgICBzYXZlT3JpZ2luYWxzKCkge1xuICAgICAgICBzZWxmLl9jb2xsZWN0aW9uLnNhdmVPcmlnaW5hbHMoKTtcbiAgICAgIH0sXG4gICAgICByZXRyaWV2ZU9yaWdpbmFscygpIHtcbiAgICAgICAgcmV0dXJuIHNlbGYuX2NvbGxlY3Rpb24ucmV0cmlldmVPcmlnaW5hbHMoKTtcbiAgICAgIH0sXG5cbiAgICAgIC8vIFVzZWQgdG8gcHJlc2VydmUgY3VycmVudCB2ZXJzaW9ucyBvZiBkb2N1bWVudHMgYWNyb3NzIGEgc3RvcmUgcmVzZXQuXG4gICAgICBnZXREb2MoaWQpIHtcbiAgICAgICAgcmV0dXJuIHNlbGYuZmluZE9uZShpZCk7XG4gICAgICB9LFxuXG4gICAgICAvLyBUbyBiZSBhYmxlIHRvIGdldCBiYWNrIHRvIHRoZSBjb2xsZWN0aW9uIGZyb20gdGhlIHN0b3JlLlxuICAgICAgX2dldENvbGxlY3Rpb24oKSB7XG4gICAgICAgIHJldHVybiBzZWxmO1xuICAgICAgfSxcbiAgICB9KTtcblxuICAgIGlmICghb2spIHtcbiAgICAgIGNvbnN0IG1lc3NhZ2UgPSBgVGhlcmUgaXMgYWxyZWFkeSBhIGNvbGxlY3Rpb24gbmFtZWQgXCIke25hbWV9XCJgO1xuICAgICAgaWYgKF9zdXBwcmVzc1NhbWVOYW1lRXJyb3IgPT09IHRydWUpIHtcbiAgICAgICAgLy8gWFhYIEluIHRoZW9yeSB3ZSBkbyBub3QgaGF2ZSB0byB0aHJvdyB3aGVuIGBva2AgaXMgZmFsc3kuIFRoZVxuICAgICAgICAvLyBzdG9yZSBpcyBhbHJlYWR5IGRlZmluZWQgZm9yIHRoaXMgY29sbGVjdGlvbiBuYW1lLCBidXQgdGhpc1xuICAgICAgICAvLyB3aWxsIHNpbXBseSBiZSBhbm90aGVyIHJlZmVyZW5jZSB0byBpdCBhbmQgZXZlcnl0aGluZyBzaG91bGRcbiAgICAgICAgLy8gd29yay4gSG93ZXZlciwgd2UgaGF2ZSBoaXN0b3JpY2FsbHkgdGhyb3duIGFuIGVycm9yIGhlcmUsIHNvXG4gICAgICAgIC8vIGZvciBub3cgd2Ugd2lsbCBza2lwIHRoZSBlcnJvciBvbmx5IHdoZW4gX3N1cHByZXNzU2FtZU5hbWVFcnJvclxuICAgICAgICAvLyBpcyBgdHJ1ZWAsIGFsbG93aW5nIHBlb3BsZSB0byBvcHQgaW4gYW5kIGdpdmUgdGhpcyBzb21lIHJlYWxcbiAgICAgICAgLy8gd29ybGQgdGVzdGluZy5cbiAgICAgICAgY29uc29sZS53YXJuID8gY29uc29sZS53YXJuKG1lc3NhZ2UpIDogY29uc29sZS5sb2cobWVzc2FnZSk7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICB0aHJvdyBuZXcgRXJyb3IobWVzc2FnZSk7XG4gICAgICB9XG4gICAgfVxuICB9LFxuXG4gIC8vL1xuICAvLy8gTWFpbiBjb2xsZWN0aW9uIEFQSVxuICAvLy9cblxuICBfZ2V0RmluZFNlbGVjdG9yKGFyZ3MpIHtcbiAgICBpZiAoYXJncy5sZW5ndGggPT0gMCkgcmV0dXJuIHt9O1xuICAgIGVsc2UgcmV0dXJuIGFyZ3NbMF07XG4gIH0sXG5cbiAgX2dldEZpbmRPcHRpb25zKGFyZ3MpIHtcbiAgICBjb25zdCBbLCBvcHRpb25zXSA9IGFyZ3MgfHwgW107XG4gICAgY29uc3QgbmV3T3B0aW9ucyA9IG5vcm1hbGl6ZVByb2plY3Rpb24ob3B0aW9ucyk7XG5cbiAgICB2YXIgc2VsZiA9IHRoaXM7XG4gICAgaWYgKGFyZ3MubGVuZ3RoIDwgMikge1xuICAgICAgcmV0dXJuIHsgdHJhbnNmb3JtOiBzZWxmLl90cmFuc2Zvcm0gfTtcbiAgICB9IGVsc2Uge1xuICAgICAgY2hlY2soXG4gICAgICAgIG5ld09wdGlvbnMsXG4gICAgICAgIE1hdGNoLk9wdGlvbmFsKFxuICAgICAgICAgIE1hdGNoLk9iamVjdEluY2x1ZGluZyh7XG4gICAgICAgICAgICBwcm9qZWN0aW9uOiBNYXRjaC5PcHRpb25hbChNYXRjaC5PbmVPZihPYmplY3QsIHVuZGVmaW5lZCkpLFxuICAgICAgICAgICAgc29ydDogTWF0Y2guT3B0aW9uYWwoXG4gICAgICAgICAgICAgIE1hdGNoLk9uZU9mKE9iamVjdCwgQXJyYXksIEZ1bmN0aW9uLCB1bmRlZmluZWQpXG4gICAgICAgICAgICApLFxuICAgICAgICAgICAgbGltaXQ6IE1hdGNoLk9wdGlvbmFsKE1hdGNoLk9uZU9mKE51bWJlciwgdW5kZWZpbmVkKSksXG4gICAgICAgICAgICBza2lwOiBNYXRjaC5PcHRpb25hbChNYXRjaC5PbmVPZihOdW1iZXIsIHVuZGVmaW5lZCkpLFxuICAgICAgICAgIH0pXG4gICAgICAgIClcbiAgICAgICk7XG5cblxuICAgICAgcmV0dXJuIHtcbiAgICAgICAgdHJhbnNmb3JtOiBzZWxmLl90cmFuc2Zvcm0sXG4gICAgICAgIC4uLm5ld09wdGlvbnMsXG4gICAgICB9O1xuICAgIH1cbiAgfSxcblxuICAvKipcbiAgICogQHN1bW1hcnkgRmluZCB0aGUgZG9jdW1lbnRzIGluIGEgY29sbGVjdGlvbiB0aGF0IG1hdGNoIHRoZSBzZWxlY3Rvci5cbiAgICogQGxvY3VzIEFueXdoZXJlXG4gICAqIEBtZXRob2QgZmluZFxuICAgKiBAbWVtYmVyb2YgTW9uZ28uQ29sbGVjdGlvblxuICAgKiBAaW5zdGFuY2VcbiAgICogQHBhcmFtIHtNb25nb1NlbGVjdG9yfSBbc2VsZWN0b3JdIEEgcXVlcnkgZGVzY3JpYmluZyB0aGUgZG9jdW1lbnRzIHRvIGZpbmRcbiAgICogQHBhcmFtIHtPYmplY3R9IFtvcHRpb25zXVxuICAgKiBAcGFyYW0ge01vbmdvU29ydFNwZWNpZmllcn0gb3B0aW9ucy5zb3J0IFNvcnQgb3JkZXIgKGRlZmF1bHQ6IG5hdHVyYWwgb3JkZXIpXG4gICAqIEBwYXJhbSB7TnVtYmVyfSBvcHRpb25zLnNraXAgTnVtYmVyIG9mIHJlc3VsdHMgdG8gc2tpcCBhdCB0aGUgYmVnaW5uaW5nXG4gICAqIEBwYXJhbSB7TnVtYmVyfSBvcHRpb25zLmxpbWl0IE1heGltdW0gbnVtYmVyIG9mIHJlc3VsdHMgdG8gcmV0dXJuXG4gICAqIEBwYXJhbSB7TW9uZ29GaWVsZFNwZWNpZmllcn0gb3B0aW9ucy5maWVsZHMgRGljdGlvbmFyeSBvZiBmaWVsZHMgdG8gcmV0dXJuIG9yIGV4Y2x1ZGUuXG4gICAqIEBwYXJhbSB7Qm9vbGVhbn0gb3B0aW9ucy5yZWFjdGl2ZSAoQ2xpZW50IG9ubHkpIERlZmF1bHQgYHRydWVgOyBwYXNzIGBmYWxzZWAgdG8gZGlzYWJsZSByZWFjdGl2aXR5XG4gICAqIEBwYXJhbSB7RnVuY3Rpb259IG9wdGlvbnMudHJhbnNmb3JtIE92ZXJyaWRlcyBgdHJhbnNmb3JtYCBvbiB0aGUgIFtgQ29sbGVjdGlvbmBdKCNjb2xsZWN0aW9ucykgZm9yIHRoaXMgY3Vyc29yLiAgUGFzcyBgbnVsbGAgdG8gZGlzYWJsZSB0cmFuc2Zvcm1hdGlvbi5cbiAgICogQHBhcmFtIHtCb29sZWFufSBvcHRpb25zLmRpc2FibGVPcGxvZyAoU2VydmVyIG9ubHkpIFBhc3MgdHJ1ZSB0byBkaXNhYmxlIG9wbG9nLXRhaWxpbmcgb24gdGhpcyBxdWVyeS4gVGhpcyBhZmZlY3RzIHRoZSB3YXkgc2VydmVyIHByb2Nlc3NlcyBjYWxscyB0byBgb2JzZXJ2ZWAgb24gdGhpcyBxdWVyeS4gRGlzYWJsaW5nIHRoZSBvcGxvZyBjYW4gYmUgdXNlZnVsIHdoZW4gd29ya2luZyB3aXRoIGRhdGEgdGhhdCB1cGRhdGVzIGluIGxhcmdlIGJhdGNoZXMuXG4gICAqIEBwYXJhbSB7TnVtYmVyfSBvcHRpb25zLnBvbGxpbmdJbnRlcnZhbE1zIChTZXJ2ZXIgb25seSkgV2hlbiBvcGxvZyBpcyBkaXNhYmxlZCAodGhyb3VnaCB0aGUgdXNlIG9mIGBkaXNhYmxlT3Bsb2dgIG9yIHdoZW4gb3RoZXJ3aXNlIG5vdCBhdmFpbGFibGUpLCB0aGUgZnJlcXVlbmN5IChpbiBtaWxsaXNlY29uZHMpIG9mIGhvdyBvZnRlbiB0byBwb2xsIHRoaXMgcXVlcnkgd2hlbiBvYnNlcnZpbmcgb24gdGhlIHNlcnZlci4gRGVmYXVsdHMgdG8gMTAwMDBtcyAoMTAgc2Vjb25kcykuXG4gICAqIEBwYXJhbSB7TnVtYmVyfSBvcHRpb25zLnBvbGxpbmdUaHJvdHRsZU1zIChTZXJ2ZXIgb25seSkgV2hlbiBvcGxvZyBpcyBkaXNhYmxlZCAodGhyb3VnaCB0aGUgdXNlIG9mIGBkaXNhYmxlT3Bsb2dgIG9yIHdoZW4gb3RoZXJ3aXNlIG5vdCBhdmFpbGFibGUpLCB0aGUgbWluaW11bSB0aW1lIChpbiBtaWxsaXNlY29uZHMpIHRvIGFsbG93IGJldHdlZW4gcmUtcG9sbGluZyB3aGVuIG9ic2VydmluZyBvbiB0aGUgc2VydmVyLiBJbmNyZWFzaW5nIHRoaXMgd2lsbCBzYXZlIENQVSBhbmQgbW9uZ28gbG9hZCBhdCB0aGUgZXhwZW5zZSBvZiBzbG93ZXIgdXBkYXRlcyB0byB1c2Vycy4gRGVjcmVhc2luZyB0aGlzIGlzIG5vdCByZWNvbW1lbmRlZC4gRGVmYXVsdHMgdG8gNTBtcy5cbiAgICogQHBhcmFtIHtOdW1iZXJ9IG9wdGlvbnMubWF4VGltZU1zIChTZXJ2ZXIgb25seSkgSWYgc2V0LCBpbnN0cnVjdHMgTW9uZ29EQiB0byBzZXQgYSB0aW1lIGxpbWl0IGZvciB0aGlzIGN1cnNvcidzIG9wZXJhdGlvbnMuIElmIHRoZSBvcGVyYXRpb24gcmVhY2hlcyB0aGUgc3BlY2lmaWVkIHRpbWUgbGltaXQgKGluIG1pbGxpc2Vjb25kcykgd2l0aG91dCB0aGUgaGF2aW5nIGJlZW4gY29tcGxldGVkLCBhbiBleGNlcHRpb24gd2lsbCBiZSB0aHJvd24uIFVzZWZ1bCB0byBwcmV2ZW50IGFuIChhY2NpZGVudGFsIG9yIG1hbGljaW91cykgdW5vcHRpbWl6ZWQgcXVlcnkgZnJvbSBjYXVzaW5nIGEgZnVsbCBjb2xsZWN0aW9uIHNjYW4gdGhhdCB3b3VsZCBkaXNydXB0IG90aGVyIGRhdGFiYXNlIHVzZXJzLCBhdCB0aGUgZXhwZW5zZSBvZiBuZWVkaW5nIHRvIGhhbmRsZSB0aGUgcmVzdWx0aW5nIGVycm9yLlxuICAgKiBAcGFyYW0ge1N0cmluZ3xPYmplY3R9IG9wdGlvbnMuaGludCAoU2VydmVyIG9ubHkpIE92ZXJyaWRlcyBNb25nb0RCJ3MgZGVmYXVsdCBpbmRleCBzZWxlY3Rpb24gYW5kIHF1ZXJ5IG9wdGltaXphdGlvbiBwcm9jZXNzLiBTcGVjaWZ5IGFuIGluZGV4IHRvIGZvcmNlIGl0cyB1c2UsIGVpdGhlciBieSBpdHMgbmFtZSBvciBpbmRleCBzcGVjaWZpY2F0aW9uLiBZb3UgY2FuIGFsc28gc3BlY2lmeSBgeyAkbmF0dXJhbCA6IDEgfWAgdG8gZm9yY2UgYSBmb3J3YXJkcyBjb2xsZWN0aW9uIHNjYW4sIG9yIGB7ICRuYXR1cmFsIDogLTEgfWAgZm9yIGEgcmV2ZXJzZSBjb2xsZWN0aW9uIHNjYW4uIFNldHRpbmcgdGhpcyBpcyBvbmx5IHJlY29tbWVuZGVkIGZvciBhZHZhbmNlZCB1c2Vycy5cbiAgICogQHBhcmFtIHtTdHJpbmd9IG9wdGlvbnMucmVhZFByZWZlcmVuY2UgKFNlcnZlciBvbmx5KSBTcGVjaWZpZXMgYSBjdXN0b20gTW9uZ29EQiBbYHJlYWRQcmVmZXJlbmNlYF0oaHR0cHM6Ly9kb2NzLm1vbmdvZGIuY29tL21hbnVhbC9jb3JlL3JlYWQtcHJlZmVyZW5jZSkgZm9yIHRoaXMgcGFydGljdWxhciBjdXJzb3IuIFBvc3NpYmxlIHZhbHVlcyBhcmUgYHByaW1hcnlgLCBgcHJpbWFyeVByZWZlcnJlZGAsIGBzZWNvbmRhcnlgLCBgc2Vjb25kYXJ5UHJlZmVycmVkYCBhbmQgYG5lYXJlc3RgLlxuICAgKiBAcmV0dXJucyB7TW9uZ28uQ3Vyc29yfVxuICAgKi9cbiAgZmluZCguLi5hcmdzKSB7XG4gICAgLy8gQ29sbGVjdGlvbi5maW5kKCkgKHJldHVybiBhbGwgZG9jcykgYmVoYXZlcyBkaWZmZXJlbnRseVxuICAgIC8vIGZyb20gQ29sbGVjdGlvbi5maW5kKHVuZGVmaW5lZCkgKHJldHVybiAwIGRvY3MpLiAgc28gYmVcbiAgICAvLyBjYXJlZnVsIGFib3V0IHRoZSBsZW5ndGggb2YgYXJndW1lbnRzLlxuICAgIHJldHVybiB0aGlzLl9jb2xsZWN0aW9uLmZpbmQoXG4gICAgICB0aGlzLl9nZXRGaW5kU2VsZWN0b3IoYXJncyksXG4gICAgICB0aGlzLl9nZXRGaW5kT3B0aW9ucyhhcmdzKVxuICAgICk7XG4gIH0sXG5cbiAgLyoqXG4gICAqIEBzdW1tYXJ5IEZpbmRzIHRoZSBmaXJzdCBkb2N1bWVudCB0aGF0IG1hdGNoZXMgdGhlIHNlbGVjdG9yLCBhcyBvcmRlcmVkIGJ5IHNvcnQgYW5kIHNraXAgb3B0aW9ucy4gUmV0dXJucyBgdW5kZWZpbmVkYCBpZiBubyBtYXRjaGluZyBkb2N1bWVudCBpcyBmb3VuZC5cbiAgICogQGxvY3VzIEFueXdoZXJlXG4gICAqIEBtZXRob2QgZmluZE9uZVxuICAgKiBAbWVtYmVyb2YgTW9uZ28uQ29sbGVjdGlvblxuICAgKiBAaW5zdGFuY2VcbiAgICogQHBhcmFtIHtNb25nb1NlbGVjdG9yfSBbc2VsZWN0b3JdIEEgcXVlcnkgZGVzY3JpYmluZyB0aGUgZG9jdW1lbnRzIHRvIGZpbmRcbiAgICogQHBhcmFtIHtPYmplY3R9IFtvcHRpb25zXVxuICAgKiBAcGFyYW0ge01vbmdvU29ydFNwZWNpZmllcn0gb3B0aW9ucy5zb3J0IFNvcnQgb3JkZXIgKGRlZmF1bHQ6IG5hdHVyYWwgb3JkZXIpXG4gICAqIEBwYXJhbSB7TnVtYmVyfSBvcHRpb25zLnNraXAgTnVtYmVyIG9mIHJlc3VsdHMgdG8gc2tpcCBhdCB0aGUgYmVnaW5uaW5nXG4gICAqIEBwYXJhbSB7TW9uZ29GaWVsZFNwZWNpZmllcn0gb3B0aW9ucy5maWVsZHMgRGljdGlvbmFyeSBvZiBmaWVsZHMgdG8gcmV0dXJuIG9yIGV4Y2x1ZGUuXG4gICAqIEBwYXJhbSB7Qm9vbGVhbn0gb3B0aW9ucy5yZWFjdGl2ZSAoQ2xpZW50IG9ubHkpIERlZmF1bHQgdHJ1ZTsgcGFzcyBmYWxzZSB0byBkaXNhYmxlIHJlYWN0aXZpdHlcbiAgICogQHBhcmFtIHtGdW5jdGlvbn0gb3B0aW9ucy50cmFuc2Zvcm0gT3ZlcnJpZGVzIGB0cmFuc2Zvcm1gIG9uIHRoZSBbYENvbGxlY3Rpb25gXSgjY29sbGVjdGlvbnMpIGZvciB0aGlzIGN1cnNvci4gIFBhc3MgYG51bGxgIHRvIGRpc2FibGUgdHJhbnNmb3JtYXRpb24uXG4gICAqIEBwYXJhbSB7U3RyaW5nfSBvcHRpb25zLnJlYWRQcmVmZXJlbmNlIChTZXJ2ZXIgb25seSkgU3BlY2lmaWVzIGEgY3VzdG9tIE1vbmdvREIgW2ByZWFkUHJlZmVyZW5jZWBdKGh0dHBzOi8vZG9jcy5tb25nb2RiLmNvbS9tYW51YWwvY29yZS9yZWFkLXByZWZlcmVuY2UpIGZvciBmZXRjaGluZyB0aGUgZG9jdW1lbnQuIFBvc3NpYmxlIHZhbHVlcyBhcmUgYHByaW1hcnlgLCBgcHJpbWFyeVByZWZlcnJlZGAsIGBzZWNvbmRhcnlgLCBgc2Vjb25kYXJ5UHJlZmVycmVkYCBhbmQgYG5lYXJlc3RgLlxuICAgKiBAcmV0dXJucyB7T2JqZWN0fVxuICAgKi9cbiAgZmluZE9uZSguLi5hcmdzKSB7XG4gICAgcmV0dXJuIHRoaXMuX2NvbGxlY3Rpb24uZmluZE9uZShcbiAgICAgIHRoaXMuX2dldEZpbmRTZWxlY3RvcihhcmdzKSxcbiAgICAgIHRoaXMuX2dldEZpbmRPcHRpb25zKGFyZ3MpXG4gICAgKTtcbiAgfSxcbn0pO1xuXG5PYmplY3QuYXNzaWduKE1vbmdvLkNvbGxlY3Rpb24sIHtcbiAgX3B1Ymxpc2hDdXJzb3IoY3Vyc29yLCBzdWIsIGNvbGxlY3Rpb24pIHtcbiAgICB2YXIgb2JzZXJ2ZUhhbmRsZSA9IGN1cnNvci5vYnNlcnZlQ2hhbmdlcyhcbiAgICAgIHtcbiAgICAgICAgYWRkZWQ6IGZ1bmN0aW9uKGlkLCBmaWVsZHMpIHtcbiAgICAgICAgICBzdWIuYWRkZWQoY29sbGVjdGlvbiwgaWQsIGZpZWxkcyk7XG4gICAgICAgIH0sXG4gICAgICAgIGNoYW5nZWQ6IGZ1bmN0aW9uKGlkLCBmaWVsZHMpIHtcbiAgICAgICAgICBzdWIuY2hhbmdlZChjb2xsZWN0aW9uLCBpZCwgZmllbGRzKTtcbiAgICAgICAgfSxcbiAgICAgICAgcmVtb3ZlZDogZnVuY3Rpb24oaWQpIHtcbiAgICAgICAgICBzdWIucmVtb3ZlZChjb2xsZWN0aW9uLCBpZCk7XG4gICAgICAgIH0sXG4gICAgICB9LFxuICAgICAgLy8gUHVibGljYXRpb25zIGRvbid0IG11dGF0ZSB0aGUgZG9jdW1lbnRzXG4gICAgICAvLyBUaGlzIGlzIHRlc3RlZCBieSB0aGUgYGxpdmVkYXRhIC0gcHVibGlzaCBjYWxsYmFja3MgY2xvbmVgIHRlc3RcbiAgICAgIHsgbm9uTXV0YXRpbmdDYWxsYmFja3M6IHRydWUgfVxuICAgICk7XG5cbiAgICAvLyBXZSBkb24ndCBjYWxsIHN1Yi5yZWFkeSgpIGhlcmU6IGl0IGdldHMgY2FsbGVkIGluIGxpdmVkYXRhX3NlcnZlciwgYWZ0ZXJcbiAgICAvLyBwb3NzaWJseSBjYWxsaW5nIF9wdWJsaXNoQ3Vyc29yIG9uIG11bHRpcGxlIHJldHVybmVkIGN1cnNvcnMuXG5cbiAgICAvLyByZWdpc3RlciBzdG9wIGNhbGxiYWNrIChleHBlY3RzIGxhbWJkYSB3LyBubyBhcmdzKS5cbiAgICBzdWIub25TdG9wKGZ1bmN0aW9uKCkge1xuICAgICAgb2JzZXJ2ZUhhbmRsZS5zdG9wKCk7XG4gICAgfSk7XG5cbiAgICAvLyByZXR1cm4gdGhlIG9ic2VydmVIYW5kbGUgaW4gY2FzZSBpdCBuZWVkcyB0byBiZSBzdG9wcGVkIGVhcmx5XG4gICAgcmV0dXJuIG9ic2VydmVIYW5kbGU7XG4gIH0sXG5cbiAgLy8gcHJvdGVjdCBhZ2FpbnN0IGRhbmdlcm91cyBzZWxlY3RvcnMuICBmYWxzZXkgYW5kIHtfaWQ6IGZhbHNleX0gYXJlIGJvdGhcbiAgLy8gbGlrZWx5IHByb2dyYW1tZXIgZXJyb3IsIGFuZCBub3Qgd2hhdCB5b3Ugd2FudCwgcGFydGljdWxhcmx5IGZvciBkZXN0cnVjdGl2ZVxuICAvLyBvcGVyYXRpb25zLiBJZiBhIGZhbHNleSBfaWQgaXMgc2VudCBpbiwgYSBuZXcgc3RyaW5nIF9pZCB3aWxsIGJlXG4gIC8vIGdlbmVyYXRlZCBhbmQgcmV0dXJuZWQ7IGlmIGEgZmFsbGJhY2tJZCBpcyBwcm92aWRlZCwgaXQgd2lsbCBiZSByZXR1cm5lZFxuICAvLyBpbnN0ZWFkLlxuICBfcmV3cml0ZVNlbGVjdG9yKHNlbGVjdG9yLCB7IGZhbGxiYWNrSWQgfSA9IHt9KSB7XG4gICAgLy8gc2hvcnRoYW5kIC0tIHNjYWxhcnMgbWF0Y2ggX2lkXG4gICAgaWYgKExvY2FsQ29sbGVjdGlvbi5fc2VsZWN0b3JJc0lkKHNlbGVjdG9yKSkgc2VsZWN0b3IgPSB7IF9pZDogc2VsZWN0b3IgfTtcblxuICAgIGlmIChBcnJheS5pc0FycmF5KHNlbGVjdG9yKSkge1xuICAgICAgLy8gVGhpcyBpcyBjb25zaXN0ZW50IHdpdGggdGhlIE1vbmdvIGNvbnNvbGUgaXRzZWxmOyBpZiB3ZSBkb24ndCBkbyB0aGlzXG4gICAgICAvLyBjaGVjayBwYXNzaW5nIGFuIGVtcHR5IGFycmF5IGVuZHMgdXAgc2VsZWN0aW5nIGFsbCBpdGVtc1xuICAgICAgdGhyb3cgbmV3IEVycm9yKFwiTW9uZ28gc2VsZWN0b3IgY2FuJ3QgYmUgYW4gYXJyYXkuXCIpO1xuICAgIH1cblxuICAgIGlmICghc2VsZWN0b3IgfHwgKCdfaWQnIGluIHNlbGVjdG9yICYmICFzZWxlY3Rvci5faWQpKSB7XG4gICAgICAvLyBjYW4ndCBtYXRjaCBhbnl0aGluZ1xuICAgICAgcmV0dXJuIHsgX2lkOiBmYWxsYmFja0lkIHx8IFJhbmRvbS5pZCgpIH07XG4gICAgfVxuXG4gICAgcmV0dXJuIHNlbGVjdG9yO1xuICB9LFxufSk7XG5cbk9iamVjdC5hc3NpZ24oTW9uZ28uQ29sbGVjdGlvbi5wcm90b3R5cGUsIHtcbiAgLy8gJ2luc2VydCcgaW1tZWRpYXRlbHkgcmV0dXJucyB0aGUgaW5zZXJ0ZWQgZG9jdW1lbnQncyBuZXcgX2lkLlxuICAvLyBUaGUgb3RoZXJzIHJldHVybiB2YWx1ZXMgaW1tZWRpYXRlbHkgaWYgeW91IGFyZSBpbiBhIHN0dWIsIGFuIGluLW1lbW9yeVxuICAvLyB1bm1hbmFnZWQgY29sbGVjdGlvbiwgb3IgYSBtb25nby1iYWNrZWQgY29sbGVjdGlvbiBhbmQgeW91IGRvbid0IHBhc3MgYVxuICAvLyBjYWxsYmFjay4gJ3VwZGF0ZScgYW5kICdyZW1vdmUnIHJldHVybiB0aGUgbnVtYmVyIG9mIGFmZmVjdGVkXG4gIC8vIGRvY3VtZW50cy4gJ3Vwc2VydCcgcmV0dXJucyBhbiBvYmplY3Qgd2l0aCBrZXlzICdudW1iZXJBZmZlY3RlZCcgYW5kLCBpZiBhblxuICAvLyBpbnNlcnQgaGFwcGVuZWQsICdpbnNlcnRlZElkJy5cbiAgLy9cbiAgLy8gT3RoZXJ3aXNlLCB0aGUgc2VtYW50aWNzIGFyZSBleGFjdGx5IGxpa2Ugb3RoZXIgbWV0aG9kczogdGhleSB0YWtlXG4gIC8vIGEgY2FsbGJhY2sgYXMgYW4gb3B0aW9uYWwgbGFzdCBhcmd1bWVudDsgaWYgbm8gY2FsbGJhY2sgaXNcbiAgLy8gcHJvdmlkZWQsIHRoZXkgYmxvY2sgdW50aWwgdGhlIG9wZXJhdGlvbiBpcyBjb21wbGV0ZSwgYW5kIHRocm93IGFuXG4gIC8vIGV4Y2VwdGlvbiBpZiBpdCBmYWlsczsgaWYgYSBjYWxsYmFjayBpcyBwcm92aWRlZCwgdGhlbiB0aGV5IGRvbid0XG4gIC8vIG5lY2Vzc2FyaWx5IGJsb2NrLCBhbmQgdGhleSBjYWxsIHRoZSBjYWxsYmFjayB3aGVuIHRoZXkgZmluaXNoIHdpdGggZXJyb3IgYW5kXG4gIC8vIHJlc3VsdCBhcmd1bWVudHMuICAoVGhlIGluc2VydCBtZXRob2QgcHJvdmlkZXMgdGhlIGRvY3VtZW50IElEIGFzIGl0cyByZXN1bHQ7XG4gIC8vIHVwZGF0ZSBhbmQgcmVtb3ZlIHByb3ZpZGUgdGhlIG51bWJlciBvZiBhZmZlY3RlZCBkb2NzIGFzIHRoZSByZXN1bHQ7IHVwc2VydFxuICAvLyBwcm92aWRlcyBhbiBvYmplY3Qgd2l0aCBudW1iZXJBZmZlY3RlZCBhbmQgbWF5YmUgaW5zZXJ0ZWRJZC4pXG4gIC8vXG4gIC8vIE9uIHRoZSBjbGllbnQsIGJsb2NraW5nIGlzIGltcG9zc2libGUsIHNvIGlmIGEgY2FsbGJhY2tcbiAgLy8gaXNuJ3QgcHJvdmlkZWQsIHRoZXkganVzdCByZXR1cm4gaW1tZWRpYXRlbHkgYW5kIGFueSBlcnJvclxuICAvLyBpbmZvcm1hdGlvbiBpcyBsb3N0LlxuICAvL1xuICAvLyBUaGVyZSdzIG9uZSBtb3JlIHR3ZWFrLiBPbiB0aGUgY2xpZW50LCBpZiB5b3UgZG9uJ3QgcHJvdmlkZSBhXG4gIC8vIGNhbGxiYWNrLCB0aGVuIGlmIHRoZXJlIGlzIGFuIGVycm9yLCBhIG1lc3NhZ2Ugd2lsbCBiZSBsb2dnZWQgd2l0aFxuICAvLyBNZXRlb3IuX2RlYnVnLlxuICAvL1xuICAvLyBUaGUgaW50ZW50ICh0aG91Z2ggdGhpcyBpcyBhY3R1YWxseSBkZXRlcm1pbmVkIGJ5IHRoZSB1bmRlcmx5aW5nXG4gIC8vIGRyaXZlcnMpIGlzIHRoYXQgdGhlIG9wZXJhdGlvbnMgc2hvdWxkIGJlIGRvbmUgc3luY2hyb25vdXNseSwgbm90XG4gIC8vIGdlbmVyYXRpbmcgdGhlaXIgcmVzdWx0IHVudGlsIHRoZSBkYXRhYmFzZSBoYXMgYWNrbm93bGVkZ2VkXG4gIC8vIHRoZW0uIEluIHRoZSBmdXR1cmUgbWF5YmUgd2Ugc2hvdWxkIHByb3ZpZGUgYSBmbGFnIHRvIHR1cm4gdGhpc1xuICAvLyBvZmYuXG5cbiAgLyoqXG4gICAqIEBzdW1tYXJ5IEluc2VydCBhIGRvY3VtZW50IGluIHRoZSBjb2xsZWN0aW9uLiAgUmV0dXJucyBpdHMgdW5pcXVlIF9pZC5cbiAgICogQGxvY3VzIEFueXdoZXJlXG4gICAqIEBtZXRob2QgIGluc2VydFxuICAgKiBAbWVtYmVyb2YgTW9uZ28uQ29sbGVjdGlvblxuICAgKiBAaW5zdGFuY2VcbiAgICogQHBhcmFtIHtPYmplY3R9IGRvYyBUaGUgZG9jdW1lbnQgdG8gaW5zZXJ0LiBNYXkgbm90IHlldCBoYXZlIGFuIF9pZCBhdHRyaWJ1dGUsIGluIHdoaWNoIGNhc2UgTWV0ZW9yIHdpbGwgZ2VuZXJhdGUgb25lIGZvciB5b3UuXG4gICAqIEBwYXJhbSB7RnVuY3Rpb259IFtjYWxsYmFja10gT3B0aW9uYWwuICBJZiBwcmVzZW50LCBjYWxsZWQgd2l0aCBhbiBlcnJvciBvYmplY3QgYXMgdGhlIGZpcnN0IGFyZ3VtZW50IGFuZCwgaWYgbm8gZXJyb3IsIHRoZSBfaWQgYXMgdGhlIHNlY29uZC5cbiAgICovXG4gIGluc2VydChkb2MsIGNhbGxiYWNrKSB7XG4gICAgLy8gTWFrZSBzdXJlIHdlIHdlcmUgcGFzc2VkIGEgZG9jdW1lbnQgdG8gaW5zZXJ0XG4gICAgaWYgKCFkb2MpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcignaW5zZXJ0IHJlcXVpcmVzIGFuIGFyZ3VtZW50Jyk7XG4gICAgfVxuXG4gICAgLy8gTWFrZSBhIHNoYWxsb3cgY2xvbmUgb2YgdGhlIGRvY3VtZW50LCBwcmVzZXJ2aW5nIGl0cyBwcm90b3R5cGUuXG4gICAgZG9jID0gT2JqZWN0LmNyZWF0ZShcbiAgICAgIE9iamVjdC5nZXRQcm90b3R5cGVPZihkb2MpLFxuICAgICAgT2JqZWN0LmdldE93blByb3BlcnR5RGVzY3JpcHRvcnMoZG9jKVxuICAgICk7XG5cbiAgICBpZiAoJ19pZCcgaW4gZG9jKSB7XG4gICAgICBpZiAoXG4gICAgICAgICFkb2MuX2lkIHx8XG4gICAgICAgICEodHlwZW9mIGRvYy5faWQgPT09ICdzdHJpbmcnIHx8IGRvYy5faWQgaW5zdGFuY2VvZiBNb25nby5PYmplY3RJRClcbiAgICAgICkge1xuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoXG4gICAgICAgICAgJ01ldGVvciByZXF1aXJlcyBkb2N1bWVudCBfaWQgZmllbGRzIHRvIGJlIG5vbi1lbXB0eSBzdHJpbmdzIG9yIE9iamVjdElEcydcbiAgICAgICAgKTtcbiAgICAgIH1cbiAgICB9IGVsc2Uge1xuICAgICAgbGV0IGdlbmVyYXRlSWQgPSB0cnVlO1xuXG4gICAgICAvLyBEb24ndCBnZW5lcmF0ZSB0aGUgaWQgaWYgd2UncmUgdGhlIGNsaWVudCBhbmQgdGhlICdvdXRlcm1vc3QnIGNhbGxcbiAgICAgIC8vIFRoaXMgb3B0aW1pemF0aW9uIHNhdmVzIHVzIHBhc3NpbmcgYm90aCB0aGUgcmFuZG9tU2VlZCBhbmQgdGhlIGlkXG4gICAgICAvLyBQYXNzaW5nIGJvdGggaXMgcmVkdW5kYW50LlxuICAgICAgaWYgKHRoaXMuX2lzUmVtb3RlQ29sbGVjdGlvbigpKSB7XG4gICAgICAgIGNvbnN0IGVuY2xvc2luZyA9IEREUC5fQ3VycmVudE1ldGhvZEludm9jYXRpb24uZ2V0KCk7XG4gICAgICAgIGlmICghZW5jbG9zaW5nKSB7XG4gICAgICAgICAgZ2VuZXJhdGVJZCA9IGZhbHNlO1xuICAgICAgICB9XG4gICAgICB9XG5cbiAgICAgIGlmIChnZW5lcmF0ZUlkKSB7XG4gICAgICAgIGRvYy5faWQgPSB0aGlzLl9tYWtlTmV3SUQoKTtcbiAgICAgIH1cbiAgICB9XG5cbiAgICAvLyBPbiBpbnNlcnRzLCBhbHdheXMgcmV0dXJuIHRoZSBpZCB0aGF0IHdlIGdlbmVyYXRlZDsgb24gYWxsIG90aGVyXG4gICAgLy8gb3BlcmF0aW9ucywganVzdCByZXR1cm4gdGhlIHJlc3VsdCBmcm9tIHRoZSBjb2xsZWN0aW9uLlxuICAgIHZhciBjaG9vc2VSZXR1cm5WYWx1ZUZyb21Db2xsZWN0aW9uUmVzdWx0ID0gZnVuY3Rpb24ocmVzdWx0KSB7XG4gICAgICBpZiAoZG9jLl9pZCkge1xuICAgICAgICByZXR1cm4gZG9jLl9pZDtcbiAgICAgIH1cblxuICAgICAgLy8gWFhYIHdoYXQgaXMgdGhpcyBmb3I/P1xuICAgICAgLy8gSXQncyBzb21lIGl0ZXJhY3Rpb24gYmV0d2VlbiB0aGUgY2FsbGJhY2sgdG8gX2NhbGxNdXRhdG9yTWV0aG9kIGFuZFxuICAgICAgLy8gdGhlIHJldHVybiB2YWx1ZSBjb252ZXJzaW9uXG4gICAgICBkb2MuX2lkID0gcmVzdWx0O1xuXG4gICAgICByZXR1cm4gcmVzdWx0O1xuICAgIH07XG5cbiAgICBjb25zdCB3cmFwcGVkQ2FsbGJhY2sgPSB3cmFwQ2FsbGJhY2soXG4gICAgICBjYWxsYmFjayxcbiAgICAgIGNob29zZVJldHVyblZhbHVlRnJvbUNvbGxlY3Rpb25SZXN1bHRcbiAgICApO1xuXG4gICAgaWYgKHRoaXMuX2lzUmVtb3RlQ29sbGVjdGlvbigpKSB7XG4gICAgICBjb25zdCByZXN1bHQgPSB0aGlzLl9jYWxsTXV0YXRvck1ldGhvZCgnaW5zZXJ0JywgW2RvY10sIHdyYXBwZWRDYWxsYmFjayk7XG4gICAgICByZXR1cm4gY2hvb3NlUmV0dXJuVmFsdWVGcm9tQ29sbGVjdGlvblJlc3VsdChyZXN1bHQpO1xuICAgIH1cblxuICAgIC8vIGl0J3MgbXkgY29sbGVjdGlvbi4gIGRlc2NlbmQgaW50byB0aGUgY29sbGVjdGlvbiBvYmplY3RcbiAgICAvLyBhbmQgcHJvcGFnYXRlIGFueSBleGNlcHRpb24uXG4gICAgdHJ5IHtcbiAgICAgIC8vIElmIHRoZSB1c2VyIHByb3ZpZGVkIGEgY2FsbGJhY2sgYW5kIHRoZSBjb2xsZWN0aW9uIGltcGxlbWVudHMgdGhpc1xuICAgICAgLy8gb3BlcmF0aW9uIGFzeW5jaHJvbm91c2x5LCB0aGVuIHF1ZXJ5UmV0IHdpbGwgYmUgdW5kZWZpbmVkLCBhbmQgdGhlXG4gICAgICAvLyByZXN1bHQgd2lsbCBiZSByZXR1cm5lZCB0aHJvdWdoIHRoZSBjYWxsYmFjayBpbnN0ZWFkLlxuICAgICAgY29uc3QgcmVzdWx0ID0gdGhpcy5fY29sbGVjdGlvbi5pbnNlcnQoZG9jLCB3cmFwcGVkQ2FsbGJhY2spO1xuICAgICAgcmV0dXJuIGNob29zZVJldHVyblZhbHVlRnJvbUNvbGxlY3Rpb25SZXN1bHQocmVzdWx0KTtcbiAgICB9IGNhdGNoIChlKSB7XG4gICAgICBpZiAoY2FsbGJhY2spIHtcbiAgICAgICAgY2FsbGJhY2soZSk7XG4gICAgICAgIHJldHVybiBudWxsO1xuICAgICAgfVxuICAgICAgdGhyb3cgZTtcbiAgICB9XG4gIH0sXG5cbiAgLyoqXG4gICAqIEBzdW1tYXJ5IE1vZGlmeSBvbmUgb3IgbW9yZSBkb2N1bWVudHMgaW4gdGhlIGNvbGxlY3Rpb24uIFJldHVybnMgdGhlIG51bWJlciBvZiBtYXRjaGVkIGRvY3VtZW50cy5cbiAgICogQGxvY3VzIEFueXdoZXJlXG4gICAqIEBtZXRob2QgdXBkYXRlXG4gICAqIEBtZW1iZXJvZiBNb25nby5Db2xsZWN0aW9uXG4gICAqIEBpbnN0YW5jZVxuICAgKiBAcGFyYW0ge01vbmdvU2VsZWN0b3J9IHNlbGVjdG9yIFNwZWNpZmllcyB3aGljaCBkb2N1bWVudHMgdG8gbW9kaWZ5XG4gICAqIEBwYXJhbSB7TW9uZ29Nb2RpZmllcn0gbW9kaWZpZXIgU3BlY2lmaWVzIGhvdyB0byBtb2RpZnkgdGhlIGRvY3VtZW50c1xuICAgKiBAcGFyYW0ge09iamVjdH0gW29wdGlvbnNdXG4gICAqIEBwYXJhbSB7Qm9vbGVhbn0gb3B0aW9ucy5tdWx0aSBUcnVlIHRvIG1vZGlmeSBhbGwgbWF0Y2hpbmcgZG9jdW1lbnRzOyBmYWxzZSB0byBvbmx5IG1vZGlmeSBvbmUgb2YgdGhlIG1hdGNoaW5nIGRvY3VtZW50cyAodGhlIGRlZmF1bHQpLlxuICAgKiBAcGFyYW0ge0Jvb2xlYW59IG9wdGlvbnMudXBzZXJ0IFRydWUgdG8gaW5zZXJ0IGEgZG9jdW1lbnQgaWYgbm8gbWF0Y2hpbmcgZG9jdW1lbnRzIGFyZSBmb3VuZC5cbiAgICogQHBhcmFtIHtBcnJheX0gb3B0aW9ucy5hcnJheUZpbHRlcnMgT3B0aW9uYWwuIFVzZWQgaW4gY29tYmluYXRpb24gd2l0aCBNb25nb0RCIFtmaWx0ZXJlZCBwb3NpdGlvbmFsIG9wZXJhdG9yXShodHRwczovL2RvY3MubW9uZ29kYi5jb20vbWFudWFsL3JlZmVyZW5jZS9vcGVyYXRvci91cGRhdGUvcG9zaXRpb25hbC1maWx0ZXJlZC8pIHRvIHNwZWNpZnkgd2hpY2ggZWxlbWVudHMgdG8gbW9kaWZ5IGluIGFuIGFycmF5IGZpZWxkLlxuICAgKiBAcGFyYW0ge0Z1bmN0aW9ufSBbY2FsbGJhY2tdIE9wdGlvbmFsLiAgSWYgcHJlc2VudCwgY2FsbGVkIHdpdGggYW4gZXJyb3Igb2JqZWN0IGFzIHRoZSBmaXJzdCBhcmd1bWVudCBhbmQsIGlmIG5vIGVycm9yLCB0aGUgbnVtYmVyIG9mIGFmZmVjdGVkIGRvY3VtZW50cyBhcyB0aGUgc2Vjb25kLlxuICAgKi9cbiAgdXBkYXRlKHNlbGVjdG9yLCBtb2RpZmllciwgLi4ub3B0aW9uc0FuZENhbGxiYWNrKSB7XG4gICAgY29uc3QgY2FsbGJhY2sgPSBwb3BDYWxsYmFja0Zyb21BcmdzKG9wdGlvbnNBbmRDYWxsYmFjayk7XG5cbiAgICAvLyBXZSd2ZSBhbHJlYWR5IHBvcHBlZCBvZmYgdGhlIGNhbGxiYWNrLCBzbyB3ZSBhcmUgbGVmdCB3aXRoIGFuIGFycmF5XG4gICAgLy8gb2Ygb25lIG9yIHplcm8gaXRlbXNcbiAgICBjb25zdCBvcHRpb25zID0geyAuLi4ob3B0aW9uc0FuZENhbGxiYWNrWzBdIHx8IG51bGwpIH07XG4gICAgbGV0IGluc2VydGVkSWQ7XG4gICAgaWYgKG9wdGlvbnMgJiYgb3B0aW9ucy51cHNlcnQpIHtcbiAgICAgIC8vIHNldCBgaW5zZXJ0ZWRJZGAgaWYgYWJzZW50LiAgYGluc2VydGVkSWRgIGlzIGEgTWV0ZW9yIGV4dGVuc2lvbi5cbiAgICAgIGlmIChvcHRpb25zLmluc2VydGVkSWQpIHtcbiAgICAgICAgaWYgKFxuICAgICAgICAgICEoXG4gICAgICAgICAgICB0eXBlb2Ygb3B0aW9ucy5pbnNlcnRlZElkID09PSAnc3RyaW5nJyB8fFxuICAgICAgICAgICAgb3B0aW9ucy5pbnNlcnRlZElkIGluc3RhbmNlb2YgTW9uZ28uT2JqZWN0SURcbiAgICAgICAgICApXG4gICAgICAgIClcbiAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoJ2luc2VydGVkSWQgbXVzdCBiZSBzdHJpbmcgb3IgT2JqZWN0SUQnKTtcbiAgICAgICAgaW5zZXJ0ZWRJZCA9IG9wdGlvbnMuaW5zZXJ0ZWRJZDtcbiAgICAgIH0gZWxzZSBpZiAoIXNlbGVjdG9yIHx8ICFzZWxlY3Rvci5faWQpIHtcbiAgICAgICAgaW5zZXJ0ZWRJZCA9IHRoaXMuX21ha2VOZXdJRCgpO1xuICAgICAgICBvcHRpb25zLmdlbmVyYXRlZElkID0gdHJ1ZTtcbiAgICAgICAgb3B0aW9ucy5pbnNlcnRlZElkID0gaW5zZXJ0ZWRJZDtcbiAgICAgIH1cbiAgICB9XG5cbiAgICBzZWxlY3RvciA9IE1vbmdvLkNvbGxlY3Rpb24uX3Jld3JpdGVTZWxlY3RvcihzZWxlY3Rvciwge1xuICAgICAgZmFsbGJhY2tJZDogaW5zZXJ0ZWRJZCxcbiAgICB9KTtcblxuICAgIGNvbnN0IHdyYXBwZWRDYWxsYmFjayA9IHdyYXBDYWxsYmFjayhjYWxsYmFjayk7XG5cbiAgICBpZiAodGhpcy5faXNSZW1vdGVDb2xsZWN0aW9uKCkpIHtcbiAgICAgIGNvbnN0IGFyZ3MgPSBbc2VsZWN0b3IsIG1vZGlmaWVyLCBvcHRpb25zXTtcblxuICAgICAgcmV0dXJuIHRoaXMuX2NhbGxNdXRhdG9yTWV0aG9kKCd1cGRhdGUnLCBhcmdzLCB3cmFwcGVkQ2FsbGJhY2spO1xuICAgIH1cblxuICAgIC8vIGl0J3MgbXkgY29sbGVjdGlvbi4gIGRlc2NlbmQgaW50byB0aGUgY29sbGVjdGlvbiBvYmplY3RcbiAgICAvLyBhbmQgcHJvcGFnYXRlIGFueSBleGNlcHRpb24uXG4gICAgdHJ5IHtcbiAgICAgIC8vIElmIHRoZSB1c2VyIHByb3ZpZGVkIGEgY2FsbGJhY2sgYW5kIHRoZSBjb2xsZWN0aW9uIGltcGxlbWVudHMgdGhpc1xuICAgICAgLy8gb3BlcmF0aW9uIGFzeW5jaHJvbm91c2x5LCB0aGVuIHF1ZXJ5UmV0IHdpbGwgYmUgdW5kZWZpbmVkLCBhbmQgdGhlXG4gICAgICAvLyByZXN1bHQgd2lsbCBiZSByZXR1cm5lZCB0aHJvdWdoIHRoZSBjYWxsYmFjayBpbnN0ZWFkLlxuICAgICAgcmV0dXJuIHRoaXMuX2NvbGxlY3Rpb24udXBkYXRlKFxuICAgICAgICBzZWxlY3RvcixcbiAgICAgICAgbW9kaWZpZXIsXG4gICAgICAgIG9wdGlvbnMsXG4gICAgICAgIHdyYXBwZWRDYWxsYmFja1xuICAgICAgKTtcbiAgICB9IGNhdGNoIChlKSB7XG4gICAgICBpZiAoY2FsbGJhY2spIHtcbiAgICAgICAgY2FsbGJhY2soZSk7XG4gICAgICAgIHJldHVybiBudWxsO1xuICAgICAgfVxuICAgICAgdGhyb3cgZTtcbiAgICB9XG4gIH0sXG5cbiAgLyoqXG4gICAqIEBzdW1tYXJ5IFJlbW92ZSBkb2N1bWVudHMgZnJvbSB0aGUgY29sbGVjdGlvblxuICAgKiBAbG9jdXMgQW55d2hlcmVcbiAgICogQG1ldGhvZCByZW1vdmVcbiAgICogQG1lbWJlcm9mIE1vbmdvLkNvbGxlY3Rpb25cbiAgICogQGluc3RhbmNlXG4gICAqIEBwYXJhbSB7TW9uZ29TZWxlY3Rvcn0gc2VsZWN0b3IgU3BlY2lmaWVzIHdoaWNoIGRvY3VtZW50cyB0byByZW1vdmVcbiAgICogQHBhcmFtIHtGdW5jdGlvbn0gW2NhbGxiYWNrXSBPcHRpb25hbC4gIElmIHByZXNlbnQsIGNhbGxlZCB3aXRoIGFuIGVycm9yIG9iamVjdCBhcyBpdHMgYXJndW1lbnQuXG4gICAqL1xuICByZW1vdmUoc2VsZWN0b3IsIGNhbGxiYWNrKSB7XG4gICAgc2VsZWN0b3IgPSBNb25nby5Db2xsZWN0aW9uLl9yZXdyaXRlU2VsZWN0b3Ioc2VsZWN0b3IpO1xuXG4gICAgY29uc3Qgd3JhcHBlZENhbGxiYWNrID0gd3JhcENhbGxiYWNrKGNhbGxiYWNrKTtcblxuICAgIGlmICh0aGlzLl9pc1JlbW90ZUNvbGxlY3Rpb24oKSkge1xuICAgICAgcmV0dXJuIHRoaXMuX2NhbGxNdXRhdG9yTWV0aG9kKCdyZW1vdmUnLCBbc2VsZWN0b3JdLCB3cmFwcGVkQ2FsbGJhY2spO1xuICAgIH1cblxuICAgIC8vIGl0J3MgbXkgY29sbGVjdGlvbi4gIGRlc2NlbmQgaW50byB0aGUgY29sbGVjdGlvbiBvYmplY3RcbiAgICAvLyBhbmQgcHJvcGFnYXRlIGFueSBleGNlcHRpb24uXG4gICAgdHJ5IHtcbiAgICAgIC8vIElmIHRoZSB1c2VyIHByb3ZpZGVkIGEgY2FsbGJhY2sgYW5kIHRoZSBjb2xsZWN0aW9uIGltcGxlbWVudHMgdGhpc1xuICAgICAgLy8gb3BlcmF0aW9uIGFzeW5jaHJvbm91c2x5LCB0aGVuIHF1ZXJ5UmV0IHdpbGwgYmUgdW5kZWZpbmVkLCBhbmQgdGhlXG4gICAgICAvLyByZXN1bHQgd2lsbCBiZSByZXR1cm5lZCB0aHJvdWdoIHRoZSBjYWxsYmFjayBpbnN0ZWFkLlxuICAgICAgcmV0dXJuIHRoaXMuX2NvbGxlY3Rpb24ucmVtb3ZlKHNlbGVjdG9yLCB3cmFwcGVkQ2FsbGJhY2spO1xuICAgIH0gY2F0Y2ggKGUpIHtcbiAgICAgIGlmIChjYWxsYmFjaykge1xuICAgICAgICBjYWxsYmFjayhlKTtcbiAgICAgICAgcmV0dXJuIG51bGw7XG4gICAgICB9XG4gICAgICB0aHJvdyBlO1xuICAgIH1cbiAgfSxcblxuICAvLyBEZXRlcm1pbmUgaWYgdGhpcyBjb2xsZWN0aW9uIGlzIHNpbXBseSBhIG1pbmltb25nbyByZXByZXNlbnRhdGlvbiBvZiBhIHJlYWxcbiAgLy8gZGF0YWJhc2Ugb24gYW5vdGhlciBzZXJ2ZXJcbiAgX2lzUmVtb3RlQ29sbGVjdGlvbigpIHtcbiAgICAvLyBYWFggc2VlICNNZXRlb3JTZXJ2ZXJOdWxsXG4gICAgcmV0dXJuIHRoaXMuX2Nvbm5lY3Rpb24gJiYgdGhpcy5fY29ubmVjdGlvbiAhPT0gTWV0ZW9yLnNlcnZlcjtcbiAgfSxcblxuICAvKipcbiAgICogQHN1bW1hcnkgTW9kaWZ5IG9uZSBvciBtb3JlIGRvY3VtZW50cyBpbiB0aGUgY29sbGVjdGlvbiwgb3IgaW5zZXJ0IG9uZSBpZiBubyBtYXRjaGluZyBkb2N1bWVudHMgd2VyZSBmb3VuZC4gUmV0dXJucyBhbiBvYmplY3Qgd2l0aCBrZXlzIGBudW1iZXJBZmZlY3RlZGAgKHRoZSBudW1iZXIgb2YgZG9jdW1lbnRzIG1vZGlmaWVkKSAgYW5kIGBpbnNlcnRlZElkYCAodGhlIHVuaXF1ZSBfaWQgb2YgdGhlIGRvY3VtZW50IHRoYXQgd2FzIGluc2VydGVkLCBpZiBhbnkpLlxuICAgKiBAbG9jdXMgQW55d2hlcmVcbiAgICogQG1ldGhvZCB1cHNlcnRcbiAgICogQG1lbWJlcm9mIE1vbmdvLkNvbGxlY3Rpb25cbiAgICogQGluc3RhbmNlXG4gICAqIEBwYXJhbSB7TW9uZ29TZWxlY3Rvcn0gc2VsZWN0b3IgU3BlY2lmaWVzIHdoaWNoIGRvY3VtZW50cyB0byBtb2RpZnlcbiAgICogQHBhcmFtIHtNb25nb01vZGlmaWVyfSBtb2RpZmllciBTcGVjaWZpZXMgaG93IHRvIG1vZGlmeSB0aGUgZG9jdW1lbnRzXG4gICAqIEBwYXJhbSB7T2JqZWN0fSBbb3B0aW9uc11cbiAgICogQHBhcmFtIHtCb29sZWFufSBvcHRpb25zLm11bHRpIFRydWUgdG8gbW9kaWZ5IGFsbCBtYXRjaGluZyBkb2N1bWVudHM7IGZhbHNlIHRvIG9ubHkgbW9kaWZ5IG9uZSBvZiB0aGUgbWF0Y2hpbmcgZG9jdW1lbnRzICh0aGUgZGVmYXVsdCkuXG4gICAqIEBwYXJhbSB7RnVuY3Rpb259IFtjYWxsYmFja10gT3B0aW9uYWwuICBJZiBwcmVzZW50LCBjYWxsZWQgd2l0aCBhbiBlcnJvciBvYmplY3QgYXMgdGhlIGZpcnN0IGFyZ3VtZW50IGFuZCwgaWYgbm8gZXJyb3IsIHRoZSBudW1iZXIgb2YgYWZmZWN0ZWQgZG9jdW1lbnRzIGFzIHRoZSBzZWNvbmQuXG4gICAqL1xuICB1cHNlcnQoc2VsZWN0b3IsIG1vZGlmaWVyLCBvcHRpb25zLCBjYWxsYmFjaykge1xuICAgIGlmICghY2FsbGJhY2sgJiYgdHlwZW9mIG9wdGlvbnMgPT09ICdmdW5jdGlvbicpIHtcbiAgICAgIGNhbGxiYWNrID0gb3B0aW9ucztcbiAgICAgIG9wdGlvbnMgPSB7fTtcbiAgICB9XG5cbiAgICByZXR1cm4gdGhpcy51cGRhdGUoXG4gICAgICBzZWxlY3RvcixcbiAgICAgIG1vZGlmaWVyLFxuICAgICAge1xuICAgICAgICAuLi5vcHRpb25zLFxuICAgICAgICBfcmV0dXJuT2JqZWN0OiB0cnVlLFxuICAgICAgICB1cHNlcnQ6IHRydWUsXG4gICAgICB9LFxuICAgICAgY2FsbGJhY2tcbiAgICApO1xuICB9LFxuXG4gIC8vIFdlJ2xsIGFjdHVhbGx5IGRlc2lnbiBhbiBpbmRleCBBUEkgbGF0ZXIuIEZvciBub3csIHdlIGp1c3QgcGFzcyB0aHJvdWdoIHRvXG4gIC8vIE1vbmdvJ3MsIGJ1dCBtYWtlIGl0IHN5bmNocm9ub3VzLlxuICBfZW5zdXJlSW5kZXgoaW5kZXgsIG9wdGlvbnMpIHtcbiAgICB2YXIgc2VsZiA9IHRoaXM7XG4gICAgaWYgKCFzZWxmLl9jb2xsZWN0aW9uLl9lbnN1cmVJbmRleCB8fCAhc2VsZi5fY29sbGVjdGlvbi5jcmVhdGVJbmRleClcbiAgICAgIHRocm93IG5ldyBFcnJvcignQ2FuIG9ubHkgY2FsbCBjcmVhdGVJbmRleCBvbiBzZXJ2ZXIgY29sbGVjdGlvbnMnKTtcbiAgICBpZiAoc2VsZi5fY29sbGVjdGlvbi5jcmVhdGVJbmRleCkge1xuICAgICAgc2VsZi5fY29sbGVjdGlvbi5jcmVhdGVJbmRleChpbmRleCwgb3B0aW9ucyk7XG4gICAgfSBlbHNlIHtcbiAgICAgIGltcG9ydCB7IExvZyB9IGZyb20gJ21ldGVvci9sb2dnaW5nJztcbiAgICAgIExvZy5kZWJ1ZyhgX2Vuc3VyZUluZGV4IGhhcyBiZWVuIGRlcHJlY2F0ZWQsIHBsZWFzZSB1c2UgdGhlIG5ldyAnY3JlYXRlSW5kZXgnIGluc3RlYWQke29wdGlvbnM/Lm5hbWUgPyBgLCBpbmRleCBuYW1lOiAke29wdGlvbnMubmFtZX1gIDogYCwgaW5kZXg6ICR7SlNPTi5zdHJpbmdpZnkoaW5kZXgpfWB9YClcbiAgICAgIHNlbGYuX2NvbGxlY3Rpb24uX2Vuc3VyZUluZGV4KGluZGV4LCBvcHRpb25zKTtcbiAgICB9XG4gIH0sXG5cbiAgLyoqXG4gICAqIEBzdW1tYXJ5IENyZWF0ZXMgdGhlIHNwZWNpZmllZCBpbmRleCBvbiB0aGUgY29sbGVjdGlvbi5cbiAgICogQGxvY3VzIHNlcnZlclxuICAgKiBAbWV0aG9kIGNyZWF0ZUluZGV4XG4gICAqIEBtZW1iZXJvZiBNb25nby5Db2xsZWN0aW9uXG4gICAqIEBpbnN0YW5jZVxuICAgKiBAcGFyYW0ge09iamVjdH0gaW5kZXggQSBkb2N1bWVudCB0aGF0IGNvbnRhaW5zIHRoZSBmaWVsZCBhbmQgdmFsdWUgcGFpcnMgd2hlcmUgdGhlIGZpZWxkIGlzIHRoZSBpbmRleCBrZXkgYW5kIHRoZSB2YWx1ZSBkZXNjcmliZXMgdGhlIHR5cGUgb2YgaW5kZXggZm9yIHRoYXQgZmllbGQuIEZvciBhbiBhc2NlbmRpbmcgaW5kZXggb24gYSBmaWVsZCwgc3BlY2lmeSBhIHZhbHVlIG9mIGAxYDsgZm9yIGRlc2NlbmRpbmcgaW5kZXgsIHNwZWNpZnkgYSB2YWx1ZSBvZiBgLTFgLiBVc2UgYHRleHRgIGZvciB0ZXh0IGluZGV4ZXMuXG4gICAqIEBwYXJhbSB7T2JqZWN0fSBbb3B0aW9uc10gQWxsIG9wdGlvbnMgYXJlIGxpc3RlZCBpbiBbTW9uZ29EQiBkb2N1bWVudGF0aW9uXShodHRwczovL2RvY3MubW9uZ29kYi5jb20vbWFudWFsL3JlZmVyZW5jZS9tZXRob2QvZGIuY29sbGVjdGlvbi5jcmVhdGVJbmRleC8jb3B0aW9ucylcbiAgICogQHBhcmFtIHtTdHJpbmd9IG9wdGlvbnMubmFtZSBOYW1lIG9mIHRoZSBpbmRleFxuICAgKiBAcGFyYW0ge0Jvb2xlYW59IG9wdGlvbnMudW5pcXVlIERlZmluZSB0aGF0IHRoZSBpbmRleCB2YWx1ZXMgbXVzdCBiZSB1bmlxdWUsIG1vcmUgYXQgW01vbmdvREIgZG9jdW1lbnRhdGlvbl0oaHR0cHM6Ly9kb2NzLm1vbmdvZGIuY29tL21hbnVhbC9jb3JlL2luZGV4LXVuaXF1ZS8pXG4gICAqIEBwYXJhbSB7Qm9vbGVhbn0gb3B0aW9ucy5zcGFyc2UgRGVmaW5lIHRoYXQgdGhlIGluZGV4IGlzIHNwYXJzZSwgbW9yZSBhdCBbTW9uZ29EQiBkb2N1bWVudGF0aW9uXShodHRwczovL2RvY3MubW9uZ29kYi5jb20vbWFudWFsL2NvcmUvaW5kZXgtc3BhcnNlLylcbiAgICovXG4gIGNyZWF0ZUluZGV4KGluZGV4LCBvcHRpb25zKSB7XG4gICAgdmFyIHNlbGYgPSB0aGlzO1xuICAgIGlmICghc2VsZi5fY29sbGVjdGlvbi5jcmVhdGVJbmRleClcbiAgICAgIHRocm93IG5ldyBFcnJvcignQ2FuIG9ubHkgY2FsbCBjcmVhdGVJbmRleCBvbiBzZXJ2ZXIgY29sbGVjdGlvbnMnKTtcbiAgICBzZWxmLl9jb2xsZWN0aW9uLmNyZWF0ZUluZGV4KGluZGV4LCBvcHRpb25zKTtcbiAgfSxcblxuICBfZHJvcEluZGV4KGluZGV4KSB7XG4gICAgdmFyIHNlbGYgPSB0aGlzO1xuICAgIGlmICghc2VsZi5fY29sbGVjdGlvbi5fZHJvcEluZGV4KVxuICAgICAgdGhyb3cgbmV3IEVycm9yKCdDYW4gb25seSBjYWxsIF9kcm9wSW5kZXggb24gc2VydmVyIGNvbGxlY3Rpb25zJyk7XG4gICAgc2VsZi5fY29sbGVjdGlvbi5fZHJvcEluZGV4KGluZGV4KTtcbiAgfSxcblxuICBfZHJvcENvbGxlY3Rpb24oKSB7XG4gICAgdmFyIHNlbGYgPSB0aGlzO1xuICAgIGlmICghc2VsZi5fY29sbGVjdGlvbi5kcm9wQ29sbGVjdGlvbilcbiAgICAgIHRocm93IG5ldyBFcnJvcignQ2FuIG9ubHkgY2FsbCBfZHJvcENvbGxlY3Rpb24gb24gc2VydmVyIGNvbGxlY3Rpb25zJyk7XG4gICAgc2VsZi5fY29sbGVjdGlvbi5kcm9wQ29sbGVjdGlvbigpO1xuICB9LFxuXG4gIF9jcmVhdGVDYXBwZWRDb2xsZWN0aW9uKGJ5dGVTaXplLCBtYXhEb2N1bWVudHMpIHtcbiAgICB2YXIgc2VsZiA9IHRoaXM7XG4gICAgaWYgKCFzZWxmLl9jb2xsZWN0aW9uLl9jcmVhdGVDYXBwZWRDb2xsZWN0aW9uKVxuICAgICAgdGhyb3cgbmV3IEVycm9yKFxuICAgICAgICAnQ2FuIG9ubHkgY2FsbCBfY3JlYXRlQ2FwcGVkQ29sbGVjdGlvbiBvbiBzZXJ2ZXIgY29sbGVjdGlvbnMnXG4gICAgICApO1xuICAgIHNlbGYuX2NvbGxlY3Rpb24uX2NyZWF0ZUNhcHBlZENvbGxlY3Rpb24oYnl0ZVNpemUsIG1heERvY3VtZW50cyk7XG4gIH0sXG5cbiAgLyoqXG4gICAqIEBzdW1tYXJ5IFJldHVybnMgdGhlIFtgQ29sbGVjdGlvbmBdKGh0dHA6Ly9tb25nb2RiLmdpdGh1Yi5pby9ub2RlLW1vbmdvZGItbmF0aXZlLzMuMC9hcGkvQ29sbGVjdGlvbi5odG1sKSBvYmplY3QgY29ycmVzcG9uZGluZyB0byB0aGlzIGNvbGxlY3Rpb24gZnJvbSB0aGUgW25wbSBgbW9uZ29kYmAgZHJpdmVyIG1vZHVsZV0oaHR0cHM6Ly93d3cubnBtanMuY29tL3BhY2thZ2UvbW9uZ29kYikgd2hpY2ggaXMgd3JhcHBlZCBieSBgTW9uZ28uQ29sbGVjdGlvbmAuXG4gICAqIEBsb2N1cyBTZXJ2ZXJcbiAgICogQG1lbWJlcm9mIE1vbmdvLkNvbGxlY3Rpb25cbiAgICogQGluc3RhbmNlXG4gICAqL1xuICByYXdDb2xsZWN0aW9uKCkge1xuICAgIHZhciBzZWxmID0gdGhpcztcbiAgICBpZiAoIXNlbGYuX2NvbGxlY3Rpb24ucmF3Q29sbGVjdGlvbikge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKCdDYW4gb25seSBjYWxsIHJhd0NvbGxlY3Rpb24gb24gc2VydmVyIGNvbGxlY3Rpb25zJyk7XG4gICAgfVxuICAgIHJldHVybiBzZWxmLl9jb2xsZWN0aW9uLnJhd0NvbGxlY3Rpb24oKTtcbiAgfSxcblxuICAvKipcbiAgICogQHN1bW1hcnkgUmV0dXJucyB0aGUgW2BEYmBdKGh0dHA6Ly9tb25nb2RiLmdpdGh1Yi5pby9ub2RlLW1vbmdvZGItbmF0aXZlLzMuMC9hcGkvRGIuaHRtbCkgb2JqZWN0IGNvcnJlc3BvbmRpbmcgdG8gdGhpcyBjb2xsZWN0aW9uJ3MgZGF0YWJhc2UgY29ubmVjdGlvbiBmcm9tIHRoZSBbbnBtIGBtb25nb2RiYCBkcml2ZXIgbW9kdWxlXShodHRwczovL3d3dy5ucG1qcy5jb20vcGFja2FnZS9tb25nb2RiKSB3aGljaCBpcyB3cmFwcGVkIGJ5IGBNb25nby5Db2xsZWN0aW9uYC5cbiAgICogQGxvY3VzIFNlcnZlclxuICAgKiBAbWVtYmVyb2YgTW9uZ28uQ29sbGVjdGlvblxuICAgKiBAaW5zdGFuY2VcbiAgICovXG4gIHJhd0RhdGFiYXNlKCkge1xuICAgIHZhciBzZWxmID0gdGhpcztcbiAgICBpZiAoIShzZWxmLl9kcml2ZXIubW9uZ28gJiYgc2VsZi5fZHJpdmVyLm1vbmdvLmRiKSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKCdDYW4gb25seSBjYWxsIHJhd0RhdGFiYXNlIG9uIHNlcnZlciBjb2xsZWN0aW9ucycpO1xuICAgIH1cbiAgICByZXR1cm4gc2VsZi5fZHJpdmVyLm1vbmdvLmRiO1xuICB9LFxufSk7XG5cbi8vIENvbnZlcnQgdGhlIGNhbGxiYWNrIHRvIG5vdCByZXR1cm4gYSByZXN1bHQgaWYgdGhlcmUgaXMgYW4gZXJyb3JcbmZ1bmN0aW9uIHdyYXBDYWxsYmFjayhjYWxsYmFjaywgY29udmVydFJlc3VsdCkge1xuICByZXR1cm4gKFxuICAgIGNhbGxiYWNrICYmXG4gICAgZnVuY3Rpb24oZXJyb3IsIHJlc3VsdCkge1xuICAgICAgaWYgKGVycm9yKSB7XG4gICAgICAgIGNhbGxiYWNrKGVycm9yKTtcbiAgICAgIH0gZWxzZSBpZiAodHlwZW9mIGNvbnZlcnRSZXN1bHQgPT09ICdmdW5jdGlvbicpIHtcbiAgICAgICAgY2FsbGJhY2soZXJyb3IsIGNvbnZlcnRSZXN1bHQocmVzdWx0KSk7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICBjYWxsYmFjayhlcnJvciwgcmVzdWx0KTtcbiAgICAgIH1cbiAgICB9XG4gICk7XG59XG5cbi8qKlxuICogQHN1bW1hcnkgQ3JlYXRlIGEgTW9uZ28tc3R5bGUgYE9iamVjdElEYC4gIElmIHlvdSBkb24ndCBzcGVjaWZ5IGEgYGhleFN0cmluZ2AsIHRoZSBgT2JqZWN0SURgIHdpbGwgZ2VuZXJhdGVkIHJhbmRvbWx5IChub3QgdXNpbmcgTW9uZ29EQidzIElEIGNvbnN0cnVjdGlvbiBydWxlcykuXG4gKiBAbG9jdXMgQW55d2hlcmVcbiAqIEBjbGFzc1xuICogQHBhcmFtIHtTdHJpbmd9IFtoZXhTdHJpbmddIE9wdGlvbmFsLiAgVGhlIDI0LWNoYXJhY3RlciBoZXhhZGVjaW1hbCBjb250ZW50cyBvZiB0aGUgT2JqZWN0SUQgdG8gY3JlYXRlXG4gKi9cbk1vbmdvLk9iamVjdElEID0gTW9uZ29JRC5PYmplY3RJRDtcblxuLyoqXG4gKiBAc3VtbWFyeSBUbyBjcmVhdGUgYSBjdXJzb3IsIHVzZSBmaW5kLiBUbyBhY2Nlc3MgdGhlIGRvY3VtZW50cyBpbiBhIGN1cnNvciwgdXNlIGZvckVhY2gsIG1hcCwgb3IgZmV0Y2guXG4gKiBAY2xhc3NcbiAqIEBpbnN0YW5jZU5hbWUgY3Vyc29yXG4gKi9cbk1vbmdvLkN1cnNvciA9IExvY2FsQ29sbGVjdGlvbi5DdXJzb3I7XG5cbi8qKlxuICogQGRlcHJlY2F0ZWQgaW4gMC45LjFcbiAqL1xuTW9uZ28uQ29sbGVjdGlvbi5DdXJzb3IgPSBNb25nby5DdXJzb3I7XG5cbi8qKlxuICogQGRlcHJlY2F0ZWQgaW4gMC45LjFcbiAqL1xuTW9uZ28uQ29sbGVjdGlvbi5PYmplY3RJRCA9IE1vbmdvLk9iamVjdElEO1xuXG4vKipcbiAqIEBkZXByZWNhdGVkIGluIDAuOS4xXG4gKi9cbk1ldGVvci5Db2xsZWN0aW9uID0gTW9uZ28uQ29sbGVjdGlvbjtcblxuLy8gQWxsb3cgZGVueSBzdHVmZiBpcyBub3cgaW4gdGhlIGFsbG93LWRlbnkgcGFja2FnZVxuT2JqZWN0LmFzc2lnbihNZXRlb3IuQ29sbGVjdGlvbi5wcm90b3R5cGUsIEFsbG93RGVueS5Db2xsZWN0aW9uUHJvdG90eXBlKTtcblxuZnVuY3Rpb24gcG9wQ2FsbGJhY2tGcm9tQXJncyhhcmdzKSB7XG4gIC8vIFB1bGwgb2ZmIGFueSBjYWxsYmFjayAob3IgcGVyaGFwcyBhICdjYWxsYmFjaycgdmFyaWFibGUgdGhhdCB3YXMgcGFzc2VkXG4gIC8vIGluIHVuZGVmaW5lZCwgbGlrZSBob3cgJ3Vwc2VydCcgZG9lcyBpdCkuXG4gIGlmIChcbiAgICBhcmdzLmxlbmd0aCAmJlxuICAgIChhcmdzW2FyZ3MubGVuZ3RoIC0gMV0gPT09IHVuZGVmaW5lZCB8fFxuICAgICAgYXJnc1thcmdzLmxlbmd0aCAtIDFdIGluc3RhbmNlb2YgRnVuY3Rpb24pXG4gICkge1xuICAgIHJldHVybiBhcmdzLnBvcCgpO1xuICB9XG59XG4iLCIvKipcbiAqIEBzdW1tYXJ5IEFsbG93cyBmb3IgdXNlciBzcGVjaWZpZWQgY29ubmVjdGlvbiBvcHRpb25zXG4gKiBAZXhhbXBsZSBodHRwOi8vbW9uZ29kYi5naXRodWIuaW8vbm9kZS1tb25nb2RiLW5hdGl2ZS8zLjAvcmVmZXJlbmNlL2Nvbm5lY3RpbmcvY29ubmVjdGlvbi1zZXR0aW5ncy9cbiAqIEBsb2N1cyBTZXJ2ZXJcbiAqIEBwYXJhbSB7T2JqZWN0fSBvcHRpb25zIFVzZXIgc3BlY2lmaWVkIE1vbmdvIGNvbm5lY3Rpb24gb3B0aW9uc1xuICovXG5Nb25nby5zZXRDb25uZWN0aW9uT3B0aW9ucyA9IGZ1bmN0aW9uIHNldENvbm5lY3Rpb25PcHRpb25zIChvcHRpb25zKSB7XG4gIGNoZWNrKG9wdGlvbnMsIE9iamVjdCk7XG4gIE1vbmdvLl9jb25uZWN0aW9uT3B0aW9ucyA9IG9wdGlvbnM7XG59OyIsImV4cG9ydCBjb25zdCBub3JtYWxpemVQcm9qZWN0aW9uID0gb3B0aW9ucyA9PiB7XG4gIC8vIHRyYW5zZm9ybSBmaWVsZHMga2V5IGluIHByb2plY3Rpb25cbiAgY29uc3QgeyBmaWVsZHMsIHByb2plY3Rpb24sIC4uLm90aGVyT3B0aW9ucyB9ID0gb3B0aW9ucyB8fCB7fTtcbiAgLy8gVE9ETzogZW5hYmxlIHRoaXMgY29tbWVudCB3aGVuIGRlcHJlY2F0aW5nIHRoZSBmaWVsZHMgb3B0aW9uXG4gIC8vIExvZy5kZWJ1ZyhgZmllbGRzIG9wdGlvbiBoYXMgYmVlbiBkZXByZWNhdGVkLCBwbGVhc2UgdXNlIHRoZSBuZXcgJ3Byb2plY3Rpb24nIGluc3RlYWRgKVxuXG4gIHJldHVybiB7XG4gICAgLi4ub3RoZXJPcHRpb25zLFxuICAgIC4uLihwcm9qZWN0aW9uIHx8IGZpZWxkcyA/IHsgcHJvamVjdGlvbjogZmllbGRzIHx8IHByb2plY3Rpb24gfSA6IHt9KSxcbiAgfTtcbn07XG4iXX0=
