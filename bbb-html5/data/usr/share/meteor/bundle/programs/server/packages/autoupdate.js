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

//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
//                                                                                                                  //
// packages/autoupdate/autoupdate_server.js                                                                         //
//                                                                                                                  //
//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
                                                                                                                    //
!function (module1) {
  let _objectSpread;

  module1.link("@babel/runtime/helpers/objectSpread2", {
    default(v) {
      _objectSpread = v;
    }

  }, 0);
  module1.export({
    Autoupdate: () => Autoupdate
  });
  let ClientVersions;
  module1.link("./client_versions.js", {
    ClientVersions(v) {
      ClientVersions = v;
    }

  }, 0);
  let onMessage;
  module1.link("meteor/inter-process-messaging", {
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
        versionNonRefreshable: AUTOUPDATE_VERSION || WebApp.calculateClientHashNonRefreshable(arch),
        versionReplaceable: AUTOUPDATE_VERSION || WebApp.calculateClientHashReplaceable(arch)
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
        const payload = _objectSpread(_objectSpread({}, Autoupdate.versions[arch]), {}, {
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
}.call(this, module);
//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

},"client_versions.js":function module(require,exports,module){

//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
//                                                                                                                  //
// packages/autoupdate/client_versions.js                                                                           //
//                                                                                                                  //
//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
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
      update: _ref => {
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

    this._watchCallbacks.forEach(_ref2 => {
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
//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

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
//# sourceMappingURL=data:application/json;charset=utf8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIm1ldGVvcjovL/CfkrthcHAvcGFja2FnZXMvYXV0b3VwZGF0ZS9hdXRvdXBkYXRlX3NlcnZlci5qcyIsIm1ldGVvcjovL/CfkrthcHAvcGFja2FnZXMvYXV0b3VwZGF0ZS9jbGllbnRfdmVyc2lvbnMuanMiXSwibmFtZXMiOlsiX29iamVjdFNwcmVhZCIsIm1vZHVsZTEiLCJsaW5rIiwiZGVmYXVsdCIsInYiLCJleHBvcnQiLCJBdXRvdXBkYXRlIiwiQ2xpZW50VmVyc2lvbnMiLCJvbk1lc3NhZ2UiLCJGdXR1cmUiLCJOcG0iLCJyZXF1aXJlIiwiX19tZXRlb3JfcnVudGltZV9jb25maWdfXyIsImF1dG91cGRhdGUiLCJ2ZXJzaW9ucyIsImNsaWVudFZlcnNpb25zIiwiYXV0b3VwZGF0ZVZlcnNpb24iLCJhdXRvdXBkYXRlVmVyc2lvblJlZnJlc2hhYmxlIiwiYXV0b3VwZGF0ZVZlcnNpb25Db3Jkb3ZhIiwiYXBwSWQiLCJwcm9jZXNzIiwiZW52IiwiQVBQX0lEIiwic3luY1F1ZXVlIiwiTWV0ZW9yIiwiX1N5bmNocm9ub3VzUXVldWUiLCJ1cGRhdGVWZXJzaW9ucyIsInNob3VsZFJlbG9hZENsaWVudFByb2dyYW0iLCJXZWJBcHBJbnRlcm5hbHMiLCJyZWxvYWRDbGllbnRQcm9ncmFtcyIsIkFVVE9VUERBVEVfVkVSU0lPTiIsImNsaWVudEFyY2hzIiwiT2JqZWN0Iiwia2V5cyIsIldlYkFwcCIsImNsaWVudFByb2dyYW1zIiwiZm9yRWFjaCIsImFyY2giLCJ2ZXJzaW9uIiwiY2FsY3VsYXRlQ2xpZW50SGFzaCIsInZlcnNpb25SZWZyZXNoYWJsZSIsImNhbGN1bGF0ZUNsaWVudEhhc2hSZWZyZXNoYWJsZSIsInZlcnNpb25Ob25SZWZyZXNoYWJsZSIsImNhbGN1bGF0ZUNsaWVudEhhc2hOb25SZWZyZXNoYWJsZSIsInZlcnNpb25SZXBsYWNlYWJsZSIsImNhbGN1bGF0ZUNsaWVudEhhc2hSZXBsYWNlYWJsZSIsImdlbmVyYXRlQm9pbGVycGxhdGUiLCJvbkxpc3RlbmluZyIsInBheWxvYWQiLCJhc3NldHMiLCJnZXRSZWZyZXNoYWJsZUFzc2V0cyIsInNldCIsInB1Ymxpc2giLCJjaGVjayIsIk1hdGNoIiwiT25lT2YiLCJTdHJpbmciLCJ1bmRlZmluZWQiLCJzdG9wIiwid2F0Y2giLCJpc05ldyIsImFkZGVkIiwiY2hhbmdlZCIsImNhbGwiLCJfaWQiLCJvblN0b3AiLCJyZWFkeSIsImlzX2F1dG8iLCJzdGFydHVwIiwiZnV0IiwicXVldWVUYXNrIiwid2FpdCIsInJldHVybiIsImVucXVldWVWZXJzaW9uc1JlZnJlc2giLCJvbiIsImJpbmRFbnZpcm9ubWVudCIsIm1vZHVsZSIsIlRyYWNrZXIiLCJjb25zdHJ1Y3RvciIsIl92ZXJzaW9ucyIsIk1hcCIsIl93YXRjaENhbGxiYWNrcyIsIlNldCIsImNyZWF0ZVN0b3JlIiwidXBkYXRlIiwiaWQiLCJtc2ciLCJmaWVsZHMiLCJoYXNWZXJzaW9ucyIsInNpemUiLCJnZXQiLCJhc3NpZ24iLCJmbiIsImZpbHRlciIsInNraXBJbml0aWFsIiwicmVzb2x2ZWQiLCJQcm9taXNlIiwicmVzb2x2ZSIsInRoZW4iLCJjYWxsYmFjayIsImFkZCIsImRlbGV0ZSIsIm5ld0NsaWVudEF2YWlsYWJsZSIsImN1cnJlbnRWZXJzaW9uIiwiaXNOZXdWZXJzaW9uIiwic29tZSIsImZpZWxkIiwiZGVwZW5kZW5jeSIsIkRlcGVuZGVuY3kiLCJkZXBlbmQiXSwibWFwcGluZ3MiOiI7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7O0FBQUEsTUFBSUEsYUFBSjs7QUFBa0JDLFNBQU8sQ0FBQ0MsSUFBUixDQUFhLHNDQUFiLEVBQW9EO0FBQUNDLFdBQU8sQ0FBQ0MsQ0FBRCxFQUFHO0FBQUNKLG1CQUFhLEdBQUNJLENBQWQ7QUFBZ0I7O0FBQTVCLEdBQXBELEVBQWtGLENBQWxGO0FBQWxCSCxTQUFPLENBQUNJLE1BQVIsQ0FBZTtBQUFDQyxjQUFVLEVBQUMsTUFBSUE7QUFBaEIsR0FBZjtBQUE0QyxNQUFJQyxjQUFKO0FBQW1C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LEtBQUtvRCxHQUFMLENBQVNMLEVBQVQsQ0FBaEI7QUFFQXNCLGNBQVUsQ0FBQ0UsTUFBWDtBQUVBLFVBQU1uRCxJQUFJLEdBQUcsS0FBS0MsS0FBTCxDQUNWckIsT0FBRCxJQUFhO0FBQ1gsVUFBSWtFLFlBQVksQ0FBQ2xFLE9BQUQsQ0FBaEIsRUFBMkI7QUFDekJxRSxrQkFBVSxDQUFDN0MsT0FBWDtBQUNBSixZQUFJO0FBQ0w7QUFDRixLQU5VLEVBT1g7QUFBRW9DLGlCQUFXLEVBQUU7QUFBZixLQVBXLENBQWI7QUFVQSxXQUFPLENBQUMsQ0FBRXhELE9BQUgsSUFBY2tFLFlBQVksQ0FBQ2xFLE9BQUQsQ0FBakM7QUFDRDs7QUFwR3lCLEMiLCJmaWxlIjoiL3BhY2thZ2VzL2F1dG91cGRhdGUuanMiLCJzb3VyY2VzQ29udGVudCI6WyIvLyBQdWJsaXNoIHRoZSBjdXJyZW50IGNsaWVudCB2ZXJzaW9ucyBmb3IgZWFjaCBjbGllbnQgYXJjaGl0ZWN0dXJlXG4vLyAod2ViLmJyb3dzZXIsIHdlYi5icm93c2VyLmxlZ2FjeSwgd2ViLmNvcmRvdmEpLiBXaGVuIGEgY2xpZW50IG9ic2VydmVzXG4vLyBhIGNoYW5nZSBpbiB0aGUgdmVyc2lvbnMgYXNzb2NpYXRlZCB3aXRoIGl0cyBjbGllbnQgYXJjaGl0ZWN0dXJlLFxuLy8gaXQgd2lsbCByZWZyZXNoIGl0c2VsZiwgZWl0aGVyIGJ5IHN3YXBwaW5nIG91dCBDU1MgYXNzZXRzIG9yIGJ5XG4vLyByZWxvYWRpbmcgdGhlIHBhZ2UuIENoYW5nZXMgdG8gdGhlIHJlcGxhY2VhYmxlIHZlcnNpb24gYXJlIGlnbm9yZWRcbi8vIGFuZCBoYW5kbGVkIGJ5IHRoZSBob3QtbW9kdWxlLXJlcGxhY2VtZW50IHBhY2thZ2UuXG4vL1xuLy8gVGhlcmUgYXJlIGZvdXIgdmVyc2lvbnMgZm9yIGFueSBnaXZlbiBjbGllbnQgYXJjaGl0ZWN0dXJlOiBgdmVyc2lvbmAsXG4vLyBgdmVyc2lvblJlZnJlc2hhYmxlYCwgYHZlcnNpb25Ob25SZWZyZXNoYWJsZWAsIGFuZFxuLy8gYHZlcnNpb25SZXBsYWNlYWJsZWAuIFRoZSByZWZyZXNoYWJsZSB2ZXJzaW9uIGlzIGEgaGFzaCBvZiBqdXN0IHRoZVxuLy8gY2xpZW50IHJlc291cmNlcyB0aGF0IGFyZSByZWZyZXNoYWJsZSwgc3VjaCBhcyBDU1MuIFRoZSByZXBsYWNlYWJsZVxuLy8gdmVyc2lvbiBpcyBhIGhhc2ggb2YgZmlsZXMgdGhhdCBjYW4gYmUgdXBkYXRlZCB3aXRoIEhNUi4gVGhlXG4vLyBub24tcmVmcmVzaGFibGUgdmVyc2lvbiBpcyBhIGhhc2ggb2YgdGhlIHJlc3Qgb2YgdGhlIGNsaWVudCBhc3NldHMsXG4vLyBleGNsdWRpbmcgdGhlIHJlZnJlc2hhYmxlIG9uZXM6IEhUTUwsIEpTIHRoYXQgaXMgbm90IHJlcGxhY2VhYmxlLCBhbmRcbi8vIHN0YXRpYyBmaWxlcyBpbiB0aGUgYHB1YmxpY2AgZGlyZWN0b3J5LiBUaGUgYHZlcnNpb25gIHZlcnNpb24gaXMgYVxuLy8gY29tYmluZWQgaGFzaCBvZiBldmVyeXRoaW5nLlxuLy9cbi8vIElmIHRoZSBlbnZpcm9ubWVudCB2YXJpYWJsZSBgQVVUT1VQREFURV9WRVJTSU9OYCBpcyBzZXQsIGl0IHdpbGwgYmVcbi8vIHVzZWQgaW4gcGxhY2Ugb2YgYWxsIGNsaWVudCB2ZXJzaW9ucy4gWW91IGNhbiB1c2UgdGhpcyB2YXJpYWJsZSB0b1xuLy8gY29udHJvbCB3aGVuIHRoZSBjbGllbnQgcmVsb2Fkcy4gRm9yIGV4YW1wbGUsIGlmIHlvdSB3YW50IHRvIGZvcmNlIGFcbi8vIHJlbG9hZCBvbmx5IGFmdGVyIG1ham9yIGNoYW5nZXMsIHVzZSBhIGN1c3RvbSBBVVRPVVBEQVRFX1ZFUlNJT04gYW5kXG4vLyBjaGFuZ2UgaXQgb25seSB3aGVuIHNvbWV0aGluZyB3b3J0aCBwdXNoaW5nIHRvIGNsaWVudHMgaGFwcGVucy5cbi8vXG4vLyBUaGUgc2VydmVyIHB1Ymxpc2hlcyBhIGBtZXRlb3JfYXV0b3VwZGF0ZV9jbGllbnRWZXJzaW9uc2AgY29sbGVjdGlvbi5cbi8vIFRoZSBJRCBvZiBlYWNoIGRvY3VtZW50IGlzIHRoZSBjbGllbnQgYXJjaGl0ZWN0dXJlLCBhbmQgdGhlIGZpZWxkcyBvZlxuLy8gdGhlIGRvY3VtZW50IGFyZSB0aGUgdmVyc2lvbnMgZGVzY3JpYmVkIGFib3ZlLlxuXG5pbXBvcnQgeyBDbGllbnRWZXJzaW9ucyB9IGZyb20gXCIuL2NsaWVudF92ZXJzaW9ucy5qc1wiO1xudmFyIEZ1dHVyZSA9IE5wbS5yZXF1aXJlKFwiZmliZXJzL2Z1dHVyZVwiKTtcblxuZXhwb3J0IGNvbnN0IEF1dG91cGRhdGUgPSBfX21ldGVvcl9ydW50aW1lX2NvbmZpZ19fLmF1dG91cGRhdGUgPSB7XG4gIC8vIE1hcCBmcm9tIGNsaWVudCBhcmNoaXRlY3R1cmVzICh3ZWIuYnJvd3Nlciwgd2ViLmJyb3dzZXIubGVnYWN5LFxuICAvLyB3ZWIuY29yZG92YSkgdG8gdmVyc2lvbiBmaWVsZHMgeyB2ZXJzaW9uLCB2ZXJzaW9uUmVmcmVzaGFibGUsXG4gIC8vIHZlcnNpb25Ob25SZWZyZXNoYWJsZSwgcmVmcmVzaGFibGUgfSB0aGF0IHdpbGwgYmUgc3RvcmVkIGluXG4gIC8vIENsaWVudFZlcnNpb25zIGRvY3VtZW50cyAod2hvc2UgSURzIGFyZSBjbGllbnQgYXJjaGl0ZWN0dXJlcykuIFRoaXNcbiAgLy8gZGF0YSBnZXRzIHNlcmlhbGl6ZWQgaW50byB0aGUgYm9pbGVycGxhdGUgYmVjYXVzZSBpdCdzIHN0b3JlZCBpblxuICAvLyBfX21ldGVvcl9ydW50aW1lX2NvbmZpZ19fLmF1dG91cGRhdGUudmVyc2lvbnMuXG4gIHZlcnNpb25zOiB7fVxufTtcblxuLy8gU3RvcmVzIGFjY2VwdGFibGUgY2xpZW50IHZlcnNpb25zLlxuY29uc3QgY2xpZW50VmVyc2lvbnMgPSBuZXcgQ2xpZW50VmVyc2lvbnMoKTtcblxuLy8gVGhlIGNsaWVudCBoYXNoIGluY2x1ZGVzIF9fbWV0ZW9yX3J1bnRpbWVfY29uZmlnX18sIHNvIHdhaXQgdW50aWxcbi8vIGFsbCBwYWNrYWdlcyBoYXZlIGxvYWRlZCBhbmQgaGF2ZSBoYWQgYSBjaGFuY2UgdG8gcG9wdWxhdGUgdGhlXG4vLyBydW50aW1lIGNvbmZpZyBiZWZvcmUgdXNpbmcgdGhlIGNsaWVudCBoYXNoIGFzIG91ciBkZWZhdWx0IGF1dG9cbi8vIHVwZGF0ZSB2ZXJzaW9uIGlkLlxuXG4vLyBOb3RlOiBUZXN0cyBhbGxvdyBwZW9wbGUgdG8gb3ZlcnJpZGUgQXV0b3VwZGF0ZS5hdXRvdXBkYXRlVmVyc2lvbiBiZWZvcmVcbi8vIHN0YXJ0dXAuXG5BdXRvdXBkYXRlLmF1dG91cGRhdGVWZXJzaW9uID0gbnVsbDtcbkF1dG91cGRhdGUuYXV0b3VwZGF0ZVZlcnNpb25SZWZyZXNoYWJsZSA9IG51bGw7XG5BdXRvdXBkYXRlLmF1dG91cGRhdGVWZXJzaW9uQ29yZG92YSA9IG51bGw7XG5BdXRvdXBkYXRlLmFwcElkID0gX19tZXRlb3JfcnVudGltZV9jb25maWdfXy5hcHBJZCA9IHByb2Nlc3MuZW52LkFQUF9JRDtcblxudmFyIHN5bmNRdWV1ZSA9IG5ldyBNZXRlb3IuX1N5bmNocm9ub3VzUXVldWUoKTtcblxuZnVuY3Rpb24gdXBkYXRlVmVyc2lvbnMoc2hvdWxkUmVsb2FkQ2xpZW50UHJvZ3JhbSkge1xuICAvLyBTdGVwIDE6IGxvYWQgdGhlIGN1cnJlbnQgY2xpZW50IHByb2dyYW0gb24gdGhlIHNlcnZlclxuICBpZiAoc2hvdWxkUmVsb2FkQ2xpZW50UHJvZ3JhbSkge1xuICAgIFdlYkFwcEludGVybmFscy5yZWxvYWRDbGllbnRQcm9ncmFtcygpO1xuICB9XG5cbiAgY29uc3Qge1xuICAgIC8vIElmIHRoZSBBVVRPVVBEQVRFX1ZFUlNJT04gZW52aXJvbm1lbnQgdmFyaWFibGUgaXMgZGVmaW5lZCwgaXQgdGFrZXNcbiAgICAvLyBwcmVjZWRlbmNlLCBidXQgQXV0b3VwZGF0ZS5hdXRvdXBkYXRlVmVyc2lvbiBpcyBzdGlsbCBzdXBwb3J0ZWQgYXNcbiAgICAvLyBhIGZhbGxiYWNrLiBJbiBtb3N0IGNhc2VzIG5laXRoZXIgb2YgdGhlc2UgdmFsdWVzIHdpbGwgYmUgZGVmaW5lZC5cbiAgICBBVVRPVVBEQVRFX1ZFUlNJT04gPSBBdXRvdXBkYXRlLmF1dG91cGRhdGVWZXJzaW9uXG4gIH0gPSBwcm9jZXNzLmVudjtcblxuICAvLyBTdGVwIDI6IHVwZGF0ZSBfX21ldGVvcl9ydW50aW1lX2NvbmZpZ19fLmF1dG91cGRhdGUudmVyc2lvbnMuXG4gIGNvbnN0IGNsaWVudEFyY2hzID0gT2JqZWN0LmtleXMoV2ViQXBwLmNsaWVudFByb2dyYW1zKTtcbiAgY2xpZW50QXJjaHMuZm9yRWFjaChhcmNoID0+IHtcbiAgICBBdXRvdXBkYXRlLnZlcnNpb25zW2FyY2hdID0ge1xuICAgICAgdmVyc2lvbjogQVVUT1VQREFURV9WRVJTSU9OIHx8XG4gICAgICAgIFdlYkFwcC5jYWxjdWxhdGVDbGllbnRIYXNoKGFyY2gpLFxuICAgICAgdmVyc2lvblJlZnJlc2hhYmxlOiBBVVRPVVBEQVRFX1ZFUlNJT04gfHxcbiAgICAgICAgV2ViQXBwLmNhbGN1bGF0ZUNsaWVudEhhc2hSZWZyZXNoYWJsZShhcmNoKSxcbiAgICAgIHZlcnNpb25Ob25SZWZyZXNoYWJsZTogQVVUT1VQREFURV9WRVJTSU9OIHx8XG4gICAgICAgIFdlYkFwcC5jYWxjdWxhdGVDbGllbnRIYXNoTm9uUmVmcmVzaGFibGUoYXJjaCksXG4gICAgICB2ZXJzaW9uUmVwbGFjZWFibGU6IEFVVE9VUERBVEVfVkVSU0lPTiB8fFxuICAgICAgICBXZWJBcHAuY2FsY3VsYXRlQ2xpZW50SGFzaFJlcGxhY2VhYmxlKGFyY2gpXG4gICAgfTtcbiAgfSk7XG5cbiAgLy8gU3RlcCAzOiBmb3JtIHRoZSBuZXcgY2xpZW50IGJvaWxlcnBsYXRlIHdoaWNoIGNvbnRhaW5zIHRoZSB1cGRhdGVkXG4gIC8vIGFzc2V0cyBhbmQgX19tZXRlb3JfcnVudGltZV9jb25maWdfXy5cbiAgaWYgKHNob3VsZFJlbG9hZENsaWVudFByb2dyYW0pIHtcbiAgICBXZWJBcHBJbnRlcm5hbHMuZ2VuZXJhdGVCb2lsZXJwbGF0ZSgpO1xuICB9XG5cbiAgLy8gU3RlcCA0OiB1cGRhdGUgdGhlIENsaWVudFZlcnNpb25zIGNvbGxlY3Rpb24uXG4gIC8vIFdlIHVzZSBgb25MaXN0ZW5pbmdgIGhlcmUgYmVjYXVzZSB3ZSBuZWVkIHRvIHVzZVxuICAvLyBgV2ViQXBwLmdldFJlZnJlc2hhYmxlQXNzZXRzYCwgd2hpY2ggaXMgb25seSBzZXQgYWZ0ZXJcbiAgLy8gYFdlYkFwcC5nZW5lcmF0ZUJvaWxlcnBsYXRlYCBpcyBjYWxsZWQgYnkgYG1haW5gIGluIHdlYmFwcC5cbiAgV2ViQXBwLm9uTGlzdGVuaW5nKCgpID0+IHtcbiAgICBjbGllbnRBcmNocy5mb3JFYWNoKGFyY2ggPT4ge1xuICAgICAgY29uc3QgcGF5bG9hZCA9IHtcbiAgICAgICAgLi4uQXV0b3VwZGF0ZS52ZXJzaW9uc1thcmNoXSxcbiAgICAgICAgYXNzZXRzOiBXZWJBcHAuZ2V0UmVmcmVzaGFibGVBc3NldHMoYXJjaCksXG4gICAgICB9O1xuXG4gICAgICBjbGllbnRWZXJzaW9ucy5zZXQoYXJjaCwgcGF5bG9hZCk7XG4gICAgfSk7XG4gIH0pO1xufVxuXG5NZXRlb3IucHVibGlzaChcbiAgXCJtZXRlb3JfYXV0b3VwZGF0ZV9jbGllbnRWZXJzaW9uc1wiLFxuICBmdW5jdGlvbiAoYXBwSWQpIHtcbiAgICAvLyBgbnVsbGAgaGFwcGVucyB3aGVuIGEgY2xpZW50IGRvZXNuJ3QgaGF2ZSBhbiBhcHBJZCBhbmQgcGFzc2VzXG4gICAgLy8gYHVuZGVmaW5lZGAgdG8gYE1ldGVvci5zdWJzY3JpYmVgLiBgdW5kZWZpbmVkYCBpcyB0cmFuc2xhdGVkIHRvXG4gICAgLy8gYG51bGxgIGFzIEpTT04gZG9lc24ndCBoYXZlIGB1bmRlZmluZWQuXG4gICAgY2hlY2soYXBwSWQsIE1hdGNoLk9uZU9mKFN0cmluZywgdW5kZWZpbmVkLCBudWxsKSk7XG5cbiAgICAvLyBEb24ndCBub3RpZnkgY2xpZW50cyB1c2luZyB3cm9uZyBhcHBJZCBzdWNoIGFzIG1vYmlsZSBhcHBzIGJ1aWx0IHdpdGggYVxuICAgIC8vIGRpZmZlcmVudCBzZXJ2ZXIgYnV0IHBvaW50aW5nIGF0IHRoZSBzYW1lIGxvY2FsIHVybFxuICAgIGlmIChBdXRvdXBkYXRlLmFwcElkICYmIGFwcElkICYmIEF1dG91cGRhdGUuYXBwSWQgIT09IGFwcElkKVxuICAgICAgcmV0dXJuIFtdO1xuXG4gICAgY29uc3Qgc3RvcCA9IGNsaWVudFZlcnNpb25zLndhdGNoKCh2ZXJzaW9uLCBpc05ldykgPT4ge1xuICAgICAgKGlzTmV3ID8gdGhpcy5hZGRlZCA6IHRoaXMuY2hhbmdlZClcbiAgICAgICAgLmNhbGwodGhpcywgXCJtZXRlb3JfYXV0b3VwZGF0ZV9jbGllbnRWZXJzaW9uc1wiLCB2ZXJzaW9uLl9pZCwgdmVyc2lvbik7XG4gICAgfSk7XG5cbiAgICB0aGlzLm9uU3RvcCgoKSA9PiBzdG9wKCkpO1xuICAgIHRoaXMucmVhZHkoKTtcbiAgfSxcbiAge2lzX2F1dG86IHRydWV9XG4pO1xuXG5NZXRlb3Iuc3RhcnR1cChmdW5jdGlvbiAoKSB7XG4gIHVwZGF0ZVZlcnNpb25zKGZhbHNlKTtcblxuICAvLyBGb3JjZSBhbnkgY29ubmVjdGVkIGNsaWVudHMgdGhhdCBhcmUgc3RpbGwgbG9va2luZyBmb3IgdGhlc2Ugb2xkZXJcbiAgLy8gZG9jdW1lbnQgSURzIHRvIHJlbG9hZC5cbiAgW1widmVyc2lvblwiLFxuICAgXCJ2ZXJzaW9uLXJlZnJlc2hhYmxlXCIsXG4gICBcInZlcnNpb24tY29yZG92YVwiLFxuICBdLmZvckVhY2goX2lkID0+IHtcbiAgICBjbGllbnRWZXJzaW9ucy5zZXQoX2lkLCB7XG4gICAgICB2ZXJzaW9uOiBcIm91dGRhdGVkXCJcbiAgICB9KTtcbiAgfSk7XG59KTtcblxudmFyIGZ1dCA9IG5ldyBGdXR1cmUoKTtcblxuLy8gV2Ugb25seSB3YW50ICdyZWZyZXNoJyB0byB0cmlnZ2VyICd1cGRhdGVWZXJzaW9ucycgQUZURVIgb25MaXN0ZW4sXG4vLyBzbyB3ZSBhZGQgYSBxdWV1ZWQgdGFzayB0aGF0IHdhaXRzIGZvciBvbkxpc3RlbiBiZWZvcmUgJ3JlZnJlc2gnIGNhbiBxdWV1ZVxuLy8gdGFza3MuIE5vdGUgdGhhdCB0aGUgYG9uTGlzdGVuaW5nYCBjYWxsYmFja3MgZG8gbm90IGZpcmUgdW50aWwgYWZ0ZXJcbi8vIE1ldGVvci5zdGFydHVwLCBzbyB0aGVyZSBpcyBubyBjb25jZXJuIHRoYXQgdGhlICd1cGRhdGVWZXJzaW9ucycgY2FsbHMgZnJvbVxuLy8gJ3JlZnJlc2gnIHdpbGwgb3ZlcmxhcCB3aXRoIHRoZSBgdXBkYXRlVmVyc2lvbnNgIGNhbGwgZnJvbSBNZXRlb3Iuc3RhcnR1cC5cblxuc3luY1F1ZXVlLnF1ZXVlVGFzayhmdW5jdGlvbiAoKSB7XG4gIGZ1dC53YWl0KCk7XG59KTtcblxuV2ViQXBwLm9uTGlzdGVuaW5nKGZ1bmN0aW9uICgpIHtcbiAgZnV0LnJldHVybigpO1xufSk7XG5cbmZ1bmN0aW9uIGVucXVldWVWZXJzaW9uc1JlZnJlc2goKSB7XG4gIHN5bmNRdWV1ZS5xdWV1ZVRhc2soZnVuY3Rpb24gKCkge1xuICAgIHVwZGF0ZVZlcnNpb25zKHRydWUpO1xuICB9KTtcbn1cblxuLy8gTGlzdGVuIGZvciBtZXNzYWdlcyBwZXJ0YWluaW5nIHRvIHRoZSBjbGllbnQtcmVmcmVzaCB0b3BpYy5cbmltcG9ydCB7IG9uTWVzc2FnZSB9IGZyb20gXCJtZXRlb3IvaW50ZXItcHJvY2Vzcy1tZXNzYWdpbmdcIjtcbm9uTWVzc2FnZShcImNsaWVudC1yZWZyZXNoXCIsIGVucXVldWVWZXJzaW9uc1JlZnJlc2gpO1xuXG4vLyBBbm90aGVyIHdheSB0byB0ZWxsIHRoZSBwcm9jZXNzIHRvIHJlZnJlc2g6IHNlbmQgU0lHSFVQIHNpZ25hbFxucHJvY2Vzcy5vbignU0lHSFVQJywgTWV0ZW9yLmJpbmRFbnZpcm9ubWVudChmdW5jdGlvbiAoKSB7XG4gIGVucXVldWVWZXJzaW9uc1JlZnJlc2goKTtcbn0sIFwiaGFuZGxpbmcgU0lHSFVQIHNpZ25hbCBmb3IgcmVmcmVzaFwiKSk7XG4iLCJpbXBvcnQgeyBUcmFja2VyIH0gZnJvbSBcIm1ldGVvci90cmFja2VyXCI7XG5cbmV4cG9ydCBjbGFzcyBDbGllbnRWZXJzaW9ucyB7XG4gIGNvbnN0cnVjdG9yKCkge1xuICAgIHRoaXMuX3ZlcnNpb25zID0gbmV3IE1hcCgpO1xuICAgIHRoaXMuX3dhdGNoQ2FsbGJhY2tzID0gbmV3IFNldCgpO1xuICB9XG5cbiAgLy8gQ3JlYXRlcyBhIExpdmVkYXRhIHN0b3JlIGZvciB1c2Ugd2l0aCBgTWV0ZW9yLmNvbm5lY3Rpb24ucmVnaXN0ZXJTdG9yZWAuXG4gIC8vIEFmdGVyIHRoZSBzdG9yZSBpcyByZWdpc3RlcmVkLCBkb2N1bWVudCB1cGRhdGVzIHJlcG9ydGVkIGJ5IExpdmVkYXRhIGFyZVxuICAvLyBtZXJnZWQgd2l0aCB0aGUgZG9jdW1lbnRzIGluIHRoaXMgYENsaWVudFZlcnNpb25zYCBpbnN0YW5jZS5cbiAgY3JlYXRlU3RvcmUoKSB7XG4gICAgcmV0dXJuIHtcbiAgICAgIHVwZGF0ZTogKHsgaWQsIG1zZywgZmllbGRzIH0pID0+IHtcbiAgICAgICAgaWYgKG1zZyA9PT0gXCJhZGRlZFwiIHx8IG1zZyA9PT0gXCJjaGFuZ2VkXCIpIHtcbiAgICAgICAgICB0aGlzLnNldChpZCwgZmllbGRzKTtcbiAgICAgICAgfVxuICAgICAgfVxuICAgIH07XG4gIH1cblxuICBoYXNWZXJzaW9ucygpIHtcbiAgICByZXR1cm4gdGhpcy5fdmVyc2lvbnMuc2l6ZSA+IDA7XG4gIH1cblxuICBnZXQoaWQpIHtcbiAgICByZXR1cm4gdGhpcy5fdmVyc2lvbnMuZ2V0KGlkKTtcbiAgfVxuXG4gIC8vIEFkZHMgb3IgdXBkYXRlcyBhIHZlcnNpb24gZG9jdW1lbnQgYW5kIGludm9rZXMgcmVnaXN0ZXJlZCBjYWxsYmFja3MgZm9yIHRoZVxuICAvLyBhZGRlZC91cGRhdGVkIGRvY3VtZW50LiBJZiBhIGRvY3VtZW50IHdpdGggdGhlIGdpdmVuIElEIGFscmVhZHkgZXhpc3RzLCBpdHNcbiAgLy8gZmllbGRzIGFyZSBtZXJnZWQgd2l0aCBgZmllbGRzYC5cbiAgc2V0KGlkLCBmaWVsZHMpIHtcbiAgICBsZXQgdmVyc2lvbiA9IHRoaXMuX3ZlcnNpb25zLmdldChpZCk7XG4gICAgbGV0IGlzTmV3ID0gZmFsc2U7XG5cbiAgICBpZiAodmVyc2lvbikge1xuICAgICAgT2JqZWN0LmFzc2lnbih2ZXJzaW9uLCBmaWVsZHMpO1xuICAgIH0gZWxzZSB7XG4gICAgICB2ZXJzaW9uID0ge1xuICAgICAgICBfaWQ6IGlkLFxuICAgICAgICAuLi5maWVsZHNcbiAgICAgIH07XG5cbiAgICAgIGlzTmV3ID0gdHJ1ZTtcbiAgICAgIHRoaXMuX3ZlcnNpb25zLnNldChpZCwgdmVyc2lvbik7XG4gICAgfVxuXG4gICAgdGhpcy5fd2F0Y2hDYWxsYmFja3MuZm9yRWFjaCgoeyBmbiwgZmlsdGVyIH0pID0+IHtcbiAgICAgIGlmICghIGZpbHRlciB8fCBmaWx0ZXIgPT09IHZlcnNpb24uX2lkKSB7XG4gICAgICAgIGZuKHZlcnNpb24sIGlzTmV3KTtcbiAgICAgIH1cbiAgICB9KTtcbiAgfVxuXG4gIC8vIFJlZ2lzdGVycyBhIGNhbGxiYWNrIHRoYXQgd2lsbCBiZSBpbnZva2VkIHdoZW4gYSB2ZXJzaW9uIGRvY3VtZW50IGlzIGFkZGVkXG4gIC8vIG9yIGNoYW5nZWQuIENhbGxpbmcgdGhlIGZ1bmN0aW9uIHJldHVybmVkIGJ5IGB3YXRjaGAgcmVtb3ZlcyB0aGUgY2FsbGJhY2suXG4gIC8vIElmIGBza2lwSW5pdGlhbGAgaXMgdHJ1ZSwgdGhlIGNhbGxiYWNrIGlzbid0IGJlIGludm9rZWQgZm9yIGV4aXN0aW5nXG4gIC8vIGRvY3VtZW50cy4gSWYgYGZpbHRlcmAgaXMgc2V0LCB0aGUgY2FsbGJhY2sgaXMgb25seSBpbnZva2VkIGZvciBkb2N1bWVudHNcbiAgLy8gd2l0aCBJRCBgZmlsdGVyYC5cbiAgd2F0Y2goZm4sIHsgc2tpcEluaXRpYWwsIGZpbHRlciB9ID0ge30pIHtcbiAgICBpZiAoISBza2lwSW5pdGlhbCkge1xuICAgICAgY29uc3QgcmVzb2x2ZWQgPSBQcm9taXNlLnJlc29sdmUoKTtcblxuICAgICAgdGhpcy5fdmVyc2lvbnMuZm9yRWFjaCgodmVyc2lvbikgPT4ge1xuICAgICAgICBpZiAoISBmaWx0ZXIgfHwgZmlsdGVyID09PSB2ZXJzaW9uLl9pZCkge1xuICAgICAgICAgIHJlc29sdmVkLnRoZW4oKCkgPT4gZm4odmVyc2lvbiwgdHJ1ZSkpO1xuICAgICAgICB9XG4gICAgICB9KTtcbiAgICB9XG5cbiAgICBjb25zdCBjYWxsYmFjayA9IHsgZm4sIGZpbHRlciB9O1xuICAgIHRoaXMuX3dhdGNoQ2FsbGJhY2tzLmFkZChjYWxsYmFjayk7XG5cbiAgICByZXR1cm4gKCkgPT4gdGhpcy5fd2F0Y2hDYWxsYmFja3MuZGVsZXRlKGNhbGxiYWNrKTtcbiAgfVxuXG4gIC8vIEEgcmVhY3RpdmUgZGF0YSBzb3VyY2UgZm9yIGBBdXRvdXBkYXRlLm5ld0NsaWVudEF2YWlsYWJsZWAuXG4gIG5ld0NsaWVudEF2YWlsYWJsZShpZCwgZmllbGRzLCBjdXJyZW50VmVyc2lvbikge1xuICAgIGZ1bmN0aW9uIGlzTmV3VmVyc2lvbih2ZXJzaW9uKSB7XG4gICAgICByZXR1cm4gKFxuICAgICAgICB2ZXJzaW9uLl9pZCA9PT0gaWQgJiZcbiAgICAgICAgZmllbGRzLnNvbWUoKGZpZWxkKSA9PiB2ZXJzaW9uW2ZpZWxkXSAhPT0gY3VycmVudFZlcnNpb25bZmllbGRdKVxuICAgICAgKTtcbiAgICB9XG5cbiAgICBjb25zdCBkZXBlbmRlbmN5ID0gbmV3IFRyYWNrZXIuRGVwZW5kZW5jeSgpO1xuICAgIGNvbnN0IHZlcnNpb24gPSB0aGlzLmdldChpZCk7XG5cbiAgICBkZXBlbmRlbmN5LmRlcGVuZCgpO1xuXG4gICAgY29uc3Qgc3RvcCA9IHRoaXMud2F0Y2goXG4gICAgICAodmVyc2lvbikgPT4ge1xuICAgICAgICBpZiAoaXNOZXdWZXJzaW9uKHZlcnNpb24pKSB7XG4gICAgICAgICAgZGVwZW5kZW5jeS5jaGFuZ2VkKCk7XG4gICAgICAgICAgc3RvcCgpO1xuICAgICAgICB9XG4gICAgICB9LFxuICAgICAgeyBza2lwSW5pdGlhbDogdHJ1ZSB9XG4gICAgKTtcblxuICAgIHJldHVybiAhISB2ZXJzaW9uICYmIGlzTmV3VmVyc2lvbih2ZXJzaW9uKTtcbiAgfVxufVxuIl19
