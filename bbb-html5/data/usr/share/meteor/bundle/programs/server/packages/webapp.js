(function () {

/* Imports */
var Meteor = Package.meteor.Meteor;
var global = Package.meteor.global;
var meteorEnv = Package.meteor.meteorEnv;
var ECMAScript = Package.ecmascript.ECMAScript;
var Log = Package.logging.Log;
var _ = Package.underscore._;
var RoutePolicy = Package.routepolicy.RoutePolicy;
var Boilerplate = Package['boilerplate-generator'].Boilerplate;
var WebAppHashing = Package['webapp-hashing'].WebAppHashing;
var Hook = Package['callback-hook'].Hook;
var meteorInstall = Package.modules.meteorInstall;
var Promise = Package.promise.Promise;

/* Package-scope variables */
var WebApp, WebAppInternals, main;

var require = meteorInstall({"node_modules":{"meteor":{"webapp":{"webapp_server.js":function module(require,exports,module){

////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
//                                                                                                                    //
// packages/webapp/webapp_server.js                                                                                   //
//                                                                                                                    //
////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
                                                                                                                      //
!function (module1) {
  let _objectSpread;

  module1.link("@babel/runtime/helpers/objectSpread2", {
    default(v) {
      _objectSpread = v;
    }

  }, 0);
  module1.export({
    WebApp: () => WebApp,
    WebAppInternals: () => WebAppInternals
  });
  let assert;
  module1.link("assert", {
    default(v) {
      assert = v;
    }

  }, 0);
  let readFileSync, chmodSync, chownSync;
  module1.link("fs", {
    readFileSync(v) {
      readFileSync = v;
    },

    chmodSync(v) {
      chmodSync = v;
    },

    chownSync(v) {
      chownSync = v;
    }

  }, 1);
  let createServer;
  module1.link("http", {
    createServer(v) {
      createServer = v;
    }

  }, 2);
  let userInfo;
  module1.link("os", {
    userInfo(v) {
      userInfo = v;
    }

  }, 3);
  let pathJoin, pathDirname;
  module1.link("path", {
    join(v) {
      pathJoin = v;
    },

    dirname(v) {
      pathDirname = v;
    }

  }, 4);
  let parseUrl;
  module1.link("url", {
    parse(v) {
      parseUrl = v;
    }

  }, 5);
  let createHash;
  module1.link("crypto", {
    createHash(v) {
      createHash = v;
    }

  }, 6);
  let connect;
  module1.link("./connect.js", {
    connect(v) {
      connect = v;
    }

  }, 7);
  let compress;
  module1.link("compression", {
    default(v) {
      compress = v;
    }

  }, 8);
  let cookieParser;
  module1.link("cookie-parser", {
    default(v) {
      cookieParser = v;
    }

  }, 9);
  let qs;
  module1.link("qs", {
    default(v) {
      qs = v;
    }

  }, 10);
  let parseRequest;
  module1.link("parseurl", {
    default(v) {
      parseRequest = v;
    }

  }, 11);
  let basicAuth;
  module1.link("basic-auth-connect", {
    default(v) {
      basicAuth = v;
    }

  }, 12);
  let lookupUserAgent;
  module1.link("useragent", {
    lookup(v) {
      lookupUserAgent = v;
    }

  }, 13);
  let isModern;
  module1.link("meteor/modern-browsers", {
    isModern(v) {
      isModern = v;
    }

  }, 14);
  let send;
  module1.link("send", {
    default(v) {
      send = v;
    }

  }, 15);
  let removeExistingSocketFile, registerSocketFileCleanup;
  module1.link("./socket_file.js", {
    removeExistingSocketFile(v) {
      removeExistingSocketFile = v;
    },

    registerSocketFileCleanup(v) {
      registerSocketFileCleanup = v;
    }

  }, 16);
  let cluster;
  module1.link("cluster", {
    default(v) {
      cluster = v;
    }

  }, 17);
  let whomst;
  module1.link("@vlasky/whomst", {
    default(v) {
      whomst = v;
    }

  }, 18);
  let onMessage;
  module1.link("meteor/inter-process-messaging", {
    onMessage(v) {
      onMessage = v;
    }

  }, 19);
  var SHORT_SOCKET_TIMEOUT = 5 * 1000;
  var LONG_SOCKET_TIMEOUT = 120 * 1000;
  const WebApp = {};
  const WebAppInternals = {};
  const hasOwn = Object.prototype.hasOwnProperty; // backwards compat to 2.0 of connect

  connect.basicAuth = basicAuth;
  WebAppInternals.NpmModules = {
    connect: {
      version: Npm.require('connect/package.json').version,
      module: connect
    }
  }; // Though we might prefer to use web.browser (modern) as the default
  // architecture, safety requires a more compatible defaultArch.

  WebApp.defaultArch = 'web.browser.legacy'; // XXX maps archs to manifests

  WebApp.clientPrograms = {}; // XXX maps archs to program path on filesystem

  var archPath = {};

  var bundledJsCssUrlRewriteHook = function (url) {
    var bundledPrefix = __meteor_runtime_config__.ROOT_URL_PATH_PREFIX || '';
    return bundledPrefix + url;
  };

  var sha1 = function (contents) {
    var hash = createHash('sha1');
    hash.update(contents);
    return hash.digest('hex');
  };

  function shouldCompress(req, res) {
    if (req.headers['x-no-compression']) {
      // don't compress responses with this request header
      return false;
    } // fallback to standard filter function


    return compress.filter(req, res);
  } // #BrowserIdentification
  //
  // We have multiple places that want to identify the browser: the
  // unsupported browser page, the appcache package, and, eventually
  // delivering browser polyfills only as needed.
  //
  // To avoid detecting the browser in multiple places ad-hoc, we create a
  // Meteor "browser" object. It uses but does not expose the npm
  // useragent module (we could choose a different mechanism to identify
  // the browser in the future if we wanted to).  The browser object
  // contains
  //
  // * `name`: the name of the browser in camel case
  // * `major`, `minor`, `patch`: integers describing the browser version
  //
  // Also here is an early version of a Meteor `request` object, intended
  // to be a high-level description of the request without exposing
  // details of connect's low-level `req`.  Currently it contains:
  //
  // * `browser`: browser identification object described above
  // * `url`: parsed url, including parsed query params
  //
  // As a temporary hack there is a `categorizeRequest` function on WebApp which
  // converts a connect `req` to a Meteor `request`. This can go away once smart
  // packages such as appcache are being passed a `request` object directly when
  // they serve content.
  //
  // This allows `request` to be used uniformly: it is passed to the html
  // attributes hook, and the appcache package can use it when deciding
  // whether to generate a 404 for the manifest.
  //
  // Real routing / server side rendering will probably refactor this
  // heavily.
  // e.g. "Mobile Safari" => "mobileSafari"


  var camelCase = function (name) {
    var parts = name.split(' ');
    parts[0] = parts[0].toLowerCase();

    for (var i = 1; i < parts.length; ++i) {
      parts[i] = parts[i].charAt(0).toUpperCase() + parts[i].substr(1);
    }

    return parts.join('');
  };

  var identifyBrowser = function (userAgentString) {
    var userAgent = lookupUserAgent(userAgentString);
    return {
      name: camelCase(userAgent.family),
      major: +userAgent.major,
      minor: +userAgent.minor,
      patch: +userAgent.patch
    };
  }; // XXX Refactor as part of implementing real routing.


  WebAppInternals.identifyBrowser = identifyBrowser;

  WebApp.categorizeRequest = function (req) {
    if (req.browser && req.arch && typeof req.modern === 'boolean') {
      // Already categorized.
      return req;
    }

    const browser = identifyBrowser(req.headers['user-agent']);
    const modern = isModern(browser);
    const path = typeof req.pathname === 'string' ? req.pathname : parseRequest(req).pathname;
    const categorized = {
      browser,
      modern,
      path,
      arch: WebApp.defaultArch,
      url: parseUrl(req.url, true),
      dynamicHead: req.dynamicHead,
      dynamicBody: req.dynamicBody,
      headers: req.headers,
      cookies: req.cookies
    };
    const pathParts = path.split('/');
    const archKey = pathParts[1];

    if (archKey.startsWith('__')) {
      const archCleaned = 'web.' + archKey.slice(2);

      if (hasOwn.call(WebApp.clientPrograms, archCleaned)) {
        pathParts.splice(1, 1); // Remove the archKey part.

        return Object.assign(categorized, {
          arch: archCleaned,
          path: pathParts.join('/')
        });
      }
    } // TODO Perhaps one day we could infer Cordova clients here, so that we
    // wouldn't have to use prefixed "/__cordova/..." URLs.


    const preferredArchOrder = isModern(browser) ? ['web.browser', 'web.browser.legacy'] : ['web.browser.legacy', 'web.browser'];

    for (const arch of preferredArchOrder) {
      // If our preferred arch is not available, it's better to use another
      // client arch that is available than to guarantee the site won't work
      // by returning an unknown arch. For example, if web.browser.legacy is
      // excluded using the --exclude-archs command-line option, legacy
      // clients are better off receiving web.browser (which might actually
      // work) than receiving an HTTP 404 response. If none of the archs in
      // preferredArchOrder are defined, only then should we send a 404.
      if (hasOwn.call(WebApp.clientPrograms, arch)) {
        return Object.assign(categorized, {
          arch
        });
      }
    }

    return categorized;
  }; // HTML attribute hooks: functions to be called to determine any attributes to
  // be added to the '<html>' tag. Each function is passed a 'request' object (see
  // #BrowserIdentification) and should return null or object.


  var htmlAttributeHooks = [];

  var getHtmlAttributes = function (request) {
    var combinedAttributes = {};

    _.each(htmlAttributeHooks || [], function (hook) {
      var attributes = hook(request);
      if (attributes === null) return;
      if (typeof attributes !== 'object') throw Error('HTML attribute hook must return null or object');

      _.extend(combinedAttributes, attributes);
    });

    return combinedAttributes;
  };

  WebApp.addHtmlAttributeHook = function (hook) {
    htmlAttributeHooks.push(hook);
  }; // Serve app HTML for this URL?


  var appUrl = function (url) {
    if (url === '/favicon.ico' || url === '/robots.txt') return false; // NOTE: app.manifest is not a web standard like favicon.ico and
    // robots.txt. It is a file name we have chosen to use for HTML5
    // appcache URLs. It is included here to prevent using an appcache
    // then removing it from poisoning an app permanently. Eventually,
    // once we have server side routing, this won't be needed as
    // unknown URLs with return a 404 automatically.

    if (url === '/app.manifest') return false; // Avoid serving app HTML for declared routes such as /sockjs/.

    if (RoutePolicy.classify(url)) return false; // we currently return app HTML on all URLs by default

    return true;
  }; // We need to calculate the client hash after all packages have loaded
  // to give them a chance to populate __meteor_runtime_config__.
  //
  // Calculating the hash during startup means that packages can only
  // populate __meteor_runtime_config__ during load, not during startup.
  //
  // Calculating instead it at the beginning of main after all startup
  // hooks had run would allow packages to also populate
  // __meteor_runtime_config__ during startup, but that's too late for
  // autoupdate because it needs to have the client hash at startup to
  // insert the auto update version itself into
  // __meteor_runtime_config__ to get it to the client.
  //
  // An alternative would be to give autoupdate a "post-start,
  // pre-listen" hook to allow it to insert the auto update version at
  // the right moment.


  Meteor.startup(function () {
    function getter(key) {
      return function (arch) {
        arch = arch || WebApp.defaultArch;
        const program = WebApp.clientPrograms[arch];
        const value = program && program[key]; // If this is the first time we have calculated this hash,
        // program[key] will be a thunk (lazy function with no parameters)
        // that we should call to do the actual computation.

        return typeof value === 'function' ? program[key] = value() : value;
      };
    }

    WebApp.calculateClientHash = WebApp.clientHash = getter('version');
    WebApp.calculateClientHashRefreshable = getter('versionRefreshable');
    WebApp.calculateClientHashNonRefreshable = getter('versionNonRefreshable');
    WebApp.calculateClientHashReplaceable = getter('versionReplaceable');
    WebApp.getRefreshableAssets = getter('refreshableAssets');
  }); // When we have a request pending, we want the socket timeout to be long, to
  // give ourselves a while to serve it, and to allow sockjs long polls to
  // complete.  On the other hand, we want to close idle sockets relatively
  // quickly, so that we can shut down relatively promptly but cleanly, without
  // cutting off anyone's response.

  WebApp._timeoutAdjustmentRequestCallback = function (req, res) {
    // this is really just req.socket.setTimeout(LONG_SOCKET_TIMEOUT);
    req.setTimeout(LONG_SOCKET_TIMEOUT); // Insert our new finish listener to run BEFORE the existing one which removes
    // the response from the socket.

    var finishListeners = res.listeners('finish'); // XXX Apparently in Node 0.12 this event was called 'prefinish'.
    // https://github.com/joyent/node/commit/7c9b6070
    // But it has switched back to 'finish' in Node v4:
    // https://github.com/nodejs/node/pull/1411

    res.removeAllListeners('finish');
    res.on('finish', function () {
      res.setTimeout(SHORT_SOCKET_TIMEOUT);
    });

    _.each(finishListeners, function (l) {
      res.on('finish', l);
    });
  }; // Will be updated by main before we listen.
  // Map from client arch to boilerplate object.
  // Boilerplate object has:
  //   - func: XXX
  //   - baseData: XXX


  var boilerplateByArch = {}; // Register a callback function that can selectively modify boilerplate
  // data given arguments (request, data, arch). The key should be a unique
  // identifier, to prevent accumulating duplicate callbacks from the same
  // call site over time. Callbacks will be called in the order they were
  // registered. A callback should return false if it did not make any
  // changes affecting the boilerplate. Passing null deletes the callback.
  // Any previous callback registered for this key will be returned.

  const boilerplateDataCallbacks = Object.create(null);

  WebAppInternals.registerBoilerplateDataCallback = function (key, callback) {
    const previousCallback = boilerplateDataCallbacks[key];

    if (typeof callback === 'function') {
      boilerplateDataCallbacks[key] = callback;
    } else {
      assert.strictEqual(callback, null);
      delete boilerplateDataCallbacks[key];
    } // Return the previous callback in case the new callback needs to call
    // it; for example, when the new callback is a wrapper for the old.


    return previousCallback || null;
  }; // Given a request (as returned from `categorizeRequest`), return the
  // boilerplate HTML to serve for that request.
  //
  // If a previous connect middleware has rendered content for the head or body,
  // returns the boilerplate with that content patched in otherwise
  // memoizes on HTML attributes (used by, eg, appcache) and whether inline
  // scripts are currently allowed.
  // XXX so far this function is always called with arch === 'web.browser'


  function getBoilerplate(request, arch) {
    return getBoilerplateAsync(request, arch).await();
  }
  /**
   * @summary Takes a runtime configuration object and
   * returns an encoded runtime string.
   * @locus Server
   * @param {Object} rtimeConfig
   * @returns {String}
   */


  WebApp.encodeRuntimeConfig = function (rtimeConfig) {
    return JSON.stringify(encodeURIComponent(JSON.stringify(rtimeConfig)));
  };
  /**
   * @summary Takes an encoded runtime string and returns
   * a runtime configuration object.
   * @locus Server
   * @param {String} rtimeConfigString
   * @returns {Object}
   */


  WebApp.decodeRuntimeConfig = function (rtimeConfigStr) {
    return JSON.parse(decodeURIComponent(JSON.parse(rtimeConfigStr)));
  };

  const runtimeConfig = {
    // hooks will contain the callback functions
    // set by the caller to addRuntimeConfigHook
    hooks: new Hook(),
    // updateHooks will contain the callback functions
    // set by the caller to addUpdatedNotifyHook
    updateHooks: new Hook(),
    // isUpdatedByArch is an object containing fields for each arch
    // that this server supports.
    // - Each field will be true when the server updates the runtimeConfig for that arch.
    // - When the hook callback is called the update field in the callback object will be
    // set to isUpdatedByArch[arch].
    // = isUpdatedyByArch[arch] is reset to false after the callback.
    // This enables the caller to cache data efficiently so they do not need to
    // decode & update data on every callback when the runtimeConfig is not changing.
    isUpdatedByArch: {}
  };
  /**
   * @name addRuntimeConfigHookCallback(options)
   * @locus Server
   * @isprototype true
   * @summary Callback for `addRuntimeConfigHook`.
   *
   * If the handler returns a _falsy_ value the hook will not
   * modify the runtime configuration.
   *
   * If the handler returns a _String_ the hook will substitute
   * the string for the encoded configuration string.
   *
   * **Warning:** the hook does not check the return value at all it is
   * the responsibility of the caller to get the formatting correct using
   * the helper functions.
   *
   * `addRuntimeConfigHookCallback` takes only one `Object` argument
   * with the following fields:
   * @param {Object} options
   * @param {String} options.arch The architecture of the client
   * requesting a new runtime configuration. This can be one of
   * `web.browser`, `web.browser.legacy` or `web.cordova`.
   * @param {Object} options.request
   * A NodeJs [IncomingMessage](https://nodejs.org/api/http.html#http_class_http_incomingmessage)
   * https://nodejs.org/api/http.html#http_class_http_incomingmessage
   * `Object` that can be used to get information about the incoming request.
   * @param {String} options.encodedCurrentConfig The current configuration object
   * encoded as a string for inclusion in the root html.
   * @param {Boolean} options.updated `true` if the config for this architecture
   * has been updated since last called, otherwise `false`. This flag can be used
   * to cache the decoding/encoding for each architecture.
   */

  /**
   * @summary Hook that calls back when the meteor runtime configuration,
   * `__meteor_runtime_config__` is being sent to any client.
   *
   * **returns**: <small>_Object_</small> `{ stop: function, callback: function }`
   * - `stop` <small>_Function_</small> Call `stop()` to stop getting callbacks.
   * - `callback` <small>_Function_</small> The passed in `callback`.
   * @locus Server
   * @param {addRuntimeConfigHookCallback} callback
   * See `addRuntimeConfigHookCallback` description.
   * @returns {Object} {{ stop: function, callback: function }}
   * Call the returned `stop()` to stop getting callbacks.
   * The passed in `callback` is returned also.
   */

  WebApp.addRuntimeConfigHook = function (callback) {
    return runtimeConfig.hooks.register(callback);
  };

  function getBoilerplateAsync(request, arch) {
    let boilerplate = boilerplateByArch[arch];
    runtimeConfig.hooks.forEach(hook => {
      const meteorRuntimeConfig = hook({
        arch,
        request,
        encodedCurrentConfig: boilerplate.baseData.meteorRuntimeConfig,
        updated: runtimeConfig.isUpdatedByArch[arch]
      });
      if (!meteorRuntimeConfig) return;
      boilerplate.baseData = Object.assign({}, boilerplate.baseData, {
        meteorRuntimeConfig
      });
    });
    runtimeConfig.isUpdatedByArch[arch] = false;
    const data = Object.assign({}, boilerplate.baseData, {
      htmlAttributes: getHtmlAttributes(request)
    }, _.pick(request, 'dynamicHead', 'dynamicBody'));
    let madeChanges = false;
    let promise = Promise.resolve();
    Object.keys(boilerplateDataCallbacks).forEach(key => {
      promise = promise.then(() => {
        const callback = boilerplateDataCallbacks[key];
        return callback(request, data, arch);
      }).then(result => {
        // Callbacks should return false if they did not make any changes.
        if (result !== false) {
          madeChanges = true;
        }
      });
    });
    return promise.then(() => ({
      stream: boilerplate.toHTMLStream(data),
      statusCode: data.statusCode,
      headers: data.headers
    }));
  }
  /**
   * @name addUpdatedNotifyHookCallback(options)
   * @summary callback handler for `addupdatedNotifyHook`
   * @isprototype true
   * @locus Server
   * @param {Object} options
   * @param {String} options.arch The architecture that is being updated.
   * This can be one of `web.browser`, `web.browser.legacy` or `web.cordova`.
   * @param {Object} options.manifest The new updated manifest object for
   * this `arch`.
   * @param {Object} options.runtimeConfig The new updated configuration
   * object for this `arch`.
   */

  /**
   * @summary Hook that runs when the meteor runtime configuration
   * is updated.  Typically the configuration only changes during development mode.
   * @locus Server
   * @param {addUpdatedNotifyHookCallback} handler
   * The `handler` is called on every change to an `arch` runtime configuration.
   * See `addUpdatedNotifyHookCallback`.
   * @returns {Object} {{ stop: function, callback: function }}
   */


  WebApp.addUpdatedNotifyHook = function (handler) {
    return runtimeConfig.updateHooks.register(handler);
  };

  WebAppInternals.generateBoilerplateInstance = function (arch, manifest, additionalOptions) {
    additionalOptions = additionalOptions || {};
    runtimeConfig.isUpdatedByArch[arch] = true;

    const rtimeConfig = _objectSpread(_objectSpread({}, __meteor_runtime_config__), additionalOptions.runtimeConfigOverrides || {});

    runtimeConfig.updateHooks.forEach(cb => {
      cb({
        arch,
        manifest,
        runtimeConfig: rtimeConfig
      });
    });
    const meteorRuntimeConfig = JSON.stringify(encodeURIComponent(JSON.stringify(rtimeConfig)));
    return new Boilerplate(arch, manifest, Object.assign({
      pathMapper(itemPath) {
        return pathJoin(archPath[arch], itemPath);
      },

      baseDataExtension: {
        additionalStaticJs: _.map(additionalStaticJs || [], function (contents, pathname) {
          return {
            pathname: pathname,
            contents: contents
          };
        }),
        // Convert to a JSON string, then get rid of most weird characters, then
        // wrap in double quotes. (The outermost JSON.stringify really ought to
        // just be "wrap in double quotes" but we use it to be safe.) This might
        // end up inside a <script> tag so we need to be careful to not include
        // "</script>", but normal {{spacebars}} escaping escapes too much! See
        // https://github.com/meteor/meteor/issues/3730
        meteorRuntimeConfig,
        meteorRuntimeHash: sha1(meteorRuntimeConfig),
        rootUrlPathPrefix: __meteor_runtime_config__.ROOT_URL_PATH_PREFIX || '',
        bundledJsCssUrlRewriteHook: bundledJsCssUrlRewriteHook,
        sriMode: sriMode,
        inlineScriptsAllowed: WebAppInternals.inlineScriptsAllowed(),
        inline: additionalOptions.inline
      }
    }, additionalOptions));
  }; // A mapping from url path to architecture (e.g. "web.browser") to static
  // file information with the following fields:
  // - type: the type of file to be served
  // - cacheable: optionally, whether the file should be cached or not
  // - sourceMapUrl: optionally, the url of the source map
  //
  // Info also contains one of the following:
  // - content: the stringified content that should be served at this path
  // - absolutePath: the absolute path on disk to the file
  // Serve static files from the manifest or added with
  // `addStaticJs`. Exported for tests.


  WebAppInternals.staticFilesMiddleware = function (staticFilesByArch, req, res, next) {
    return Promise.asyncApply(() => {
      var _Meteor$settings$pack3, _Meteor$settings$pack4;

      var pathname = parseRequest(req).pathname;

      try {
        pathname = decodeURIComponent(pathname);
      } catch (e) {
        next();
        return;
      }

      var serveStaticJs = function (s) {
        var _Meteor$settings$pack, _Meteor$settings$pack2;

        if (req.method === 'GET' || req.method === 'HEAD' || (_Meteor$settings$pack = Meteor.settings.packages) !== null && _Meteor$settings$pack !== void 0 && (_Meteor$settings$pack2 = _Meteor$settings$pack.webapp) !== null && _Meteor$settings$pack2 !== void 0 && _Meteor$settings$pack2.alwaysReturnContent) {
          res.writeHead(200, {
            'Content-type': 'application/javascript; charset=UTF-8',
            'Content-Length': Buffer.byteLength(s)
          });
          res.write(s);
          res.end();
        } else {
          const status = req.method === 'OPTIONS' ? 200 : 405;
          res.writeHead(status, {
            Allow: 'OPTIONS, GET, HEAD',
            'Content-Length': '0'
          });
          res.end();
        }
      };

      if (_.has(additionalStaticJs, pathname) && !WebAppInternals.inlineScriptsAllowed()) {
        serveStaticJs(additionalStaticJs[pathname]);
        return;
      }

      const {
        arch,
        path
      } = WebApp.categorizeRequest(req);

      if (!hasOwn.call(WebApp.clientPrograms, arch)) {
        // We could come here in case we run with some architectures excluded
        next();
        return;
      } // If pauseClient(arch) has been called, program.paused will be a
      // Promise that will be resolved when the program is unpaused.


      const program = WebApp.clientPrograms[arch];
      Promise.await(program.paused);

      if (path === '/meteor_runtime_config.js' && !WebAppInternals.inlineScriptsAllowed()) {
        serveStaticJs("__meteor_runtime_config__ = ".concat(program.meteorRuntimeConfig, ";"));
        return;
      }

      const info = getStaticFileInfo(staticFilesByArch, pathname, path, arch);

      if (!info) {
        next();
        return;
      } // "send" will handle HEAD & GET requests


      if (req.method !== 'HEAD' && req.method !== 'GET' && !((_Meteor$settings$pack3 = Meteor.settings.packages) !== null && _Meteor$settings$pack3 !== void 0 && (_Meteor$settings$pack4 = _Meteor$settings$pack3.webapp) !== null && _Meteor$settings$pack4 !== void 0 && _Meteor$settings$pack4.alwaysReturnContent)) {
        const status = req.method === 'OPTIONS' ? 200 : 405;
        res.writeHead(status, {
          Allow: 'OPTIONS, GET, HEAD',
          'Content-Length': '0'
        });
        res.end();
        return;
      } // We don't need to call pause because, unlike 'static', once we call into
      // 'send' and yield to the event loop, we never call another handler with
      // 'next'.
      // Cacheable files are files that should never change. Typically
      // named by their hash (eg meteor bundled js and css files).
      // We cache them ~forever (1yr).


      const maxAge = info.cacheable ? 1000 * 60 * 60 * 24 * 365 : 0;

      if (info.cacheable) {
        // Since we use req.headers["user-agent"] to determine whether the
        // client should receive modern or legacy resources, tell the client
        // to invalidate cached resources when/if its user agent string
        // changes in the future.
        res.setHeader('Vary', 'User-Agent');
      } // Set the X-SourceMap header, which current Chrome, FireFox, and Safari
      // understand.  (The SourceMap header is slightly more spec-correct but FF
      // doesn't understand it.)
      //
      // You may also need to enable source maps in Chrome: open dev tools, click
      // the gear in the bottom right corner, and select "enable source maps".


      if (info.sourceMapUrl) {
        res.setHeader('X-SourceMap', __meteor_runtime_config__.ROOT_URL_PATH_PREFIX + info.sourceMapUrl);
      }

      if (info.type === 'js' || info.type === 'dynamic js') {
        res.setHeader('Content-Type', 'application/javascript; charset=UTF-8');
      } else if (info.type === 'css') {
        res.setHeader('Content-Type', 'text/css; charset=UTF-8');
      } else if (info.type === 'json') {
        res.setHeader('Content-Type', 'application/json; charset=UTF-8');
      }

      if (info.hash) {
        res.setHeader('ETag', '"' + info.hash + '"');
      }

      if (info.content) {
        res.setHeader('Content-Length', Buffer.byteLength(info.content));
        res.write(info.content);
        res.end();
      } else {
        send(req, info.absolutePath, {
          maxage: maxAge,
          dotfiles: 'allow',
          // if we specified a dotfile in the manifest, serve it
          lastModified: false // don't set last-modified based on the file date

        }).on('error', function (err) {
          Log.error('Error serving static file ' + err);
          res.writeHead(500);
          res.end();
        }).on('directory', function () {
          Log.error('Unexpected directory ' + info.absolutePath);
          res.writeHead(500);
          res.end();
        }).pipe(res);
      }
    });
  };

  function getStaticFileInfo(staticFilesByArch, originalPath, path, arch) {
    if (!hasOwn.call(WebApp.clientPrograms, arch)) {
      return null;
    } // Get a list of all available static file architectures, with arch
    // first in the list if it exists.


    const staticArchList = Object.keys(staticFilesByArch);
    const archIndex = staticArchList.indexOf(arch);

    if (archIndex > 0) {
      staticArchList.unshift(staticArchList.splice(archIndex, 1)[0]);
    }

    let info = null;
    staticArchList.some(arch => {
      const staticFiles = staticFilesByArch[arch];

      function finalize(path) {
        info = staticFiles[path]; // Sometimes we register a lazy function instead of actual data in
        // the staticFiles manifest.

        if (typeof info === 'function') {
          info = staticFiles[path] = info();
        }

        return info;
      } // If staticFiles contains originalPath with the arch inferred above,
      // use that information.


      if (hasOwn.call(staticFiles, originalPath)) {
        return finalize(originalPath);
      } // If categorizeRequest returned an alternate path, try that instead.


      if (path !== originalPath && hasOwn.call(staticFiles, path)) {
        return finalize(path);
      }
    });
    return info;
  } // Parse the passed in port value. Return the port as-is if it's a String
  // (e.g. a Windows Server style named pipe), otherwise return the port as an
  // integer.
  //
  // DEPRECATED: Direct use of this function is not recommended; it is no
  // longer used internally, and will be removed in a future release.


  WebAppInternals.parsePort = port => {
    let parsedPort = parseInt(port);

    if (Number.isNaN(parsedPort)) {
      parsedPort = port;
    }

    return parsedPort;
  };

  onMessage('webapp-pause-client', _ref => Promise.asyncApply(() => {
    let {
      arch
    } = _ref;
    WebAppInternals.pauseClient(arch);
  }));
  onMessage('webapp-reload-client', _ref2 => Promise.asyncApply(() => {
    let {
      arch
    } = _ref2;
    WebAppInternals.generateClientProgram(arch);
  }));

  function runWebAppServer() {
    var shuttingDown = false;
    var syncQueue = new Meteor._SynchronousQueue();

    var getItemPathname = function (itemUrl) {
      return decodeURIComponent(parseUrl(itemUrl).pathname);
    };

    WebAppInternals.reloadClientPrograms = function () {
      syncQueue.runTask(function () {
        const staticFilesByArch = Object.create(null);
        const {
          configJson
        } = __meteor_bootstrap__;
        const clientArchs = configJson.clientArchs || Object.keys(configJson.clientPaths);

        try {
          clientArchs.forEach(arch => {
            generateClientProgram(arch, staticFilesByArch);
          });
          WebAppInternals.staticFilesByArch = staticFilesByArch;
        } catch (e) {
          Log.error('Error reloading the client program: ' + e.stack);
          process.exit(1);
        }
      });
    }; // Pause any incoming requests and make them wait for the program to be
    // unpaused the next time generateClientProgram(arch) is called.


    WebAppInternals.pauseClient = function (arch) {
      syncQueue.runTask(() => {
        const program = WebApp.clientPrograms[arch];
        const {
          unpause
        } = program;
        program.paused = new Promise(resolve => {
          if (typeof unpause === 'function') {
            // If there happens to be an existing program.unpause function,
            // compose it with the resolve function.
            program.unpause = function () {
              unpause();
              resolve();
            };
          } else {
            program.unpause = resolve;
          }
        });
      });
    };

    WebAppInternals.generateClientProgram = function (arch) {
      syncQueue.runTask(() => generateClientProgram(arch));
    };

    function generateClientProgram(arch) {
      let staticFilesByArch = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : WebAppInternals.staticFilesByArch;
      const clientDir = pathJoin(pathDirname(__meteor_bootstrap__.serverDir), arch); // read the control for the client we'll be serving up

      const programJsonPath = pathJoin(clientDir, 'program.json');
      let programJson;

      try {
        programJson = JSON.parse(readFileSync(programJsonPath));
      } catch (e) {
        if (e.code === 'ENOENT') return;
        throw e;
      }

      if (programJson.format !== 'web-program-pre1') {
        throw new Error('Unsupported format for client assets: ' + JSON.stringify(programJson.format));
      }

      if (!programJsonPath || !clientDir || !programJson) {
        throw new Error('Client config file not parsed.');
      }

      archPath[arch] = clientDir;
      const staticFiles = staticFilesByArch[arch] = Object.create(null);
      const {
        manifest
      } = programJson;
      manifest.forEach(item => {
        if (item.url && item.where === 'client') {
          staticFiles[getItemPathname(item.url)] = {
            absolutePath: pathJoin(clientDir, item.path),
            cacheable: item.cacheable,
            hash: item.hash,
            // Link from source to its map
            sourceMapUrl: item.sourceMapUrl,
            type: item.type
          };

          if (item.sourceMap) {
            // Serve the source map too, under the specified URL. We assume
            // all source maps are cacheable.
            staticFiles[getItemPathname(item.sourceMapUrl)] = {
              absolutePath: pathJoin(clientDir, item.sourceMap),
              cacheable: true
            };
          }
        }
      });
      const {
        PUBLIC_SETTINGS
      } = __meteor_runtime_config__;
      const configOverrides = {
        PUBLIC_SETTINGS
      };
      const oldProgram = WebApp.clientPrograms[arch];
      const newProgram = WebApp.clientPrograms[arch] = {
        format: 'web-program-pre1',
        manifest: manifest,
        // Use arrow functions so that these versions can be lazily
        // calculated later, and so that they will not be included in the
        // staticFiles[manifestUrl].content string below.
        //
        // Note: these version calculations must be kept in agreement with
        // CordovaBuilder#appendVersion in tools/cordova/builder.js, or hot
        // code push will reload Cordova apps unnecessarily.
        version: () => WebAppHashing.calculateClientHash(manifest, null, configOverrides),
        versionRefreshable: () => WebAppHashing.calculateClientHash(manifest, type => type === 'css', configOverrides),
        versionNonRefreshable: () => WebAppHashing.calculateClientHash(manifest, (type, replaceable) => type !== 'css' && !replaceable, configOverrides),
        versionReplaceable: () => WebAppHashing.calculateClientHash(manifest, (_type, replaceable) => {
          if (Meteor.isProduction && replaceable) {
            throw new Error('Unexpected replaceable file in production');
          }

          return replaceable;
        }, configOverrides),
        cordovaCompatibilityVersions: programJson.cordovaCompatibilityVersions,
        PUBLIC_SETTINGS,
        hmrVersion: programJson.hmrVersion
      }; // Expose program details as a string reachable via the following URL.

      const manifestUrlPrefix = '/__' + arch.replace(/^web\./, '');
      const manifestUrl = manifestUrlPrefix + getItemPathname('/manifest.json');

      staticFiles[manifestUrl] = () => {
        if (Package.autoupdate) {
          const {
            AUTOUPDATE_VERSION = Package.autoupdate.Autoupdate.autoupdateVersion
          } = process.env;

          if (AUTOUPDATE_VERSION) {
            newProgram.version = AUTOUPDATE_VERSION;
          }
        }

        if (typeof newProgram.version === 'function') {
          newProgram.version = newProgram.version();
        }

        return {
          content: JSON.stringify(newProgram),
          cacheable: false,
          hash: newProgram.version,
          type: 'json'
        };
      };

      generateBoilerplateForArch(arch); // If there are any requests waiting on oldProgram.paused, let them
      // continue now (using the new program).

      if (oldProgram && oldProgram.paused) {
        oldProgram.unpause();
      }
    }

    const defaultOptionsForArch = {
      'web.cordova': {
        runtimeConfigOverrides: {
          // XXX We use absoluteUrl() here so that we serve https://
          // URLs to cordova clients if force-ssl is in use. If we were
          // to use __meteor_runtime_config__.ROOT_URL instead of
          // absoluteUrl(), then Cordova clients would immediately get a
          // HCP setting their DDP_DEFAULT_CONNECTION_URL to
          // http://example.meteor.com. This breaks the app, because
          // force-ssl doesn't serve CORS headers on 302
          // redirects. (Plus it's undesirable to have clients
          // connecting to http://example.meteor.com when force-ssl is
          // in use.)
          DDP_DEFAULT_CONNECTION_URL: process.env.MOBILE_DDP_URL || Meteor.absoluteUrl(),
          ROOT_URL: process.env.MOBILE_ROOT_URL || Meteor.absoluteUrl()
        }
      },
      'web.browser': {
        runtimeConfigOverrides: {
          isModern: true
        }
      },
      'web.browser.legacy': {
        runtimeConfigOverrides: {
          isModern: false
        }
      }
    };

    WebAppInternals.generateBoilerplate = function () {
      // This boilerplate will be served to the mobile devices when used with
      // Meteor/Cordova for the Hot-Code Push and since the file will be served by
      // the device's server, it is important to set the DDP url to the actual
      // Meteor server accepting DDP connections and not the device's file server.
      syncQueue.runTask(function () {
        Object.keys(WebApp.clientPrograms).forEach(generateBoilerplateForArch);
      });
    };

    function generateBoilerplateForArch(arch) {
      const program = WebApp.clientPrograms[arch];
      const additionalOptions = defaultOptionsForArch[arch] || {};
      const {
        baseData
      } = boilerplateByArch[arch] = WebAppInternals.generateBoilerplateInstance(arch, program.manifest, additionalOptions); // We need the runtime config with overrides for meteor_runtime_config.js:

      program.meteorRuntimeConfig = JSON.stringify(_objectSpread(_objectSpread({}, __meteor_runtime_config__), additionalOptions.runtimeConfigOverrides || null));
      program.refreshableAssets = baseData.css.map(file => ({
        url: bundledJsCssUrlRewriteHook(file.url)
      }));
    }

    WebAppInternals.reloadClientPrograms(); // webserver

    var app = connect(); // Packages and apps can add handlers that run before any other Meteor
    // handlers via WebApp.rawConnectHandlers.

    var rawConnectHandlers = connect();
    app.use(rawConnectHandlers); // Auto-compress any json, javascript, or text.

    app.use(compress({
      filter: shouldCompress
    })); // parse cookies into an object

    app.use(cookieParser()); // We're not a proxy; reject (without crashing) attempts to treat us like
    // one. (See #1212.)

    app.use(function (req, res, next) {
      if (RoutePolicy.isValidUrl(req.url)) {
        next();
        return;
      }

      res.writeHead(400);
      res.write('Not a proxy');
      res.end();
    }); // Parse the query string into res.query. Used by oauth_server, but it's
    // generally pretty handy..
    //
    // Do this before the next middleware destroys req.url if a path prefix
    // is set to close #10111.

    app.use(function (request, response, next) {
      request.query = qs.parse(parseUrl(request.url).query);
      next();
    });

    function getPathParts(path) {
      const parts = path.split('/');

      while (parts[0] === '') parts.shift();

      return parts;
    }

    function isPrefixOf(prefix, array) {
      return prefix.length <= array.length && prefix.every((part, i) => part === array[i]);
    } // Strip off the path prefix, if it exists.


    app.use(function (request, response, next) {
      const pathPrefix = __meteor_runtime_config__.ROOT_URL_PATH_PREFIX;
      const {
        pathname,
        search
      } = parseUrl(request.url); // check if the path in the url starts with the path prefix

      if (pathPrefix) {
        const prefixParts = getPathParts(pathPrefix);
        const pathParts = getPathParts(pathname);

        if (isPrefixOf(prefixParts, pathParts)) {
          request.url = '/' + pathParts.slice(prefixParts.length).join('/');

          if (search) {
            request.url += search;
          }

          return next();
        }
      }

      if (pathname === '/favicon.ico' || pathname === '/robots.txt') {
        return next();
      }

      if (pathPrefix) {
        response.writeHead(404);
        response.write('Unknown path');
        response.end();
        return;
      }

      next();
    }); // Serve static files from the manifest.
    // This is inspired by the 'static' middleware.

    app.use(function (req, res, next) {
      WebAppInternals.staticFilesMiddleware(WebAppInternals.staticFilesByArch, req, res, next);
    }); // Core Meteor packages like dynamic-import can add handlers before
    // other handlers added by package and application code.

    app.use(WebAppInternals.meteorInternalHandlers = connect());
    /**
     * @name connectHandlersCallback(req, res, next)
     * @locus Server
     * @isprototype true
     * @summary callback handler for `WebApp.connectHandlers`
     * @param {Object} req
     * a Node.js
     * [IncomingMessage](https://nodejs.org/api/http.html#http_class_http_incomingmessage)
     * object with some extra properties. This argument can be used
     *  to get information about the incoming request.
     * @param {Object} res
     * a Node.js
     * [ServerResponse](http://nodejs.org/api/http.html#http_class_http_serverresponse)
     * object. Use this to write data that should be sent in response to the
     * request, and call `res.end()` when you are done.
     * @param {Function} next
     * Calling this function will pass on the handling of
     * this request to the next relevant handler.
     *
     */

    /**
     * @method connectHandlers
     * @memberof WebApp
     * @locus Server
     * @summary Register a handler for all HTTP requests.
     * @param {String} [path]
     * This handler will only be called on paths that match
     * this string. The match has to border on a `/` or a `.`.
     *
     * For example, `/hello` will match `/hello/world` and
     * `/hello.world`, but not `/hello_world`.
     * @param {connectHandlersCallback} handler
     * A handler function that will be called on HTTP requests.
     * See `connectHandlersCallback`
     *
     */
    // Packages and apps can add handlers to this via WebApp.connectHandlers.
    // They are inserted before our default handler.

    var packageAndAppHandlers = connect();
    app.use(packageAndAppHandlers);
    var suppressConnectErrors = false; // connect knows it is an error handler because it has 4 arguments instead of
    // 3. go figure.  (It is not smart enough to find such a thing if it's hidden
    // inside packageAndAppHandlers.)

    app.use(function (err, req, res, next) {
      if (!err || !suppressConnectErrors || !req.headers['x-suppress-error']) {
        next(err);
        return;
      }

      res.writeHead(err.status, {
        'Content-Type': 'text/plain'
      });
      res.end('An error message');
    });
    app.use(function (req, res, next) {
      return Promise.asyncApply(() => {
        var _Meteor$settings$pack5, _Meteor$settings$pack6;

        if (!appUrl(req.url)) {
          return next();
        } else if (req.method !== 'HEAD' && req.method !== 'GET' && !((_Meteor$settings$pack5 = Meteor.settings.packages) !== null && _Meteor$settings$pack5 !== void 0 && (_Meteor$settings$pack6 = _Meteor$settings$pack5.webapp) !== null && _Meteor$settings$pack6 !== void 0 && _Meteor$settings$pack6.alwaysReturnContent)) {
          const status = req.method === 'OPTIONS' ? 200 : 405;
          res.writeHead(status, {
            Allow: 'OPTIONS, GET, HEAD',
            'Content-Length': '0'
          });
          res.end();
        } else {
          var headers = {
            'Content-Type': 'text/html; charset=utf-8'
          };

          if (shuttingDown) {
            headers['Connection'] = 'Close';
          }

          var request = WebApp.categorizeRequest(req);

          if (request.url.query && request.url.query['meteor_css_resource']) {
            // In this case, we're requesting a CSS resource in the meteor-specific
            // way, but we don't have it.  Serve a static css file that indicates that
            // we didn't have it, so we can detect that and refresh.  Make sure
            // that any proxies or CDNs don't cache this error!  (Normally proxies
            // or CDNs are smart enough not to cache error pages, but in order to
            // make this hack work, we need to return the CSS file as a 200, which
            // would otherwise be cached.)
            headers['Content-Type'] = 'text/css; charset=utf-8';
            headers['Cache-Control'] = 'no-cache';
            res.writeHead(200, headers);
            res.write('.meteor-css-not-found-error { width: 0px;}');
            res.end();
            return;
          }

          if (request.url.query && request.url.query['meteor_js_resource']) {
            // Similarly, we're requesting a JS resource that we don't have.
            // Serve an uncached 404. (We can't use the same hack we use for CSS,
            // because actually acting on that hack requires us to have the JS
            // already!)
            headers['Cache-Control'] = 'no-cache';
            res.writeHead(404, headers);
            res.end('404 Not Found');
            return;
          }

          if (request.url.query && request.url.query['meteor_dont_serve_index']) {
            // When downloading files during a Cordova hot code push, we need
            // to detect if a file is not available instead of inadvertently
            // downloading the default index page.
            // So similar to the situation above, we serve an uncached 404.
            headers['Cache-Control'] = 'no-cache';
            res.writeHead(404, headers);
            res.end('404 Not Found');
            return;
          }

          const {
            arch
          } = request;
          assert.strictEqual(typeof arch, 'string', {
            arch
          });

          if (!hasOwn.call(WebApp.clientPrograms, arch)) {
            // We could come here in case we run with some architectures excluded
            headers['Cache-Control'] = 'no-cache';
            res.writeHead(404, headers);

            if (Meteor.isDevelopment) {
              res.end("No client program found for the ".concat(arch, " architecture."));
            } else {
              // Safety net, but this branch should not be possible.
              res.end('404 Not Found');
            }

            return;
          } // If pauseClient(arch) has been called, program.paused will be a
          // Promise that will be resolved when the program is unpaused.


          Promise.await(WebApp.clientPrograms[arch].paused);
          return getBoilerplateAsync(request, arch).then(_ref3 => {
            let {
              stream,
              statusCode,
              headers: newHeaders
            } = _ref3;

            if (!statusCode) {
              statusCode = res.statusCode ? res.statusCode : 200;
            }

            if (newHeaders) {
              Object.assign(headers, newHeaders);
            }

            res.writeHead(statusCode, headers);
            stream.pipe(res, {
              // End the response when the stream ends.
              end: true
            });
          }).catch(error => {
            Log.error('Error running template: ' + error.stack);
            res.writeHead(500, headers);
            res.end();
          });
        }
      });
    }); // Return 404 by default, if no other handlers serve this URL.

    app.use(function (req, res) {
      res.writeHead(404);
      res.end();
    });
    var httpServer = createServer(app);
    var onListeningCallbacks = []; // After 5 seconds w/o data on a socket, kill it.  On the other hand, if
    // there's an outstanding request, give it a higher timeout instead (to avoid
    // killing long-polling requests)

    httpServer.setTimeout(SHORT_SOCKET_TIMEOUT); // Do this here, and then also in livedata/stream_server.js, because
    // stream_server.js kills all the current request handlers when installing its
    // own.

    httpServer.on('request', WebApp._timeoutAdjustmentRequestCallback); // If the client gave us a bad request, tell it instead of just closing the
    // socket. This lets load balancers in front of us differentiate between "a
    // server is randomly closing sockets for no reason" and "client sent a bad
    // request".
    //
    // This will only work on Node 6; Node 4 destroys the socket before calling
    // this event. See https://github.com/nodejs/node/pull/4557/ for details.

    httpServer.on('clientError', (err, socket) => {
      // Pre-Node-6, do nothing.
      if (socket.destroyed) {
        return;
      }

      if (err.message === 'Parse Error') {
        socket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
      } else {
        // For other errors, use the default behavior as if we had no clientError
        // handler.
        socket.destroy(err);
      }
    }); // start up app

    _.extend(WebApp, {
      connectHandlers: packageAndAppHandlers,
      rawConnectHandlers: rawConnectHandlers,
      httpServer: httpServer,
      connectApp: app,
      // For testing.
      suppressConnectErrors: function () {
        suppressConnectErrors = true;
      },
      onListening: function (f) {
        if (onListeningCallbacks) onListeningCallbacks.push(f);else f();
      },
      // This can be overridden by users who want to modify how listening works
      // (eg, to run a proxy like Apollo Engine Proxy in front of the server).
      startListening: function (httpServer, listenOptions, cb) {
        httpServer.listen(listenOptions, cb);
      }
    }); // Let the rest of the packages (and Meteor.startup hooks) insert connect
    // middlewares and update __meteor_runtime_config__, then keep going to set up
    // actually serving HTML.


    exports.main = argv => {
      WebAppInternals.generateBoilerplate();

      const startHttpServer = listenOptions => {
        WebApp.startListening(httpServer, listenOptions, Meteor.bindEnvironment(() => {
          if (process.env.METEOR_PRINT_ON_LISTEN) {
            console.log('LISTENING');
          }

          const callbacks = onListeningCallbacks;
          onListeningCallbacks = null;
          callbacks.forEach(callback => {
            callback();
          });
        }, e => {
          console.error('Error listening:', e);
          console.error(e && e.stack);
        }));
      };

      let localPort = process.env.PORT || 0;
      let unixSocketPath = process.env.UNIX_SOCKET_PATH;

      if (unixSocketPath) {
        if (cluster.isWorker) {
          const workerName = cluster.worker.process.env.name || cluster.worker.id;
          unixSocketPath += '.' + workerName + '.sock';
        } // Start the HTTP server using a socket file.


        removeExistingSocketFile(unixSocketPath);
        startHttpServer({
          path: unixSocketPath
        });
        const unixSocketPermissions = (process.env.UNIX_SOCKET_PERMISSIONS || '').trim();

        if (unixSocketPermissions) {
          if (/^[0-7]{3}$/.test(unixSocketPermissions)) {
            chmodSync(unixSocketPath, parseInt(unixSocketPermissions, 8));
          } else {
            throw new Error('Invalid UNIX_SOCKET_PERMISSIONS specified');
          }
        }

        const unixSocketGroup = (process.env.UNIX_SOCKET_GROUP || '').trim();

        if (unixSocketGroup) {
          //whomst automatically handles both group names and numerical gids
          const unixSocketGroupInfo = whomst.sync.group(unixSocketGroup);

          if (unixSocketGroupInfo === null) {
            throw new Error('Invalid UNIX_SOCKET_GROUP name specified');
          }

          chownSync(unixSocketPath, userInfo().uid, unixSocketGroupInfo.gid);
        }

        registerSocketFileCleanup(unixSocketPath);
      } else {
        localPort = isNaN(Number(localPort)) ? localPort : Number(localPort);

        if (/\\\\?.+\\pipe\\?.+/.test(localPort)) {
          // Start the HTTP server using Windows Server style named pipe.
          startHttpServer({
            path: localPort
          });
        } else if (typeof localPort === 'number') {
          // Start the HTTP server using TCP.
          startHttpServer({
            port: localPort,
            host: process.env.BIND_IP || '0.0.0.0'
          });
        } else {
          throw new Error('Invalid PORT specified');
        }
      }

      return 'DAEMON';
    };
  }

  var inlineScriptsAllowed = true;

  WebAppInternals.inlineScriptsAllowed = function () {
    return inlineScriptsAllowed;
  };

  WebAppInternals.setInlineScriptsAllowed = function (value) {
    inlineScriptsAllowed = value;
    WebAppInternals.generateBoilerplate();
  };

  var sriMode;

  WebAppInternals.enableSubresourceIntegrity = function () {
    let use_credentials = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : false;
    sriMode = use_credentials ? 'use-credentials' : 'anonymous';
    WebAppInternals.generateBoilerplate();
  };

  WebAppInternals.setBundledJsCssUrlRewriteHook = function (hookFn) {
    bundledJsCssUrlRewriteHook = hookFn;
    WebAppInternals.generateBoilerplate();
  };

  WebAppInternals.setBundledJsCssPrefix = function (prefix) {
    var self = this;
    self.setBundledJsCssUrlRewriteHook(function (url) {
      return prefix + url;
    });
  }; // Packages can call `WebAppInternals.addStaticJs` to specify static
  // JavaScript to be included in the app. This static JS will be inlined,
  // unless inline scripts have been disabled, in which case it will be
  // served under `/<sha1 of contents>`.


  var additionalStaticJs = {};

  WebAppInternals.addStaticJs = function (contents) {
    additionalStaticJs['/' + sha1(contents) + '.js'] = contents;
  }; // Exported for tests


  WebAppInternals.getBoilerplate = getBoilerplate;
  WebAppInternals.additionalStaticJs = additionalStaticJs; // Start the server!

  runWebAppServer();
}.call(this, module);
////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

},"connect.js":function module(require,exports,module){

////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
//                                                                                                                    //
// packages/webapp/connect.js                                                                                         //
//                                                                                                                    //
////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
                                                                                                                      //
module.export({
  connect: () => connect
});
let npmConnect;
module.link("connect", {
  default(v) {
    npmConnect = v;
  }

}, 0);

function connect() {
  for (var _len = arguments.length, connectArgs = new Array(_len), _key = 0; _key < _len; _key++) {
    connectArgs[_key] = arguments[_key];
  }

  const handlers = npmConnect.apply(this, connectArgs);
  const originalUse = handlers.use; // Wrap the handlers.use method so that any provided handler functions
  // always run in a Fiber.

  handlers.use = function use() {
    for (var _len2 = arguments.length, useArgs = new Array(_len2), _key2 = 0; _key2 < _len2; _key2++) {
      useArgs[_key2] = arguments[_key2];
    }

    const {
      stack
    } = this;
    const originalLength = stack.length;
    const result = originalUse.apply(this, useArgs); // If we just added anything to the stack, wrap each new entry.handle
    // with a function that calls Promise.asyncApply to ensure the
    // original handler runs in a Fiber.

    for (let i = originalLength; i < stack.length; ++i) {
      const entry = stack[i];
      const originalHandle = entry.handle;

      if (originalHandle.length >= 4) {
        // If the original handle had four (or more) parameters, the
        // wrapper must also have four parameters, since connect uses
        // handle.length to determine whether to pass the error as the first
        // argument to the handle function.
        entry.handle = function handle(err, req, res, next) {
          return Promise.asyncApply(originalHandle, this, arguments);
        };
      } else {
        entry.handle = function handle(req, res, next) {
          return Promise.asyncApply(originalHandle, this, arguments);
        };
      }
    }

    return result;
  };

  return handlers;
}
////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

},"socket_file.js":function module(require,exports,module){

////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
//                                                                                                                    //
// packages/webapp/socket_file.js                                                                                     //
//                                                                                                                    //
////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
                                                                                                                      //
module.export({
  removeExistingSocketFile: () => removeExistingSocketFile,
  registerSocketFileCleanup: () => registerSocketFileCleanup
});
let statSync, unlinkSync, existsSync;
module.link("fs", {
  statSync(v) {
    statSync = v;
  },

  unlinkSync(v) {
    unlinkSync = v;
  },

  existsSync(v) {
    existsSync = v;
  }

}, 0);

const removeExistingSocketFile = socketPath => {
  try {
    if (statSync(socketPath).isSocket()) {
      // Since a new socket file will be created, remove the existing
      // file.
      unlinkSync(socketPath);
    } else {
      throw new Error("An existing file was found at \"".concat(socketPath, "\" and it is not ") + 'a socket file. Please confirm PORT is pointing to valid and ' + 'un-used socket file path.');
    }
  } catch (error) {
    // If there is no existing socket file to cleanup, great, we'll
    // continue normally. If the caught exception represents any other
    // issue, re-throw.
    if (error.code !== 'ENOENT') {
      throw error;
    }
  }
};

const registerSocketFileCleanup = function (socketPath) {
  let eventEmitter = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : process;
  ['exit', 'SIGINT', 'SIGHUP', 'SIGTERM'].forEach(signal => {
    eventEmitter.on(signal, Meteor.bindEnvironment(() => {
      if (existsSync(socketPath)) {
        unlinkSync(socketPath);
      }
    }));
  });
};
////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

},"node_modules":{"connect":{"package.json":function module(require,exports,module){

////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
//                                                                                                                    //
// node_modules/meteor/webapp/node_modules/connect/package.json                                                       //
//                                                                                                                    //
////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
                                                                                                                      //
module.exports = {
  "name": "connect",
  "version": "3.7.0"
};

////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

},"index.js":function module(require,exports,module){

////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
//                                                                                                                    //
// node_modules/meteor/webapp/node_modules/connect/index.js                                                           //
//                                                                                                                    //
////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
                                                                                                                      //
module.useNode();
////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

}},"compression":{"package.json":function module(require,exports,module){

////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
//                                                                                                                    //
// node_modules/meteor/webapp/node_modules/compression/package.json                                                   //
//                                                                                                                    //
////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
                                                                                                                      //
module.exports = {
  "name": "compression",
  "version": "1.7.4"
};

////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

},"index.js":function module(require,exports,module){

////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
//                                                                                                                    //
// node_modules/meteor/webapp/node_modules/compression/index.js                                                       //
//                                                                                                                    //
////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
                                                                                                                      //
module.useNode();
////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

}},"cookie-parser":{"package.json":function module(require,exports,module){

////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
//                                                                                                                    //
// node_modules/meteor/webapp/node_modules/cookie-parser/package.json                                                 //
//                                                                                                                    //
////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
                                                                                                                      //
module.exports = {
  "name": "cookie-parser",
  "version": "1.4.5"
};

////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

},"index.js":function module(require,exports,module){

////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
//                                                                                                                    //
// node_modules/meteor/webapp/node_modules/cookie-parser/index.js                                                     //
//                                                                                                                    //
////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
                                                                                                                      //
module.useNode();
////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

}},"qs":{"package.json":function module(require,exports,module){

////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
//                                                                                                                    //
// node_modules/meteor/webapp/node_modules/qs/package.json                                                            //
//                                                                                                                    //
////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
                                                                                                                      //
module.exports = {
  "name": "qs",
  "version": "6.10.1",
  "main": "lib/index.js"
};

////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

},"lib":{"index.js":function module(require,exports,module){

////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
//                                                                                                                    //
// node_modules/meteor/webapp/node_modules/qs/lib/index.js                                                            //
//                                                                                                                    //
////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
                                                                                                                      //
module.useNode();
////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

}}},"parseurl":{"package.json":function module(require,exports,module){

////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
//                                                                                                                    //
// node_modules/meteor/webapp/node_modules/parseurl/package.json                                                      //
//                                                                                                                    //
////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
                                                                                                                      //
module.exports = {
  "name": "parseurl",
  "version": "1.3.3"
};

////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

},"index.js":function module(require,exports,module){

////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
//                                                                                                                    //
// node_modules/meteor/webapp/node_modules/parseurl/index.js                                                          //
//                                                                                                                    //
////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
                                                                                                                      //
module.useNode();
////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

}},"basic-auth-connect":{"package.json":function module(require,exports,module){

////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
//                                                                                                                    //
// node_modules/meteor/webapp/node_modules/basic-auth-connect/package.json                                            //
//                                                                                                                    //
////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
                                                                                                                      //
module.exports = {
  "name": "basic-auth-connect",
  "version": "1.0.0"
};

////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

},"index.js":function module(require,exports,module){

////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
//                                                                                                                    //
// node_modules/meteor/webapp/node_modules/basic-auth-connect/index.js                                                //
//                                                                                                                    //
////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
                                                                                                                      //
module.useNode();
////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

}},"useragent":{"package.json":function module(require,exports,module){

////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
//                                                                                                                    //
// node_modules/meteor/webapp/node_modules/useragent/package.json                                                     //
//                                                                                                                    //
////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
                                                                                                                      //
module.exports = {
  "name": "useragent",
  "version": "2.3.0",
  "main": "./index.js"
};

////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

},"index.js":function module(require,exports,module){

////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
//                                                                                                                    //
// node_modules/meteor/webapp/node_modules/useragent/index.js                                                         //
//                                                                                                                    //
////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
                                                                                                                      //
module.useNode();
////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

}},"send":{"package.json":function module(require,exports,module){

////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
//                                                                                                                    //
// node_modules/meteor/webapp/node_modules/send/package.json                                                          //
//                                                                                                                    //
////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
                                                                                                                      //
module.exports = {
  "name": "send",
  "version": "0.17.1"
};

////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

},"index.js":function module(require,exports,module){

////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
//                                                                                                                    //
// node_modules/meteor/webapp/node_modules/send/index.js                                                              //
//                                                                                                                    //
////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
                                                                                                                      //
module.useNode();
////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

}},"@vlasky":{"whomst":{"package.json":function module(require,exports,module){

////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
//                                                                                                                    //
// node_modules/meteor/webapp/node_modules/@vlasky/whomst/package.json                                                //
//                                                                                                                    //
////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
                                                                                                                      //
module.exports = {
  "name": "@vlasky/whomst",
  "version": "0.1.7",
  "main": "index.js"
};

////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

},"index.js":function module(require,exports,module){

////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
//                                                                                                                    //
// node_modules/meteor/webapp/node_modules/@vlasky/whomst/index.js                                                    //
//                                                                                                                    //
////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
                                                                                                                      //
module.useNode();
////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

}}}}}}}},{
  "extensions": [
    ".js",
    ".json"
  ]
});

var exports = require("/node_modules/meteor/webapp/webapp_server.js");

/* Exports */
Package._define("webapp", exports, {
  WebApp: WebApp,
  WebAppInternals: WebAppInternals,
  main: main
});

})();

//# sourceURL=meteor://💻app/packages/webapp.js
//# sourceMappingURL=data:application/json;charset=utf8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIm1ldGVvcjovL/CfkrthcHAvcGFja2FnZXMvd2ViYXBwL3dlYmFwcF9zZXJ2ZXIuanMiLCJtZXRlb3I6Ly/wn5K7YXBwL3BhY2thZ2VzL3dlYmFwcC9jb25uZWN0LmpzIiwibWV0ZW9yOi8v8J+Su2FwcC9wYWNrYWdlcy93ZWJhcHAvc29ja2V0X2ZpbGUuanMiXSwibmFtZXMiOlsiX29iamVjdFNwcmVhZCIsIm1vZHVsZTEiLCJsaW5rIiwiZGVmYXVsdCIsInYiLCJleHBvcnQiLCJXZWJBcHAiLCJXZWJBcHBJbnRlcm5hbHMiLCJhc3NlcnQiLCJyZWFkRmlsZVN5bmMiLCJjaG1vZFN5bmMiLCJjaG93blN5bmMiLCJjcmVhdGVTZXJ2ZXIiLCJ1c2VySW5mbyIsInBhdGhKb2luIiwicGF0aERpcm5hbWUiLCJqb2luIiwiZGlybmFtZSIsInBhcnNlVXJsIiwicGFyc2UiLCJjcmVhdGVIYXNoIiwiY29ubmVjdCIsImNvbXByZXNzIiwiY29va2llUGFyc2VyIiwicXMiLCJwYXJzZVJlcXVlc3QiLCJiYXNpY0F1dGgiLCJsb29rdXBVc2VyQWdlbnQiLCJsb29rdXAiLCJpc01vZGVybiIsInNlbmQiLCJyZW1vdmVFeGlzdGluZ1NvY2tldEZpbGUiLCJyZWdpc3RlclNvY2tldEZpbGVDbGVhbnVwIiwiY2x1c3RlciIsIndob21zdCIsIm9uTWVzc2FnZSIsIlNIT1JUX1NPQ0tFVF9USU1FT1VUIiwiTE9OR19TT0NLRVRfVElNRU9VVCIsImhhc093biIsIk9iamVjdCIsInByb3RvdHlwZSIsImhhc093blByb3BlcnR5IiwiTnBtTW9kdWxlcyIsInZlcnNpb24iLCJOcG0iLCJyZXF1aXJlIiwibW9kdWxlIiwiZGVmYXVsdEFyY2giLCJjbGllbnRQcm9ncmFtcyIsImFyY2hQYXRoIiwiYnVuZGxlZEpzQ3NzVXJsUmV3cml0ZUhvb2siLCJ1cmwiLCJidW5kbGVkUHJlZml4IiwiX19tZXRlb3JfcnVudGltZV9jb25maWdfXyIsIlJPT1RfVVJMX1BBVEhfUFJFRklYIiwic2hhMSIsImNvbnRlbnRzIiwiaGFzaCIsInVwZGF0ZSIsImRpZ2VzdCIsInNob3VsZENvbXByZXNzIiwicmVxIiwicmVzIiwiaGVhZGVycyIsImZpbHRlciIsImNhbWVsQ2FzZSIsIm5hbWUiLCJwYXJ0cyIsInNwbGl0IiwidG9Mb3dlckNhc2UiLCJpIiwibGVuZ3RoIiwiY2hhckF0IiwidG9VcHBlckNhc2UiLCJzdWJzdHIiLCJpZGVudGlmeUJyb3dzZXIiLCJ1c2VyQWdlbnRTdHJpbmciLCJ1c2VyQWdlbnQiLCJmYW1pbHkiLCJtYWpvciIsIm1pbm9yIiwicGF0Y2giLCJjYXRlZ29yaXplUmVxdWVzdCIsImJyb3dzZXIiLCJhcmNoIiwibW9kZXJuIiwicGF0aCIsInBhdGhuYW1lIiwiY2F0ZWdvcml6ZWQiLCJkeW5hbWljSGVhZCIsImR5bmFtaWNCb2R5IiwiY29va2llcyIsInBhdGhQYXJ0cyIsImFyY2hLZXkiLCJzdGFydHNXaXRoIiwiYXJjaENsZWFuZWQiLCJzbGljZSIsImNhbGwiLCJzcGxpY2UiLCJhc3NpZ24iLCJwcmVmZXJyZWRBcmNoT3JkZXIiLCJodG1sQXR0cmlidXRlSG9va3MiLCJnZXRIdG1sQXR0cmlidXRlcyIsInJlcXVlc3QiLCJjb21iaW5lZEF0dHJpYnV0ZXMiLCJfIiwiZWFjaCIsImhvb2siLCJhdHRyaWJ1dGVzIiwiRXJyb3IiLCJleHRlbmQiLCJhZGRIdG1sQXR0cmlidXRlSG9vayIsInB1c2giLCJhcHBVcmwiLCJSb3V0ZVBvbGljeSIsImNsYXNzaWZ5IiwiTWV0ZW9yIiwic3RhcnR1cCIsImdldHRlciIsImtleSIsInByb2dyYW0iLCJ2YWx1ZSIsImNhbGN1bGF0ZUNsaWVudEhhc2giLCJjbGllbnRIYXNoIiwiY2FsY3VsYXRlQ2xpZW50SGFzaFJlZnJlc2hhYmxlIiwiY2FsY3VsYXRlQ2xpZW50SGFzaE5vblJlZnJlc2hhYmxlIiwiY2FsY3VsYXRlQ2xpZW50SGFzaFJlcGxhY2VhYmxlIiwiZ2V0UmVmcmVzaGFibGVBc3NldHMiLCJfdGltZW91dEFkanVzdG1lbnRSZXF1ZXN0Q2FsbGJhY2siLCJzZXRUaW1lb3V0IiwiZmluaXNoTGlzdGVuZXJzIiwibGlzdGVuZXJzIiwicmVtb3ZlQWxsTGlzdGVuZXJzIiwib24iLCJsIiwiYm9pbGVycGxhdGVCeUFyY2giLCJib2lsZXJwbGF0ZURhdGFDYWxsYmFja3MiLCJjcmVhdGUiLCJyZWdpc3RlckJvaWxlcnBsYXRlRGF0YUNhbGxiYWNrIiwiY2FsbGJhY2siLCJwcmV2aW91c0NhbGxiYWNrIiwic3RyaWN0RXF1YWwiLCJnZXRCb2lsZXJwbGF0ZSIsImdldEJvaWxlcnBsYXRlQXN5bmMiLCJhd2FpdCIsImVuY29kZVJ1bnRpbWVDb25maWciLCJydGltZUNvbmZpZyIsIkpTT04iLCJzdHJpbmdpZnkiLCJlbmNvZGVVUklDb21wb25lbnQiLCJkZWNvZGVSdW50aW1lQ29uZmlnIiwicnRpbWVDb25maWdTdHIiLCJkZWNvZGVVUklDb21wb25lbnQiLCJydW50aW1lQ29uZmlnIiwiaG9va3MiLCJIb29rIiwidXBkYXRlSG9va3MiLCJpc1VwZGF0ZWRCeUFyY2giLCJhZGRSdW50aW1lQ29uZmlnSG9vayIsInJlZ2lzdGVyIiwiYm9pbGVycGxhdGUiLCJmb3JFYWNoIiwibWV0ZW9yUnVudGltZUNvbmZpZyIsImVuY29kZWRDdXJyZW50Q29uZmlnIiwiYmFzZURhdGEiLCJ1cGRhdGVkIiwiZGF0YSIsImh0bWxBdHRyaWJ1dGVzIiwicGljayIsIm1hZGVDaGFuZ2VzIiwicHJvbWlzZSIsIlByb21pc2UiLCJyZXNvbHZlIiwia2V5cyIsInRoZW4iLCJyZXN1bHQiLCJzdHJlYW0iLCJ0b0hUTUxTdHJlYW0iLCJzdGF0dXNDb2RlIiwiYWRkVXBkYXRlZE5vdGlmeUhvb2siLCJoYW5kbGVyIiwiZ2VuZXJhdGVCb2lsZXJwbGF0ZUluc3RhbmNlIiwibWFuaWZlc3QiLCJhZGRpdGlvbmFsT3B0aW9ucyIsInJ1bnRpbWVDb25maWdPdmVycmlkZXMiLCJjYiIsIkJvaWxlcnBsYXRlIiwicGF0aE1hcHBlciIsIml0ZW1QYXRoIiwiYmFzZURhdGFFeHRlbnNpb24iLCJhZGRpdGlvbmFsU3RhdGljSnMiLCJtYXAiLCJtZXRlb3JSdW50aW1lSGFzaCIsInJvb3RVcmxQYXRoUHJlZml4Iiwic3JpTW9kZSIsImlubGluZVNjcmlwdHNBbGxvd2VkIiwiaW5saW5lIiwic3RhdGljRmlsZXNNaWRkbGV3YXJlIiwic3RhdGljRmlsZXNCeUFyY2giLCJuZXh0IiwiZSIsInNlcnZlU3RhdGljSnMiLCJzIiwibWV0aG9kIiwic2V0dGluZ3MiLCJwYWNrYWdlcyIsIndlYmFwcCIsImFsd2F5c1JldHVybkNvbnRlbnQiLCJ3cml0ZUhlYWQiLCJCdWZmZXIiLCJieXRlTGVuZ3RoIiwid3JpdGUiLCJlbmQiLCJzdGF0dXMiLCJBbGxvdyIsImhhcyIsInBhdXNlZCIsImluZm8iLCJnZXRTdGF0aWNGaWxlSW5mbyIsIm1heEFnZSIsImNhY2hlYWJsZSIsInNldEhlYWRlciIsInNvdXJjZU1hcFVybCIsInR5cGUiLCJjb250ZW50IiwiYWJzb2x1dGVQYXRoIiwibWF4YWdlIiwiZG90ZmlsZXMiLCJsYXN0TW9kaWZpZWQiLCJlcnIiLCJMb2ciLCJlcnJvciIsInBpcGUiLCJvcmlnaW5hbFBhdGgiLCJzdGF0aWNBcmNoTGlzdCIsImFyY2hJbmRleCIsImluZGV4T2YiLCJ1bnNoaWZ0Iiwic29tZSIsInN0YXRpY0ZpbGVzIiwiZmluYWxpemUiLCJwYXJzZVBvcnQiLCJwb3J0IiwicGFyc2VkUG9ydCIsInBhcnNlSW50IiwiTnVtYmVyIiwiaXNOYU4iLCJwYXVzZUNsaWVudCIsImdlbmVyYXRlQ2xpZW50UHJvZ3JhbSIsInJ1bldlYkFwcFNlcnZlciIsInNodXR0aW5nRG93biIsInN5bmNRdWV1ZSIsIl9TeW5jaHJvbm91c1F1ZXVlIiwiZ2V0SXRlbVBhdGhuYW1lIiwiaXRlbVVybCIsInJlbG9hZENsaWVudFByb2dyYW1zIiwicnVuVGFzayIsImNvbmZpZ0pzb24iLCJfX21ldGVvcl9ib290c3RyYXBfXyIsImNsaWVudEFyY2hzIiwiY2xpZW50UGF0aHMiLCJzdGFjayIsInByb2Nlc3MiLCJleGl0IiwidW5wYXVzZSIsImNsaWVudERpciIsInNlcnZlckRpciIsInByb2dyYW1Kc29uUGF0aCIsInByb2dyYW1Kc29uIiwiY29kZSIsImZvcm1hdCIsIml0ZW0iLCJ3aGVyZSIsInNvdXJjZU1hcCIsIlBVQkxJQ19TRVRUSU5HUyIsImNvbmZpZ092ZXJyaWRlcyIsIm9sZFByb2dyYW0iLCJuZXdQcm9ncmFtIiwiV2ViQXBwSGFzaGluZyIsInZlcnNpb25SZWZyZXNoYWJsZSIsInZlcnNpb25Ob25SZWZyZXNoYWJsZSIsInJlcGxhY2VhYmxlIiwidmVyc2lvblJlcGxhY2VhYmxlIiwiX3R5cGUiLCJpc1Byb2R1Y3Rpb24iLCJjb3Jkb3ZhQ29tcGF0aWJpbGl0eVZlcnNpb25zIiwiaG1yVmVyc2lvbiIsIm1hbmlmZXN0VXJsUHJlZml4IiwicmVwbGFjZSIsIm1hbmlmZXN0VXJsIiwiUGFja2FnZSIsImF1dG91cGRhdGUiLCJBVVRPVVBEQVRFX1ZFUlNJT04iLCJBdXRvdXBkYXRlIiwiYXV0b3VwZGF0ZVZlcnNpb24iLCJlbnYiLCJnZW5lcmF0ZUJvaWxlcnBsYXRlRm9yQXJjaCIsImRlZmF1bHRPcHRpb25zRm9yQXJjaCIsIkREUF9ERUZBVUxUX0NPTk5FQ1RJT05fVVJMIiwiTU9CSUxFX0REUF9VUkwiLCJhYnNvbHV0ZVVybCIsIlJPT1RfVVJMIiwiTU9CSUxFX1JPT1RfVVJMIiwiZ2VuZXJhdGVCb2lsZXJwbGF0ZSIsInJlZnJlc2hhYmxlQXNzZXRzIiwiY3NzIiwiZmlsZSIsImFwcCIsInJhd0Nvbm5lY3RIYW5kbGVycyIsInVzZSIsImlzVmFsaWRVcmwiLCJyZXNwb25zZSIsInF1ZXJ5IiwiZ2V0UGF0aFBhcnRzIiwic2hpZnQiLCJpc1ByZWZpeE9mIiwicHJlZml4IiwiYXJyYXkiLCJldmVyeSIsInBhcnQiLCJwYXRoUHJlZml4Iiwic2VhcmNoIiwicHJlZml4UGFydHMiLCJtZXRlb3JJbnRlcm5hbEhhbmRsZXJzIiwicGFja2FnZUFuZEFwcEhhbmRsZXJzIiwic3VwcHJlc3NDb25uZWN0RXJyb3JzIiwiaXNEZXZlbG9wbWVudCIsIm5ld0hlYWRlcnMiLCJjYXRjaCIsImh0dHBTZXJ2ZXIiLCJvbkxpc3RlbmluZ0NhbGxiYWNrcyIsInNvY2tldCIsImRlc3Ryb3llZCIsIm1lc3NhZ2UiLCJkZXN0cm95IiwiY29ubmVjdEhhbmRsZXJzIiwiY29ubmVjdEFwcCIsIm9uTGlzdGVuaW5nIiwiZiIsInN0YXJ0TGlzdGVuaW5nIiwibGlzdGVuT3B0aW9ucyIsImxpc3RlbiIsImV4cG9ydHMiLCJtYWluIiwiYXJndiIsInN0YXJ0SHR0cFNlcnZlciIsImJpbmRFbnZpcm9ubWVudCIsIk1FVEVPUl9QUklOVF9PTl9MSVNURU4iLCJjb25zb2xlIiwibG9nIiwiY2FsbGJhY2tzIiwibG9jYWxQb3J0IiwiUE9SVCIsInVuaXhTb2NrZXRQYXRoIiwiVU5JWF9TT0NLRVRfUEFUSCIsImlzV29ya2VyIiwid29ya2VyTmFtZSIsIndvcmtlciIsImlkIiwidW5peFNvY2tldFBlcm1pc3Npb25zIiwiVU5JWF9TT0NLRVRfUEVSTUlTU0lPTlMiLCJ0cmltIiwidGVzdCIsInVuaXhTb2NrZXRHcm91cCIsIlVOSVhfU09DS0VUX0dST1VQIiwidW5peFNvY2tldEdyb3VwSW5mbyIsInN5bmMiLCJncm91cCIsInVpZCIsImdpZCIsImhvc3QiLCJCSU5EX0lQIiwic2V0SW5saW5lU2NyaXB0c0FsbG93ZWQiLCJlbmFibGVTdWJyZXNvdXJjZUludGVncml0eSIsInVzZV9jcmVkZW50aWFscyIsInNldEJ1bmRsZWRKc0Nzc1VybFJld3JpdGVIb29rIiwiaG9va0ZuIiwic2V0QnVuZGxlZEpzQ3NzUHJlZml4Iiwic2VsZiIsImFkZFN0YXRpY0pzIiwibnBtQ29ubmVjdCIsImNvbm5lY3RBcmdzIiwiaGFuZGxlcnMiLCJhcHBseSIsIm9yaWdpbmFsVXNlIiwidXNlQXJncyIsIm9yaWdpbmFsTGVuZ3RoIiwiZW50cnkiLCJvcmlnaW5hbEhhbmRsZSIsImhhbmRsZSIsImFzeW5jQXBwbHkiLCJhcmd1bWVudHMiLCJzdGF0U3luYyIsInVubGlua1N5bmMiLCJleGlzdHNTeW5jIiwic29ja2V0UGF0aCIsImlzU29ja2V0IiwiZXZlbnRFbWl0dGVyIiwic2lnbmFsIl0sIm1hcHBpbmdzIjoiOzs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7O0FBQUEsTUFBSUEsYUFBSjs7QUFBa0JDLFNBQU8sQ0FBQ0MsSUFBUixDQUFhLHNDQUFiLEVBQW9EO0FBQUNDLFdBQU8sQ0FBQ0MsQ0FBRCxFQUFHO0FBQUNKLG1CQUFhLEdBQUNJLENBQWQ7QUFBZ0I7O0FBQTVCLEdBQXBELEVBQWtGLENBQWxGO0FBQWxCSCxTQUFPLENBQUNJLE1BQVIsQ0FBZTtBQUFDQyxVQUFNLEVBQUMsTUFBSUEsTUFBWjtBQUFtQkMsbUJBQWUsRUFBQyxNQUFJQTtBQUF2QyxHQUFmO0FBQXdFLE1BQUlDLE1BQUo7QUFBV1AsU0FBTyxDQUFDQyxJQUFSLENBQWEsUUFBYixFQUFzQjtBQUFDQyxXQUFPLENBQUNDLENBQUQsRUFBRztBQUFDSSxZQUFNLEdBQUNKLENBQVA7QUFBUzs7QUFBckIsR0FBdEIsRUFBNkMsQ0FBN0M7QUFBZ0QsTUFBSUssWUFBSixFQUFpQkMsU0FBakIsRUFBMkJDLFNBQTNCO0FBQXFDVixTQUFPLENBQUNDLElBQVIsQ0FBYSxJQUFiLEVBQWtCO0FBQUNPLGdCQUFZLENBQUNMLENBQUQsRUFBRztBQUFDSyxrQkFBWSxHQUFDTCxDQUFiO0FBQWUsS0FBaEM7O0FBQWlDTSxhQUFTLENBQUNOLENBQUQsRUFBRztBQUFDTSxlQUFTLEdBQUNOLENBQVY7QUFBWSxLQUExRDs7QUFBMkRPLGFBQVMsQ0FBQ1AsQ0FBRCxFQUFHO0FBQUNPLGVBQVMsR0FBQ1AsQ0FBVjtBQUFZOztBQUFwRixHQUFsQixFQUF3RyxDQUF4RztBQUEyRyxNQUFJUSxZQUFKO0FBQWlCWCxTQUFPLENBQUNDLElBQVIsQ0FBYSxNQUFiLEVBQW9CO0FBQUNVLGdCQUFZLENBQUNSLENBQUQsRUFBRztBQUFDUSxrQkFBWSxHQUFDUixDQUFiO0FBQWU7O0FBQWhDLEdBQXBCLEVBQXNE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QXdDckcsT0FBeEMsQ0FBZ0Q2TyxNQUFNLElBQUk7QUFDeERELGdCQUFZLENBQUN4USxFQUFiLENBQWdCeVEsTUFBaEIsRUFBd0IxUixNQUFNLENBQUNzTyxlQUFQLENBQXVCLE1BQU07QUFDbkQsVUFBSWdELFVBQVUsQ0FBQ0MsVUFBRCxDQUFkLEVBQTRCO0FBQzFCRixrQkFBVSxDQUFDRSxVQUFELENBQVY7QUFDRDtBQUNGLEtBSnVCLENBQXhCO0FBS0QsR0FORDtBQU9ELENBVEksQyIsImZpbGUiOiIvcGFja2FnZXMvd2ViYXBwLmpzIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0IGFzc2VydCBmcm9tICdhc3NlcnQnO1xuaW1wb3J0IHsgcmVhZEZpbGVTeW5jLCBjaG1vZFN5bmMsIGNob3duU3luYyB9IGZyb20gJ2ZzJztcbmltcG9ydCB7IGNyZWF0ZVNlcnZlciB9IGZyb20gJ2h0dHAnO1xuaW1wb3J0IHsgdXNlckluZm8gfSBmcm9tICdvcyc7XG5pbXBvcnQgeyBqb2luIGFzIHBhdGhKb2luLCBkaXJuYW1lIGFzIHBhdGhEaXJuYW1lIH0gZnJvbSAncGF0aCc7XG5pbXBvcnQgeyBwYXJzZSBhcyBwYXJzZVVybCB9IGZyb20gJ3VybCc7XG5pbXBvcnQgeyBjcmVhdGVIYXNoIH0gZnJvbSAnY3J5cHRvJztcbmltcG9ydCB7IGNvbm5lY3QgfSBmcm9tICcuL2Nvbm5lY3QuanMnO1xuaW1wb3J0IGNvbXByZXNzIGZyb20gJ2NvbXByZXNzaW9uJztcbmltcG9ydCBjb29raWVQYXJzZXIgZnJvbSAnY29va2llLXBhcnNlcic7XG5pbXBvcnQgcXMgZnJvbSAncXMnO1xuaW1wb3J0IHBhcnNlUmVxdWVzdCBmcm9tICdwYXJzZXVybCc7XG5pbXBvcnQgYmFzaWNBdXRoIGZyb20gJ2Jhc2ljLWF1dGgtY29ubmVjdCc7XG5pbXBvcnQgeyBsb29rdXAgYXMgbG9va3VwVXNlckFnZW50IH0gZnJvbSAndXNlcmFnZW50JztcbmltcG9ydCB7IGlzTW9kZXJuIH0gZnJvbSAnbWV0ZW9yL21vZGVybi1icm93c2Vycyc7XG5pbXBvcnQgc2VuZCBmcm9tICdzZW5kJztcbmltcG9ydCB7XG4gIHJlbW92ZUV4aXN0aW5nU29ja2V0RmlsZSxcbiAgcmVnaXN0ZXJTb2NrZXRGaWxlQ2xlYW51cCxcbn0gZnJvbSAnLi9zb2NrZXRfZmlsZS5qcyc7XG5pbXBvcnQgY2x1c3RlciBmcm9tICdjbHVzdGVyJztcbmltcG9ydCB3aG9tc3QgZnJvbSAnQHZsYXNreS93aG9tc3QnO1xuXG52YXIgU0hPUlRfU09DS0VUX1RJTUVPVVQgPSA1ICogMTAwMDtcbnZhciBMT05HX1NPQ0tFVF9USU1FT1VUID0gMTIwICogMTAwMDtcblxuZXhwb3J0IGNvbnN0IFdlYkFwcCA9IHt9O1xuZXhwb3J0IGNvbnN0IFdlYkFwcEludGVybmFscyA9IHt9O1xuXG5jb25zdCBoYXNPd24gPSBPYmplY3QucHJvdG90eXBlLmhhc093blByb3BlcnR5O1xuXG4vLyBiYWNrd2FyZHMgY29tcGF0IHRvIDIuMCBvZiBjb25uZWN0XG5jb25uZWN0LmJhc2ljQXV0aCA9IGJhc2ljQXV0aDtcblxuV2ViQXBwSW50ZXJuYWxzLk5wbU1vZHVsZXMgPSB7XG4gIGNvbm5lY3Q6IHtcbiAgICB2ZXJzaW9uOiBOcG0ucmVxdWlyZSgnY29ubmVjdC9wYWNrYWdlLmpzb24nKS52ZXJzaW9uLFxuICAgIG1vZHVsZTogY29ubmVjdCxcbiAgfSxcbn07XG5cbi8vIFRob3VnaCB3ZSBtaWdodCBwcmVmZXIgdG8gdXNlIHdlYi5icm93c2VyIChtb2Rlcm4pIGFzIHRoZSBkZWZhdWx0XG4vLyBhcmNoaXRlY3R1cmUsIHNhZmV0eSByZXF1aXJlcyBhIG1vcmUgY29tcGF0aWJsZSBkZWZhdWx0QXJjaC5cbldlYkFwcC5kZWZhdWx0QXJjaCA9ICd3ZWIuYnJvd3Nlci5sZWdhY3knO1xuXG4vLyBYWFggbWFwcyBhcmNocyB0byBtYW5pZmVzdHNcbldlYkFwcC5jbGllbnRQcm9ncmFtcyA9IHt9O1xuXG4vLyBYWFggbWFwcyBhcmNocyB0byBwcm9ncmFtIHBhdGggb24gZmlsZXN5c3RlbVxudmFyIGFyY2hQYXRoID0ge307XG5cbnZhciBidW5kbGVkSnNDc3NVcmxSZXdyaXRlSG9vayA9IGZ1bmN0aW9uKHVybCkge1xuICB2YXIgYnVuZGxlZFByZWZpeCA9IF9fbWV0ZW9yX3J1bnRpbWVfY29uZmlnX18uUk9PVF9VUkxfUEFUSF9QUkVGSVggfHwgJyc7XG4gIHJldHVybiBidW5kbGVkUHJlZml4ICsgdXJsO1xufTtcblxudmFyIHNoYTEgPSBmdW5jdGlvbihjb250ZW50cykge1xuICB2YXIgaGFzaCA9IGNyZWF0ZUhhc2goJ3NoYTEnKTtcbiAgaGFzaC51cGRhdGUoY29udGVudHMpO1xuICByZXR1cm4gaGFzaC5kaWdlc3QoJ2hleCcpO1xufTtcblxuZnVuY3Rpb24gc2hvdWxkQ29tcHJlc3MocmVxLCByZXMpIHtcbiAgaWYgKHJlcS5oZWFkZXJzWyd4LW5vLWNvbXByZXNzaW9uJ10pIHtcbiAgICAvLyBkb24ndCBjb21wcmVzcyByZXNwb25zZXMgd2l0aCB0aGlzIHJlcXVlc3QgaGVhZGVyXG4gICAgcmV0dXJuIGZhbHNlO1xuICB9XG5cbiAgLy8gZmFsbGJhY2sgdG8gc3RhbmRhcmQgZmlsdGVyIGZ1bmN0aW9uXG4gIHJldHVybiBjb21wcmVzcy5maWx0ZXIocmVxLCByZXMpO1xufVxuXG4vLyAjQnJvd3NlcklkZW50aWZpY2F0aW9uXG4vL1xuLy8gV2UgaGF2ZSBtdWx0aXBsZSBwbGFjZXMgdGhhdCB3YW50IHRvIGlkZW50aWZ5IHRoZSBicm93c2VyOiB0aGVcbi8vIHVuc3VwcG9ydGVkIGJyb3dzZXIgcGFnZSwgdGhlIGFwcGNhY2hlIHBhY2thZ2UsIGFuZCwgZXZlbnR1YWxseVxuLy8gZGVsaXZlcmluZyBicm93c2VyIHBvbHlmaWxscyBvbmx5IGFzIG5lZWRlZC5cbi8vXG4vLyBUbyBhdm9pZCBkZXRlY3RpbmcgdGhlIGJyb3dzZXIgaW4gbXVsdGlwbGUgcGxhY2VzIGFkLWhvYywgd2UgY3JlYXRlIGFcbi8vIE1ldGVvciBcImJyb3dzZXJcIiBvYmplY3QuIEl0IHVzZXMgYnV0IGRvZXMgbm90IGV4cG9zZSB0aGUgbnBtXG4vLyB1c2VyYWdlbnQgbW9kdWxlICh3ZSBjb3VsZCBjaG9vc2UgYSBkaWZmZXJlbnQgbWVjaGFuaXNtIHRvIGlkZW50aWZ5XG4vLyB0aGUgYnJvd3NlciBpbiB0aGUgZnV0dXJlIGlmIHdlIHdhbnRlZCB0bykuICBUaGUgYnJvd3NlciBvYmplY3Rcbi8vIGNvbnRhaW5zXG4vL1xuLy8gKiBgbmFtZWA6IHRoZSBuYW1lIG9mIHRoZSBicm93c2VyIGluIGNhbWVsIGNhc2Vcbi8vICogYG1ham9yYCwgYG1pbm9yYCwgYHBhdGNoYDogaW50ZWdlcnMgZGVzY3JpYmluZyB0aGUgYnJvd3NlciB2ZXJzaW9uXG4vL1xuLy8gQWxzbyBoZXJlIGlzIGFuIGVhcmx5IHZlcnNpb24gb2YgYSBNZXRlb3IgYHJlcXVlc3RgIG9iamVjdCwgaW50ZW5kZWRcbi8vIHRvIGJlIGEgaGlnaC1sZXZlbCBkZXNjcmlwdGlvbiBvZiB0aGUgcmVxdWVzdCB3aXRob3V0IGV4cG9zaW5nXG4vLyBkZXRhaWxzIG9mIGNvbm5lY3QncyBsb3ctbGV2ZWwgYHJlcWAuICBDdXJyZW50bHkgaXQgY29udGFpbnM6XG4vL1xuLy8gKiBgYnJvd3NlcmA6IGJyb3dzZXIgaWRlbnRpZmljYXRpb24gb2JqZWN0IGRlc2NyaWJlZCBhYm92ZVxuLy8gKiBgdXJsYDogcGFyc2VkIHVybCwgaW5jbHVkaW5nIHBhcnNlZCBxdWVyeSBwYXJhbXNcbi8vXG4vLyBBcyBhIHRlbXBvcmFyeSBoYWNrIHRoZXJlIGlzIGEgYGNhdGVnb3JpemVSZXF1ZXN0YCBmdW5jdGlvbiBvbiBXZWJBcHAgd2hpY2hcbi8vIGNvbnZlcnRzIGEgY29ubmVjdCBgcmVxYCB0byBhIE1ldGVvciBgcmVxdWVzdGAuIFRoaXMgY2FuIGdvIGF3YXkgb25jZSBzbWFydFxuLy8gcGFja2FnZXMgc3VjaCBhcyBhcHBjYWNoZSBhcmUgYmVpbmcgcGFzc2VkIGEgYHJlcXVlc3RgIG9iamVjdCBkaXJlY3RseSB3aGVuXG4vLyB0aGV5IHNlcnZlIGNvbnRlbnQuXG4vL1xuLy8gVGhpcyBhbGxvd3MgYHJlcXVlc3RgIHRvIGJlIHVzZWQgdW5pZm9ybWx5OiBpdCBpcyBwYXNzZWQgdG8gdGhlIGh0bWxcbi8vIGF0dHJpYnV0ZXMgaG9vaywgYW5kIHRoZSBhcHBjYWNoZSBwYWNrYWdlIGNhbiB1c2UgaXQgd2hlbiBkZWNpZGluZ1xuLy8gd2hldGhlciB0byBnZW5lcmF0ZSBhIDQwNCBmb3IgdGhlIG1hbmlmZXN0LlxuLy9cbi8vIFJlYWwgcm91dGluZyAvIHNlcnZlciBzaWRlIHJlbmRlcmluZyB3aWxsIHByb2JhYmx5IHJlZmFjdG9yIHRoaXNcbi8vIGhlYXZpbHkuXG5cbi8vIGUuZy4gXCJNb2JpbGUgU2FmYXJpXCIgPT4gXCJtb2JpbGVTYWZhcmlcIlxudmFyIGNhbWVsQ2FzZSA9IGZ1bmN0aW9uKG5hbWUpIHtcbiAgdmFyIHBhcnRzID0gbmFtZS5zcGxpdCgnICcpO1xuICBwYXJ0c1swXSA9IHBhcnRzWzBdLnRvTG93ZXJDYXNlKCk7XG4gIGZvciAodmFyIGkgPSAxOyBpIDwgcGFydHMubGVuZ3RoOyArK2kpIHtcbiAgICBwYXJ0c1tpXSA9IHBhcnRzW2ldLmNoYXJBdCgwKS50b1VwcGVyQ2FzZSgpICsgcGFydHNbaV0uc3Vic3RyKDEpO1xuICB9XG4gIHJldHVybiBwYXJ0cy5qb2luKCcnKTtcbn07XG5cbnZhciBpZGVudGlmeUJyb3dzZXIgPSBmdW5jdGlvbih1c2VyQWdlbnRTdHJpbmcpIHtcbiAgdmFyIHVzZXJBZ2VudCA9IGxvb2t1cFVzZXJBZ2VudCh1c2VyQWdlbnRTdHJpbmcpO1xuICByZXR1cm4ge1xuICAgIG5hbWU6IGNhbWVsQ2FzZSh1c2VyQWdlbnQuZmFtaWx5KSxcbiAgICBtYWpvcjogK3VzZXJBZ2VudC5tYWpvcixcbiAgICBtaW5vcjogK3VzZXJBZ2VudC5taW5vcixcbiAgICBwYXRjaDogK3VzZXJBZ2VudC5wYXRjaCxcbiAgfTtcbn07XG5cbi8vIFhYWCBSZWZhY3RvciBhcyBwYXJ0IG9mIGltcGxlbWVudGluZyByZWFsIHJvdXRpbmcuXG5XZWJBcHBJbnRlcm5hbHMuaWRlbnRpZnlCcm93c2VyID0gaWRlbnRpZnlCcm93c2VyO1xuXG5XZWJBcHAuY2F0ZWdvcml6ZVJlcXVlc3QgPSBmdW5jdGlvbihyZXEpIHtcbiAgaWYgKHJlcS5icm93c2VyICYmIHJlcS5hcmNoICYmIHR5cGVvZiByZXEubW9kZXJuID09PSAnYm9vbGVhbicpIHtcbiAgICAvLyBBbHJlYWR5IGNhdGVnb3JpemVkLlxuICAgIHJldHVybiByZXE7XG4gIH1cblxuICBjb25zdCBicm93c2VyID0gaWRlbnRpZnlCcm93c2VyKHJlcS5oZWFkZXJzWyd1c2VyLWFnZW50J10pO1xuICBjb25zdCBtb2Rlcm4gPSBpc01vZGVybihicm93c2VyKTtcbiAgY29uc3QgcGF0aCA9XG4gICAgdHlwZW9mIHJlcS5wYXRobmFtZSA9PT0gJ3N0cmluZydcbiAgICAgID8gcmVxLnBhdGhuYW1lXG4gICAgICA6IHBhcnNlUmVxdWVzdChyZXEpLnBhdGhuYW1lO1xuXG4gIGNvbnN0IGNhdGVnb3JpemVkID0ge1xuICAgIGJyb3dzZXIsXG4gICAgbW9kZXJuLFxuICAgIHBhdGgsXG4gICAgYXJjaDogV2ViQXBwLmRlZmF1bHRBcmNoLFxuICAgIHVybDogcGFyc2VVcmwocmVxLnVybCwgdHJ1ZSksXG4gICAgZHluYW1pY0hlYWQ6IHJlcS5keW5hbWljSGVhZCxcbiAgICBkeW5hbWljQm9keTogcmVxLmR5bmFtaWNCb2R5LFxuICAgIGhlYWRlcnM6IHJlcS5oZWFkZXJzLFxuICAgIGNvb2tpZXM6IHJlcS5jb29raWVzLFxuICB9O1xuXG4gIGNvbnN0IHBhdGhQYXJ0cyA9IHBhdGguc3BsaXQoJy8nKTtcbiAgY29uc3QgYXJjaEtleSA9IHBhdGhQYXJ0c1sxXTtcblxuICBpZiAoYXJjaEtleS5zdGFydHNXaXRoKCdfXycpKSB7XG4gICAgY29uc3QgYXJjaENsZWFuZWQgPSAnd2ViLicgKyBhcmNoS2V5LnNsaWNlKDIpO1xuICAgIGlmIChoYXNPd24uY2FsbChXZWJBcHAuY2xpZW50UHJvZ3JhbXMsIGFyY2hDbGVhbmVkKSkge1xuICAgICAgcGF0aFBhcnRzLnNwbGljZSgxLCAxKTsgLy8gUmVtb3ZlIHRoZSBhcmNoS2V5IHBhcnQuXG4gICAgICByZXR1cm4gT2JqZWN0LmFzc2lnbihjYXRlZ29yaXplZCwge1xuICAgICAgICBhcmNoOiBhcmNoQ2xlYW5lZCxcbiAgICAgICAgcGF0aDogcGF0aFBhcnRzLmpvaW4oJy8nKSxcbiAgICAgIH0pO1xuICAgIH1cbiAgfVxuXG4gIC8vIFRPRE8gUGVyaGFwcyBvbmUgZGF5IHdlIGNvdWxkIGluZmVyIENvcmRvdmEgY2xpZW50cyBoZXJlLCBzbyB0aGF0IHdlXG4gIC8vIHdvdWxkbid0IGhhdmUgdG8gdXNlIHByZWZpeGVkIFwiL19fY29yZG92YS8uLi5cIiBVUkxzLlxuICBjb25zdCBwcmVmZXJyZWRBcmNoT3JkZXIgPSBpc01vZGVybihicm93c2VyKVxuICAgID8gWyd3ZWIuYnJvd3NlcicsICd3ZWIuYnJvd3Nlci5sZWdhY3knXVxuICAgIDogWyd3ZWIuYnJvd3Nlci5sZWdhY3knLCAnd2ViLmJyb3dzZXInXTtcblxuICBmb3IgKGNvbnN0IGFyY2ggb2YgcHJlZmVycmVkQXJjaE9yZGVyKSB7XG4gICAgLy8gSWYgb3VyIHByZWZlcnJlZCBhcmNoIGlzIG5vdCBhdmFpbGFibGUsIGl0J3MgYmV0dGVyIHRvIHVzZSBhbm90aGVyXG4gICAgLy8gY2xpZW50IGFyY2ggdGhhdCBpcyBhdmFpbGFibGUgdGhhbiB0byBndWFyYW50ZWUgdGhlIHNpdGUgd29uJ3Qgd29ya1xuICAgIC8vIGJ5IHJldHVybmluZyBhbiB1bmtub3duIGFyY2guIEZvciBleGFtcGxlLCBpZiB3ZWIuYnJvd3Nlci5sZWdhY3kgaXNcbiAgICAvLyBleGNsdWRlZCB1c2luZyB0aGUgLS1leGNsdWRlLWFyY2hzIGNvbW1hbmQtbGluZSBvcHRpb24sIGxlZ2FjeVxuICAgIC8vIGNsaWVudHMgYXJlIGJldHRlciBvZmYgcmVjZWl2aW5nIHdlYi5icm93c2VyICh3aGljaCBtaWdodCBhY3R1YWxseVxuICAgIC8vIHdvcmspIHRoYW4gcmVjZWl2aW5nIGFuIEhUVFAgNDA0IHJlc3BvbnNlLiBJZiBub25lIG9mIHRoZSBhcmNocyBpblxuICAgIC8vIHByZWZlcnJlZEFyY2hPcmRlciBhcmUgZGVmaW5lZCwgb25seSB0aGVuIHNob3VsZCB3ZSBzZW5kIGEgNDA0LlxuICAgIGlmIChoYXNPd24uY2FsbChXZWJBcHAuY2xpZW50UHJvZ3JhbXMsIGFyY2gpKSB7XG4gICAgICByZXR1cm4gT2JqZWN0LmFzc2lnbihjYXRlZ29yaXplZCwgeyBhcmNoIH0pO1xuICAgIH1cbiAgfVxuXG4gIHJldHVybiBjYXRlZ29yaXplZDtcbn07XG5cbi8vIEhUTUwgYXR0cmlidXRlIGhvb2tzOiBmdW5jdGlvbnMgdG8gYmUgY2FsbGVkIHRvIGRldGVybWluZSBhbnkgYXR0cmlidXRlcyB0b1xuLy8gYmUgYWRkZWQgdG8gdGhlICc8aHRtbD4nIHRhZy4gRWFjaCBmdW5jdGlvbiBpcyBwYXNzZWQgYSAncmVxdWVzdCcgb2JqZWN0IChzZWVcbi8vICNCcm93c2VySWRlbnRpZmljYXRpb24pIGFuZCBzaG91bGQgcmV0dXJuIG51bGwgb3Igb2JqZWN0LlxudmFyIGh0bWxBdHRyaWJ1dGVIb29rcyA9IFtdO1xudmFyIGdldEh0bWxBdHRyaWJ1dGVzID0gZnVuY3Rpb24ocmVxdWVzdCkge1xuICB2YXIgY29tYmluZWRBdHRyaWJ1dGVzID0ge307XG4gIF8uZWFjaChodG1sQXR0cmlidXRlSG9va3MgfHwgW10sIGZ1bmN0aW9uKGhvb2spIHtcbiAgICB2YXIgYXR0cmlidXRlcyA9IGhvb2socmVxdWVzdCk7XG4gICAgaWYgKGF0dHJpYnV0ZXMgPT09IG51bGwpIHJldHVybjtcbiAgICBpZiAodHlwZW9mIGF0dHJpYnV0ZXMgIT09ICdvYmplY3QnKVxuICAgICAgdGhyb3cgRXJyb3IoJ0hUTUwgYXR0cmlidXRlIGhvb2sgbXVzdCByZXR1cm4gbnVsbCBvciBvYmplY3QnKTtcbiAgICBfLmV4dGVuZChjb21iaW5lZEF0dHJpYnV0ZXMsIGF0dHJpYnV0ZXMpO1xuICB9KTtcbiAgcmV0dXJuIGNvbWJpbmVkQXR0cmlidXRlcztcbn07XG5XZWJBcHAuYWRkSHRtbEF0dHJpYnV0ZUhvb2sgPSBmdW5jdGlvbihob29rKSB7XG4gIGh0bWxBdHRyaWJ1dGVIb29rcy5wdXNoKGhvb2spO1xufTtcblxuLy8gU2VydmUgYXBwIEhUTUwgZm9yIHRoaXMgVVJMP1xudmFyIGFwcFVybCA9IGZ1bmN0aW9uKHVybCkge1xuICBpZiAodXJsID09PSAnL2Zhdmljb24uaWNvJyB8fCB1cmwgPT09ICcvcm9ib3RzLnR4dCcpIHJldHVybiBmYWxzZTtcblxuICAvLyBOT1RFOiBhcHAubWFuaWZlc3QgaXMgbm90IGEgd2ViIHN0YW5kYXJkIGxpa2UgZmF2aWNvbi5pY28gYW5kXG4gIC8vIHJvYm90cy50eHQuIEl0IGlzIGEgZmlsZSBuYW1lIHdlIGhhdmUgY2hvc2VuIHRvIHVzZSBmb3IgSFRNTDVcbiAgLy8gYXBwY2FjaGUgVVJMcy4gSXQgaXMgaW5jbHVkZWQgaGVyZSB0byBwcmV2ZW50IHVzaW5nIGFuIGFwcGNhY2hlXG4gIC8vIHRoZW4gcmVtb3ZpbmcgaXQgZnJvbSBwb2lzb25pbmcgYW4gYXBwIHBlcm1hbmVudGx5LiBFdmVudHVhbGx5LFxuICAvLyBvbmNlIHdlIGhhdmUgc2VydmVyIHNpZGUgcm91dGluZywgdGhpcyB3b24ndCBiZSBuZWVkZWQgYXNcbiAgLy8gdW5rbm93biBVUkxzIHdpdGggcmV0dXJuIGEgNDA0IGF1dG9tYXRpY2FsbHkuXG4gIGlmICh1cmwgPT09ICcvYXBwLm1hbmlmZXN0JykgcmV0dXJuIGZhbHNlO1xuXG4gIC8vIEF2b2lkIHNlcnZpbmcgYXBwIEhUTUwgZm9yIGRlY2xhcmVkIHJvdXRlcyBzdWNoIGFzIC9zb2NranMvLlxuICBpZiAoUm91dGVQb2xpY3kuY2xhc3NpZnkodXJsKSkgcmV0dXJuIGZhbHNlO1xuXG4gIC8vIHdlIGN1cnJlbnRseSByZXR1cm4gYXBwIEhUTUwgb24gYWxsIFVSTHMgYnkgZGVmYXVsdFxuICByZXR1cm4gdHJ1ZTtcbn07XG5cbi8vIFdlIG5lZWQgdG8gY2FsY3VsYXRlIHRoZSBjbGllbnQgaGFzaCBhZnRlciBhbGwgcGFja2FnZXMgaGF2ZSBsb2FkZWRcbi8vIHRvIGdpdmUgdGhlbSBhIGNoYW5jZSB0byBwb3B1bGF0ZSBfX21ldGVvcl9ydW50aW1lX2NvbmZpZ19fLlxuLy9cbi8vIENhbGN1bGF0aW5nIHRoZSBoYXNoIGR1cmluZyBzdGFydHVwIG1lYW5zIHRoYXQgcGFja2FnZXMgY2FuIG9ubHlcbi8vIHBvcHVsYXRlIF9fbWV0ZW9yX3J1bnRpbWVfY29uZmlnX18gZHVyaW5nIGxvYWQsIG5vdCBkdXJpbmcgc3RhcnR1cC5cbi8vXG4vLyBDYWxjdWxhdGluZyBpbnN0ZWFkIGl0IGF0IHRoZSBiZWdpbm5pbmcgb2YgbWFpbiBhZnRlciBhbGwgc3RhcnR1cFxuLy8gaG9va3MgaGFkIHJ1biB3b3VsZCBhbGxvdyBwYWNrYWdlcyB0byBhbHNvIHBvcHVsYXRlXG4vLyBfX21ldGVvcl9ydW50aW1lX2NvbmZpZ19fIGR1cmluZyBzdGFydHVwLCBidXQgdGhhdCdzIHRvbyBsYXRlIGZvclxuLy8gYXV0b3VwZGF0ZSBiZWNhdXNlIGl0IG5lZWRzIHRvIGhhdmUgdGhlIGNsaWVudCBoYXNoIGF0IHN0YXJ0dXAgdG9cbi8vIGluc2VydCB0aGUgYXV0byB1cGRhdGUgdmVyc2lvbiBpdHNlbGYgaW50b1xuLy8gX19tZXRlb3JfcnVudGltZV9jb25maWdfXyB0byBnZXQgaXQgdG8gdGhlIGNsaWVudC5cbi8vXG4vLyBBbiBhbHRlcm5hdGl2ZSB3b3VsZCBiZSB0byBnaXZlIGF1dG91cGRhdGUgYSBcInBvc3Qtc3RhcnQsXG4vLyBwcmUtbGlzdGVuXCIgaG9vayB0byBhbGxvdyBpdCB0byBpbnNlcnQgdGhlIGF1dG8gdXBkYXRlIHZlcnNpb24gYXRcbi8vIHRoZSByaWdodCBtb21lbnQuXG5cbk1ldGVvci5zdGFydHVwKGZ1bmN0aW9uKCkge1xuICBmdW5jdGlvbiBnZXR0ZXIoa2V5KSB7XG4gICAgcmV0dXJuIGZ1bmN0aW9uKGFyY2gpIHtcbiAgICAgIGFyY2ggPSBhcmNoIHx8IFdlYkFwcC5kZWZhdWx0QXJjaDtcbiAgICAgIGNvbnN0IHByb2dyYW0gPSBXZWJBcHAuY2xpZW50UHJvZ3JhbXNbYXJjaF07XG4gICAgICBjb25zdCB2YWx1ZSA9IHByb2dyYW0gJiYgcHJvZ3JhbVtrZXldO1xuICAgICAgLy8gSWYgdGhpcyBpcyB0aGUgZmlyc3QgdGltZSB3ZSBoYXZlIGNhbGN1bGF0ZWQgdGhpcyBoYXNoLFxuICAgICAgLy8gcHJvZ3JhbVtrZXldIHdpbGwgYmUgYSB0aHVuayAobGF6eSBmdW5jdGlvbiB3aXRoIG5vIHBhcmFtZXRlcnMpXG4gICAgICAvLyB0aGF0IHdlIHNob3VsZCBjYWxsIHRvIGRvIHRoZSBhY3R1YWwgY29tcHV0YXRpb24uXG4gICAgICByZXR1cm4gdHlwZW9mIHZhbHVlID09PSAnZnVuY3Rpb24nID8gKHByb2dyYW1ba2V5XSA9IHZhbHVlKCkpIDogdmFsdWU7XG4gICAgfTtcbiAgfVxuXG4gIFdlYkFwcC5jYWxjdWxhdGVDbGllbnRIYXNoID0gV2ViQXBwLmNsaWVudEhhc2ggPSBnZXR0ZXIoJ3ZlcnNpb24nKTtcbiAgV2ViQXBwLmNhbGN1bGF0ZUNsaWVudEhhc2hSZWZyZXNoYWJsZSA9IGdldHRlcigndmVyc2lvblJlZnJlc2hhYmxlJyk7XG4gIFdlYkFwcC5jYWxjdWxhdGVDbGllbnRIYXNoTm9uUmVmcmVzaGFibGUgPSBnZXR0ZXIoJ3ZlcnNpb25Ob25SZWZyZXNoYWJsZScpO1xuICBXZWJBcHAuY2FsY3VsYXRlQ2xpZW50SGFzaFJlcGxhY2VhYmxlID0gZ2V0dGVyKCd2ZXJzaW9uUmVwbGFjZWFibGUnKTtcbiAgV2ViQXBwLmdldFJlZnJlc2hhYmxlQXNzZXRzID0gZ2V0dGVyKCdyZWZyZXNoYWJsZUFzc2V0cycpO1xufSk7XG5cbi8vIFdoZW4gd2UgaGF2ZSBhIHJlcXVlc3QgcGVuZGluZywgd2Ugd2FudCB0aGUgc29ja2V0IHRpbWVvdXQgdG8gYmUgbG9uZywgdG9cbi8vIGdpdmUgb3Vyc2VsdmVzIGEgd2hpbGUgdG8gc2VydmUgaXQsIGFuZCB0byBhbGxvdyBzb2NranMgbG9uZyBwb2xscyB0b1xuLy8gY29tcGxldGUuICBPbiB0aGUgb3RoZXIgaGFuZCwgd2Ugd2FudCB0byBjbG9zZSBpZGxlIHNvY2tldHMgcmVsYXRpdmVseVxuLy8gcXVpY2tseSwgc28gdGhhdCB3ZSBjYW4gc2h1dCBkb3duIHJlbGF0aXZlbHkgcHJvbXB0bHkgYnV0IGNsZWFubHksIHdpdGhvdXRcbi8vIGN1dHRpbmcgb2ZmIGFueW9uZSdzIHJlc3BvbnNlLlxuV2ViQXBwLl90aW1lb3V0QWRqdXN0bWVudFJlcXVlc3RDYWxsYmFjayA9IGZ1bmN0aW9uKHJlcSwgcmVzKSB7XG4gIC8vIHRoaXMgaXMgcmVhbGx5IGp1c3QgcmVxLnNvY2tldC5zZXRUaW1lb3V0KExPTkdfU09DS0VUX1RJTUVPVVQpO1xuICByZXEuc2V0VGltZW91dChMT05HX1NPQ0tFVF9USU1FT1VUKTtcbiAgLy8gSW5zZXJ0IG91ciBuZXcgZmluaXNoIGxpc3RlbmVyIHRvIHJ1biBCRUZPUkUgdGhlIGV4aXN0aW5nIG9uZSB3aGljaCByZW1vdmVzXG4gIC8vIHRoZSByZXNwb25zZSBmcm9tIHRoZSBzb2NrZXQuXG4gIHZhciBmaW5pc2hMaXN0ZW5lcnMgPSByZXMubGlzdGVuZXJzKCdmaW5pc2gnKTtcbiAgLy8gWFhYIEFwcGFyZW50bHkgaW4gTm9kZSAwLjEyIHRoaXMgZXZlbnQgd2FzIGNhbGxlZCAncHJlZmluaXNoJy5cbiAgLy8gaHR0cHM6Ly9naXRodWIuY29tL2pveWVudC9ub2RlL2NvbW1pdC83YzliNjA3MFxuICAvLyBCdXQgaXQgaGFzIHN3aXRjaGVkIGJhY2sgdG8gJ2ZpbmlzaCcgaW4gTm9kZSB2NDpcbiAgLy8gaHR0cHM6Ly9naXRodWIuY29tL25vZGVqcy9ub2RlL3B1bGwvMTQxMVxuICByZXMucmVtb3ZlQWxsTGlzdGVuZXJzKCdmaW5pc2gnKTtcbiAgcmVzLm9uKCdmaW5pc2gnLCBmdW5jdGlvbigpIHtcbiAgICByZXMuc2V0VGltZW91dChTSE9SVF9TT0NLRVRfVElNRU9VVCk7XG4gIH0pO1xuICBfLmVhY2goZmluaXNoTGlzdGVuZXJzLCBmdW5jdGlvbihsKSB7XG4gICAgcmVzLm9uKCdmaW5pc2gnLCBsKTtcbiAgfSk7XG59O1xuXG4vLyBXaWxsIGJlIHVwZGF0ZWQgYnkgbWFpbiBiZWZvcmUgd2UgbGlzdGVuLlxuLy8gTWFwIGZyb20gY2xpZW50IGFyY2ggdG8gYm9pbGVycGxhdGUgb2JqZWN0LlxuLy8gQm9pbGVycGxhdGUgb2JqZWN0IGhhczpcbi8vICAgLSBmdW5jOiBYWFhcbi8vICAgLSBiYXNlRGF0YTogWFhYXG52YXIgYm9pbGVycGxhdGVCeUFyY2ggPSB7fTtcblxuLy8gUmVnaXN0ZXIgYSBjYWxsYmFjayBmdW5jdGlvbiB0aGF0IGNhbiBzZWxlY3RpdmVseSBtb2RpZnkgYm9pbGVycGxhdGVcbi8vIGRhdGEgZ2l2ZW4gYXJndW1lbnRzIChyZXF1ZXN0LCBkYXRhLCBhcmNoKS4gVGhlIGtleSBzaG91bGQgYmUgYSB1bmlxdWVcbi8vIGlkZW50aWZpZXIsIHRvIHByZXZlbnQgYWNjdW11bGF0aW5nIGR1cGxpY2F0ZSBjYWxsYmFja3MgZnJvbSB0aGUgc2FtZVxuLy8gY2FsbCBzaXRlIG92ZXIgdGltZS4gQ2FsbGJhY2tzIHdpbGwgYmUgY2FsbGVkIGluIHRoZSBvcmRlciB0aGV5IHdlcmVcbi8vIHJlZ2lzdGVyZWQuIEEgY2FsbGJhY2sgc2hvdWxkIHJldHVybiBmYWxzZSBpZiBpdCBkaWQgbm90IG1ha2UgYW55XG4vLyBjaGFuZ2VzIGFmZmVjdGluZyB0aGUgYm9pbGVycGxhdGUuIFBhc3NpbmcgbnVsbCBkZWxldGVzIHRoZSBjYWxsYmFjay5cbi8vIEFueSBwcmV2aW91cyBjYWxsYmFjayByZWdpc3RlcmVkIGZvciB0aGlzIGtleSB3aWxsIGJlIHJldHVybmVkLlxuY29uc3QgYm9pbGVycGxhdGVEYXRhQ2FsbGJhY2tzID0gT2JqZWN0LmNyZWF0ZShudWxsKTtcbldlYkFwcEludGVybmFscy5yZWdpc3RlckJvaWxlcnBsYXRlRGF0YUNhbGxiYWNrID0gZnVuY3Rpb24oa2V5LCBjYWxsYmFjaykge1xuICBjb25zdCBwcmV2aW91c0NhbGxiYWNrID0gYm9pbGVycGxhdGVEYXRhQ2FsbGJhY2tzW2tleV07XG5cbiAgaWYgKHR5cGVvZiBjYWxsYmFjayA9PT0gJ2Z1bmN0aW9uJykge1xuICAgIGJvaWxlcnBsYXRlRGF0YUNhbGxiYWNrc1trZXldID0gY2FsbGJhY2s7XG4gIH0gZWxzZSB7XG4gICAgYXNzZXJ0LnN0cmljdEVxdWFsKGNhbGxiYWNrLCBudWxsKTtcbiAgICBkZWxldGUgYm9pbGVycGxhdGVEYXRhQ2FsbGJhY2tzW2tleV07XG4gIH1cblxuICAvLyBSZXR1cm4gdGhlIHByZXZpb3VzIGNhbGxiYWNrIGluIGNhc2UgdGhlIG5ldyBjYWxsYmFjayBuZWVkcyB0byBjYWxsXG4gIC8vIGl0OyBmb3IgZXhhbXBsZSwgd2hlbiB0aGUgbmV3IGNhbGxiYWNrIGlzIGEgd3JhcHBlciBmb3IgdGhlIG9sZC5cbiAgcmV0dXJuIHByZXZpb3VzQ2FsbGJhY2sgfHwgbnVsbDtcbn07XG5cbi8vIEdpdmVuIGEgcmVxdWVzdCAoYXMgcmV0dXJuZWQgZnJvbSBgY2F0ZWdvcml6ZVJlcXVlc3RgKSwgcmV0dXJuIHRoZVxuLy8gYm9pbGVycGxhdGUgSFRNTCB0byBzZXJ2ZSBmb3IgdGhhdCByZXF1ZXN0LlxuLy9cbi8vIElmIGEgcHJldmlvdXMgY29ubmVjdCBtaWRkbGV3YXJlIGhhcyByZW5kZXJlZCBjb250ZW50IGZvciB0aGUgaGVhZCBvciBib2R5LFxuLy8gcmV0dXJucyB0aGUgYm9pbGVycGxhdGUgd2l0aCB0aGF0IGNvbnRlbnQgcGF0Y2hlZCBpbiBvdGhlcndpc2Vcbi8vIG1lbW9pemVzIG9uIEhUTUwgYXR0cmlidXRlcyAodXNlZCBieSwgZWcsIGFwcGNhY2hlKSBhbmQgd2hldGhlciBpbmxpbmVcbi8vIHNjcmlwdHMgYXJlIGN1cnJlbnRseSBhbGxvd2VkLlxuLy8gWFhYIHNvIGZhciB0aGlzIGZ1bmN0aW9uIGlzIGFsd2F5cyBjYWxsZWQgd2l0aCBhcmNoID09PSAnd2ViLmJyb3dzZXInXG5mdW5jdGlvbiBnZXRCb2lsZXJwbGF0ZShyZXF1ZXN0LCBhcmNoKSB7XG4gIHJldHVybiBnZXRCb2lsZXJwbGF0ZUFzeW5jKHJlcXVlc3QsIGFyY2gpLmF3YWl0KCk7XG59XG5cbi8qKlxuICogQHN1bW1hcnkgVGFrZXMgYSBydW50aW1lIGNvbmZpZ3VyYXRpb24gb2JqZWN0IGFuZFxuICogcmV0dXJucyBhbiBlbmNvZGVkIHJ1bnRpbWUgc3RyaW5nLlxuICogQGxvY3VzIFNlcnZlclxuICogQHBhcmFtIHtPYmplY3R9IHJ0aW1lQ29uZmlnXG4gKiBAcmV0dXJucyB7U3RyaW5nfVxuICovXG5XZWJBcHAuZW5jb2RlUnVudGltZUNvbmZpZyA9IGZ1bmN0aW9uKHJ0aW1lQ29uZmlnKSB7XG4gIHJldHVybiBKU09OLnN0cmluZ2lmeShlbmNvZGVVUklDb21wb25lbnQoSlNPTi5zdHJpbmdpZnkocnRpbWVDb25maWcpKSk7XG59O1xuXG4vKipcbiAqIEBzdW1tYXJ5IFRha2VzIGFuIGVuY29kZWQgcnVudGltZSBzdHJpbmcgYW5kIHJldHVybnNcbiAqIGEgcnVudGltZSBjb25maWd1cmF0aW9uIG9iamVjdC5cbiAqIEBsb2N1cyBTZXJ2ZXJcbiAqIEBwYXJhbSB7U3RyaW5nfSBydGltZUNvbmZpZ1N0cmluZ1xuICogQHJldHVybnMge09iamVjdH1cbiAqL1xuV2ViQXBwLmRlY29kZVJ1bnRpbWVDb25maWcgPSBmdW5jdGlvbihydGltZUNvbmZpZ1N0cikge1xuICByZXR1cm4gSlNPTi5wYXJzZShkZWNvZGVVUklDb21wb25lbnQoSlNPTi5wYXJzZShydGltZUNvbmZpZ1N0cikpKTtcbn07XG5cbmNvbnN0IHJ1bnRpbWVDb25maWcgPSB7XG4gIC8vIGhvb2tzIHdpbGwgY29udGFpbiB0aGUgY2FsbGJhY2sgZnVuY3Rpb25zXG4gIC8vIHNldCBieSB0aGUgY2FsbGVyIHRvIGFkZFJ1bnRpbWVDb25maWdIb29rXG4gIGhvb2tzOiBuZXcgSG9vaygpLFxuICAvLyB1cGRhdGVIb29rcyB3aWxsIGNvbnRhaW4gdGhlIGNhbGxiYWNrIGZ1bmN0aW9uc1xuICAvLyBzZXQgYnkgdGhlIGNhbGxlciB0byBhZGRVcGRhdGVkTm90aWZ5SG9va1xuICB1cGRhdGVIb29rczogbmV3IEhvb2soKSxcbiAgLy8gaXNVcGRhdGVkQnlBcmNoIGlzIGFuIG9iamVjdCBjb250YWluaW5nIGZpZWxkcyBmb3IgZWFjaCBhcmNoXG4gIC8vIHRoYXQgdGhpcyBzZXJ2ZXIgc3VwcG9ydHMuXG4gIC8vIC0gRWFjaCBmaWVsZCB3aWxsIGJlIHRydWUgd2hlbiB0aGUgc2VydmVyIHVwZGF0ZXMgdGhlIHJ1bnRpbWVDb25maWcgZm9yIHRoYXQgYXJjaC5cbiAgLy8gLSBXaGVuIHRoZSBob29rIGNhbGxiYWNrIGlzIGNhbGxlZCB0aGUgdXBkYXRlIGZpZWxkIGluIHRoZSBjYWxsYmFjayBvYmplY3Qgd2lsbCBiZVxuICAvLyBzZXQgdG8gaXNVcGRhdGVkQnlBcmNoW2FyY2hdLlxuICAvLyA9IGlzVXBkYXRlZHlCeUFyY2hbYXJjaF0gaXMgcmVzZXQgdG8gZmFsc2UgYWZ0ZXIgdGhlIGNhbGxiYWNrLlxuICAvLyBUaGlzIGVuYWJsZXMgdGhlIGNhbGxlciB0byBjYWNoZSBkYXRhIGVmZmljaWVudGx5IHNvIHRoZXkgZG8gbm90IG5lZWQgdG9cbiAgLy8gZGVjb2RlICYgdXBkYXRlIGRhdGEgb24gZXZlcnkgY2FsbGJhY2sgd2hlbiB0aGUgcnVudGltZUNvbmZpZyBpcyBub3QgY2hhbmdpbmcuXG4gIGlzVXBkYXRlZEJ5QXJjaDoge30sXG59O1xuXG4vKipcbiAqIEBuYW1lIGFkZFJ1bnRpbWVDb25maWdIb29rQ2FsbGJhY2sob3B0aW9ucylcbiAqIEBsb2N1cyBTZXJ2ZXJcbiAqIEBpc3Byb3RvdHlwZSB0cnVlXG4gKiBAc3VtbWFyeSBDYWxsYmFjayBmb3IgYGFkZFJ1bnRpbWVDb25maWdIb29rYC5cbiAqXG4gKiBJZiB0aGUgaGFuZGxlciByZXR1cm5zIGEgX2ZhbHN5XyB2YWx1ZSB0aGUgaG9vayB3aWxsIG5vdFxuICogbW9kaWZ5IHRoZSBydW50aW1lIGNvbmZpZ3VyYXRpb24uXG4gKlxuICogSWYgdGhlIGhhbmRsZXIgcmV0dXJucyBhIF9TdHJpbmdfIHRoZSBob29rIHdpbGwgc3Vic3RpdHV0ZVxuICogdGhlIHN0cmluZyBmb3IgdGhlIGVuY29kZWQgY29uZmlndXJhdGlvbiBzdHJpbmcuXG4gKlxuICogKipXYXJuaW5nOioqIHRoZSBob29rIGRvZXMgbm90IGNoZWNrIHRoZSByZXR1cm4gdmFsdWUgYXQgYWxsIGl0IGlzXG4gKiB0aGUgcmVzcG9uc2liaWxpdHkgb2YgdGhlIGNhbGxlciB0byBnZXQgdGhlIGZvcm1hdHRpbmcgY29ycmVjdCB1c2luZ1xuICogdGhlIGhlbHBlciBmdW5jdGlvbnMuXG4gKlxuICogYGFkZFJ1bnRpbWVDb25maWdIb29rQ2FsbGJhY2tgIHRha2VzIG9ubHkgb25lIGBPYmplY3RgIGFyZ3VtZW50XG4gKiB3aXRoIHRoZSBmb2xsb3dpbmcgZmllbGRzOlxuICogQHBhcmFtIHtPYmplY3R9IG9wdGlvbnNcbiAqIEBwYXJhbSB7U3RyaW5nfSBvcHRpb25zLmFyY2ggVGhlIGFyY2hpdGVjdHVyZSBvZiB0aGUgY2xpZW50XG4gKiByZXF1ZXN0aW5nIGEgbmV3IHJ1bnRpbWUgY29uZmlndXJhdGlvbi4gVGhpcyBjYW4gYmUgb25lIG9mXG4gKiBgd2ViLmJyb3dzZXJgLCBgd2ViLmJyb3dzZXIubGVnYWN5YCBvciBgd2ViLmNvcmRvdmFgLlxuICogQHBhcmFtIHtPYmplY3R9IG9wdGlvbnMucmVxdWVzdFxuICogQSBOb2RlSnMgW0luY29taW5nTWVzc2FnZV0oaHR0cHM6Ly9ub2RlanMub3JnL2FwaS9odHRwLmh0bWwjaHR0cF9jbGFzc19odHRwX2luY29taW5nbWVzc2FnZSlcbiAqIGh0dHBzOi8vbm9kZWpzLm9yZy9hcGkvaHR0cC5odG1sI2h0dHBfY2xhc3NfaHR0cF9pbmNvbWluZ21lc3NhZ2VcbiAqIGBPYmplY3RgIHRoYXQgY2FuIGJlIHVzZWQgdG8gZ2V0IGluZm9ybWF0aW9uIGFib3V0IHRoZSBpbmNvbWluZyByZXF1ZXN0LlxuICogQHBhcmFtIHtTdHJpbmd9IG9wdGlvbnMuZW5jb2RlZEN1cnJlbnRDb25maWcgVGhlIGN1cnJlbnQgY29uZmlndXJhdGlvbiBvYmplY3RcbiAqIGVuY29kZWQgYXMgYSBzdHJpbmcgZm9yIGluY2x1c2lvbiBpbiB0aGUgcm9vdCBodG1sLlxuICogQHBhcmFtIHtCb29sZWFufSBvcHRpb25zLnVwZGF0ZWQgYHRydWVgIGlmIHRoZSBjb25maWcgZm9yIHRoaXMgYXJjaGl0ZWN0dXJlXG4gKiBoYXMgYmVlbiB1cGRhdGVkIHNpbmNlIGxhc3QgY2FsbGVkLCBvdGhlcndpc2UgYGZhbHNlYC4gVGhpcyBmbGFnIGNhbiBiZSB1c2VkXG4gKiB0byBjYWNoZSB0aGUgZGVjb2RpbmcvZW5jb2RpbmcgZm9yIGVhY2ggYXJjaGl0ZWN0dXJlLlxuICovXG5cbi8qKlxuICogQHN1bW1hcnkgSG9vayB0aGF0IGNhbGxzIGJhY2sgd2hlbiB0aGUgbWV0ZW9yIHJ1bnRpbWUgY29uZmlndXJhdGlvbixcbiAqIGBfX21ldGVvcl9ydW50aW1lX2NvbmZpZ19fYCBpcyBiZWluZyBzZW50IHRvIGFueSBjbGllbnQuXG4gKlxuICogKipyZXR1cm5zKio6IDxzbWFsbD5fT2JqZWN0Xzwvc21hbGw+IGB7IHN0b3A6IGZ1bmN0aW9uLCBjYWxsYmFjazogZnVuY3Rpb24gfWBcbiAqIC0gYHN0b3BgIDxzbWFsbD5fRnVuY3Rpb25fPC9zbWFsbD4gQ2FsbCBgc3RvcCgpYCB0byBzdG9wIGdldHRpbmcgY2FsbGJhY2tzLlxuICogLSBgY2FsbGJhY2tgIDxzbWFsbD5fRnVuY3Rpb25fPC9zbWFsbD4gVGhlIHBhc3NlZCBpbiBgY2FsbGJhY2tgLlxuICogQGxvY3VzIFNlcnZlclxuICogQHBhcmFtIHthZGRSdW50aW1lQ29uZmlnSG9va0NhbGxiYWNrfSBjYWxsYmFja1xuICogU2VlIGBhZGRSdW50aW1lQ29uZmlnSG9va0NhbGxiYWNrYCBkZXNjcmlwdGlvbi5cbiAqIEByZXR1cm5zIHtPYmplY3R9IHt7IHN0b3A6IGZ1bmN0aW9uLCBjYWxsYmFjazogZnVuY3Rpb24gfX1cbiAqIENhbGwgdGhlIHJldHVybmVkIGBzdG9wKClgIHRvIHN0b3AgZ2V0dGluZyBjYWxsYmFja3MuXG4gKiBUaGUgcGFzc2VkIGluIGBjYWxsYmFja2AgaXMgcmV0dXJuZWQgYWxzby5cbiAqL1xuV2ViQXBwLmFkZFJ1bnRpbWVDb25maWdIb29rID0gZnVuY3Rpb24oY2FsbGJhY2spIHtcbiAgcmV0dXJuIHJ1bnRpbWVDb25maWcuaG9va3MucmVnaXN0ZXIoY2FsbGJhY2spO1xufTtcblxuZnVuY3Rpb24gZ2V0Qm9pbGVycGxhdGVBc3luYyhyZXF1ZXN0LCBhcmNoKSB7XG4gIGxldCBib2lsZXJwbGF0ZSA9IGJvaWxlcnBsYXRlQnlBcmNoW2FyY2hdO1xuICBydW50aW1lQ29uZmlnLmhvb2tzLmZvckVhY2goaG9vayA9PiB7XG4gICAgY29uc3QgbWV0ZW9yUnVudGltZUNvbmZpZyA9IGhvb2soe1xuICAgICAgYXJjaCxcbiAgICAgIHJlcXVlc3QsXG4gICAgICBlbmNvZGVkQ3VycmVudENvbmZpZzogYm9pbGVycGxhdGUuYmFzZURhdGEubWV0ZW9yUnVudGltZUNvbmZpZyxcbiAgICAgIHVwZGF0ZWQ6IHJ1bnRpbWVDb25maWcuaXNVcGRhdGVkQnlBcmNoW2FyY2hdLFxuICAgIH0pO1xuICAgIGlmICghbWV0ZW9yUnVudGltZUNvbmZpZykgcmV0dXJuO1xuICAgIGJvaWxlcnBsYXRlLmJhc2VEYXRhID0gT2JqZWN0LmFzc2lnbih7fSwgYm9pbGVycGxhdGUuYmFzZURhdGEsIHtcbiAgICAgIG1ldGVvclJ1bnRpbWVDb25maWcsXG4gICAgfSk7XG4gIH0pO1xuICBydW50aW1lQ29uZmlnLmlzVXBkYXRlZEJ5QXJjaFthcmNoXSA9IGZhbHNlO1xuICBjb25zdCBkYXRhID0gT2JqZWN0LmFzc2lnbihcbiAgICB7fSxcbiAgICBib2lsZXJwbGF0ZS5iYXNlRGF0YSxcbiAgICB7XG4gICAgICBodG1sQXR0cmlidXRlczogZ2V0SHRtbEF0dHJpYnV0ZXMocmVxdWVzdCksXG4gICAgfSxcbiAgICBfLnBpY2socmVxdWVzdCwgJ2R5bmFtaWNIZWFkJywgJ2R5bmFtaWNCb2R5JylcbiAgKTtcblxuICBsZXQgbWFkZUNoYW5nZXMgPSBmYWxzZTtcbiAgbGV0IHByb21pc2UgPSBQcm9taXNlLnJlc29sdmUoKTtcblxuICBPYmplY3Qua2V5cyhib2lsZXJwbGF0ZURhdGFDYWxsYmFja3MpLmZvckVhY2goa2V5ID0+IHtcbiAgICBwcm9taXNlID0gcHJvbWlzZVxuICAgICAgLnRoZW4oKCkgPT4ge1xuICAgICAgICBjb25zdCBjYWxsYmFjayA9IGJvaWxlcnBsYXRlRGF0YUNhbGxiYWNrc1trZXldO1xuICAgICAgICByZXR1cm4gY2FsbGJhY2socmVxdWVzdCwgZGF0YSwgYXJjaCk7XG4gICAgICB9KVxuICAgICAgLnRoZW4ocmVzdWx0ID0+IHtcbiAgICAgICAgLy8gQ2FsbGJhY2tzIHNob3VsZCByZXR1cm4gZmFsc2UgaWYgdGhleSBkaWQgbm90IG1ha2UgYW55IGNoYW5nZXMuXG4gICAgICAgIGlmIChyZXN1bHQgIT09IGZhbHNlKSB7XG4gICAgICAgICAgbWFkZUNoYW5nZXMgPSB0cnVlO1xuICAgICAgICB9XG4gICAgICB9KTtcbiAgfSk7XG5cbiAgcmV0dXJuIHByb21pc2UudGhlbigoKSA9PiAoe1xuICAgIHN0cmVhbTogYm9pbGVycGxhdGUudG9IVE1MU3RyZWFtKGRhdGEpLFxuICAgIHN0YXR1c0NvZGU6IGRhdGEuc3RhdHVzQ29kZSxcbiAgICBoZWFkZXJzOiBkYXRhLmhlYWRlcnMsXG4gIH0pKTtcbn1cblxuLyoqXG4gKiBAbmFtZSBhZGRVcGRhdGVkTm90aWZ5SG9va0NhbGxiYWNrKG9wdGlvbnMpXG4gKiBAc3VtbWFyeSBjYWxsYmFjayBoYW5kbGVyIGZvciBgYWRkdXBkYXRlZE5vdGlmeUhvb2tgXG4gKiBAaXNwcm90b3R5cGUgdHJ1ZVxuICogQGxvY3VzIFNlcnZlclxuICogQHBhcmFtIHtPYmplY3R9IG9wdGlvbnNcbiAqIEBwYXJhbSB7U3RyaW5nfSBvcHRpb25zLmFyY2ggVGhlIGFyY2hpdGVjdHVyZSB0aGF0IGlzIGJlaW5nIHVwZGF0ZWQuXG4gKiBUaGlzIGNhbiBiZSBvbmUgb2YgYHdlYi5icm93c2VyYCwgYHdlYi5icm93c2VyLmxlZ2FjeWAgb3IgYHdlYi5jb3Jkb3ZhYC5cbiAqIEBwYXJhbSB7T2JqZWN0fSBvcHRpb25zLm1hbmlmZXN0IFRoZSBuZXcgdXBkYXRlZCBtYW5pZmVzdCBvYmplY3QgZm9yXG4gKiB0aGlzIGBhcmNoYC5cbiAqIEBwYXJhbSB7T2JqZWN0fSBvcHRpb25zLnJ1bnRpbWVDb25maWcgVGhlIG5ldyB1cGRhdGVkIGNvbmZpZ3VyYXRpb25cbiAqIG9iamVjdCBmb3IgdGhpcyBgYXJjaGAuXG4gKi9cblxuLyoqXG4gKiBAc3VtbWFyeSBIb29rIHRoYXQgcnVucyB3aGVuIHRoZSBtZXRlb3IgcnVudGltZSBjb25maWd1cmF0aW9uXG4gKiBpcyB1cGRhdGVkLiAgVHlwaWNhbGx5IHRoZSBjb25maWd1cmF0aW9uIG9ubHkgY2hhbmdlcyBkdXJpbmcgZGV2ZWxvcG1lbnQgbW9kZS5cbiAqIEBsb2N1cyBTZXJ2ZXJcbiAqIEBwYXJhbSB7YWRkVXBkYXRlZE5vdGlmeUhvb2tDYWxsYmFja30gaGFuZGxlclxuICogVGhlIGBoYW5kbGVyYCBpcyBjYWxsZWQgb24gZXZlcnkgY2hhbmdlIHRvIGFuIGBhcmNoYCBydW50aW1lIGNvbmZpZ3VyYXRpb24uXG4gKiBTZWUgYGFkZFVwZGF0ZWROb3RpZnlIb29rQ2FsbGJhY2tgLlxuICogQHJldHVybnMge09iamVjdH0ge3sgc3RvcDogZnVuY3Rpb24sIGNhbGxiYWNrOiBmdW5jdGlvbiB9fVxuICovXG5XZWJBcHAuYWRkVXBkYXRlZE5vdGlmeUhvb2sgPSBmdW5jdGlvbihoYW5kbGVyKSB7XG4gIHJldHVybiBydW50aW1lQ29uZmlnLnVwZGF0ZUhvb2tzLnJlZ2lzdGVyKGhhbmRsZXIpO1xufTtcblxuV2ViQXBwSW50ZXJuYWxzLmdlbmVyYXRlQm9pbGVycGxhdGVJbnN0YW5jZSA9IGZ1bmN0aW9uKFxuICBhcmNoLFxuICBtYW5pZmVzdCxcbiAgYWRkaXRpb25hbE9wdGlvbnNcbikge1xuICBhZGRpdGlvbmFsT3B0aW9ucyA9IGFkZGl0aW9uYWxPcHRpb25zIHx8IHt9O1xuXG4gIHJ1bnRpbWVDb25maWcuaXNVcGRhdGVkQnlBcmNoW2FyY2hdID0gdHJ1ZTtcbiAgY29uc3QgcnRpbWVDb25maWcgPSB7XG4gICAgLi4uX19tZXRlb3JfcnVudGltZV9jb25maWdfXyxcbiAgICAuLi4oYWRkaXRpb25hbE9wdGlvbnMucnVudGltZUNvbmZpZ092ZXJyaWRlcyB8fCB7fSksXG4gIH07XG4gIHJ1bnRpbWVDb25maWcudXBkYXRlSG9va3MuZm9yRWFjaChjYiA9PiB7XG4gICAgY2IoeyBhcmNoLCBtYW5pZmVzdCwgcnVudGltZUNvbmZpZzogcnRpbWVDb25maWcgfSk7XG4gIH0pO1xuXG4gIGNvbnN0IG1ldGVvclJ1bnRpbWVDb25maWcgPSBKU09OLnN0cmluZ2lmeShcbiAgICBlbmNvZGVVUklDb21wb25lbnQoSlNPTi5zdHJpbmdpZnkocnRpbWVDb25maWcpKVxuICApO1xuXG4gIHJldHVybiBuZXcgQm9pbGVycGxhdGUoXG4gICAgYXJjaCxcbiAgICBtYW5pZmVzdCxcbiAgICBPYmplY3QuYXNzaWduKFxuICAgICAge1xuICAgICAgICBwYXRoTWFwcGVyKGl0ZW1QYXRoKSB7XG4gICAgICAgICAgcmV0dXJuIHBhdGhKb2luKGFyY2hQYXRoW2FyY2hdLCBpdGVtUGF0aCk7XG4gICAgICAgIH0sXG4gICAgICAgIGJhc2VEYXRhRXh0ZW5zaW9uOiB7XG4gICAgICAgICAgYWRkaXRpb25hbFN0YXRpY0pzOiBfLm1hcChhZGRpdGlvbmFsU3RhdGljSnMgfHwgW10sIGZ1bmN0aW9uKFxuICAgICAgICAgICAgY29udGVudHMsXG4gICAgICAgICAgICBwYXRobmFtZVxuICAgICAgICAgICkge1xuICAgICAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICAgICAgcGF0aG5hbWU6IHBhdGhuYW1lLFxuICAgICAgICAgICAgICBjb250ZW50czogY29udGVudHMsXG4gICAgICAgICAgICB9O1xuICAgICAgICAgIH0pLFxuICAgICAgICAgIC8vIENvbnZlcnQgdG8gYSBKU09OIHN0cmluZywgdGhlbiBnZXQgcmlkIG9mIG1vc3Qgd2VpcmQgY2hhcmFjdGVycywgdGhlblxuICAgICAgICAgIC8vIHdyYXAgaW4gZG91YmxlIHF1b3Rlcy4gKFRoZSBvdXRlcm1vc3QgSlNPTi5zdHJpbmdpZnkgcmVhbGx5IG91Z2h0IHRvXG4gICAgICAgICAgLy8ganVzdCBiZSBcIndyYXAgaW4gZG91YmxlIHF1b3Rlc1wiIGJ1dCB3ZSB1c2UgaXQgdG8gYmUgc2FmZS4pIFRoaXMgbWlnaHRcbiAgICAgICAgICAvLyBlbmQgdXAgaW5zaWRlIGEgPHNjcmlwdD4gdGFnIHNvIHdlIG5lZWQgdG8gYmUgY2FyZWZ1bCB0byBub3QgaW5jbHVkZVxuICAgICAgICAgIC8vIFwiPC9zY3JpcHQ+XCIsIGJ1dCBub3JtYWwge3tzcGFjZWJhcnN9fSBlc2NhcGluZyBlc2NhcGVzIHRvbyBtdWNoISBTZWVcbiAgICAgICAgICAvLyBodHRwczovL2dpdGh1Yi5jb20vbWV0ZW9yL21ldGVvci9pc3N1ZXMvMzczMFxuICAgICAgICAgIG1ldGVvclJ1bnRpbWVDb25maWcsXG4gICAgICAgICAgbWV0ZW9yUnVudGltZUhhc2g6IHNoYTEobWV0ZW9yUnVudGltZUNvbmZpZyksXG4gICAgICAgICAgcm9vdFVybFBhdGhQcmVmaXg6XG4gICAgICAgICAgICBfX21ldGVvcl9ydW50aW1lX2NvbmZpZ19fLlJPT1RfVVJMX1BBVEhfUFJFRklYIHx8ICcnLFxuICAgICAgICAgIGJ1bmRsZWRKc0Nzc1VybFJld3JpdGVIb29rOiBidW5kbGVkSnNDc3NVcmxSZXdyaXRlSG9vayxcbiAgICAgICAgICBzcmlNb2RlOiBzcmlNb2RlLFxuICAgICAgICAgIGlubGluZVNjcmlwdHNBbGxvd2VkOiBXZWJBcHBJbnRlcm5hbHMuaW5saW5lU2NyaXB0c0FsbG93ZWQoKSxcbiAgICAgICAgICBpbmxpbmU6IGFkZGl0aW9uYWxPcHRpb25zLmlubGluZSxcbiAgICAgICAgfSxcbiAgICAgIH0sXG4gICAgICBhZGRpdGlvbmFsT3B0aW9uc1xuICAgIClcbiAgKTtcbn07XG5cbi8vIEEgbWFwcGluZyBmcm9tIHVybCBwYXRoIHRvIGFyY2hpdGVjdHVyZSAoZS5nLiBcIndlYi5icm93c2VyXCIpIHRvIHN0YXRpY1xuLy8gZmlsZSBpbmZvcm1hdGlvbiB3aXRoIHRoZSBmb2xsb3dpbmcgZmllbGRzOlxuLy8gLSB0eXBlOiB0aGUgdHlwZSBvZiBmaWxlIHRvIGJlIHNlcnZlZFxuLy8gLSBjYWNoZWFibGU6IG9wdGlvbmFsbHksIHdoZXRoZXIgdGhlIGZpbGUgc2hvdWxkIGJlIGNhY2hlZCBvciBub3Rcbi8vIC0gc291cmNlTWFwVXJsOiBvcHRpb25hbGx5LCB0aGUgdXJsIG9mIHRoZSBzb3VyY2UgbWFwXG4vL1xuLy8gSW5mbyBhbHNvIGNvbnRhaW5zIG9uZSBvZiB0aGUgZm9sbG93aW5nOlxuLy8gLSBjb250ZW50OiB0aGUgc3RyaW5naWZpZWQgY29udGVudCB0aGF0IHNob3VsZCBiZSBzZXJ2ZWQgYXQgdGhpcyBwYXRoXG4vLyAtIGFic29sdXRlUGF0aDogdGhlIGFic29sdXRlIHBhdGggb24gZGlzayB0byB0aGUgZmlsZVxuXG4vLyBTZXJ2ZSBzdGF0aWMgZmlsZXMgZnJvbSB0aGUgbWFuaWZlc3Qgb3IgYWRkZWQgd2l0aFxuLy8gYGFkZFN0YXRpY0pzYC4gRXhwb3J0ZWQgZm9yIHRlc3RzLlxuV2ViQXBwSW50ZXJuYWxzLnN0YXRpY0ZpbGVzTWlkZGxld2FyZSA9IGFzeW5jIGZ1bmN0aW9uKFxuICBzdGF0aWNGaWxlc0J5QXJjaCxcbiAgcmVxLFxuICByZXMsXG4gIG5leHRcbikge1xuICB2YXIgcGF0aG5hbWUgPSBwYXJzZVJlcXVlc3QocmVxKS5wYXRobmFtZTtcbiAgdHJ5IHtcbiAgICBwYXRobmFtZSA9IGRlY29kZVVSSUNvbXBvbmVudChwYXRobmFtZSk7XG4gIH0gY2F0Y2ggKGUpIHtcbiAgICBuZXh0KCk7XG4gICAgcmV0dXJuO1xuICB9XG5cbiAgdmFyIHNlcnZlU3RhdGljSnMgPSBmdW5jdGlvbihzKSB7XG4gICAgaWYgKFxuICAgICAgcmVxLm1ldGhvZCA9PT0gJ0dFVCcgfHxcbiAgICAgIHJlcS5tZXRob2QgPT09ICdIRUFEJyB8fFxuICAgICAgTWV0ZW9yLnNldHRpbmdzLnBhY2thZ2VzPy53ZWJhcHA/LmFsd2F5c1JldHVybkNvbnRlbnRcbiAgICApIHtcbiAgICAgIHJlcy53cml0ZUhlYWQoMjAwLCB7XG4gICAgICAgICdDb250ZW50LXR5cGUnOiAnYXBwbGljYXRpb24vamF2YXNjcmlwdDsgY2hhcnNldD1VVEYtOCcsXG4gICAgICAgICdDb250ZW50LUxlbmd0aCc6IEJ1ZmZlci5ieXRlTGVuZ3RoKHMpLFxuICAgICAgfSk7XG4gICAgICByZXMud3JpdGUocyk7XG4gICAgICByZXMuZW5kKCk7XG4gICAgfSBlbHNlIHtcbiAgICAgIGNvbnN0IHN0YXR1cyA9IHJlcS5tZXRob2QgPT09ICdPUFRJT05TJyA/IDIwMCA6IDQwNTtcbiAgICAgIHJlcy53cml0ZUhlYWQoc3RhdHVzLCB7XG4gICAgICAgIEFsbG93OiAnT1BUSU9OUywgR0VULCBIRUFEJyxcbiAgICAgICAgJ0NvbnRlbnQtTGVuZ3RoJzogJzAnLFxuICAgICAgfSk7XG4gICAgICByZXMuZW5kKCk7XG4gICAgfVxuICB9O1xuXG4gIGlmIChcbiAgICBfLmhhcyhhZGRpdGlvbmFsU3RhdGljSnMsIHBhdGhuYW1lKSAmJlxuICAgICFXZWJBcHBJbnRlcm5hbHMuaW5saW5lU2NyaXB0c0FsbG93ZWQoKVxuICApIHtcbiAgICBzZXJ2ZVN0YXRpY0pzKGFkZGl0aW9uYWxTdGF0aWNKc1twYXRobmFtZV0pO1xuICAgIHJldHVybjtcbiAgfVxuXG4gIGNvbnN0IHsgYXJjaCwgcGF0aCB9ID0gV2ViQXBwLmNhdGVnb3JpemVSZXF1ZXN0KHJlcSk7XG5cbiAgaWYgKCFoYXNPd24uY2FsbChXZWJBcHAuY2xpZW50UHJvZ3JhbXMsIGFyY2gpKSB7XG4gICAgLy8gV2UgY291bGQgY29tZSBoZXJlIGluIGNhc2Ugd2UgcnVuIHdpdGggc29tZSBhcmNoaXRlY3R1cmVzIGV4Y2x1ZGVkXG4gICAgbmV4dCgpO1xuICAgIHJldHVybjtcbiAgfVxuXG4gIC8vIElmIHBhdXNlQ2xpZW50KGFyY2gpIGhhcyBiZWVuIGNhbGxlZCwgcHJvZ3JhbS5wYXVzZWQgd2lsbCBiZSBhXG4gIC8vIFByb21pc2UgdGhhdCB3aWxsIGJlIHJlc29sdmVkIHdoZW4gdGhlIHByb2dyYW0gaXMgdW5wYXVzZWQuXG4gIGNvbnN0IHByb2dyYW0gPSBXZWJBcHAuY2xpZW50UHJvZ3JhbXNbYXJjaF07XG4gIGF3YWl0IHByb2dyYW0ucGF1c2VkO1xuXG4gIGlmIChcbiAgICBwYXRoID09PSAnL21ldGVvcl9ydW50aW1lX2NvbmZpZy5qcycgJiZcbiAgICAhV2ViQXBwSW50ZXJuYWxzLmlubGluZVNjcmlwdHNBbGxvd2VkKClcbiAgKSB7XG4gICAgc2VydmVTdGF0aWNKcyhcbiAgICAgIGBfX21ldGVvcl9ydW50aW1lX2NvbmZpZ19fID0gJHtwcm9ncmFtLm1ldGVvclJ1bnRpbWVDb25maWd9O2BcbiAgICApO1xuICAgIHJldHVybjtcbiAgfVxuXG4gIGNvbnN0IGluZm8gPSBnZXRTdGF0aWNGaWxlSW5mbyhzdGF0aWNGaWxlc0J5QXJjaCwgcGF0aG5hbWUsIHBhdGgsIGFyY2gpO1xuICBpZiAoIWluZm8pIHtcbiAgICBuZXh0KCk7XG4gICAgcmV0dXJuO1xuICB9XG4gIC8vIFwic2VuZFwiIHdpbGwgaGFuZGxlIEhFQUQgJiBHRVQgcmVxdWVzdHNcbiAgaWYgKFxuICAgIHJlcS5tZXRob2QgIT09ICdIRUFEJyAmJlxuICAgIHJlcS5tZXRob2QgIT09ICdHRVQnICYmXG4gICAgIU1ldGVvci5zZXR0aW5ncy5wYWNrYWdlcz8ud2ViYXBwPy5hbHdheXNSZXR1cm5Db250ZW50XG4gICkge1xuICAgIGNvbnN0IHN0YXR1cyA9IHJlcS5tZXRob2QgPT09ICdPUFRJT05TJyA/IDIwMCA6IDQwNTtcbiAgICByZXMud3JpdGVIZWFkKHN0YXR1cywge1xuICAgICAgQWxsb3c6ICdPUFRJT05TLCBHRVQsIEhFQUQnLFxuICAgICAgJ0NvbnRlbnQtTGVuZ3RoJzogJzAnLFxuICAgIH0pO1xuICAgIHJlcy5lbmQoKTtcbiAgICByZXR1cm47XG4gIH1cblxuICAvLyBXZSBkb24ndCBuZWVkIHRvIGNhbGwgcGF1c2UgYmVjYXVzZSwgdW5saWtlICdzdGF0aWMnLCBvbmNlIHdlIGNhbGwgaW50b1xuICAvLyAnc2VuZCcgYW5kIHlpZWxkIHRvIHRoZSBldmVudCBsb29wLCB3ZSBuZXZlciBjYWxsIGFub3RoZXIgaGFuZGxlciB3aXRoXG4gIC8vICduZXh0Jy5cblxuICAvLyBDYWNoZWFibGUgZmlsZXMgYXJlIGZpbGVzIHRoYXQgc2hvdWxkIG5ldmVyIGNoYW5nZS4gVHlwaWNhbGx5XG4gIC8vIG5hbWVkIGJ5IHRoZWlyIGhhc2ggKGVnIG1ldGVvciBidW5kbGVkIGpzIGFuZCBjc3MgZmlsZXMpLlxuICAvLyBXZSBjYWNoZSB0aGVtIH5mb3JldmVyICgxeXIpLlxuICBjb25zdCBtYXhBZ2UgPSBpbmZvLmNhY2hlYWJsZSA/IDEwMDAgKiA2MCAqIDYwICogMjQgKiAzNjUgOiAwO1xuXG4gIGlmIChpbmZvLmNhY2hlYWJsZSkge1xuICAgIC8vIFNpbmNlIHdlIHVzZSByZXEuaGVhZGVyc1tcInVzZXItYWdlbnRcIl0gdG8gZGV0ZXJtaW5lIHdoZXRoZXIgdGhlXG4gICAgLy8gY2xpZW50IHNob3VsZCByZWNlaXZlIG1vZGVybiBvciBsZWdhY3kgcmVzb3VyY2VzLCB0ZWxsIHRoZSBjbGllbnRcbiAgICAvLyB0byBpbnZhbGlkYXRlIGNhY2hlZCByZXNvdXJjZXMgd2hlbi9pZiBpdHMgdXNlciBhZ2VudCBzdHJpbmdcbiAgICAvLyBjaGFuZ2VzIGluIHRoZSBmdXR1cmUuXG4gICAgcmVzLnNldEhlYWRlcignVmFyeScsICdVc2VyLUFnZW50Jyk7XG4gIH1cblxuICAvLyBTZXQgdGhlIFgtU291cmNlTWFwIGhlYWRlciwgd2hpY2ggY3VycmVudCBDaHJvbWUsIEZpcmVGb3gsIGFuZCBTYWZhcmlcbiAgLy8gdW5kZXJzdGFuZC4gIChUaGUgU291cmNlTWFwIGhlYWRlciBpcyBzbGlnaHRseSBtb3JlIHNwZWMtY29ycmVjdCBidXQgRkZcbiAgLy8gZG9lc24ndCB1bmRlcnN0YW5kIGl0LilcbiAgLy9cbiAgLy8gWW91IG1heSBhbHNvIG5lZWQgdG8gZW5hYmxlIHNvdXJjZSBtYXBzIGluIENocm9tZTogb3BlbiBkZXYgdG9vbHMsIGNsaWNrXG4gIC8vIHRoZSBnZWFyIGluIHRoZSBib3R0b20gcmlnaHQgY29ybmVyLCBhbmQgc2VsZWN0IFwiZW5hYmxlIHNvdXJjZSBtYXBzXCIuXG4gIGlmIChpbmZvLnNvdXJjZU1hcFVybCkge1xuICAgIHJlcy5zZXRIZWFkZXIoXG4gICAgICAnWC1Tb3VyY2VNYXAnLFxuICAgICAgX19tZXRlb3JfcnVudGltZV9jb25maWdfXy5ST09UX1VSTF9QQVRIX1BSRUZJWCArIGluZm8uc291cmNlTWFwVXJsXG4gICAgKTtcbiAgfVxuXG4gIGlmIChpbmZvLnR5cGUgPT09ICdqcycgfHwgaW5mby50eXBlID09PSAnZHluYW1pYyBqcycpIHtcbiAgICByZXMuc2V0SGVhZGVyKCdDb250ZW50LVR5cGUnLCAnYXBwbGljYXRpb24vamF2YXNjcmlwdDsgY2hhcnNldD1VVEYtOCcpO1xuICB9IGVsc2UgaWYgKGluZm8udHlwZSA9PT0gJ2NzcycpIHtcbiAgICByZXMuc2V0SGVhZGVyKCdDb250ZW50LVR5cGUnLCAndGV4dC9jc3M7IGNoYXJzZXQ9VVRGLTgnKTtcbiAgfSBlbHNlIGlmIChpbmZvLnR5cGUgPT09ICdqc29uJykge1xuICAgIHJlcy5zZXRIZWFkZXIoJ0NvbnRlbnQtVHlwZScsICdhcHBsaWNhdGlvbi9qc29uOyBjaGFyc2V0PVVURi04Jyk7XG4gIH1cblxuICBpZiAoaW5mby5oYXNoKSB7XG4gICAgcmVzLnNldEhlYWRlcignRVRhZycsICdcIicgKyBpbmZvLmhhc2ggKyAnXCInKTtcbiAgfVxuXG4gIGlmIChpbmZvLmNvbnRlbnQpIHtcbiAgICByZXMuc2V0SGVhZGVyKCdDb250ZW50LUxlbmd0aCcsIEJ1ZmZlci5ieXRlTGVuZ3RoKGluZm8uY29udGVudCkpO1xuICAgIHJlcy53cml0ZShpbmZvLmNvbnRlbnQpO1xuICAgIHJlcy5lbmQoKTtcbiAgfSBlbHNlIHtcbiAgICBzZW5kKHJlcSwgaW5mby5hYnNvbHV0ZVBhdGgsIHtcbiAgICAgIG1heGFnZTogbWF4QWdlLFxuICAgICAgZG90ZmlsZXM6ICdhbGxvdycsIC8vIGlmIHdlIHNwZWNpZmllZCBhIGRvdGZpbGUgaW4gdGhlIG1hbmlmZXN0LCBzZXJ2ZSBpdFxuICAgICAgbGFzdE1vZGlmaWVkOiBmYWxzZSwgLy8gZG9uJ3Qgc2V0IGxhc3QtbW9kaWZpZWQgYmFzZWQgb24gdGhlIGZpbGUgZGF0ZVxuICAgIH0pXG4gICAgICAub24oJ2Vycm9yJywgZnVuY3Rpb24oZXJyKSB7XG4gICAgICAgIExvZy5lcnJvcignRXJyb3Igc2VydmluZyBzdGF0aWMgZmlsZSAnICsgZXJyKTtcbiAgICAgICAgcmVzLndyaXRlSGVhZCg1MDApO1xuICAgICAgICByZXMuZW5kKCk7XG4gICAgICB9KVxuICAgICAgLm9uKCdkaXJlY3RvcnknLCBmdW5jdGlvbigpIHtcbiAgICAgICAgTG9nLmVycm9yKCdVbmV4cGVjdGVkIGRpcmVjdG9yeSAnICsgaW5mby5hYnNvbHV0ZVBhdGgpO1xuICAgICAgICByZXMud3JpdGVIZWFkKDUwMCk7XG4gICAgICAgIHJlcy5lbmQoKTtcbiAgICAgIH0pXG4gICAgICAucGlwZShyZXMpO1xuICB9XG59O1xuXG5mdW5jdGlvbiBnZXRTdGF0aWNGaWxlSW5mbyhzdGF0aWNGaWxlc0J5QXJjaCwgb3JpZ2luYWxQYXRoLCBwYXRoLCBhcmNoKSB7XG4gIGlmICghaGFzT3duLmNhbGwoV2ViQXBwLmNsaWVudFByb2dyYW1zLCBhcmNoKSkge1xuICAgIHJldHVybiBudWxsO1xuICB9XG5cbiAgLy8gR2V0IGEgbGlzdCBvZiBhbGwgYXZhaWxhYmxlIHN0YXRpYyBmaWxlIGFyY2hpdGVjdHVyZXMsIHdpdGggYXJjaFxuICAvLyBmaXJzdCBpbiB0aGUgbGlzdCBpZiBpdCBleGlzdHMuXG4gIGNvbnN0IHN0YXRpY0FyY2hMaXN0ID0gT2JqZWN0LmtleXMoc3RhdGljRmlsZXNCeUFyY2gpO1xuICBjb25zdCBhcmNoSW5kZXggPSBzdGF0aWNBcmNoTGlzdC5pbmRleE9mKGFyY2gpO1xuICBpZiAoYXJjaEluZGV4ID4gMCkge1xuICAgIHN0YXRpY0FyY2hMaXN0LnVuc2hpZnQoc3RhdGljQXJjaExpc3Quc3BsaWNlKGFyY2hJbmRleCwgMSlbMF0pO1xuICB9XG5cbiAgbGV0IGluZm8gPSBudWxsO1xuXG4gIHN0YXRpY0FyY2hMaXN0LnNvbWUoYXJjaCA9PiB7XG4gICAgY29uc3Qgc3RhdGljRmlsZXMgPSBzdGF0aWNGaWxlc0J5QXJjaFthcmNoXTtcblxuICAgIGZ1bmN0aW9uIGZpbmFsaXplKHBhdGgpIHtcbiAgICAgIGluZm8gPSBzdGF0aWNGaWxlc1twYXRoXTtcbiAgICAgIC8vIFNvbWV0aW1lcyB3ZSByZWdpc3RlciBhIGxhenkgZnVuY3Rpb24gaW5zdGVhZCBvZiBhY3R1YWwgZGF0YSBpblxuICAgICAgLy8gdGhlIHN0YXRpY0ZpbGVzIG1hbmlmZXN0LlxuICAgICAgaWYgKHR5cGVvZiBpbmZvID09PSAnZnVuY3Rpb24nKSB7XG4gICAgICAgIGluZm8gPSBzdGF0aWNGaWxlc1twYXRoXSA9IGluZm8oKTtcbiAgICAgIH1cbiAgICAgIHJldHVybiBpbmZvO1xuICAgIH1cblxuICAgIC8vIElmIHN0YXRpY0ZpbGVzIGNvbnRhaW5zIG9yaWdpbmFsUGF0aCB3aXRoIHRoZSBhcmNoIGluZmVycmVkIGFib3ZlLFxuICAgIC8vIHVzZSB0aGF0IGluZm9ybWF0aW9uLlxuICAgIGlmIChoYXNPd24uY2FsbChzdGF0aWNGaWxlcywgb3JpZ2luYWxQYXRoKSkge1xuICAgICAgcmV0dXJuIGZpbmFsaXplKG9yaWdpbmFsUGF0aCk7XG4gICAgfVxuXG4gICAgLy8gSWYgY2F0ZWdvcml6ZVJlcXVlc3QgcmV0dXJuZWQgYW4gYWx0ZXJuYXRlIHBhdGgsIHRyeSB0aGF0IGluc3RlYWQuXG4gICAgaWYgKHBhdGggIT09IG9yaWdpbmFsUGF0aCAmJiBoYXNPd24uY2FsbChzdGF0aWNGaWxlcywgcGF0aCkpIHtcbiAgICAgIHJldHVybiBmaW5hbGl6ZShwYXRoKTtcbiAgICB9XG4gIH0pO1xuXG4gIHJldHVybiBpbmZvO1xufVxuXG4vLyBQYXJzZSB0aGUgcGFzc2VkIGluIHBvcnQgdmFsdWUuIFJldHVybiB0aGUgcG9ydCBhcy1pcyBpZiBpdCdzIGEgU3RyaW5nXG4vLyAoZS5nLiBhIFdpbmRvd3MgU2VydmVyIHN0eWxlIG5hbWVkIHBpcGUpLCBvdGhlcndpc2UgcmV0dXJuIHRoZSBwb3J0IGFzIGFuXG4vLyBpbnRlZ2VyLlxuLy9cbi8vIERFUFJFQ0FURUQ6IERpcmVjdCB1c2Ugb2YgdGhpcyBmdW5jdGlvbiBpcyBub3QgcmVjb21tZW5kZWQ7IGl0IGlzIG5vXG4vLyBsb25nZXIgdXNlZCBpbnRlcm5hbGx5LCBhbmQgd2lsbCBiZSByZW1vdmVkIGluIGEgZnV0dXJlIHJlbGVhc2UuXG5XZWJBcHBJbnRlcm5hbHMucGFyc2VQb3J0ID0gcG9ydCA9PiB7XG4gIGxldCBwYXJzZWRQb3J0ID0gcGFyc2VJbnQocG9ydCk7XG4gIGlmIChOdW1iZXIuaXNOYU4ocGFyc2VkUG9ydCkpIHtcbiAgICBwYXJzZWRQb3J0ID0gcG9ydDtcbiAgfVxuICByZXR1cm4gcGFyc2VkUG9ydDtcbn07XG5cbmltcG9ydCB7IG9uTWVzc2FnZSB9IGZyb20gJ21ldGVvci9pbnRlci1wcm9jZXNzLW1lc3NhZ2luZyc7XG5cbm9uTWVzc2FnZSgnd2ViYXBwLXBhdXNlLWNsaWVudCcsIGFzeW5jICh7IGFyY2ggfSkgPT4ge1xuICBXZWJBcHBJbnRlcm5hbHMucGF1c2VDbGllbnQoYXJjaCk7XG59KTtcblxub25NZXNzYWdlKCd3ZWJhcHAtcmVsb2FkLWNsaWVudCcsIGFzeW5jICh7IGFyY2ggfSkgPT4ge1xuICBXZWJBcHBJbnRlcm5hbHMuZ2VuZXJhdGVDbGllbnRQcm9ncmFtKGFyY2gpO1xufSk7XG5cbmZ1bmN0aW9uIHJ1bldlYkFwcFNlcnZlcigpIHtcbiAgdmFyIHNodXR0aW5nRG93biA9IGZhbHNlO1xuICB2YXIgc3luY1F1ZXVlID0gbmV3IE1ldGVvci5fU3luY2hyb25vdXNRdWV1ZSgpO1xuXG4gIHZhciBnZXRJdGVtUGF0aG5hbWUgPSBmdW5jdGlvbihpdGVtVXJsKSB7XG4gICAgcmV0dXJuIGRlY29kZVVSSUNvbXBvbmVudChwYXJzZVVybChpdGVtVXJsKS5wYXRobmFtZSk7XG4gIH07XG5cbiAgV2ViQXBwSW50ZXJuYWxzLnJlbG9hZENsaWVudFByb2dyYW1zID0gZnVuY3Rpb24oKSB7XG4gICAgc3luY1F1ZXVlLnJ1blRhc2soZnVuY3Rpb24oKSB7XG4gICAgICBjb25zdCBzdGF0aWNGaWxlc0J5QXJjaCA9IE9iamVjdC5jcmVhdGUobnVsbCk7XG5cbiAgICAgIGNvbnN0IHsgY29uZmlnSnNvbiB9ID0gX19tZXRlb3JfYm9vdHN0cmFwX187XG4gICAgICBjb25zdCBjbGllbnRBcmNocyA9XG4gICAgICAgIGNvbmZpZ0pzb24uY2xpZW50QXJjaHMgfHwgT2JqZWN0LmtleXMoY29uZmlnSnNvbi5jbGllbnRQYXRocyk7XG5cbiAgICAgIHRyeSB7XG4gICAgICAgIGNsaWVudEFyY2hzLmZvckVhY2goYXJjaCA9PiB7XG4gICAgICAgICAgZ2VuZXJhdGVDbGllbnRQcm9ncmFtKGFyY2gsIHN0YXRpY0ZpbGVzQnlBcmNoKTtcbiAgICAgICAgfSk7XG4gICAgICAgIFdlYkFwcEludGVybmFscy5zdGF0aWNGaWxlc0J5QXJjaCA9IHN0YXRpY0ZpbGVzQnlBcmNoO1xuICAgICAgfSBjYXRjaCAoZSkge1xuICAgICAgICBMb2cuZXJyb3IoJ0Vycm9yIHJlbG9hZGluZyB0aGUgY2xpZW50IHByb2dyYW06ICcgKyBlLnN0YWNrKTtcbiAgICAgICAgcHJvY2Vzcy5leGl0KDEpO1xuICAgICAgfVxuICAgIH0pO1xuICB9O1xuXG4gIC8vIFBhdXNlIGFueSBpbmNvbWluZyByZXF1ZXN0cyBhbmQgbWFrZSB0aGVtIHdhaXQgZm9yIHRoZSBwcm9ncmFtIHRvIGJlXG4gIC8vIHVucGF1c2VkIHRoZSBuZXh0IHRpbWUgZ2VuZXJhdGVDbGllbnRQcm9ncmFtKGFyY2gpIGlzIGNhbGxlZC5cbiAgV2ViQXBwSW50ZXJuYWxzLnBhdXNlQ2xpZW50ID0gZnVuY3Rpb24oYXJjaCkge1xuICAgIHN5bmNRdWV1ZS5ydW5UYXNrKCgpID0+IHtcbiAgICAgIGNvbnN0IHByb2dyYW0gPSBXZWJBcHAuY2xpZW50UHJvZ3JhbXNbYXJjaF07XG4gICAgICBjb25zdCB7IHVucGF1c2UgfSA9IHByb2dyYW07XG4gICAgICBwcm9ncmFtLnBhdXNlZCA9IG5ldyBQcm9taXNlKHJlc29sdmUgPT4ge1xuICAgICAgICBpZiAodHlwZW9mIHVucGF1c2UgPT09ICdmdW5jdGlvbicpIHtcbiAgICAgICAgICAvLyBJZiB0aGVyZSBoYXBwZW5zIHRvIGJlIGFuIGV4aXN0aW5nIHByb2dyYW0udW5wYXVzZSBmdW5jdGlvbixcbiAgICAgICAgICAvLyBjb21wb3NlIGl0IHdpdGggdGhlIHJlc29sdmUgZnVuY3Rpb24uXG4gICAgICAgICAgcHJvZ3JhbS51bnBhdXNlID0gZnVuY3Rpb24oKSB7XG4gICAgICAgICAgICB1bnBhdXNlKCk7XG4gICAgICAgICAgICByZXNvbHZlKCk7XG4gICAgICAgICAgfTtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICBwcm9ncmFtLnVucGF1c2UgPSByZXNvbHZlO1xuICAgICAgICB9XG4gICAgICB9KTtcbiAgICB9KTtcbiAgfTtcblxuICBXZWJBcHBJbnRlcm5hbHMuZ2VuZXJhdGVDbGllbnRQcm9ncmFtID0gZnVuY3Rpb24oYXJjaCkge1xuICAgIHN5bmNRdWV1ZS5ydW5UYXNrKCgpID0+IGdlbmVyYXRlQ2xpZW50UHJvZ3JhbShhcmNoKSk7XG4gIH07XG5cbiAgZnVuY3Rpb24gZ2VuZXJhdGVDbGllbnRQcm9ncmFtKFxuICAgIGFyY2gsXG4gICAgc3RhdGljRmlsZXNCeUFyY2ggPSBXZWJBcHBJbnRlcm5hbHMuc3RhdGljRmlsZXNCeUFyY2hcbiAgKSB7XG4gICAgY29uc3QgY2xpZW50RGlyID0gcGF0aEpvaW4oXG4gICAgICBwYXRoRGlybmFtZShfX21ldGVvcl9ib290c3RyYXBfXy5zZXJ2ZXJEaXIpLFxuICAgICAgYXJjaFxuICAgICk7XG5cbiAgICAvLyByZWFkIHRoZSBjb250cm9sIGZvciB0aGUgY2xpZW50IHdlJ2xsIGJlIHNlcnZpbmcgdXBcbiAgICBjb25zdCBwcm9ncmFtSnNvblBhdGggPSBwYXRoSm9pbihjbGllbnREaXIsICdwcm9ncmFtLmpzb24nKTtcblxuICAgIGxldCBwcm9ncmFtSnNvbjtcbiAgICB0cnkge1xuICAgICAgcHJvZ3JhbUpzb24gPSBKU09OLnBhcnNlKHJlYWRGaWxlU3luYyhwcm9ncmFtSnNvblBhdGgpKTtcbiAgICB9IGNhdGNoIChlKSB7XG4gICAgICBpZiAoZS5jb2RlID09PSAnRU5PRU5UJykgcmV0dXJuO1xuICAgICAgdGhyb3cgZTtcbiAgICB9XG5cbiAgICBpZiAocHJvZ3JhbUpzb24uZm9ybWF0ICE9PSAnd2ViLXByb2dyYW0tcHJlMScpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihcbiAgICAgICAgJ1Vuc3VwcG9ydGVkIGZvcm1hdCBmb3IgY2xpZW50IGFzc2V0czogJyArXG4gICAgICAgICAgSlNPTi5zdHJpbmdpZnkocHJvZ3JhbUpzb24uZm9ybWF0KVxuICAgICAgKTtcbiAgICB9XG5cbiAgICBpZiAoIXByb2dyYW1Kc29uUGF0aCB8fCAhY2xpZW50RGlyIHx8ICFwcm9ncmFtSnNvbikge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKCdDbGllbnQgY29uZmlnIGZpbGUgbm90IHBhcnNlZC4nKTtcbiAgICB9XG5cbiAgICBhcmNoUGF0aFthcmNoXSA9IGNsaWVudERpcjtcbiAgICBjb25zdCBzdGF0aWNGaWxlcyA9IChzdGF0aWNGaWxlc0J5QXJjaFthcmNoXSA9IE9iamVjdC5jcmVhdGUobnVsbCkpO1xuXG4gICAgY29uc3QgeyBtYW5pZmVzdCB9ID0gcHJvZ3JhbUpzb247XG4gICAgbWFuaWZlc3QuZm9yRWFjaChpdGVtID0+IHtcbiAgICAgIGlmIChpdGVtLnVybCAmJiBpdGVtLndoZXJlID09PSAnY2xpZW50Jykge1xuICAgICAgICBzdGF0aWNGaWxlc1tnZXRJdGVtUGF0aG5hbWUoaXRlbS51cmwpXSA9IHtcbiAgICAgICAgICBhYnNvbHV0ZVBhdGg6IHBhdGhKb2luKGNsaWVudERpciwgaXRlbS5wYXRoKSxcbiAgICAgICAgICBjYWNoZWFibGU6IGl0ZW0uY2FjaGVhYmxlLFxuICAgICAgICAgIGhhc2g6IGl0ZW0uaGFzaCxcbiAgICAgICAgICAvLyBMaW5rIGZyb20gc291cmNlIHRvIGl0cyBtYXBcbiAgICAgICAgICBzb3VyY2VNYXBVcmw6IGl0ZW0uc291cmNlTWFwVXJsLFxuICAgICAgICAgIHR5cGU6IGl0ZW0udHlwZSxcbiAgICAgICAgfTtcblxuICAgICAgICBpZiAoaXRlbS5zb3VyY2VNYXApIHtcbiAgICAgICAgICAvLyBTZXJ2ZSB0aGUgc291cmNlIG1hcCB0b28sIHVuZGVyIHRoZSBzcGVjaWZpZWQgVVJMLiBXZSBhc3N1bWVcbiAgICAgICAgICAvLyBhbGwgc291cmNlIG1hcHMgYXJlIGNhY2hlYWJsZS5cbiAgICAgICAgICBzdGF0aWNGaWxlc1tnZXRJdGVtUGF0aG5hbWUoaXRlbS5zb3VyY2VNYXBVcmwpXSA9IHtcbiAgICAgICAgICAgIGFic29sdXRlUGF0aDogcGF0aEpvaW4oY2xpZW50RGlyLCBpdGVtLnNvdXJjZU1hcCksXG4gICAgICAgICAgICBjYWNoZWFibGU6IHRydWUsXG4gICAgICAgICAgfTtcbiAgICAgICAgfVxuICAgICAgfVxuICAgIH0pO1xuXG4gICAgY29uc3QgeyBQVUJMSUNfU0VUVElOR1MgfSA9IF9fbWV0ZW9yX3J1bnRpbWVfY29uZmlnX187XG4gICAgY29uc3QgY29uZmlnT3ZlcnJpZGVzID0ge1xuICAgICAgUFVCTElDX1NFVFRJTkdTLFxuICAgIH07XG5cbiAgICBjb25zdCBvbGRQcm9ncmFtID0gV2ViQXBwLmNsaWVudFByb2dyYW1zW2FyY2hdO1xuICAgIGNvbnN0IG5ld1Byb2dyYW0gPSAoV2ViQXBwLmNsaWVudFByb2dyYW1zW2FyY2hdID0ge1xuICAgICAgZm9ybWF0OiAnd2ViLXByb2dyYW0tcHJlMScsXG4gICAgICBtYW5pZmVzdDogbWFuaWZlc3QsXG4gICAgICAvLyBVc2UgYXJyb3cgZnVuY3Rpb25zIHNvIHRoYXQgdGhlc2UgdmVyc2lvbnMgY2FuIGJlIGxhemlseVxuICAgICAgLy8gY2FsY3VsYXRlZCBsYXRlciwgYW5kIHNvIHRoYXQgdGhleSB3aWxsIG5vdCBiZSBpbmNsdWRlZCBpbiB0aGVcbiAgICAgIC8vIHN0YXRpY0ZpbGVzW21hbmlmZXN0VXJsXS5jb250ZW50IHN0cmluZyBiZWxvdy5cbiAgICAgIC8vXG4gICAgICAvLyBOb3RlOiB0aGVzZSB2ZXJzaW9uIGNhbGN1bGF0aW9ucyBtdXN0IGJlIGtlcHQgaW4gYWdyZWVtZW50IHdpdGhcbiAgICAgIC8vIENvcmRvdmFCdWlsZGVyI2FwcGVuZFZlcnNpb24gaW4gdG9vbHMvY29yZG92YS9idWlsZGVyLmpzLCBvciBob3RcbiAgICAgIC8vIGNvZGUgcHVzaCB3aWxsIHJlbG9hZCBDb3Jkb3ZhIGFwcHMgdW5uZWNlc3NhcmlseS5cbiAgICAgIHZlcnNpb246ICgpID0+XG4gICAgICAgIFdlYkFwcEhhc2hpbmcuY2FsY3VsYXRlQ2xpZW50SGFzaChtYW5pZmVzdCwgbnVsbCwgY29uZmlnT3ZlcnJpZGVzKSxcbiAgICAgIHZlcnNpb25SZWZyZXNoYWJsZTogKCkgPT5cbiAgICAgICAgV2ViQXBwSGFzaGluZy5jYWxjdWxhdGVDbGllbnRIYXNoKFxuICAgICAgICAgIG1hbmlmZXN0LFxuICAgICAgICAgIHR5cGUgPT4gdHlwZSA9PT0gJ2NzcycsXG4gICAgICAgICAgY29uZmlnT3ZlcnJpZGVzXG4gICAgICAgICksXG4gICAgICB2ZXJzaW9uTm9uUmVmcmVzaGFibGU6ICgpID0+XG4gICAgICAgIFdlYkFwcEhhc2hpbmcuY2FsY3VsYXRlQ2xpZW50SGFzaChcbiAgICAgICAgICBtYW5pZmVzdCxcbiAgICAgICAgICAodHlwZSwgcmVwbGFjZWFibGUpID0+IHR5cGUgIT09ICdjc3MnICYmICFyZXBsYWNlYWJsZSxcbiAgICAgICAgICBjb25maWdPdmVycmlkZXNcbiAgICAgICAgKSxcbiAgICAgIHZlcnNpb25SZXBsYWNlYWJsZTogKCkgPT5cbiAgICAgICAgV2ViQXBwSGFzaGluZy5jYWxjdWxhdGVDbGllbnRIYXNoKFxuICAgICAgICAgIG1hbmlmZXN0LFxuICAgICAgICAgIChfdHlwZSwgcmVwbGFjZWFibGUpID0+IHtcbiAgICAgICAgICAgIGlmIChNZXRlb3IuaXNQcm9kdWN0aW9uICYmIHJlcGxhY2VhYmxlKSB7XG4gICAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcignVW5leHBlY3RlZCByZXBsYWNlYWJsZSBmaWxlIGluIHByb2R1Y3Rpb24nKTtcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgcmV0dXJuIHJlcGxhY2VhYmxlO1xuICAgICAgICAgIH0sXG4gICAgICAgICAgY29uZmlnT3ZlcnJpZGVzXG4gICAgICAgICksXG4gICAgICBjb3Jkb3ZhQ29tcGF0aWJpbGl0eVZlcnNpb25zOiBwcm9ncmFtSnNvbi5jb3Jkb3ZhQ29tcGF0aWJpbGl0eVZlcnNpb25zLFxuICAgICAgUFVCTElDX1NFVFRJTkdTLFxuICAgICAgaG1yVmVyc2lvbjogcHJvZ3JhbUpzb24uaG1yVmVyc2lvbixcbiAgICB9KTtcblxuICAgIC8vIEV4cG9zZSBwcm9ncmFtIGRldGFpbHMgYXMgYSBzdHJpbmcgcmVhY2hhYmxlIHZpYSB0aGUgZm9sbG93aW5nIFVSTC5cbiAgICBjb25zdCBtYW5pZmVzdFVybFByZWZpeCA9ICcvX18nICsgYXJjaC5yZXBsYWNlKC9ed2ViXFwuLywgJycpO1xuICAgIGNvbnN0IG1hbmlmZXN0VXJsID0gbWFuaWZlc3RVcmxQcmVmaXggKyBnZXRJdGVtUGF0aG5hbWUoJy9tYW5pZmVzdC5qc29uJyk7XG5cbiAgICBzdGF0aWNGaWxlc1ttYW5pZmVzdFVybF0gPSAoKSA9PiB7XG4gICAgICBpZiAoUGFja2FnZS5hdXRvdXBkYXRlKSB7XG4gICAgICAgIGNvbnN0IHtcbiAgICAgICAgICBBVVRPVVBEQVRFX1ZFUlNJT04gPSBQYWNrYWdlLmF1dG91cGRhdGUuQXV0b3VwZGF0ZS5hdXRvdXBkYXRlVmVyc2lvbixcbiAgICAgICAgfSA9IHByb2Nlc3MuZW52O1xuXG4gICAgICAgIGlmIChBVVRPVVBEQVRFX1ZFUlNJT04pIHtcbiAgICAgICAgICBuZXdQcm9ncmFtLnZlcnNpb24gPSBBVVRPVVBEQVRFX1ZFUlNJT047XG4gICAgICAgIH1cbiAgICAgIH1cblxuICAgICAgaWYgKHR5cGVvZiBuZXdQcm9ncmFtLnZlcnNpb24gPT09ICdmdW5jdGlvbicpIHtcbiAgICAgICAgbmV3UHJvZ3JhbS52ZXJzaW9uID0gbmV3UHJvZ3JhbS52ZXJzaW9uKCk7XG4gICAgICB9XG5cbiAgICAgIHJldHVybiB7XG4gICAgICAgIGNvbnRlbnQ6IEpTT04uc3RyaW5naWZ5KG5ld1Byb2dyYW0pLFxuICAgICAgICBjYWNoZWFibGU6IGZhbHNlLFxuICAgICAgICBoYXNoOiBuZXdQcm9ncmFtLnZlcnNpb24sXG4gICAgICAgIHR5cGU6ICdqc29uJyxcbiAgICAgIH07XG4gICAgfTtcblxuICAgIGdlbmVyYXRlQm9pbGVycGxhdGVGb3JBcmNoKGFyY2gpO1xuXG4gICAgLy8gSWYgdGhlcmUgYXJlIGFueSByZXF1ZXN0cyB3YWl0aW5nIG9uIG9sZFByb2dyYW0ucGF1c2VkLCBsZXQgdGhlbVxuICAgIC8vIGNvbnRpbnVlIG5vdyAodXNpbmcgdGhlIG5ldyBwcm9ncmFtKS5cbiAgICBpZiAob2xkUHJvZ3JhbSAmJiBvbGRQcm9ncmFtLnBhdXNlZCkge1xuICAgICAgb2xkUHJvZ3JhbS51bnBhdXNlKCk7XG4gICAgfVxuICB9XG5cbiAgY29uc3QgZGVmYXVsdE9wdGlvbnNGb3JBcmNoID0ge1xuICAgICd3ZWIuY29yZG92YSc6IHtcbiAgICAgIHJ1bnRpbWVDb25maWdPdmVycmlkZXM6IHtcbiAgICAgICAgLy8gWFhYIFdlIHVzZSBhYnNvbHV0ZVVybCgpIGhlcmUgc28gdGhhdCB3ZSBzZXJ2ZSBodHRwczovL1xuICAgICAgICAvLyBVUkxzIHRvIGNvcmRvdmEgY2xpZW50cyBpZiBmb3JjZS1zc2wgaXMgaW4gdXNlLiBJZiB3ZSB3ZXJlXG4gICAgICAgIC8vIHRvIHVzZSBfX21ldGVvcl9ydW50aW1lX2NvbmZpZ19fLlJPT1RfVVJMIGluc3RlYWQgb2ZcbiAgICAgICAgLy8gYWJzb2x1dGVVcmwoKSwgdGhlbiBDb3Jkb3ZhIGNsaWVudHMgd291bGQgaW1tZWRpYXRlbHkgZ2V0IGFcbiAgICAgICAgLy8gSENQIHNldHRpbmcgdGhlaXIgRERQX0RFRkFVTFRfQ09OTkVDVElPTl9VUkwgdG9cbiAgICAgICAgLy8gaHR0cDovL2V4YW1wbGUubWV0ZW9yLmNvbS4gVGhpcyBicmVha3MgdGhlIGFwcCwgYmVjYXVzZVxuICAgICAgICAvLyBmb3JjZS1zc2wgZG9lc24ndCBzZXJ2ZSBDT1JTIGhlYWRlcnMgb24gMzAyXG4gICAgICAgIC8vIHJlZGlyZWN0cy4gKFBsdXMgaXQncyB1bmRlc2lyYWJsZSB0byBoYXZlIGNsaWVudHNcbiAgICAgICAgLy8gY29ubmVjdGluZyB0byBodHRwOi8vZXhhbXBsZS5tZXRlb3IuY29tIHdoZW4gZm9yY2Utc3NsIGlzXG4gICAgICAgIC8vIGluIHVzZS4pXG4gICAgICAgIEREUF9ERUZBVUxUX0NPTk5FQ1RJT05fVVJMOlxuICAgICAgICAgIHByb2Nlc3MuZW52Lk1PQklMRV9ERFBfVVJMIHx8IE1ldGVvci5hYnNvbHV0ZVVybCgpLFxuICAgICAgICBST09UX1VSTDogcHJvY2Vzcy5lbnYuTU9CSUxFX1JPT1RfVVJMIHx8IE1ldGVvci5hYnNvbHV0ZVVybCgpLFxuICAgICAgfSxcbiAgICB9LFxuXG4gICAgJ3dlYi5icm93c2VyJzoge1xuICAgICAgcnVudGltZUNvbmZpZ092ZXJyaWRlczoge1xuICAgICAgICBpc01vZGVybjogdHJ1ZSxcbiAgICAgIH0sXG4gICAgfSxcblxuICAgICd3ZWIuYnJvd3Nlci5sZWdhY3knOiB7XG4gICAgICBydW50aW1lQ29uZmlnT3ZlcnJpZGVzOiB7XG4gICAgICAgIGlzTW9kZXJuOiBmYWxzZSxcbiAgICAgIH0sXG4gICAgfSxcbiAgfTtcblxuICBXZWJBcHBJbnRlcm5hbHMuZ2VuZXJhdGVCb2lsZXJwbGF0ZSA9IGZ1bmN0aW9uKCkge1xuICAgIC8vIFRoaXMgYm9pbGVycGxhdGUgd2lsbCBiZSBzZXJ2ZWQgdG8gdGhlIG1vYmlsZSBkZXZpY2VzIHdoZW4gdXNlZCB3aXRoXG4gICAgLy8gTWV0ZW9yL0NvcmRvdmEgZm9yIHRoZSBIb3QtQ29kZSBQdXNoIGFuZCBzaW5jZSB0aGUgZmlsZSB3aWxsIGJlIHNlcnZlZCBieVxuICAgIC8vIHRoZSBkZXZpY2UncyBzZXJ2ZXIsIGl0IGlzIGltcG9ydGFudCB0byBzZXQgdGhlIEREUCB1cmwgdG8gdGhlIGFjdHVhbFxuICAgIC8vIE1ldGVvciBzZXJ2ZXIgYWNjZXB0aW5nIEREUCBjb25uZWN0aW9ucyBhbmQgbm90IHRoZSBkZXZpY2UncyBmaWxlIHNlcnZlci5cbiAgICBzeW5jUXVldWUucnVuVGFzayhmdW5jdGlvbigpIHtcbiAgICAgIE9iamVjdC5rZXlzKFdlYkFwcC5jbGllbnRQcm9ncmFtcykuZm9yRWFjaChnZW5lcmF0ZUJvaWxlcnBsYXRlRm9yQXJjaCk7XG4gICAgfSk7XG4gIH07XG5cbiAgZnVuY3Rpb24gZ2VuZXJhdGVCb2lsZXJwbGF0ZUZvckFyY2goYXJjaCkge1xuICAgIGNvbnN0IHByb2dyYW0gPSBXZWJBcHAuY2xpZW50UHJvZ3JhbXNbYXJjaF07XG4gICAgY29uc3QgYWRkaXRpb25hbE9wdGlvbnMgPSBkZWZhdWx0T3B0aW9uc0ZvckFyY2hbYXJjaF0gfHwge307XG4gICAgY29uc3QgeyBiYXNlRGF0YSB9ID0gKGJvaWxlcnBsYXRlQnlBcmNoW1xuICAgICAgYXJjaFxuICAgIF0gPSBXZWJBcHBJbnRlcm5hbHMuZ2VuZXJhdGVCb2lsZXJwbGF0ZUluc3RhbmNlKFxuICAgICAgYXJjaCxcbiAgICAgIHByb2dyYW0ubWFuaWZlc3QsXG4gICAgICBhZGRpdGlvbmFsT3B0aW9uc1xuICAgICkpO1xuICAgIC8vIFdlIG5lZWQgdGhlIHJ1bnRpbWUgY29uZmlnIHdpdGggb3ZlcnJpZGVzIGZvciBtZXRlb3JfcnVudGltZV9jb25maWcuanM6XG4gICAgcHJvZ3JhbS5tZXRlb3JSdW50aW1lQ29uZmlnID0gSlNPTi5zdHJpbmdpZnkoe1xuICAgICAgLi4uX19tZXRlb3JfcnVudGltZV9jb25maWdfXyxcbiAgICAgIC4uLihhZGRpdGlvbmFsT3B0aW9ucy5ydW50aW1lQ29uZmlnT3ZlcnJpZGVzIHx8IG51bGwpLFxuICAgIH0pO1xuICAgIHByb2dyYW0ucmVmcmVzaGFibGVBc3NldHMgPSBiYXNlRGF0YS5jc3MubWFwKGZpbGUgPT4gKHtcbiAgICAgIHVybDogYnVuZGxlZEpzQ3NzVXJsUmV3cml0ZUhvb2soZmlsZS51cmwpLFxuICAgIH0pKTtcbiAgfVxuXG4gIFdlYkFwcEludGVybmFscy5yZWxvYWRDbGllbnRQcm9ncmFtcygpO1xuXG4gIC8vIHdlYnNlcnZlclxuICB2YXIgYXBwID0gY29ubmVjdCgpO1xuXG4gIC8vIFBhY2thZ2VzIGFuZCBhcHBzIGNhbiBhZGQgaGFuZGxlcnMgdGhhdCBydW4gYmVmb3JlIGFueSBvdGhlciBNZXRlb3JcbiAgLy8gaGFuZGxlcnMgdmlhIFdlYkFwcC5yYXdDb25uZWN0SGFuZGxlcnMuXG4gIHZhciByYXdDb25uZWN0SGFuZGxlcnMgPSBjb25uZWN0KCk7XG4gIGFwcC51c2UocmF3Q29ubmVjdEhhbmRsZXJzKTtcblxuICAvLyBBdXRvLWNvbXByZXNzIGFueSBqc29uLCBqYXZhc2NyaXB0LCBvciB0ZXh0LlxuICBhcHAudXNlKGNvbXByZXNzKHsgZmlsdGVyOiBzaG91bGRDb21wcmVzcyB9KSk7XG5cbiAgLy8gcGFyc2UgY29va2llcyBpbnRvIGFuIG9iamVjdFxuICBhcHAudXNlKGNvb2tpZVBhcnNlcigpKTtcblxuICAvLyBXZSdyZSBub3QgYSBwcm94eTsgcmVqZWN0ICh3aXRob3V0IGNyYXNoaW5nKSBhdHRlbXB0cyB0byB0cmVhdCB1cyBsaWtlXG4gIC8vIG9uZS4gKFNlZSAjMTIxMi4pXG4gIGFwcC51c2UoZnVuY3Rpb24ocmVxLCByZXMsIG5leHQpIHtcbiAgICBpZiAoUm91dGVQb2xpY3kuaXNWYWxpZFVybChyZXEudXJsKSkge1xuICAgICAgbmV4dCgpO1xuICAgICAgcmV0dXJuO1xuICAgIH1cbiAgICByZXMud3JpdGVIZWFkKDQwMCk7XG4gICAgcmVzLndyaXRlKCdOb3QgYSBwcm94eScpO1xuICAgIHJlcy5lbmQoKTtcbiAgfSk7XG5cbiAgLy8gUGFyc2UgdGhlIHF1ZXJ5IHN0cmluZyBpbnRvIHJlcy5xdWVyeS4gVXNlZCBieSBvYXV0aF9zZXJ2ZXIsIGJ1dCBpdCdzXG4gIC8vIGdlbmVyYWxseSBwcmV0dHkgaGFuZHkuLlxuICAvL1xuICAvLyBEbyB0aGlzIGJlZm9yZSB0aGUgbmV4dCBtaWRkbGV3YXJlIGRlc3Ryb3lzIHJlcS51cmwgaWYgYSBwYXRoIHByZWZpeFxuICAvLyBpcyBzZXQgdG8gY2xvc2UgIzEwMTExLlxuICBhcHAudXNlKGZ1bmN0aW9uKHJlcXVlc3QsIHJlc3BvbnNlLCBuZXh0KSB7XG4gICAgcmVxdWVzdC5xdWVyeSA9IHFzLnBhcnNlKHBhcnNlVXJsKHJlcXVlc3QudXJsKS5xdWVyeSk7XG4gICAgbmV4dCgpO1xuICB9KTtcblxuICBmdW5jdGlvbiBnZXRQYXRoUGFydHMocGF0aCkge1xuICAgIGNvbnN0IHBhcnRzID0gcGF0aC5zcGxpdCgnLycpO1xuICAgIHdoaWxlIChwYXJ0c1swXSA9PT0gJycpIHBhcnRzLnNoaWZ0KCk7XG4gICAgcmV0dXJuIHBhcnRzO1xuICB9XG5cbiAgZnVuY3Rpb24gaXNQcmVmaXhPZihwcmVmaXgsIGFycmF5KSB7XG4gICAgcmV0dXJuIChcbiAgICAgIHByZWZpeC5sZW5ndGggPD0gYXJyYXkubGVuZ3RoICYmXG4gICAgICBwcmVmaXguZXZlcnkoKHBhcnQsIGkpID0+IHBhcnQgPT09IGFycmF5W2ldKVxuICAgICk7XG4gIH1cblxuICAvLyBTdHJpcCBvZmYgdGhlIHBhdGggcHJlZml4LCBpZiBpdCBleGlzdHMuXG4gIGFwcC51c2UoZnVuY3Rpb24ocmVxdWVzdCwgcmVzcG9uc2UsIG5leHQpIHtcbiAgICBjb25zdCBwYXRoUHJlZml4ID0gX19tZXRlb3JfcnVudGltZV9jb25maWdfXy5ST09UX1VSTF9QQVRIX1BSRUZJWDtcbiAgICBjb25zdCB7IHBhdGhuYW1lLCBzZWFyY2ggfSA9IHBhcnNlVXJsKHJlcXVlc3QudXJsKTtcblxuICAgIC8vIGNoZWNrIGlmIHRoZSBwYXRoIGluIHRoZSB1cmwgc3RhcnRzIHdpdGggdGhlIHBhdGggcHJlZml4XG4gICAgaWYgKHBhdGhQcmVmaXgpIHtcbiAgICAgIGNvbnN0IHByZWZpeFBhcnRzID0gZ2V0UGF0aFBhcnRzKHBhdGhQcmVmaXgpO1xuICAgICAgY29uc3QgcGF0aFBhcnRzID0gZ2V0UGF0aFBhcnRzKHBhdGhuYW1lKTtcbiAgICAgIGlmIChpc1ByZWZpeE9mKHByZWZpeFBhcnRzLCBwYXRoUGFydHMpKSB7XG4gICAgICAgIHJlcXVlc3QudXJsID0gJy8nICsgcGF0aFBhcnRzLnNsaWNlKHByZWZpeFBhcnRzLmxlbmd0aCkuam9pbignLycpO1xuICAgICAgICBpZiAoc2VhcmNoKSB7XG4gICAgICAgICAgcmVxdWVzdC51cmwgKz0gc2VhcmNoO1xuICAgICAgICB9XG4gICAgICAgIHJldHVybiBuZXh0KCk7XG4gICAgICB9XG4gICAgfVxuXG4gICAgaWYgKHBhdGhuYW1lID09PSAnL2Zhdmljb24uaWNvJyB8fCBwYXRobmFtZSA9PT0gJy9yb2JvdHMudHh0Jykge1xuICAgICAgcmV0dXJuIG5leHQoKTtcbiAgICB9XG5cbiAgICBpZiAocGF0aFByZWZpeCkge1xuICAgICAgcmVzcG9uc2Uud3JpdGVIZWFkKDQwNCk7XG4gICAgICByZXNwb25zZS53cml0ZSgnVW5rbm93biBwYXRoJyk7XG4gICAgICByZXNwb25zZS5lbmQoKTtcbiAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICBuZXh0KCk7XG4gIH0pO1xuXG4gIC8vIFNlcnZlIHN0YXRpYyBmaWxlcyBmcm9tIHRoZSBtYW5pZmVzdC5cbiAgLy8gVGhpcyBpcyBpbnNwaXJlZCBieSB0aGUgJ3N0YXRpYycgbWlkZGxld2FyZS5cbiAgYXBwLnVzZShmdW5jdGlvbihyZXEsIHJlcywgbmV4dCkge1xuICAgIFdlYkFwcEludGVybmFscy5zdGF0aWNGaWxlc01pZGRsZXdhcmUoXG4gICAgICBXZWJBcHBJbnRlcm5hbHMuc3RhdGljRmlsZXNCeUFyY2gsXG4gICAgICByZXEsXG4gICAgICByZXMsXG4gICAgICBuZXh0XG4gICAgKTtcbiAgfSk7XG5cbiAgLy8gQ29yZSBNZXRlb3IgcGFja2FnZXMgbGlrZSBkeW5hbWljLWltcG9ydCBjYW4gYWRkIGhhbmRsZXJzIGJlZm9yZVxuICAvLyBvdGhlciBoYW5kbGVycyBhZGRlZCBieSBwYWNrYWdlIGFuZCBhcHBsaWNhdGlvbiBjb2RlLlxuICBhcHAudXNlKChXZWJBcHBJbnRlcm5hbHMubWV0ZW9ySW50ZXJuYWxIYW5kbGVycyA9IGNvbm5lY3QoKSkpO1xuXG4gIC8qKlxuICAgKiBAbmFtZSBjb25uZWN0SGFuZGxlcnNDYWxsYmFjayhyZXEsIHJlcywgbmV4dClcbiAgICogQGxvY3VzIFNlcnZlclxuICAgKiBAaXNwcm90b3R5cGUgdHJ1ZVxuICAgKiBAc3VtbWFyeSBjYWxsYmFjayBoYW5kbGVyIGZvciBgV2ViQXBwLmNvbm5lY3RIYW5kbGVyc2BcbiAgICogQHBhcmFtIHtPYmplY3R9IHJlcVxuICAgKiBhIE5vZGUuanNcbiAgICogW0luY29taW5nTWVzc2FnZV0oaHR0cHM6Ly9ub2RlanMub3JnL2FwaS9odHRwLmh0bWwjaHR0cF9jbGFzc19odHRwX2luY29taW5nbWVzc2FnZSlcbiAgICogb2JqZWN0IHdpdGggc29tZSBleHRyYSBwcm9wZXJ0aWVzLiBUaGlzIGFyZ3VtZW50IGNhbiBiZSB1c2VkXG4gICAqICB0byBnZXQgaW5mb3JtYXRpb24gYWJvdXQgdGhlIGluY29taW5nIHJlcXVlc3QuXG4gICAqIEBwYXJhbSB7T2JqZWN0fSByZXNcbiAgICogYSBOb2RlLmpzXG4gICAqIFtTZXJ2ZXJSZXNwb25zZV0oaHR0cDovL25vZGVqcy5vcmcvYXBpL2h0dHAuaHRtbCNodHRwX2NsYXNzX2h0dHBfc2VydmVycmVzcG9uc2UpXG4gICAqIG9iamVjdC4gVXNlIHRoaXMgdG8gd3JpdGUgZGF0YSB0aGF0IHNob3VsZCBiZSBzZW50IGluIHJlc3BvbnNlIHRvIHRoZVxuICAgKiByZXF1ZXN0LCBhbmQgY2FsbCBgcmVzLmVuZCgpYCB3aGVuIHlvdSBhcmUgZG9uZS5cbiAgICogQHBhcmFtIHtGdW5jdGlvbn0gbmV4dFxuICAgKiBDYWxsaW5nIHRoaXMgZnVuY3Rpb24gd2lsbCBwYXNzIG9uIHRoZSBoYW5kbGluZyBvZlxuICAgKiB0aGlzIHJlcXVlc3QgdG8gdGhlIG5leHQgcmVsZXZhbnQgaGFuZGxlci5cbiAgICpcbiAgICovXG5cbiAgLyoqXG4gICAqIEBtZXRob2QgY29ubmVjdEhhbmRsZXJzXG4gICAqIEBtZW1iZXJvZiBXZWJBcHBcbiAgICogQGxvY3VzIFNlcnZlclxuICAgKiBAc3VtbWFyeSBSZWdpc3RlciBhIGhhbmRsZXIgZm9yIGFsbCBIVFRQIHJlcXVlc3RzLlxuICAgKiBAcGFyYW0ge1N0cmluZ30gW3BhdGhdXG4gICAqIFRoaXMgaGFuZGxlciB3aWxsIG9ubHkgYmUgY2FsbGVkIG9uIHBhdGhzIHRoYXQgbWF0Y2hcbiAgICogdGhpcyBzdHJpbmcuIFRoZSBtYXRjaCBoYXMgdG8gYm9yZGVyIG9uIGEgYC9gIG9yIGEgYC5gLlxuICAgKlxuICAgKiBGb3IgZXhhbXBsZSwgYC9oZWxsb2Agd2lsbCBtYXRjaCBgL2hlbGxvL3dvcmxkYCBhbmRcbiAgICogYC9oZWxsby53b3JsZGAsIGJ1dCBub3QgYC9oZWxsb193b3JsZGAuXG4gICAqIEBwYXJhbSB7Y29ubmVjdEhhbmRsZXJzQ2FsbGJhY2t9IGhhbmRsZXJcbiAgICogQSBoYW5kbGVyIGZ1bmN0aW9uIHRoYXQgd2lsbCBiZSBjYWxsZWQgb24gSFRUUCByZXF1ZXN0cy5cbiAgICogU2VlIGBjb25uZWN0SGFuZGxlcnNDYWxsYmFja2BcbiAgICpcbiAgICovXG4gIC8vIFBhY2thZ2VzIGFuZCBhcHBzIGNhbiBhZGQgaGFuZGxlcnMgdG8gdGhpcyB2aWEgV2ViQXBwLmNvbm5lY3RIYW5kbGVycy5cbiAgLy8gVGhleSBhcmUgaW5zZXJ0ZWQgYmVmb3JlIG91ciBkZWZhdWx0IGhhbmRsZXIuXG4gIHZhciBwYWNrYWdlQW5kQXBwSGFuZGxlcnMgPSBjb25uZWN0KCk7XG4gIGFwcC51c2UocGFja2FnZUFuZEFwcEhhbmRsZXJzKTtcblxuICB2YXIgc3VwcHJlc3NDb25uZWN0RXJyb3JzID0gZmFsc2U7XG4gIC8vIGNvbm5lY3Qga25vd3MgaXQgaXMgYW4gZXJyb3IgaGFuZGxlciBiZWNhdXNlIGl0IGhhcyA0IGFyZ3VtZW50cyBpbnN0ZWFkIG9mXG4gIC8vIDMuIGdvIGZpZ3VyZS4gIChJdCBpcyBub3Qgc21hcnQgZW5vdWdoIHRvIGZpbmQgc3VjaCBhIHRoaW5nIGlmIGl0J3MgaGlkZGVuXG4gIC8vIGluc2lkZSBwYWNrYWdlQW5kQXBwSGFuZGxlcnMuKVxuICBhcHAudXNlKGZ1bmN0aW9uKGVyciwgcmVxLCByZXMsIG5leHQpIHtcbiAgICBpZiAoIWVyciB8fCAhc3VwcHJlc3NDb25uZWN0RXJyb3JzIHx8ICFyZXEuaGVhZGVyc1sneC1zdXBwcmVzcy1lcnJvciddKSB7XG4gICAgICBuZXh0KGVycik7XG4gICAgICByZXR1cm47XG4gICAgfVxuICAgIHJlcy53cml0ZUhlYWQoZXJyLnN0YXR1cywgeyAnQ29udGVudC1UeXBlJzogJ3RleHQvcGxhaW4nIH0pO1xuICAgIHJlcy5lbmQoJ0FuIGVycm9yIG1lc3NhZ2UnKTtcbiAgfSk7XG5cbiAgYXBwLnVzZShhc3luYyBmdW5jdGlvbihyZXEsIHJlcywgbmV4dCkge1xuICAgIGlmICghYXBwVXJsKHJlcS51cmwpKSB7XG4gICAgICByZXR1cm4gbmV4dCgpO1xuICAgIH0gZWxzZSBpZiAoXG4gICAgICByZXEubWV0aG9kICE9PSAnSEVBRCcgJiZcbiAgICAgIHJlcS5tZXRob2QgIT09ICdHRVQnICYmXG4gICAgICAhTWV0ZW9yLnNldHRpbmdzLnBhY2thZ2VzPy53ZWJhcHA/LmFsd2F5c1JldHVybkNvbnRlbnRcbiAgICApIHtcbiAgICAgIGNvbnN0IHN0YXR1cyA9IHJlcS5tZXRob2QgPT09ICdPUFRJT05TJyA/IDIwMCA6IDQwNTtcbiAgICAgIHJlcy53cml0ZUhlYWQoc3RhdHVzLCB7XG4gICAgICAgIEFsbG93OiAnT1BUSU9OUywgR0VULCBIRUFEJyxcbiAgICAgICAgJ0NvbnRlbnQtTGVuZ3RoJzogJzAnLFxuICAgICAgfSk7XG4gICAgICByZXMuZW5kKCk7XG4gICAgfSBlbHNlIHtcbiAgICAgIHZhciBoZWFkZXJzID0ge1xuICAgICAgICAnQ29udGVudC1UeXBlJzogJ3RleHQvaHRtbDsgY2hhcnNldD11dGYtOCcsXG4gICAgICB9O1xuXG4gICAgICBpZiAoc2h1dHRpbmdEb3duKSB7XG4gICAgICAgIGhlYWRlcnNbJ0Nvbm5lY3Rpb24nXSA9ICdDbG9zZSc7XG4gICAgICB9XG5cbiAgICAgIHZhciByZXF1ZXN0ID0gV2ViQXBwLmNhdGVnb3JpemVSZXF1ZXN0KHJlcSk7XG5cbiAgICAgIGlmIChyZXF1ZXN0LnVybC5xdWVyeSAmJiByZXF1ZXN0LnVybC5xdWVyeVsnbWV0ZW9yX2Nzc19yZXNvdXJjZSddKSB7XG4gICAgICAgIC8vIEluIHRoaXMgY2FzZSwgd2UncmUgcmVxdWVzdGluZyBhIENTUyByZXNvdXJjZSBpbiB0aGUgbWV0ZW9yLXNwZWNpZmljXG4gICAgICAgIC8vIHdheSwgYnV0IHdlIGRvbid0IGhhdmUgaXQuICBTZXJ2ZSBhIHN0YXRpYyBjc3MgZmlsZSB0aGF0IGluZGljYXRlcyB0aGF0XG4gICAgICAgIC8vIHdlIGRpZG4ndCBoYXZlIGl0LCBzbyB3ZSBjYW4gZGV0ZWN0IHRoYXQgYW5kIHJlZnJlc2guICBNYWtlIHN1cmVcbiAgICAgICAgLy8gdGhhdCBhbnkgcHJveGllcyBvciBDRE5zIGRvbid0IGNhY2hlIHRoaXMgZXJyb3IhICAoTm9ybWFsbHkgcHJveGllc1xuICAgICAgICAvLyBvciBDRE5zIGFyZSBzbWFydCBlbm91Z2ggbm90IHRvIGNhY2hlIGVycm9yIHBhZ2VzLCBidXQgaW4gb3JkZXIgdG9cbiAgICAgICAgLy8gbWFrZSB0aGlzIGhhY2sgd29yaywgd2UgbmVlZCB0byByZXR1cm4gdGhlIENTUyBmaWxlIGFzIGEgMjAwLCB3aGljaFxuICAgICAgICAvLyB3b3VsZCBvdGhlcndpc2UgYmUgY2FjaGVkLilcbiAgICAgICAgaGVhZGVyc1snQ29udGVudC1UeXBlJ10gPSAndGV4dC9jc3M7IGNoYXJzZXQ9dXRmLTgnO1xuICAgICAgICBoZWFkZXJzWydDYWNoZS1Db250cm9sJ10gPSAnbm8tY2FjaGUnO1xuICAgICAgICByZXMud3JpdGVIZWFkKDIwMCwgaGVhZGVycyk7XG4gICAgICAgIHJlcy53cml0ZSgnLm1ldGVvci1jc3Mtbm90LWZvdW5kLWVycm9yIHsgd2lkdGg6IDBweDt9Jyk7XG4gICAgICAgIHJlcy5lbmQoKTtcbiAgICAgICAgcmV0dXJuO1xuICAgICAgfVxuXG4gICAgICBpZiAocmVxdWVzdC51cmwucXVlcnkgJiYgcmVxdWVzdC51cmwucXVlcnlbJ21ldGVvcl9qc19yZXNvdXJjZSddKSB7XG4gICAgICAgIC8vIFNpbWlsYXJseSwgd2UncmUgcmVxdWVzdGluZyBhIEpTIHJlc291cmNlIHRoYXQgd2UgZG9uJ3QgaGF2ZS5cbiAgICAgICAgLy8gU2VydmUgYW4gdW5jYWNoZWQgNDA0LiAoV2UgY2FuJ3QgdXNlIHRoZSBzYW1lIGhhY2sgd2UgdXNlIGZvciBDU1MsXG4gICAgICAgIC8vIGJlY2F1c2UgYWN0dWFsbHkgYWN0aW5nIG9uIHRoYXQgaGFjayByZXF1aXJlcyB1cyB0byBoYXZlIHRoZSBKU1xuICAgICAgICAvLyBhbHJlYWR5ISlcbiAgICAgICAgaGVhZGVyc1snQ2FjaGUtQ29udHJvbCddID0gJ25vLWNhY2hlJztcbiAgICAgICAgcmVzLndyaXRlSGVhZCg0MDQsIGhlYWRlcnMpO1xuICAgICAgICByZXMuZW5kKCc0MDQgTm90IEZvdW5kJyk7XG4gICAgICAgIHJldHVybjtcbiAgICAgIH1cblxuICAgICAgaWYgKHJlcXVlc3QudXJsLnF1ZXJ5ICYmIHJlcXVlc3QudXJsLnF1ZXJ5WydtZXRlb3JfZG9udF9zZXJ2ZV9pbmRleCddKSB7XG4gICAgICAgIC8vIFdoZW4gZG93bmxvYWRpbmcgZmlsZXMgZHVyaW5nIGEgQ29yZG92YSBob3QgY29kZSBwdXNoLCB3ZSBuZWVkXG4gICAgICAgIC8vIHRvIGRldGVjdCBpZiBhIGZpbGUgaXMgbm90IGF2YWlsYWJsZSBpbnN0ZWFkIG9mIGluYWR2ZXJ0ZW50bHlcbiAgICAgICAgLy8gZG93bmxvYWRpbmcgdGhlIGRlZmF1bHQgaW5kZXggcGFnZS5cbiAgICAgICAgLy8gU28gc2ltaWxhciB0byB0aGUgc2l0dWF0aW9uIGFib3ZlLCB3ZSBzZXJ2ZSBhbiB1bmNhY2hlZCA0MDQuXG4gICAgICAgIGhlYWRlcnNbJ0NhY2hlLUNvbnRyb2wnXSA9ICduby1jYWNoZSc7XG4gICAgICAgIHJlcy53cml0ZUhlYWQoNDA0LCBoZWFkZXJzKTtcbiAgICAgICAgcmVzLmVuZCgnNDA0IE5vdCBGb3VuZCcpO1xuICAgICAgICByZXR1cm47XG4gICAgICB9XG5cbiAgICAgIGNvbnN0IHsgYXJjaCB9ID0gcmVxdWVzdDtcbiAgICAgIGFzc2VydC5zdHJpY3RFcXVhbCh0eXBlb2YgYXJjaCwgJ3N0cmluZycsIHsgYXJjaCB9KTtcblxuICAgICAgaWYgKCFoYXNPd24uY2FsbChXZWJBcHAuY2xpZW50UHJvZ3JhbXMsIGFyY2gpKSB7XG4gICAgICAgIC8vIFdlIGNvdWxkIGNvbWUgaGVyZSBpbiBjYXNlIHdlIHJ1biB3aXRoIHNvbWUgYXJjaGl0ZWN0dXJlcyBleGNsdWRlZFxuICAgICAgICBoZWFkZXJzWydDYWNoZS1Db250cm9sJ10gPSAnbm8tY2FjaGUnO1xuICAgICAgICByZXMud3JpdGVIZWFkKDQwNCwgaGVhZGVycyk7XG4gICAgICAgIGlmIChNZXRlb3IuaXNEZXZlbG9wbWVudCkge1xuICAgICAgICAgIHJlcy5lbmQoYE5vIGNsaWVudCBwcm9ncmFtIGZvdW5kIGZvciB0aGUgJHthcmNofSBhcmNoaXRlY3R1cmUuYCk7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgLy8gU2FmZXR5IG5ldCwgYnV0IHRoaXMgYnJhbmNoIHNob3VsZCBub3QgYmUgcG9zc2libGUuXG4gICAgICAgICAgcmVzLmVuZCgnNDA0IE5vdCBGb3VuZCcpO1xuICAgICAgICB9XG4gICAgICAgIHJldHVybjtcbiAgICAgIH1cblxuICAgICAgLy8gSWYgcGF1c2VDbGllbnQoYXJjaCkgaGFzIGJlZW4gY2FsbGVkLCBwcm9ncmFtLnBhdXNlZCB3aWxsIGJlIGFcbiAgICAgIC8vIFByb21pc2UgdGhhdCB3aWxsIGJlIHJlc29sdmVkIHdoZW4gdGhlIHByb2dyYW0gaXMgdW5wYXVzZWQuXG4gICAgICBhd2FpdCBXZWJBcHAuY2xpZW50UHJvZ3JhbXNbYXJjaF0ucGF1c2VkO1xuXG4gICAgICByZXR1cm4gZ2V0Qm9pbGVycGxhdGVBc3luYyhyZXF1ZXN0LCBhcmNoKVxuICAgICAgICAudGhlbigoeyBzdHJlYW0sIHN0YXR1c0NvZGUsIGhlYWRlcnM6IG5ld0hlYWRlcnMgfSkgPT4ge1xuICAgICAgICAgIGlmICghc3RhdHVzQ29kZSkge1xuICAgICAgICAgICAgc3RhdHVzQ29kZSA9IHJlcy5zdGF0dXNDb2RlID8gcmVzLnN0YXR1c0NvZGUgOiAyMDA7XG4gICAgICAgICAgfVxuXG4gICAgICAgICAgaWYgKG5ld0hlYWRlcnMpIHtcbiAgICAgICAgICAgIE9iamVjdC5hc3NpZ24oaGVhZGVycywgbmV3SGVhZGVycyk7XG4gICAgICAgICAgfVxuXG4gICAgICAgICAgcmVzLndyaXRlSGVhZChzdGF0dXNDb2RlLCBoZWFkZXJzKTtcblxuICAgICAgICAgIHN0cmVhbS5waXBlKHJlcywge1xuICAgICAgICAgICAgLy8gRW5kIHRoZSByZXNwb25zZSB3aGVuIHRoZSBzdHJlYW0gZW5kcy5cbiAgICAgICAgICAgIGVuZDogdHJ1ZSxcbiAgICAgICAgICB9KTtcbiAgICAgICAgfSlcbiAgICAgICAgLmNhdGNoKGVycm9yID0+IHtcbiAgICAgICAgICBMb2cuZXJyb3IoJ0Vycm9yIHJ1bm5pbmcgdGVtcGxhdGU6ICcgKyBlcnJvci5zdGFjayk7XG4gICAgICAgICAgcmVzLndyaXRlSGVhZCg1MDAsIGhlYWRlcnMpO1xuICAgICAgICAgIHJlcy5lbmQoKTtcbiAgICAgICAgfSk7XG4gICAgfVxuICB9KTtcblxuICAvLyBSZXR1cm4gNDA0IGJ5IGRlZmF1bHQsIGlmIG5vIG90aGVyIGhhbmRsZXJzIHNlcnZlIHRoaXMgVVJMLlxuICBhcHAudXNlKGZ1bmN0aW9uKHJlcSwgcmVzKSB7XG4gICAgcmVzLndyaXRlSGVhZCg0MDQpO1xuICAgIHJlcy5lbmQoKTtcbiAgfSk7XG5cbiAgdmFyIGh0dHBTZXJ2ZXIgPSBjcmVhdGVTZXJ2ZXIoYXBwKTtcbiAgdmFyIG9uTGlzdGVuaW5nQ2FsbGJhY2tzID0gW107XG5cbiAgLy8gQWZ0ZXIgNSBzZWNvbmRzIHcvbyBkYXRhIG9uIGEgc29ja2V0LCBraWxsIGl0LiAgT24gdGhlIG90aGVyIGhhbmQsIGlmXG4gIC8vIHRoZXJlJ3MgYW4gb3V0c3RhbmRpbmcgcmVxdWVzdCwgZ2l2ZSBpdCBhIGhpZ2hlciB0aW1lb3V0IGluc3RlYWQgKHRvIGF2b2lkXG4gIC8vIGtpbGxpbmcgbG9uZy1wb2xsaW5nIHJlcXVlc3RzKVxuICBodHRwU2VydmVyLnNldFRpbWVvdXQoU0hPUlRfU09DS0VUX1RJTUVPVVQpO1xuXG4gIC8vIERvIHRoaXMgaGVyZSwgYW5kIHRoZW4gYWxzbyBpbiBsaXZlZGF0YS9zdHJlYW1fc2VydmVyLmpzLCBiZWNhdXNlXG4gIC8vIHN0cmVhbV9zZXJ2ZXIuanMga2lsbHMgYWxsIHRoZSBjdXJyZW50IHJlcXVlc3QgaGFuZGxlcnMgd2hlbiBpbnN0YWxsaW5nIGl0c1xuICAvLyBvd24uXG4gIGh0dHBTZXJ2ZXIub24oJ3JlcXVlc3QnLCBXZWJBcHAuX3RpbWVvdXRBZGp1c3RtZW50UmVxdWVzdENhbGxiYWNrKTtcblxuICAvLyBJZiB0aGUgY2xpZW50IGdhdmUgdXMgYSBiYWQgcmVxdWVzdCwgdGVsbCBpdCBpbnN0ZWFkIG9mIGp1c3QgY2xvc2luZyB0aGVcbiAgLy8gc29ja2V0LiBUaGlzIGxldHMgbG9hZCBiYWxhbmNlcnMgaW4gZnJvbnQgb2YgdXMgZGlmZmVyZW50aWF0ZSBiZXR3ZWVuIFwiYVxuICAvLyBzZXJ2ZXIgaXMgcmFuZG9tbHkgY2xvc2luZyBzb2NrZXRzIGZvciBubyByZWFzb25cIiBhbmQgXCJjbGllbnQgc2VudCBhIGJhZFxuICAvLyByZXF1ZXN0XCIuXG4gIC8vXG4gIC8vIFRoaXMgd2lsbCBvbmx5IHdvcmsgb24gTm9kZSA2OyBOb2RlIDQgZGVzdHJveXMgdGhlIHNvY2tldCBiZWZvcmUgY2FsbGluZ1xuICAvLyB0aGlzIGV2ZW50LiBTZWUgaHR0cHM6Ly9naXRodWIuY29tL25vZGVqcy9ub2RlL3B1bGwvNDU1Ny8gZm9yIGRldGFpbHMuXG4gIGh0dHBTZXJ2ZXIub24oJ2NsaWVudEVycm9yJywgKGVyciwgc29ja2V0KSA9PiB7XG4gICAgLy8gUHJlLU5vZGUtNiwgZG8gbm90aGluZy5cbiAgICBpZiAoc29ja2V0LmRlc3Ryb3llZCkge1xuICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIGlmIChlcnIubWVzc2FnZSA9PT0gJ1BhcnNlIEVycm9yJykge1xuICAgICAgc29ja2V0LmVuZCgnSFRUUC8xLjEgNDAwIEJhZCBSZXF1ZXN0XFxyXFxuXFxyXFxuJyk7XG4gICAgfSBlbHNlIHtcbiAgICAgIC8vIEZvciBvdGhlciBlcnJvcnMsIHVzZSB0aGUgZGVmYXVsdCBiZWhhdmlvciBhcyBpZiB3ZSBoYWQgbm8gY2xpZW50RXJyb3JcbiAgICAgIC8vIGhhbmRsZXIuXG4gICAgICBzb2NrZXQuZGVzdHJveShlcnIpO1xuICAgIH1cbiAgfSk7XG5cbiAgLy8gc3RhcnQgdXAgYXBwXG4gIF8uZXh0ZW5kKFdlYkFwcCwge1xuICAgIGNvbm5lY3RIYW5kbGVyczogcGFja2FnZUFuZEFwcEhhbmRsZXJzLFxuICAgIHJhd0Nvbm5lY3RIYW5kbGVyczogcmF3Q29ubmVjdEhhbmRsZXJzLFxuICAgIGh0dHBTZXJ2ZXI6IGh0dHBTZXJ2ZXIsXG4gICAgY29ubmVjdEFwcDogYXBwLFxuICAgIC8vIEZvciB0ZXN0aW5nLlxuICAgIHN1cHByZXNzQ29ubmVjdEVycm9yczogZnVuY3Rpb24oKSB7XG4gICAgICBzdXBwcmVzc0Nvbm5lY3RFcnJvcnMgPSB0cnVlO1xuICAgIH0sXG4gICAgb25MaXN0ZW5pbmc6IGZ1bmN0aW9uKGYpIHtcbiAgICAgIGlmIChvbkxpc3RlbmluZ0NhbGxiYWNrcykgb25MaXN0ZW5pbmdDYWxsYmFja3MucHVzaChmKTtcbiAgICAgIGVsc2UgZigpO1xuICAgIH0sXG4gICAgLy8gVGhpcyBjYW4gYmUgb3ZlcnJpZGRlbiBieSB1c2VycyB3aG8gd2FudCB0byBtb2RpZnkgaG93IGxpc3RlbmluZyB3b3Jrc1xuICAgIC8vIChlZywgdG8gcnVuIGEgcHJveHkgbGlrZSBBcG9sbG8gRW5naW5lIFByb3h5IGluIGZyb250IG9mIHRoZSBzZXJ2ZXIpLlxuICAgIHN0YXJ0TGlzdGVuaW5nOiBmdW5jdGlvbihodHRwU2VydmVyLCBsaXN0ZW5PcHRpb25zLCBjYikge1xuICAgICAgaHR0cFNlcnZlci5saXN0ZW4obGlzdGVuT3B0aW9ucywgY2IpO1xuICAgIH0sXG4gIH0pO1xuXG4gIC8vIExldCB0aGUgcmVzdCBvZiB0aGUgcGFja2FnZXMgKGFuZCBNZXRlb3Iuc3RhcnR1cCBob29rcykgaW5zZXJ0IGNvbm5lY3RcbiAgLy8gbWlkZGxld2FyZXMgYW5kIHVwZGF0ZSBfX21ldGVvcl9ydW50aW1lX2NvbmZpZ19fLCB0aGVuIGtlZXAgZ29pbmcgdG8gc2V0IHVwXG4gIC8vIGFjdHVhbGx5IHNlcnZpbmcgSFRNTC5cbiAgZXhwb3J0cy5tYWluID0gYXJndiA9PiB7XG4gICAgV2ViQXBwSW50ZXJuYWxzLmdlbmVyYXRlQm9pbGVycGxhdGUoKTtcblxuICAgIGNvbnN0IHN0YXJ0SHR0cFNlcnZlciA9IGxpc3Rlbk9wdGlvbnMgPT4ge1xuICAgICAgV2ViQXBwLnN0YXJ0TGlzdGVuaW5nKFxuICAgICAgICBodHRwU2VydmVyLFxuICAgICAgICBsaXN0ZW5PcHRpb25zLFxuICAgICAgICBNZXRlb3IuYmluZEVudmlyb25tZW50KFxuICAgICAgICAgICgpID0+IHtcbiAgICAgICAgICAgIGlmIChwcm9jZXNzLmVudi5NRVRFT1JfUFJJTlRfT05fTElTVEVOKSB7XG4gICAgICAgICAgICAgIGNvbnNvbGUubG9nKCdMSVNURU5JTkcnKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGNvbnN0IGNhbGxiYWNrcyA9IG9uTGlzdGVuaW5nQ2FsbGJhY2tzO1xuICAgICAgICAgICAgb25MaXN0ZW5pbmdDYWxsYmFja3MgPSBudWxsO1xuICAgICAgICAgICAgY2FsbGJhY2tzLmZvckVhY2goY2FsbGJhY2sgPT4ge1xuICAgICAgICAgICAgICBjYWxsYmFjaygpO1xuICAgICAgICAgICAgfSk7XG4gICAgICAgICAgfSxcbiAgICAgICAgICBlID0+IHtcbiAgICAgICAgICAgIGNvbnNvbGUuZXJyb3IoJ0Vycm9yIGxpc3RlbmluZzonLCBlKTtcbiAgICAgICAgICAgIGNvbnNvbGUuZXJyb3IoZSAmJiBlLnN0YWNrKTtcbiAgICAgICAgICB9XG4gICAgICAgIClcbiAgICAgICk7XG4gICAgfTtcblxuICAgIGxldCBsb2NhbFBvcnQgPSBwcm9jZXNzLmVudi5QT1JUIHx8IDA7XG4gICAgbGV0IHVuaXhTb2NrZXRQYXRoID0gcHJvY2Vzcy5lbnYuVU5JWF9TT0NLRVRfUEFUSDtcblxuICAgIGlmICh1bml4U29ja2V0UGF0aCkge1xuICAgICAgaWYgKGNsdXN0ZXIuaXNXb3JrZXIpIHtcbiAgICAgICAgY29uc3Qgd29ya2VyTmFtZSA9IGNsdXN0ZXIud29ya2VyLnByb2Nlc3MuZW52Lm5hbWUgfHwgY2x1c3Rlci53b3JrZXIuaWQ7XG4gICAgICAgIHVuaXhTb2NrZXRQYXRoICs9ICcuJyArIHdvcmtlck5hbWUgKyAnLnNvY2snO1xuICAgICAgfVxuICAgICAgLy8gU3RhcnQgdGhlIEhUVFAgc2VydmVyIHVzaW5nIGEgc29ja2V0IGZpbGUuXG4gICAgICByZW1vdmVFeGlzdGluZ1NvY2tldEZpbGUodW5peFNvY2tldFBhdGgpO1xuICAgICAgc3RhcnRIdHRwU2VydmVyKHsgcGF0aDogdW5peFNvY2tldFBhdGggfSk7XG5cbiAgICAgIGNvbnN0IHVuaXhTb2NrZXRQZXJtaXNzaW9ucyA9IChcbiAgICAgICAgcHJvY2Vzcy5lbnYuVU5JWF9TT0NLRVRfUEVSTUlTU0lPTlMgfHwgJydcbiAgICAgICkudHJpbSgpO1xuICAgICAgaWYgKHVuaXhTb2NrZXRQZXJtaXNzaW9ucykge1xuICAgICAgICBpZiAoL15bMC03XXszfSQvLnRlc3QodW5peFNvY2tldFBlcm1pc3Npb25zKSkge1xuICAgICAgICAgIGNobW9kU3luYyh1bml4U29ja2V0UGF0aCwgcGFyc2VJbnQodW5peFNvY2tldFBlcm1pc3Npb25zLCA4KSk7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgdGhyb3cgbmV3IEVycm9yKCdJbnZhbGlkIFVOSVhfU09DS0VUX1BFUk1JU1NJT05TIHNwZWNpZmllZCcpO1xuICAgICAgICB9XG4gICAgICB9XG5cbiAgICAgIGNvbnN0IHVuaXhTb2NrZXRHcm91cCA9IChwcm9jZXNzLmVudi5VTklYX1NPQ0tFVF9HUk9VUCB8fCAnJykudHJpbSgpO1xuICAgICAgaWYgKHVuaXhTb2NrZXRHcm91cCkge1xuICAgICAgICAvL3dob21zdCBhdXRvbWF0aWNhbGx5IGhhbmRsZXMgYm90aCBncm91cCBuYW1lcyBhbmQgbnVtZXJpY2FsIGdpZHNcbiAgICAgICAgY29uc3QgdW5peFNvY2tldEdyb3VwSW5mbyA9IHdob21zdC5zeW5jLmdyb3VwKHVuaXhTb2NrZXRHcm91cCk7XG4gICAgICAgIGlmICh1bml4U29ja2V0R3JvdXBJbmZvID09PSBudWxsKSB7XG4gICAgICAgICAgdGhyb3cgbmV3IEVycm9yKCdJbnZhbGlkIFVOSVhfU09DS0VUX0dST1VQIG5hbWUgc3BlY2lmaWVkJyk7XG4gICAgICAgIH1cbiAgICAgICAgY2hvd25TeW5jKHVuaXhTb2NrZXRQYXRoLCB1c2VySW5mbygpLnVpZCwgdW5peFNvY2tldEdyb3VwSW5mby5naWQpO1xuICAgICAgfVxuXG4gICAgICByZWdpc3RlclNvY2tldEZpbGVDbGVhbnVwKHVuaXhTb2NrZXRQYXRoKTtcbiAgICB9IGVsc2Uge1xuICAgICAgbG9jYWxQb3J0ID0gaXNOYU4oTnVtYmVyKGxvY2FsUG9ydCkpID8gbG9jYWxQb3J0IDogTnVtYmVyKGxvY2FsUG9ydCk7XG4gICAgICBpZiAoL1xcXFxcXFxcPy4rXFxcXHBpcGVcXFxcPy4rLy50ZXN0KGxvY2FsUG9ydCkpIHtcbiAgICAgICAgLy8gU3RhcnQgdGhlIEhUVFAgc2VydmVyIHVzaW5nIFdpbmRvd3MgU2VydmVyIHN0eWxlIG5hbWVkIHBpcGUuXG4gICAgICAgIHN0YXJ0SHR0cFNlcnZlcih7IHBhdGg6IGxvY2FsUG9ydCB9KTtcbiAgICAgIH0gZWxzZSBpZiAodHlwZW9mIGxvY2FsUG9ydCA9PT0gJ251bWJlcicpIHtcbiAgICAgICAgLy8gU3RhcnQgdGhlIEhUVFAgc2VydmVyIHVzaW5nIFRDUC5cbiAgICAgICAgc3RhcnRIdHRwU2VydmVyKHtcbiAgICAgICAgICBwb3J0OiBsb2NhbFBvcnQsXG4gICAgICAgICAgaG9zdDogcHJvY2Vzcy5lbnYuQklORF9JUCB8fCAnMC4wLjAuMCcsXG4gICAgICAgIH0pO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKCdJbnZhbGlkIFBPUlQgc3BlY2lmaWVkJyk7XG4gICAgICB9XG4gICAgfVxuXG4gICAgcmV0dXJuICdEQUVNT04nO1xuICB9O1xufVxuXG52YXIgaW5saW5lU2NyaXB0c0FsbG93ZWQgPSB0cnVlO1xuXG5XZWJBcHBJbnRlcm5hbHMuaW5saW5lU2NyaXB0c0FsbG93ZWQgPSBmdW5jdGlvbigpIHtcbiAgcmV0dXJuIGlubGluZVNjcmlwdHNBbGxvd2VkO1xufTtcblxuV2ViQXBwSW50ZXJuYWxzLnNldElubGluZVNjcmlwdHNBbGxvd2VkID0gZnVuY3Rpb24odmFsdWUpIHtcbiAgaW5saW5lU2NyaXB0c0FsbG93ZWQgPSB2YWx1ZTtcbiAgV2ViQXBwSW50ZXJuYWxzLmdlbmVyYXRlQm9pbGVycGxhdGUoKTtcbn07XG5cbnZhciBzcmlNb2RlO1xuXG5XZWJBcHBJbnRlcm5hbHMuZW5hYmxlU3VicmVzb3VyY2VJbnRlZ3JpdHkgPSBmdW5jdGlvbih1c2VfY3JlZGVudGlhbHMgPSBmYWxzZSkge1xuICBzcmlNb2RlID0gdXNlX2NyZWRlbnRpYWxzID8gJ3VzZS1jcmVkZW50aWFscycgOiAnYW5vbnltb3VzJztcbiAgV2ViQXBwSW50ZXJuYWxzLmdlbmVyYXRlQm9pbGVycGxhdGUoKTtcbn07XG5cbldlYkFwcEludGVybmFscy5zZXRCdW5kbGVkSnNDc3NVcmxSZXdyaXRlSG9vayA9IGZ1bmN0aW9uKGhvb2tGbikge1xuICBidW5kbGVkSnNDc3NVcmxSZXdyaXRlSG9vayA9IGhvb2tGbjtcbiAgV2ViQXBwSW50ZXJuYWxzLmdlbmVyYXRlQm9pbGVycGxhdGUoKTtcbn07XG5cbldlYkFwcEludGVybmFscy5zZXRCdW5kbGVkSnNDc3NQcmVmaXggPSBmdW5jdGlvbihwcmVmaXgpIHtcbiAgdmFyIHNlbGYgPSB0aGlzO1xuICBzZWxmLnNldEJ1bmRsZWRKc0Nzc1VybFJld3JpdGVIb29rKGZ1bmN0aW9uKHVybCkge1xuICAgIHJldHVybiBwcmVmaXggKyB1cmw7XG4gIH0pO1xufTtcblxuLy8gUGFja2FnZXMgY2FuIGNhbGwgYFdlYkFwcEludGVybmFscy5hZGRTdGF0aWNKc2AgdG8gc3BlY2lmeSBzdGF0aWNcbi8vIEphdmFTY3JpcHQgdG8gYmUgaW5jbHVkZWQgaW4gdGhlIGFwcC4gVGhpcyBzdGF0aWMgSlMgd2lsbCBiZSBpbmxpbmVkLFxuLy8gdW5sZXNzIGlubGluZSBzY3JpcHRzIGhhdmUgYmVlbiBkaXNhYmxlZCwgaW4gd2hpY2ggY2FzZSBpdCB3aWxsIGJlXG4vLyBzZXJ2ZWQgdW5kZXIgYC88c2hhMSBvZiBjb250ZW50cz5gLlxudmFyIGFkZGl0aW9uYWxTdGF0aWNKcyA9IHt9O1xuV2ViQXBwSW50ZXJuYWxzLmFkZFN0YXRpY0pzID0gZnVuY3Rpb24oY29udGVudHMpIHtcbiAgYWRkaXRpb25hbFN0YXRpY0pzWycvJyArIHNoYTEoY29udGVudHMpICsgJy5qcyddID0gY29udGVudHM7XG59O1xuXG4vLyBFeHBvcnRlZCBmb3IgdGVzdHNcbldlYkFwcEludGVybmFscy5nZXRCb2lsZXJwbGF0ZSA9IGdldEJvaWxlcnBsYXRlO1xuV2ViQXBwSW50ZXJuYWxzLmFkZGl0aW9uYWxTdGF0aWNKcyA9IGFkZGl0aW9uYWxTdGF0aWNKcztcblxuLy8gU3RhcnQgdGhlIHNlcnZlciFcbnJ1bldlYkFwcFNlcnZlcigpO1xuIiwiaW1wb3J0IG5wbUNvbm5lY3QgZnJvbSBcImNvbm5lY3RcIjtcblxuZXhwb3J0IGZ1bmN0aW9uIGNvbm5lY3QoLi4uY29ubmVjdEFyZ3MpIHtcbiAgY29uc3QgaGFuZGxlcnMgPSBucG1Db25uZWN0LmFwcGx5KHRoaXMsIGNvbm5lY3RBcmdzKTtcbiAgY29uc3Qgb3JpZ2luYWxVc2UgPSBoYW5kbGVycy51c2U7XG5cbiAgLy8gV3JhcCB0aGUgaGFuZGxlcnMudXNlIG1ldGhvZCBzbyB0aGF0IGFueSBwcm92aWRlZCBoYW5kbGVyIGZ1bmN0aW9uc1xuICAvLyBhbHdheXMgcnVuIGluIGEgRmliZXIuXG4gIGhhbmRsZXJzLnVzZSA9IGZ1bmN0aW9uIHVzZSguLi51c2VBcmdzKSB7XG4gICAgY29uc3QgeyBzdGFjayB9ID0gdGhpcztcbiAgICBjb25zdCBvcmlnaW5hbExlbmd0aCA9IHN0YWNrLmxlbmd0aDtcbiAgICBjb25zdCByZXN1bHQgPSBvcmlnaW5hbFVzZS5hcHBseSh0aGlzLCB1c2VBcmdzKTtcblxuICAgIC8vIElmIHdlIGp1c3QgYWRkZWQgYW55dGhpbmcgdG8gdGhlIHN0YWNrLCB3cmFwIGVhY2ggbmV3IGVudHJ5LmhhbmRsZVxuICAgIC8vIHdpdGggYSBmdW5jdGlvbiB0aGF0IGNhbGxzIFByb21pc2UuYXN5bmNBcHBseSB0byBlbnN1cmUgdGhlXG4gICAgLy8gb3JpZ2luYWwgaGFuZGxlciBydW5zIGluIGEgRmliZXIuXG4gICAgZm9yIChsZXQgaSA9IG9yaWdpbmFsTGVuZ3RoOyBpIDwgc3RhY2subGVuZ3RoOyArK2kpIHtcbiAgICAgIGNvbnN0IGVudHJ5ID0gc3RhY2tbaV07XG4gICAgICBjb25zdCBvcmlnaW5hbEhhbmRsZSA9IGVudHJ5LmhhbmRsZTtcblxuICAgICAgaWYgKG9yaWdpbmFsSGFuZGxlLmxlbmd0aCA+PSA0KSB7XG4gICAgICAgIC8vIElmIHRoZSBvcmlnaW5hbCBoYW5kbGUgaGFkIGZvdXIgKG9yIG1vcmUpIHBhcmFtZXRlcnMsIHRoZVxuICAgICAgICAvLyB3cmFwcGVyIG11c3QgYWxzbyBoYXZlIGZvdXIgcGFyYW1ldGVycywgc2luY2UgY29ubmVjdCB1c2VzXG4gICAgICAgIC8vIGhhbmRsZS5sZW5ndGggdG8gZGV0ZXJtaW5lIHdoZXRoZXIgdG8gcGFzcyB0aGUgZXJyb3IgYXMgdGhlIGZpcnN0XG4gICAgICAgIC8vIGFyZ3VtZW50IHRvIHRoZSBoYW5kbGUgZnVuY3Rpb24uXG4gICAgICAgIGVudHJ5LmhhbmRsZSA9IGZ1bmN0aW9uIGhhbmRsZShlcnIsIHJlcSwgcmVzLCBuZXh0KSB7XG4gICAgICAgICAgcmV0dXJuIFByb21pc2UuYXN5bmNBcHBseShvcmlnaW5hbEhhbmRsZSwgdGhpcywgYXJndW1lbnRzKTtcbiAgICAgICAgfTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIGVudHJ5LmhhbmRsZSA9IGZ1bmN0aW9uIGhhbmRsZShyZXEsIHJlcywgbmV4dCkge1xuICAgICAgICAgIHJldHVybiBQcm9taXNlLmFzeW5jQXBwbHkob3JpZ2luYWxIYW5kbGUsIHRoaXMsIGFyZ3VtZW50cyk7XG4gICAgICAgIH07XG4gICAgICB9XG4gICAgfVxuXG4gICAgcmV0dXJuIHJlc3VsdDtcbiAgfTtcblxuICByZXR1cm4gaGFuZGxlcnM7XG59XG4iLCJpbXBvcnQgeyBzdGF0U3luYywgdW5saW5rU3luYywgZXhpc3RzU3luYyB9IGZyb20gJ2ZzJztcblxuLy8gU2luY2UgYSBuZXcgc29ja2V0IGZpbGUgd2lsbCBiZSBjcmVhdGVkIHdoZW4gdGhlIEhUVFAgc2VydmVyXG4vLyBzdGFydHMgdXAsIGlmIGZvdW5kIHJlbW92ZSB0aGUgZXhpc3RpbmcgZmlsZS5cbi8vXG4vLyBXQVJOSU5HOlxuLy8gVGhpcyB3aWxsIHJlbW92ZSB0aGUgY29uZmlndXJlZCBzb2NrZXQgZmlsZSB3aXRob3V0IHdhcm5pbmcuIElmXG4vLyB0aGUgY29uZmlndXJlZCBzb2NrZXQgZmlsZSBpcyBhbHJlYWR5IGluIHVzZSBieSBhbm90aGVyIGFwcGxpY2F0aW9uLFxuLy8gaXQgd2lsbCBzdGlsbCBiZSByZW1vdmVkLiBOb2RlIGRvZXMgbm90IHByb3ZpZGUgYSByZWxpYWJsZSB3YXkgdG9cbi8vIGRpZmZlcmVudGlhdGUgYmV0d2VlbiBhIHNvY2tldCBmaWxlIHRoYXQgaXMgYWxyZWFkeSBpbiB1c2UgYnlcbi8vIGFub3RoZXIgYXBwbGljYXRpb24gb3IgYSBzdGFsZSBzb2NrZXQgZmlsZSB0aGF0IGhhcyBiZWVuXG4vLyBsZWZ0IG92ZXIgYWZ0ZXIgYSBTSUdLSUxMLiBTaW5jZSB3ZSBoYXZlIG5vIHJlbGlhYmxlIHdheSB0b1xuLy8gZGlmZmVyZW50aWF0ZSBiZXR3ZWVuIHRoZXNlIHR3byBzY2VuYXJpb3MsIHRoZSBiZXN0IGNvdXJzZSBvZlxuLy8gYWN0aW9uIGR1cmluZyBzdGFydHVwIGlzIHRvIHJlbW92ZSBhbnkgZXhpc3Rpbmcgc29ja2V0IGZpbGUuIFRoaXNcbi8vIGlzIG5vdCB0aGUgc2FmZXN0IGNvdXJzZSBvZiBhY3Rpb24gYXMgcmVtb3ZpbmcgdGhlIGV4aXN0aW5nIHNvY2tldFxuLy8gZmlsZSBjb3VsZCBpbXBhY3QgYW4gYXBwbGljYXRpb24gdXNpbmcgaXQsIGJ1dCB0aGlzIGFwcHJvYWNoIGhlbHBzXG4vLyBlbnN1cmUgdGhlIEhUVFAgc2VydmVyIGNhbiBzdGFydHVwIHdpdGhvdXQgbWFudWFsXG4vLyBpbnRlcnZlbnRpb24gKGUuZy4gYXNraW5nIGZvciB0aGUgdmVyaWZpY2F0aW9uIGFuZCBjbGVhbnVwIG9mIHNvY2tldFxuLy8gZmlsZXMgYmVmb3JlIGFsbG93aW5nIHRoZSBIVFRQIHNlcnZlciB0byBiZSBzdGFydGVkKS5cbi8vXG4vLyBUaGUgYWJvdmUgYmVpbmcgc2FpZCwgYXMgbG9uZyBhcyB0aGUgc29ja2V0IGZpbGUgcGF0aCBpc1xuLy8gY29uZmlndXJlZCBjYXJlZnVsbHkgd2hlbiB0aGUgYXBwbGljYXRpb24gaXMgZGVwbG95ZWQgKGFuZCBleHRyYVxuLy8gY2FyZSBpcyB0YWtlbiB0byBtYWtlIHN1cmUgdGhlIGNvbmZpZ3VyZWQgcGF0aCBpcyB1bmlxdWUgYW5kIGRvZXNuJ3Rcbi8vIGNvbmZsaWN0IHdpdGggYW5vdGhlciBzb2NrZXQgZmlsZSBwYXRoKSwgdGhlbiB0aGVyZSBzaG91bGQgbm90IGJlXG4vLyBhbnkgaXNzdWVzIHdpdGggdGhpcyBhcHByb2FjaC5cbmV4cG9ydCBjb25zdCByZW1vdmVFeGlzdGluZ1NvY2tldEZpbGUgPSAoc29ja2V0UGF0aCkgPT4ge1xuICB0cnkge1xuICAgIGlmIChzdGF0U3luYyhzb2NrZXRQYXRoKS5pc1NvY2tldCgpKSB7XG4gICAgICAvLyBTaW5jZSBhIG5ldyBzb2NrZXQgZmlsZSB3aWxsIGJlIGNyZWF0ZWQsIHJlbW92ZSB0aGUgZXhpc3RpbmdcbiAgICAgIC8vIGZpbGUuXG4gICAgICB1bmxpbmtTeW5jKHNvY2tldFBhdGgpO1xuICAgIH0gZWxzZSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXG4gICAgICAgIGBBbiBleGlzdGluZyBmaWxlIHdhcyBmb3VuZCBhdCBcIiR7c29ja2V0UGF0aH1cIiBhbmQgaXQgaXMgbm90IGAgK1xuICAgICAgICAnYSBzb2NrZXQgZmlsZS4gUGxlYXNlIGNvbmZpcm0gUE9SVCBpcyBwb2ludGluZyB0byB2YWxpZCBhbmQgJyArXG4gICAgICAgICd1bi11c2VkIHNvY2tldCBmaWxlIHBhdGguJ1xuICAgICAgKTtcbiAgICB9XG4gIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgLy8gSWYgdGhlcmUgaXMgbm8gZXhpc3Rpbmcgc29ja2V0IGZpbGUgdG8gY2xlYW51cCwgZ3JlYXQsIHdlJ2xsXG4gICAgLy8gY29udGludWUgbm9ybWFsbHkuIElmIHRoZSBjYXVnaHQgZXhjZXB0aW9uIHJlcHJlc2VudHMgYW55IG90aGVyXG4gICAgLy8gaXNzdWUsIHJlLXRocm93LlxuICAgIGlmIChlcnJvci5jb2RlICE9PSAnRU5PRU5UJykge1xuICAgICAgdGhyb3cgZXJyb3I7XG4gICAgfVxuICB9XG59O1xuXG4vLyBSZW1vdmUgdGhlIHNvY2tldCBmaWxlIHdoZW4gZG9uZSB0byBhdm9pZCBsZWF2aW5nIGJlaGluZCBhIHN0YWxlIG9uZS5cbi8vIE5vdGUgLSBhIHN0YWxlIHNvY2tldCBmaWxlIGlzIHN0aWxsIGxlZnQgYmVoaW5kIGlmIHRoZSBydW5uaW5nIG5vZGVcbi8vIHByb2Nlc3MgaXMga2lsbGVkIHZpYSBzaWduYWwgOSAtIFNJR0tJTEwuXG5leHBvcnQgY29uc3QgcmVnaXN0ZXJTb2NrZXRGaWxlQ2xlYW51cCA9XG4gIChzb2NrZXRQYXRoLCBldmVudEVtaXR0ZXIgPSBwcm9jZXNzKSA9PiB7XG4gICAgWydleGl0JywgJ1NJR0lOVCcsICdTSUdIVVAnLCAnU0lHVEVSTSddLmZvckVhY2goc2lnbmFsID0+IHtcbiAgICAgIGV2ZW50RW1pdHRlci5vbihzaWduYWwsIE1ldGVvci5iaW5kRW52aXJvbm1lbnQoKCkgPT4ge1xuICAgICAgICBpZiAoZXhpc3RzU3luYyhzb2NrZXRQYXRoKSkge1xuICAgICAgICAgIHVubGlua1N5bmMoc29ja2V0UGF0aCk7XG4gICAgICAgIH1cbiAgICAgIH0pKTtcbiAgICB9KTtcbiAgfTtcbiJdfQ==
