(function () {

/* Imports */
var Meteor = Package.meteor.Meteor;
var global = Package.meteor.global;
var meteorEnv = Package.meteor.meteorEnv;
var WebApp = Package.webapp.WebApp;
var WebAppInternals = Package.webapp.WebAppInternals;
var main = Package.webapp.main;
var check = Package.check.check;
var Match = Package.check.Match;
var ECMAScript = Package.ecmascript.ECMAScript;
var DDP = Package['ddp-client'].DDP;
var DDPServer = Package['ddp-server'].DDPServer;
var meteorInstall = Package.modules.meteorInstall;
var Promise = Package.promise.Promise;

/* Package-scope variables */
var Autoupdate;

var require = meteorInstall({"node_modules":{"meteor":{"autoupdate":{"autoupdate_server.js":function module(require,exports,module){

/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
//                                                                                                                     //
// packages/autoupdate/autoupdate_server.js                                                                            //
//                                                                                                                     //
/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
                                                                                                                       //
let _objectSpread;

module.link("@babel/runtime/helpers/objectSpread2", {
  default(v) {
    _objectSpread = v;
  }

}, 0);
module.export({
  Autoupdate: () => Autoupdate
});
let ClientVersions;
module.link("./client_versions.js", {
  ClientVersions(v) {
    ClientVersions = v;
  }

}, 0);
let onMessage;
module.link("meteor/inter-process-messaging", {
  onMessage(v) {
    onMessage = v;
  }

}, 1);

var Future = Npm.require("fibers/future");

const Autoupdate = __meteor_runtime_config__.autoupdate = {
  // Map from client architectures (web.browser, web.browser.legacy,
  // web.cordova) to version fields { version, versionRefreshable,
  // versionNonRefreshable, refreshable } that will be stored in
  // ClientVersions documents (whose IDs are client architectures). This
  // data gets serialized into the boilerplate because it's stored in
  // __meteor_runtime_config__.autoupdate.versions.
  versions: {}
};
// Stores acceptable client versions.
const clientVersions = new ClientVersions(); // The client hash includes __meteor_runtime_config__, so wait until
// all packages have loaded and have had a chance to populate the
// runtime config before using the client hash as our default auto
// update version id.
// Note: Tests allow people to override Autoupdate.autoupdateVersion before
// startup.

Autoupdate.autoupdateVersion = null;
Autoupdate.autoupdateVersionRefreshable = null;
Autoupdate.autoupdateVersionCordova = null;
Autoupdate.appId = __meteor_runtime_config__.appId = process.env.APP_ID;
var syncQueue = new Meteor._SynchronousQueue();

function updateVersions(shouldReloadClientProgram) {
  // Step 1: load the current client program on the server
  if (shouldReloadClientProgram) {
    WebAppInternals.reloadClientPrograms();
  }

  const {
    // If the AUTOUPDATE_VERSION environment variable is defined, it takes
    // precedence, but Autoupdate.autoupdateVersion is still supported as
    // a fallback. In most cases neither of these values will be defined.
    AUTOUPDATE_VERSION = Autoupdate.autoupdateVersion
  } = process.env; // Step 2: update __meteor_runtime_config__.autoupdate.versions.

  const clientArchs = Object.keys(WebApp.clientPrograms);
  clientArchs.forEach(arch => {
    Autoupdate.versions[arch] = {
      version: AUTOUPDATE_VERSION || WebApp.calculateClientHash(arch),
      versionRefreshable: AUTOUPDATE_VERSION || WebApp.calculateClientHashRefreshable(arch),
      versionNonRefreshable: AUTOUPDATE_VERSION || WebApp.calculateClientHashNonRefreshable(arch)
    };
  }); // Step 3: form the new client boilerplate which contains the updated
  // assets and __meteor_runtime_config__.

  if (shouldReloadClientProgram) {
    WebAppInternals.generateBoilerplate();
  } // Step 4: update the ClientVersions collection.
  // We use `onListening` here because we need to use
  // `WebApp.getRefreshableAssets`, which is only set after
  // `WebApp.generateBoilerplate` is called by `main` in webapp.


  WebApp.onListening(() => {
    clientArchs.forEach(arch => {
      const payload = _objectSpread({}, Autoupdate.versions[arch], {
        assets: WebApp.getRefreshableAssets(arch)
      });

      clientVersions.set(arch, payload);
    });
  });
}

Meteor.publish("meteor_autoupdate_clientVersions", function (appId) {
  // `null` happens when a client doesn't have an appId and passes
  // `undefined` to `Meteor.subscribe`. `undefined` is translated to
  // `null` as JSON doesn't have `undefined.
  check(appId, Match.OneOf(String, undefined, null)); // Don't notify clients using wrong appId such as mobile apps built with a
  // different server but pointing at the same local url

  if (Autoupdate.appId && appId && Autoupdate.appId !== appId) return [];
  const stop = clientVersions.watch((version, isNew) => {
    (isNew ? this.added : this.changed).call(this, "meteor_autoupdate_clientVersions", version._id, version);
  });
  this.onStop(() => stop());
  this.ready();
}, {
  is_auto: true
});
Meteor.startup(function () {
  updateVersions(false); // Force any connected clients that are still looking for these older
  // document IDs to reload.

  ["version", "version-refreshable", "version-cordova"].forEach(_id => {
    clientVersions.set(_id, {
      version: "outdated"
    });
  });
});
var fut = new Future(); // We only want 'refresh' to trigger 'updateVersions' AFTER onListen,
// so we add a queued task that waits for onListen before 'refresh' can queue
// tasks. Note that the `onListening` callbacks do not fire until after
// Meteor.startup, so there is no concern that the 'updateVersions' calls from
// 'refresh' will overlap with the `updateVersions` call from Meteor.startup.

syncQueue.queueTask(function () {
  fut.wait();
});
WebApp.onListening(function () {
  fut.return();
});

function enqueueVersionsRefresh() {
  syncQueue.queueTask(function () {
    updateVersions(true);
  });
} // Listen for messages pertaining to the client-refresh topic.


onMessage("client-refresh", enqueueVersionsRefresh); // Another way to tell the process to refresh: send SIGHUP signal

process.on('SIGHUP', Meteor.bindEnvironment(function () {
  enqueueVersionsRefresh();
}, "handling SIGHUP signal for refresh"));
/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

},"client_versions.js":function module(require,exports,module){

/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
//                                                                                                                     //
// packages/autoupdate/client_versions.js                                                                              //
//                                                                                                                     //
/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
                                                                                                                       //
let _objectSpread;

module.link("@babel/runtime/helpers/objectSpread2", {
  default(v) {
    _objectSpread = v;
  }

}, 0);
module.export({
  ClientVersions: () => ClientVersions
});
let Tracker;
module.link("meteor/tracker", {
  Tracker(v) {
    Tracker = v;
  }

}, 0);

class ClientVersions {
  constructor() {
    this._versions = new Map();
    this._watchCallbacks = new Set();
  } // Creates a Livedata store for use with `Meteor.connection.registerStore`.
  // After the store is registered, document updates reported by Livedata are
  // merged with the documents in this `ClientVersions` instance.


  createStore() {
    return {
      update: (_ref) => {
        let {
          id,
          msg,
          fields
        } = _ref;

        if (msg === "added" || msg === "changed") {
          this.set(id, fields);
        }
      }
    };
  }

  hasVersions() {
    return this._versions.size > 0;
  }

  get(id) {
    return this._versions.get(id);
  } // Adds or updates a version document and invokes registered callbacks for the
  // added/updated document. If a document with the given ID already exists, its
  // fields are merged with `fields`.


  set(id, fields) {
    let version = this._versions.get(id);

    let isNew = false;

    if (version) {
      Object.assign(version, fields);
    } else {
      version = _objectSpread({
        _id: id
      }, fields);
      isNew = true;

      this._versions.set(id, version);
    }

    this._watchCallbacks.forEach((_ref2) => {
      let {
        fn,
        filter
      } = _ref2;

      if (!filter || filter === version._id) {
        fn(version, isNew);
      }
    });
  } // Registers a callback that will be invoked when a version document is added
  // or changed. Calling the function returned by `watch` removes the callback.
  // If `skipInitial` is true, the callback isn't be invoked for existing
  // documents. If `filter` is set, the callback is only invoked for documents
  // with ID `filter`.


  watch(fn) {
    let {
      skipInitial,
      filter
    } = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : {};

    if (!skipInitial) {
      const resolved = Promise.resolve();

      this._versions.forEach(version => {
        if (!filter || filter === version._id) {
          resolved.then(() => fn(version, true));
        }
      });
    }

    const callback = {
      fn,
      filter
    };

    this._watchCallbacks.add(callback);

    return () => this._watchCallbacks.delete(callback);
  } // A reactive data source for `Autoupdate.newClientAvailable`.


  newClientAvailable(id, fields, currentVersion) {
    function isNewVersion(version) {
      return version._id === id && fields.some(field => version[field] !== currentVersion[field]);
    }

    const dependency = new Tracker.Dependency();
    const version = this.get(id);
    dependency.depend();
    const stop = this.watch(version => {
      if (isNewVersion(version)) {
        dependency.changed();
        stop();
      }
    }, {
      skipInitial: true
    });
    return !!version && isNewVersion(version);
  }

}
/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

}}}}},{
  "extensions": [
    ".js",
    ".json"
  ]
});

var exports = require("/node_modules/meteor/autoupdate/autoupdate_server.js");

/* Exports */
Package._define("autoupdate", exports, {
  Autoupdate: Autoupdate
});

})();

//# sourceURL=meteor://💻app/packages/autoupdate.js
//# sourceMappingURL=data:application/json;charset=utf8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIm1ldGVvcjovL/CfkrthcHAvcGFja2FnZXMvYXV0b3VwZGF0ZS9hdXRvdXBkYXRlX3NlcnZlci5qcyIsIm1ldGVvcjovL/CfkrthcHAvcGFja2FnZXMvYXV0b3VwZGF0ZS9jbGllbnRfdmVyc2lvbnMuanMiXSwibmFtZXMiOlsiX29iamVjdFNwcmVhZCIsIm1vZHVsZSIsImxpbmsiLCJkZWZhdWx0IiwidiIsImV4cG9ydCIsIkF1dG91cGRhdGUiLCJDbGllbnRWZXJzaW9ucyIsIm9uTWVzc2FnZSIsIkZ1dHVyZSIsIk5wbSIsInJlcXVpcmUiLCJfX21ldGVvcl9ydW50aW1lX2NvbmZpZ19fIiwiYXV0b3VwZGF0ZSIsInZlcnNpb25zIiwiY2xpZW50VmVyc2lvbnMiLCJhdXRvdXBkYXRlVmVyc2lvbiIsImF1dG91cGRhdGVWZXJzaW9uUmVmcmVzaGFibGUiLCJhdXRvdXBkYXRlVmVyc2lvbkNvcmRvdmEiLCJhcHBJZCIsInByb2Nlc3MiLCJlbnYiLCJBUFBfSUQiLCJzeW5jUXVldWUiLCJNZXRlb3IiLCJfU3luY2hyb25vdXNRdWV1ZSIsInVwZGF0ZVZlcnNpb25zIiwic2hvdWxkUmVsb2FkQ2xpZW50UHJvZ3JhbSIsIldlYkFwcEludGVybmFscyIsInJlbG9hZENsaWVudFByb2dyYW1zIiwiQVVUT1VQREFURV9WRVJTSU9OIiwiY2xpZW50QXJjaHMiLCJPYmplY3QiLCJrZXlzIiwiV2ViQXBwIiwiY2xpZW50UHJvZ3JhbXMiLCJmb3JFYWNoIiwiYXJjaCIsInZlcnNpb24iLCJjYWxjdWxhdGVDbGllbnRIYXNoIiwidmVyc2lvblJlZnJlc2hhYmxlIiwiY2FsY3VsYXRlQ2xpZW50SGFzaFJlZnJlc2hhYmxlIiwidmVyc2lvbk5vblJlZnJlc2hhYmxlIiwiY2FsY3VsYXRlQ2xpZW50SGFzaE5vblJlZnJlc2hhYmxlIiwiZ2VuZXJhdGVCb2lsZXJwbGF0ZSIsIm9uTGlzdGVuaW5nIiwicGF5bG9hZCIsImFzc2V0cyIsImdldFJlZnJlc2hhYmxlQXNzZXRzIiwic2V0IiwicHVibGlzaCIsImNoZWNrIiwiTWF0Y2giLCJPbmVPZiIsIlN0cmluZyIsInVuZGVmaW5lZCIsInN0b3AiLCJ3YXRjaCIsImlzTmV3IiwiYWRkZWQiLCJjaGFuZ2VkIiwiY2FsbCIsIl9pZCIsIm9uU3RvcCIsInJlYWR5IiwiaXNfYXV0byIsInN0YXJ0dXAiLCJmdXQiLCJxdWV1ZVRhc2siLCJ3YWl0IiwicmV0dXJuIiwiZW5xdWV1ZVZlcnNpb25zUmVmcmVzaCIsIm9uIiwiYmluZEVudmlyb25tZW50IiwiVHJhY2tlciIsImNvbnN0cnVjdG9yIiwiX3ZlcnNpb25zIiwiTWFwIiwiX3dhdGNoQ2FsbGJhY2tzIiwiU2V0IiwiY3JlYXRlU3RvcmUiLCJ1cGRhdGUiLCJpZCIsIm1zZyIsImZpZWxkcyIsImhhc1ZlcnNpb25zIiwic2l6ZSIsImdldCIsImFzc2lnbiIsImZuIiwiZmlsdGVyIiwic2tpcEluaXRpYWwiLCJyZXNvbHZlZCIsIlByb21pc2UiLCJyZXNvbHZlIiwidGhlbiIsImNhbGxiYWNrIiwiYWRkIiwiZGVsZXRlIiwibmV3Q2xpZW50QXZhaWxhYmxlIiwiY3VycmVudFZlcnNpb24iLCJpc05ld1ZlcnNpb24iLCJzb21lIiwiZmllbGQiLCJkZXBlbmRlbmN5IiwiRGVwZW5kZW5jeSIsImRlcGVuZCJdLCJtYXBwaW5ncyI6Ijs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7OztBQUFBLElBQUlBLGFBQUo7O0FBQWtCQyxNQUFNLENBQUNDLElBQVAsQ0FBWSxzQ0FBWixFQUFtRDtBQUFDQyxTQUFPLENBQUNDLENBQUQsRUFBRztBQUFDSixpQkFBYSxHQUFDSSxDQUFkO0FBQWdCOztBQUE1QixDQUFuRCxFQUFpRixDQUFqRjtBQUFsQkgsTUFBTSxDQUFDSSxNQUFQLENBQWM7QUFBQ0MsWUFBVSxFQUFDLE1BQUlBO0FBQWhCLENBQWQ7QUFBMkMsSUFBSUMsY0FBSjtBQUFtQk4sTUFBTSxDQUFDQyxJQUFQLENBQVksc0JBQVosRUFBbUM7QUFBQ0ssZ0JBQWMsQ0FBQ0gsQ0FBRCxFQUFHO0FB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O0FBQ3pCa0Usa0JBQVUsQ0FBQzVDLE9BQVg7QUFDQUosWUFBSTtBQUNMO0FBQ0YsS0FOVSxFQU9YO0FBQUVtQyxpQkFBVyxFQUFFO0FBQWYsS0FQVyxDQUFiO0FBVUEsV0FBTyxDQUFDLENBQUVyRCxPQUFILElBQWMrRCxZQUFZLENBQUMvRCxPQUFELENBQWpDO0FBQ0Q7O0FBcEd5QixDIiwiZmlsZSI6Ii9wYWNrYWdlcy9hdXRvdXBkYXRlLmpzIiwic291cmNlc0NvbnRlbnQiOlsiLy8gUHVibGlzaCB0aGUgY3VycmVudCBjbGllbnQgdmVyc2lvbnMgZm9yIGVhY2ggY2xpZW50IGFyY2hpdGVjdHVyZVxuLy8gKHdlYi5icm93c2VyLCB3ZWIuYnJvd3Nlci5sZWdhY3ksIHdlYi5jb3Jkb3ZhKS4gV2hlbiBhIGNsaWVudCBvYnNlcnZlc1xuLy8gYSBjaGFuZ2UgaW4gdGhlIHZlcnNpb25zIGFzc29jaWF0ZWQgd2l0aCBpdHMgY2xpZW50IGFyY2hpdGVjdHVyZSxcbi8vIGl0IHdpbGwgcmVmcmVzaCBpdHNlbGYsIGVpdGhlciBieSBzd2FwcGluZyBvdXQgQ1NTIGFzc2V0cyBvciBieVxuLy8gcmVsb2FkaW5nIHRoZSBwYWdlLlxuLy9cbi8vIFRoZXJlIGFyZSB0aHJlZSB2ZXJzaW9ucyBmb3IgYW55IGdpdmVuIGNsaWVudCBhcmNoaXRlY3R1cmU6IGB2ZXJzaW9uYCxcbi8vIGB2ZXJzaW9uUmVmcmVzaGFibGVgLCBhbmQgYHZlcnNpb25Ob25SZWZyZXNoYWJsZWAuIFRoZSByZWZyZXNoYWJsZVxuLy8gdmVyc2lvbiBpcyBhIGhhc2ggb2YganVzdCB0aGUgY2xpZW50IHJlc291cmNlcyB0aGF0IGFyZSByZWZyZXNoYWJsZSxcbi8vIHN1Y2ggYXMgQ1NTLCB3aGlsZSB0aGUgbm9uLXJlZnJlc2hhYmxlIHZlcnNpb24gaXMgYSBoYXNoIG9mIHRoZSByZXN0IG9mXG4vLyB0aGUgY2xpZW50IGFzc2V0cywgZXhjbHVkaW5nIHRoZSByZWZyZXNoYWJsZSBvbmVzOiBIVE1MLCBKUywgYW5kIHN0YXRpY1xuLy8gZmlsZXMgaW4gdGhlIGBwdWJsaWNgIGRpcmVjdG9yeS4gVGhlIGB2ZXJzaW9uYCB2ZXJzaW9uIGlzIGEgY29tYmluZWRcbi8vIGhhc2ggb2YgZXZlcnl0aGluZy5cbi8vXG4vLyBJZiB0aGUgZW52aXJvbm1lbnQgdmFyaWFibGUgYEFVVE9VUERBVEVfVkVSU0lPTmAgaXMgc2V0LCBpdCB3aWxsIGJlXG4vLyB1c2VkIGluIHBsYWNlIG9mIGFsbCBjbGllbnQgdmVyc2lvbnMuIFlvdSBjYW4gdXNlIHRoaXMgdmFyaWFibGUgdG9cbi8vIGNvbnRyb2wgd2hlbiB0aGUgY2xpZW50IHJlbG9hZHMuIEZvciBleGFtcGxlLCBpZiB5b3Ugd2FudCB0byBmb3JjZSBhXG4vLyByZWxvYWQgb25seSBhZnRlciBtYWpvciBjaGFuZ2VzLCB1c2UgYSBjdXN0b20gQVVUT1VQREFURV9WRVJTSU9OIGFuZFxuLy8gY2hhbmdlIGl0IG9ubHkgd2hlbiBzb21ldGhpbmcgd29ydGggcHVzaGluZyB0byBjbGllbnRzIGhhcHBlbnMuXG4vL1xuLy8gVGhlIHNlcnZlciBwdWJsaXNoZXMgYSBgbWV0ZW9yX2F1dG91cGRhdGVfY2xpZW50VmVyc2lvbnNgIGNvbGxlY3Rpb24uXG4vLyBUaGUgSUQgb2YgZWFjaCBkb2N1bWVudCBpcyB0aGUgY2xpZW50IGFyY2hpdGVjdHVyZSwgYW5kIHRoZSBmaWVsZHMgb2Zcbi8vIHRoZSBkb2N1bWVudCBhcmUgdGhlIHZlcnNpb25zIGRlc2NyaWJlZCBhYm92ZS5cblxuaW1wb3J0IHsgQ2xpZW50VmVyc2lvbnMgfSBmcm9tIFwiLi9jbGllbnRfdmVyc2lvbnMuanNcIjtcbnZhciBGdXR1cmUgPSBOcG0ucmVxdWlyZShcImZpYmVycy9mdXR1cmVcIik7XG5cbmV4cG9ydCBjb25zdCBBdXRvdXBkYXRlID0gX19tZXRlb3JfcnVudGltZV9jb25maWdfXy5hdXRvdXBkYXRlID0ge1xuICAvLyBNYXAgZnJvbSBjbGllbnQgYXJjaGl0ZWN0dXJlcyAod2ViLmJyb3dzZXIsIHdlYi5icm93c2VyLmxlZ2FjeSxcbiAgLy8gd2ViLmNvcmRvdmEpIHRvIHZlcnNpb24gZmllbGRzIHsgdmVyc2lvbiwgdmVyc2lvblJlZnJlc2hhYmxlLFxuICAvLyB2ZXJzaW9uTm9uUmVmcmVzaGFibGUsIHJlZnJlc2hhYmxlIH0gdGhhdCB3aWxsIGJlIHN0b3JlZCBpblxuICAvLyBDbGllbnRWZXJzaW9ucyBkb2N1bWVudHMgKHdob3NlIElEcyBhcmUgY2xpZW50IGFyY2hpdGVjdHVyZXMpLiBUaGlzXG4gIC8vIGRhdGEgZ2V0cyBzZXJpYWxpemVkIGludG8gdGhlIGJvaWxlcnBsYXRlIGJlY2F1c2UgaXQncyBzdG9yZWQgaW5cbiAgLy8gX19tZXRlb3JfcnVudGltZV9jb25maWdfXy5hdXRvdXBkYXRlLnZlcnNpb25zLlxuICB2ZXJzaW9uczoge31cbn07XG5cbi8vIFN0b3JlcyBhY2NlcHRhYmxlIGNsaWVudCB2ZXJzaW9ucy5cbmNvbnN0IGNsaWVudFZlcnNpb25zID0gbmV3IENsaWVudFZlcnNpb25zKCk7XG5cbi8vIFRoZSBjbGllbnQgaGFzaCBpbmNsdWRlcyBfX21ldGVvcl9ydW50aW1lX2NvbmZpZ19fLCBzbyB3YWl0IHVudGlsXG4vLyBhbGwgcGFja2FnZXMgaGF2ZSBsb2FkZWQgYW5kIGhhdmUgaGFkIGEgY2hhbmNlIHRvIHBvcHVsYXRlIHRoZVxuLy8gcnVudGltZSBjb25maWcgYmVmb3JlIHVzaW5nIHRoZSBjbGllbnQgaGFzaCBhcyBvdXIgZGVmYXVsdCBhdXRvXG4vLyB1cGRhdGUgdmVyc2lvbiBpZC5cblxuLy8gTm90ZTogVGVzdHMgYWxsb3cgcGVvcGxlIHRvIG92ZXJyaWRlIEF1dG91cGRhdGUuYXV0b3VwZGF0ZVZlcnNpb24gYmVmb3JlXG4vLyBzdGFydHVwLlxuQXV0b3VwZGF0ZS5hdXRvdXBkYXRlVmVyc2lvbiA9IG51bGw7XG5BdXRvdXBkYXRlLmF1dG91cGRhdGVWZXJzaW9uUmVmcmVzaGFibGUgPSBudWxsO1xuQXV0b3VwZGF0ZS5hdXRvdXBkYXRlVmVyc2lvbkNvcmRvdmEgPSBudWxsO1xuQXV0b3VwZGF0ZS5hcHBJZCA9IF9fbWV0ZW9yX3J1bnRpbWVfY29uZmlnX18uYXBwSWQgPSBwcm9jZXNzLmVudi5BUFBfSUQ7XG5cbnZhciBzeW5jUXVldWUgPSBuZXcgTWV0ZW9yLl9TeW5jaHJvbm91c1F1ZXVlKCk7XG5cbmZ1bmN0aW9uIHVwZGF0ZVZlcnNpb25zKHNob3VsZFJlbG9hZENsaWVudFByb2dyYW0pIHtcbiAgLy8gU3RlcCAxOiBsb2FkIHRoZSBjdXJyZW50IGNsaWVudCBwcm9ncmFtIG9uIHRoZSBzZXJ2ZXJcbiAgaWYgKHNob3VsZFJlbG9hZENsaWVudFByb2dyYW0pIHtcbiAgICBXZWJBcHBJbnRlcm5hbHMucmVsb2FkQ2xpZW50UHJvZ3JhbXMoKTtcbiAgfVxuXG4gIGNvbnN0IHtcbiAgICAvLyBJZiB0aGUgQVVUT1VQREFURV9WRVJTSU9OIGVudmlyb25tZW50IHZhcmlhYmxlIGlzIGRlZmluZWQsIGl0IHRha2VzXG4gICAgLy8gcHJlY2VkZW5jZSwgYnV0IEF1dG91cGRhdGUuYXV0b3VwZGF0ZVZlcnNpb24gaXMgc3RpbGwgc3VwcG9ydGVkIGFzXG4gICAgLy8gYSBmYWxsYmFjay4gSW4gbW9zdCBjYXNlcyBuZWl0aGVyIG9mIHRoZXNlIHZhbHVlcyB3aWxsIGJlIGRlZmluZWQuXG4gICAgQVVUT1VQREFURV9WRVJTSU9OID0gQXV0b3VwZGF0ZS5hdXRvdXBkYXRlVmVyc2lvblxuICB9ID0gcHJvY2Vzcy5lbnY7XG5cbiAgLy8gU3RlcCAyOiB1cGRhdGUgX19tZXRlb3JfcnVudGltZV9jb25maWdfXy5hdXRvdXBkYXRlLnZlcnNpb25zLlxuICBjb25zdCBjbGllbnRBcmNocyA9IE9iamVjdC5rZXlzKFdlYkFwcC5jbGllbnRQcm9ncmFtcyk7XG4gIGNsaWVudEFyY2hzLmZvckVhY2goYXJjaCA9PiB7XG4gICAgQXV0b3VwZGF0ZS52ZXJzaW9uc1thcmNoXSA9IHtcbiAgICAgIHZlcnNpb246IEFVVE9VUERBVEVfVkVSU0lPTiB8fFxuICAgICAgICBXZWJBcHAuY2FsY3VsYXRlQ2xpZW50SGFzaChhcmNoKSxcbiAgICAgIHZlcnNpb25SZWZyZXNoYWJsZTogQVVUT1VQREFURV9WRVJTSU9OIHx8XG4gICAgICAgIFdlYkFwcC5jYWxjdWxhdGVDbGllbnRIYXNoUmVmcmVzaGFibGUoYXJjaCksXG4gICAgICB2ZXJzaW9uTm9uUmVmcmVzaGFibGU6IEFVVE9VUERBVEVfVkVSU0lPTiB8fFxuICAgICAgICBXZWJBcHAuY2FsY3VsYXRlQ2xpZW50SGFzaE5vblJlZnJlc2hhYmxlKGFyY2gpLFxuICAgIH07XG4gIH0pO1xuXG4gIC8vIFN0ZXAgMzogZm9ybSB0aGUgbmV3IGNsaWVudCBib2lsZXJwbGF0ZSB3aGljaCBjb250YWlucyB0aGUgdXBkYXRlZFxuICAvLyBhc3NldHMgYW5kIF9fbWV0ZW9yX3J1bnRpbWVfY29uZmlnX18uXG4gIGlmIChzaG91bGRSZWxvYWRDbGllbnRQcm9ncmFtKSB7XG4gICAgV2ViQXBwSW50ZXJuYWxzLmdlbmVyYXRlQm9pbGVycGxhdGUoKTtcbiAgfVxuXG4gIC8vIFN0ZXAgNDogdXBkYXRlIHRoZSBDbGllbnRWZXJzaW9ucyBjb2xsZWN0aW9uLlxuICAvLyBXZSB1c2UgYG9uTGlzdGVuaW5nYCBoZXJlIGJlY2F1c2Ugd2UgbmVlZCB0byB1c2VcbiAgLy8gYFdlYkFwcC5nZXRSZWZyZXNoYWJsZUFzc2V0c2AsIHdoaWNoIGlzIG9ubHkgc2V0IGFmdGVyXG4gIC8vIGBXZWJBcHAuZ2VuZXJhdGVCb2lsZXJwbGF0ZWAgaXMgY2FsbGVkIGJ5IGBtYWluYCBpbiB3ZWJhcHAuXG4gIFdlYkFwcC5vbkxpc3RlbmluZygoKSA9PiB7XG4gICAgY2xpZW50QXJjaHMuZm9yRWFjaChhcmNoID0+IHtcbiAgICAgIGNvbnN0IHBheWxvYWQgPSB7XG4gICAgICAgIC4uLkF1dG91cGRhdGUudmVyc2lvbnNbYXJjaF0sXG4gICAgICAgIGFzc2V0czogV2ViQXBwLmdldFJlZnJlc2hhYmxlQXNzZXRzKGFyY2gpLFxuICAgICAgfTtcblxuICAgICAgY2xpZW50VmVyc2lvbnMuc2V0KGFyY2gsIHBheWxvYWQpO1xuICAgIH0pO1xuICB9KTtcbn1cblxuTWV0ZW9yLnB1Ymxpc2goXG4gIFwibWV0ZW9yX2F1dG91cGRhdGVfY2xpZW50VmVyc2lvbnNcIixcbiAgZnVuY3Rpb24gKGFwcElkKSB7XG4gICAgLy8gYG51bGxgIGhhcHBlbnMgd2hlbiBhIGNsaWVudCBkb2Vzbid0IGhhdmUgYW4gYXBwSWQgYW5kIHBhc3Nlc1xuICAgIC8vIGB1bmRlZmluZWRgIHRvIGBNZXRlb3Iuc3Vic2NyaWJlYC4gYHVuZGVmaW5lZGAgaXMgdHJhbnNsYXRlZCB0b1xuICAgIC8vIGBudWxsYCBhcyBKU09OIGRvZXNuJ3QgaGF2ZSBgdW5kZWZpbmVkLlxuICAgIGNoZWNrKGFwcElkLCBNYXRjaC5PbmVPZihTdHJpbmcsIHVuZGVmaW5lZCwgbnVsbCkpO1xuXG4gICAgLy8gRG9uJ3Qgbm90aWZ5IGNsaWVudHMgdXNpbmcgd3JvbmcgYXBwSWQgc3VjaCBhcyBtb2JpbGUgYXBwcyBidWlsdCB3aXRoIGFcbiAgICAvLyBkaWZmZXJlbnQgc2VydmVyIGJ1dCBwb2ludGluZyBhdCB0aGUgc2FtZSBsb2NhbCB1cmxcbiAgICBpZiAoQXV0b3VwZGF0ZS5hcHBJZCAmJiBhcHBJZCAmJiBBdXRvdXBkYXRlLmFwcElkICE9PSBhcHBJZClcbiAgICAgIHJldHVybiBbXTtcblxuICAgIGNvbnN0IHN0b3AgPSBjbGllbnRWZXJzaW9ucy53YXRjaCgodmVyc2lvbiwgaXNOZXcpID0+IHtcbiAgICAgIChpc05ldyA/IHRoaXMuYWRkZWQgOiB0aGlzLmNoYW5nZWQpXG4gICAgICAgIC5jYWxsKHRoaXMsIFwibWV0ZW9yX2F1dG91cGRhdGVfY2xpZW50VmVyc2lvbnNcIiwgdmVyc2lvbi5faWQsIHZlcnNpb24pO1xuICAgIH0pO1xuXG4gICAgdGhpcy5vblN0b3AoKCkgPT4gc3RvcCgpKTtcbiAgICB0aGlzLnJlYWR5KCk7XG4gIH0sXG4gIHtpc19hdXRvOiB0cnVlfVxuKTtcblxuTWV0ZW9yLnN0YXJ0dXAoZnVuY3Rpb24gKCkge1xuICB1cGRhdGVWZXJzaW9ucyhmYWxzZSk7XG5cbiAgLy8gRm9yY2UgYW55IGNvbm5lY3RlZCBjbGllbnRzIHRoYXQgYXJlIHN0aWxsIGxvb2tpbmcgZm9yIHRoZXNlIG9sZGVyXG4gIC8vIGRvY3VtZW50IElEcyB0byByZWxvYWQuXG4gIFtcInZlcnNpb25cIixcbiAgIFwidmVyc2lvbi1yZWZyZXNoYWJsZVwiLFxuICAgXCJ2ZXJzaW9uLWNvcmRvdmFcIixcbiAgXS5mb3JFYWNoKF9pZCA9PiB7XG4gICAgY2xpZW50VmVyc2lvbnMuc2V0KF9pZCwge1xuICAgICAgdmVyc2lvbjogXCJvdXRkYXRlZFwiXG4gICAgfSk7XG4gIH0pO1xufSk7XG5cbnZhciBmdXQgPSBuZXcgRnV0dXJlKCk7XG5cbi8vIFdlIG9ubHkgd2FudCAncmVmcmVzaCcgdG8gdHJpZ2dlciAndXBkYXRlVmVyc2lvbnMnIEFGVEVSIG9uTGlzdGVuLFxuLy8gc28gd2UgYWRkIGEgcXVldWVkIHRhc2sgdGhhdCB3YWl0cyBmb3Igb25MaXN0ZW4gYmVmb3JlICdyZWZyZXNoJyBjYW4gcXVldWVcbi8vIHRhc2tzLiBOb3RlIHRoYXQgdGhlIGBvbkxpc3RlbmluZ2AgY2FsbGJhY2tzIGRvIG5vdCBmaXJlIHVudGlsIGFmdGVyXG4vLyBNZXRlb3Iuc3RhcnR1cCwgc28gdGhlcmUgaXMgbm8gY29uY2VybiB0aGF0IHRoZSAndXBkYXRlVmVyc2lvbnMnIGNhbGxzIGZyb21cbi8vICdyZWZyZXNoJyB3aWxsIG92ZXJsYXAgd2l0aCB0aGUgYHVwZGF0ZVZlcnNpb25zYCBjYWxsIGZyb20gTWV0ZW9yLnN0YXJ0dXAuXG5cbnN5bmNRdWV1ZS5xdWV1ZVRhc2soZnVuY3Rpb24gKCkge1xuICBmdXQud2FpdCgpO1xufSk7XG5cbldlYkFwcC5vbkxpc3RlbmluZyhmdW5jdGlvbiAoKSB7XG4gIGZ1dC5yZXR1cm4oKTtcbn0pO1xuXG5mdW5jdGlvbiBlbnF1ZXVlVmVyc2lvbnNSZWZyZXNoKCkge1xuICBzeW5jUXVldWUucXVldWVUYXNrKGZ1bmN0aW9uICgpIHtcbiAgICB1cGRhdGVWZXJzaW9ucyh0cnVlKTtcbiAgfSk7XG59XG5cbi8vIExpc3RlbiBmb3IgbWVzc2FnZXMgcGVydGFpbmluZyB0byB0aGUgY2xpZW50LXJlZnJlc2ggdG9waWMuXG5pbXBvcnQgeyBvbk1lc3NhZ2UgfSBmcm9tIFwibWV0ZW9yL2ludGVyLXByb2Nlc3MtbWVzc2FnaW5nXCI7XG5vbk1lc3NhZ2UoXCJjbGllbnQtcmVmcmVzaFwiLCBlbnF1ZXVlVmVyc2lvbnNSZWZyZXNoKTtcblxuLy8gQW5vdGhlciB3YXkgdG8gdGVsbCB0aGUgcHJvY2VzcyB0byByZWZyZXNoOiBzZW5kIFNJR0hVUCBzaWduYWxcbnByb2Nlc3Mub24oJ1NJR0hVUCcsIE1ldGVvci5iaW5kRW52aXJvbm1lbnQoZnVuY3Rpb24gKCkge1xuICBlbnF1ZXVlVmVyc2lvbnNSZWZyZXNoKCk7XG59LCBcImhhbmRsaW5nIFNJR0hVUCBzaWduYWwgZm9yIHJlZnJlc2hcIikpO1xuIiwiaW1wb3J0IHsgVHJhY2tlciB9IGZyb20gXCJtZXRlb3IvdHJhY2tlclwiO1xuXG5leHBvcnQgY2xhc3MgQ2xpZW50VmVyc2lvbnMge1xuICBjb25zdHJ1Y3RvcigpIHtcbiAgICB0aGlzLl92ZXJzaW9ucyA9IG5ldyBNYXAoKTtcbiAgICB0aGlzLl93YXRjaENhbGxiYWNrcyA9IG5ldyBTZXQoKTtcbiAgfVxuXG4gIC8vIENyZWF0ZXMgYSBMaXZlZGF0YSBzdG9yZSBmb3IgdXNlIHdpdGggYE1ldGVvci5jb25uZWN0aW9uLnJlZ2lzdGVyU3RvcmVgLlxuICAvLyBBZnRlciB0aGUgc3RvcmUgaXMgcmVnaXN0ZXJlZCwgZG9jdW1lbnQgdXBkYXRlcyByZXBvcnRlZCBieSBMaXZlZGF0YSBhcmVcbiAgLy8gbWVyZ2VkIHdpdGggdGhlIGRvY3VtZW50cyBpbiB0aGlzIGBDbGllbnRWZXJzaW9uc2AgaW5zdGFuY2UuXG4gIGNyZWF0ZVN0b3JlKCkge1xuICAgIHJldHVybiB7XG4gICAgICB1cGRhdGU6ICh7IGlkLCBtc2csIGZpZWxkcyB9KSA9PiB7XG4gICAgICAgIGlmIChtc2cgPT09IFwiYWRkZWRcIiB8fCBtc2cgPT09IFwiY2hhbmdlZFwiKSB7XG4gICAgICAgICAgdGhpcy5zZXQoaWQsIGZpZWxkcyk7XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9O1xuICB9XG5cbiAgaGFzVmVyc2lvbnMoKSB7XG4gICAgcmV0dXJuIHRoaXMuX3ZlcnNpb25zLnNpemUgPiAwO1xuICB9XG5cbiAgZ2V0KGlkKSB7XG4gICAgcmV0dXJuIHRoaXMuX3ZlcnNpb25zLmdldChpZCk7XG4gIH1cblxuICAvLyBBZGRzIG9yIHVwZGF0ZXMgYSB2ZXJzaW9uIGRvY3VtZW50IGFuZCBpbnZva2VzIHJlZ2lzdGVyZWQgY2FsbGJhY2tzIGZvciB0aGVcbiAgLy8gYWRkZWQvdXBkYXRlZCBkb2N1bWVudC4gSWYgYSBkb2N1bWVudCB3aXRoIHRoZSBnaXZlbiBJRCBhbHJlYWR5IGV4aXN0cywgaXRzXG4gIC8vIGZpZWxkcyBhcmUgbWVyZ2VkIHdpdGggYGZpZWxkc2AuXG4gIHNldChpZCwgZmllbGRzKSB7XG4gICAgbGV0IHZlcnNpb24gPSB0aGlzLl92ZXJzaW9ucy5nZXQoaWQpO1xuICAgIGxldCBpc05ldyA9IGZhbHNlO1xuXG4gICAgaWYgKHZlcnNpb24pIHtcbiAgICAgIE9iamVjdC5hc3NpZ24odmVyc2lvbiwgZmllbGRzKTtcbiAgICB9IGVsc2Uge1xuICAgICAgdmVyc2lvbiA9IHtcbiAgICAgICAgX2lkOiBpZCxcbiAgICAgICAgLi4uZmllbGRzXG4gICAgICB9O1xuXG4gICAgICBpc05ldyA9IHRydWU7XG4gICAgICB0aGlzLl92ZXJzaW9ucy5zZXQoaWQsIHZlcnNpb24pO1xuICAgIH1cblxuICAgIHRoaXMuX3dhdGNoQ2FsbGJhY2tzLmZvckVhY2goKHsgZm4sIGZpbHRlciB9KSA9PiB7XG4gICAgICBpZiAoISBmaWx0ZXIgfHwgZmlsdGVyID09PSB2ZXJzaW9uLl9pZCkge1xuICAgICAgICBmbih2ZXJzaW9uLCBpc05ldyk7XG4gICAgICB9XG4gICAgfSk7XG4gIH1cblxuICAvLyBSZWdpc3RlcnMgYSBjYWxsYmFjayB0aGF0IHdpbGwgYmUgaW52b2tlZCB3aGVuIGEgdmVyc2lvbiBkb2N1bWVudCBpcyBhZGRlZFxuICAvLyBvciBjaGFuZ2VkLiBDYWxsaW5nIHRoZSBmdW5jdGlvbiByZXR1cm5lZCBieSBgd2F0Y2hgIHJlbW92ZXMgdGhlIGNhbGxiYWNrLlxuICAvLyBJZiBgc2tpcEluaXRpYWxgIGlzIHRydWUsIHRoZSBjYWxsYmFjayBpc24ndCBiZSBpbnZva2VkIGZvciBleGlzdGluZ1xuICAvLyBkb2N1bWVudHMuIElmIGBmaWx0ZXJgIGlzIHNldCwgdGhlIGNhbGxiYWNrIGlzIG9ubHkgaW52b2tlZCBmb3IgZG9jdW1lbnRzXG4gIC8vIHdpdGggSUQgYGZpbHRlcmAuXG4gIHdhdGNoKGZuLCB7IHNraXBJbml0aWFsLCBmaWx0ZXIgfSA9IHt9KSB7XG4gICAgaWYgKCEgc2tpcEluaXRpYWwpIHtcbiAgICAgIGNvbnN0IHJlc29sdmVkID0gUHJvbWlzZS5yZXNvbHZlKCk7XG5cbiAgICAgIHRoaXMuX3ZlcnNpb25zLmZvckVhY2goKHZlcnNpb24pID0+IHtcbiAgICAgICAgaWYgKCEgZmlsdGVyIHx8IGZpbHRlciA9PT0gdmVyc2lvbi5faWQpIHtcbiAgICAgICAgICByZXNvbHZlZC50aGVuKCgpID0+IGZuKHZlcnNpb24sIHRydWUpKTtcbiAgICAgICAgfVxuICAgICAgfSk7XG4gICAgfVxuXG4gICAgY29uc3QgY2FsbGJhY2sgPSB7IGZuLCBmaWx0ZXIgfTtcbiAgICB0aGlzLl93YXRjaENhbGxiYWNrcy5hZGQoY2FsbGJhY2spO1xuXG4gICAgcmV0dXJuICgpID0+IHRoaXMuX3dhdGNoQ2FsbGJhY2tzLmRlbGV0ZShjYWxsYmFjayk7XG4gIH1cblxuICAvLyBBIHJlYWN0aXZlIGRhdGEgc291cmNlIGZvciBgQXV0b3VwZGF0ZS5uZXdDbGllbnRBdmFpbGFibGVgLlxuICBuZXdDbGllbnRBdmFpbGFibGUoaWQsIGZpZWxkcywgY3VycmVudFZlcnNpb24pIHtcbiAgICBmdW5jdGlvbiBpc05ld1ZlcnNpb24odmVyc2lvbikge1xuICAgICAgcmV0dXJuIChcbiAgICAgICAgdmVyc2lvbi5faWQgPT09IGlkICYmXG4gICAgICAgIGZpZWxkcy5zb21lKChmaWVsZCkgPT4gdmVyc2lvbltmaWVsZF0gIT09IGN1cnJlbnRWZXJzaW9uW2ZpZWxkXSlcbiAgICAgICk7XG4gICAgfVxuXG4gICAgY29uc3QgZGVwZW5kZW5jeSA9IG5ldyBUcmFja2VyLkRlcGVuZGVuY3koKTtcbiAgICBjb25zdCB2ZXJzaW9uID0gdGhpcy5nZXQoaWQpO1xuXG4gICAgZGVwZW5kZW5jeS5kZXBlbmQoKTtcblxuICAgIGNvbnN0IHN0b3AgPSB0aGlzLndhdGNoKFxuICAgICAgKHZlcnNpb24pID0+IHtcbiAgICAgICAgaWYgKGlzTmV3VmVyc2lvbih2ZXJzaW9uKSkge1xuICAgICAgICAgIGRlcGVuZGVuY3kuY2hhbmdlZCgpO1xuICAgICAgICAgIHN0b3AoKTtcbiAgICAgICAgfVxuICAgICAgfSxcbiAgICAgIHsgc2tpcEluaXRpYWw6IHRydWUgfVxuICAgICk7XG5cbiAgICByZXR1cm4gISEgdmVyc2lvbiAmJiBpc05ld1ZlcnNpb24odmVyc2lvbik7XG4gIH1cbn1cbiJdfQ==
