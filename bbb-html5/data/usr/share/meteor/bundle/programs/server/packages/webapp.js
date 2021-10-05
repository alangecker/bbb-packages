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
  }

  ; // #BrowserIdentification
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
    if (req.browser && req.arch && typeof req.modern === "boolean") {
      // Already categorized.
      return req;
    }

    const browser = identifyBrowser(req.headers["user-agent"]);
    const modern = isModern(browser);
    const path = typeof req.pathname === "string" ? req.pathname : parseRequest(req).pathname;
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
    const pathParts = path.split("/");
    const archKey = pathParts[1];

    if (archKey.startsWith("__")) {
      const archCleaned = "web." + archKey.slice(2);

      if (hasOwn.call(WebApp.clientPrograms, archCleaned)) {
        pathParts.splice(1, 1); // Remove the archKey part.

        return Object.assign(categorized, {
          arch: archCleaned,
          path: pathParts.join("/")
        });
      }
    } // TODO Perhaps one day we could infer Cordova clients here, so that we
    // wouldn't have to use prefixed "/__cordova/..." URLs.


    const preferredArchOrder = isModern(browser) ? ["web.browser", "web.browser.legacy"] : ["web.browser.legacy", "web.browser"];

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
      if (typeof attributes !== 'object') throw Error("HTML attribute hook must return null or object");

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

        return typeof value === "function" ? program[key] = value() : value;
      };
    }

    WebApp.calculateClientHash = WebApp.clientHash = getter("version");
    WebApp.calculateClientHashRefreshable = getter("versionRefreshable");
    WebApp.calculateClientHashNonRefreshable = getter("versionNonRefreshable");
    WebApp.calculateClientHashReplaceable = getter("versionReplaceable");
    WebApp.getRefreshableAssets = getter("refreshableAssets");
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

    if (typeof callback === "function") {
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

  function getBoilerplateAsync(request, arch) {
    const boilerplate = boilerplateByArch[arch];
    const data = Object.assign({}, boilerplate.baseData, {
      htmlAttributes: getHtmlAttributes(request)
    }, _.pick(request, "dynamicHead", "dynamicBody"));
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

  WebAppInternals.generateBoilerplateInstance = function (arch, manifest, additionalOptions) {
    additionalOptions = additionalOptions || {};
    const meteorRuntimeConfig = JSON.stringify(encodeURIComponent(JSON.stringify(_objectSpread(_objectSpread({}, __meteor_runtime_config__), additionalOptions.runtimeConfigOverrides || {}))));
    return new Boilerplate(arch, manifest, _.extend({
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
      var pathname = parseRequest(req).pathname;

      try {
        pathname = decodeURIComponent(pathname);
      } catch (e) {
        next();
        return;
      }

      var serveStaticJs = function (s) {
        if (req.method === 'GET' || req.method === 'HEAD') {
          res.writeHead(200, {
            'Content-type': 'application/javascript; charset=UTF-8',
            'Content-Length': Buffer.byteLength(s)
          });
          res.write(s);
          res.end();
        } else {
          const status = req.method === 'OPTIONS' ? 200 : 405;
          res.writeHead(status, {
            'Allow': 'OPTIONS, GET, HEAD',
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

      if (path === "/meteor_runtime_config.js" && !WebAppInternals.inlineScriptsAllowed()) {
        serveStaticJs("__meteor_runtime_config__ = ".concat(program.meteorRuntimeConfig, ";"));
        return;
      }

      const info = getStaticFileInfo(staticFilesByArch, pathname, path, arch);

      if (!info) {
        next();
        return;
      } // "send" will handle HEAD & GET requests


      if (req.method !== 'HEAD' && req.method !== 'GET') {
        const status = req.method === 'OPTIONS' ? 200 : 405;
        res.writeHead(status, {
          'Allow': 'OPTIONS, GET, HEAD',
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
        res.setHeader("Vary", "User-Agent");
      } // Set the X-SourceMap header, which current Chrome, FireFox, and Safari
      // understand.  (The SourceMap header is slightly more spec-correct but FF
      // doesn't understand it.)
      //
      // You may also need to enable source maps in Chrome: open dev tools, click
      // the gear in the bottom right corner, and select "enable source maps".


      if (info.sourceMapUrl) {
        res.setHeader('X-SourceMap', __meteor_runtime_config__.ROOT_URL_PATH_PREFIX + info.sourceMapUrl);
      }

      if (info.type === "js" || info.type === "dynamic js") {
        res.setHeader("Content-Type", "application/javascript; charset=UTF-8");
      } else if (info.type === "css") {
        res.setHeader("Content-Type", "text/css; charset=UTF-8");
      } else if (info.type === "json") {
        res.setHeader("Content-Type", "application/json; charset=UTF-8");
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
          Log.error("Error serving static file " + err);
          res.writeHead(500);
          res.end();
        }).on('directory', function () {
          Log.error("Unexpected directory " + info.absolutePath);
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

        if (typeof info === "function") {
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

  onMessage("webapp-pause-client", _ref => Promise.asyncApply(() => {
    let {
      arch
    } = _ref;
    WebAppInternals.pauseClient(arch);
  }));
  onMessage("webapp-reload-client", _ref2 => Promise.asyncApply(() => {
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
          Log.error("Error reloading the client program: " + e.stack);
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
          if (typeof unpause === "function") {
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

      const programJsonPath = pathJoin(clientDir, "program.json");
      let programJson;

      try {
        programJson = JSON.parse(readFileSync(programJsonPath));
      } catch (e) {
        if (e.code === "ENOENT") return;
        throw e;
      }

      if (programJson.format !== "web-program-pre1") {
        throw new Error("Unsupported format for client assets: " + JSON.stringify(programJson.format));
      }

      if (!programJsonPath || !clientDir || !programJson) {
        throw new Error("Client config file not parsed.");
      }

      archPath[arch] = clientDir;
      const staticFiles = staticFilesByArch[arch] = Object.create(null);
      const {
        manifest
      } = programJson;
      manifest.forEach(item => {
        if (item.url && item.where === "client") {
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
        format: "web-program-pre1",
        manifest: manifest,
        // Use arrow functions so that these versions can be lazily
        // calculated later, and so that they will not be included in the
        // staticFiles[manifestUrl].content string below.
        //
        // Note: these version calculations must be kept in agreement with
        // CordovaBuilder#appendVersion in tools/cordova/builder.js, or hot
        // code push will reload Cordova apps unnecessarily.
        version: () => WebAppHashing.calculateClientHash(manifest, null, configOverrides),
        versionRefreshable: () => WebAppHashing.calculateClientHash(manifest, type => type === "css", configOverrides),
        versionNonRefreshable: () => WebAppHashing.calculateClientHash(manifest, (type, replaceable) => type !== "css" && !replaceable, configOverrides),
        versionReplaceable: () => WebAppHashing.calculateClientHash(manifest, (_type, replaceable) => {
          if (Meteor.isProduction && replaceable) {
            throw new Error('Unexpected replaceable file in production');
          }

          return replaceable;
        }, configOverrides),
        cordovaCompatibilityVersions: programJson.cordovaCompatibilityVersions,
        PUBLIC_SETTINGS
      }; // Expose program details as a string reachable via the following URL.

      const manifestUrlPrefix = "/__" + arch.replace(/^web\./, "");
      const manifestUrl = manifestUrlPrefix + getItemPathname("/manifest.json");

      staticFiles[manifestUrl] = () => {
        if (Package.autoupdate) {
          const {
            AUTOUPDATE_VERSION = Package.autoupdate.Autoupdate.autoupdateVersion
          } = process.env;

          if (AUTOUPDATE_VERSION) {
            newProgram.version = AUTOUPDATE_VERSION;
          }
        }

        if (typeof newProgram.version === "function") {
          newProgram.version = newProgram.version();
        }

        return {
          content: JSON.stringify(newProgram),
          cacheable: false,
          hash: newProgram.version,
          type: "json"
        };
      };

      generateBoilerplateForArch(arch); // If there are any requests waiting on oldProgram.paused, let them
      // continue now (using the new program).

      if (oldProgram && oldProgram.paused) {
        oldProgram.unpause();
      }
    }

    ;
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
      "web.browser": {
        runtimeConfigOverrides: {
          isModern: true
        }
      },
      "web.browser.legacy": {
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
      res.write("Not a proxy");
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
      const parts = path.split("/");

      while (parts[0] === "") parts.shift();

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
          request.url = "/" + pathParts.slice(prefixParts.length).join("/");

          if (search) {
            request.url += search;
          }

          return next();
        }
      }

      if (pathname === "/favicon.ico" || pathname === "/robots.txt") {
        return next();
      }

      if (pathPrefix) {
        response.writeHead(404);
        response.write("Unknown path");
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

    app.use(WebAppInternals.meteorInternalHandlers = connect()); // Packages and apps can add handlers to this via WebApp.connectHandlers.
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
      res.end("An error message");
    });
    app.use(function (req, res, next) {
      return Promise.asyncApply(() => {
        if (!appUrl(req.url)) {
          return next();
        } else if (req.method !== 'HEAD' && req.method !== 'GET') {
          const status = req.method === 'OPTIONS' ? 200 : 405;
          res.writeHead(status, {
            'Allow': 'OPTIONS, GET, HEAD',
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
            res.write(".meteor-css-not-found-error { width: 0px;}");
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
            res.end("404 Not Found");
            return;
          }

          if (request.url.query && request.url.query['meteor_dont_serve_index']) {
            // When downloading files during a Cordova hot code push, we need
            // to detect if a file is not available instead of inadvertently
            // downloading the default index page.
            // So similar to the situation above, we serve an uncached 404.
            headers['Cache-Control'] = 'no-cache';
            res.writeHead(404, headers);
            res.end("404 Not Found");
            return;
          }

          const {
            arch
          } = request;
          assert.strictEqual(typeof arch, "string", {
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
              res.end("404 Not Found");
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
            Log.error("Error running template: " + error.stack);
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
            console.log("LISTENING");
          }

          const callbacks = onListeningCallbacks;
          onListeningCallbacks = null;
          callbacks.forEach(callback => {
            callback();
          });
        }, e => {
          console.error("Error listening:", e);
          console.error(e && e.stack);
        }));
      };

      let localPort = process.env.PORT || 0;
      let unixSocketPath = process.env.UNIX_SOCKET_PATH;

      if (unixSocketPath) {
        if (cluster.isWorker) {
          const workerName = cluster.worker.process.env.name || cluster.worker.id;
          unixSocketPath += "." + workerName + ".sock";
        } // Start the HTTP server using a socket file.


        removeExistingSocketFile(unixSocketPath);
        startHttpServer({
          path: unixSocketPath
        });
        const unixSocketPermissions = (process.env.UNIX_SOCKET_PERMISSIONS || "").trim();

        if (unixSocketPermissions) {
          if (/^[0-7]{3}$/.test(unixSocketPermissions)) {
            chmodSync(unixSocketPath, parseInt(unixSocketPermissions, 8));
          } else {
            throw new Error("Invalid UNIX_SOCKET_PERMISSIONS specified");
          }
        }

        const unixSocketGroup = (process.env.UNIX_SOCKET_GROUP || "").trim();

        if (unixSocketGroup) {
          //whomst automatically handles both group names and numerical gids
          const unixSocketGroupInfo = whomst.sync.group(unixSocketGroup);

          if (unixSocketGroupInfo === null) {
            throw new Error("Invalid UNIX_SOCKET_GROUP name specified");
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
        } else if (typeof localPort === "number") {
          // Start the HTTP server using TCP.
          startHttpServer({
            port: localPort,
            host: process.env.BIND_IP || "0.0.0.0"
          });
        } else {
          throw new Error("Invalid PORT specified");
        }
      }

      return "DAEMON";
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
    additionalStaticJs["/" + sha1(contents) + ".js"] = contents;
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
  "version": "3.6.5"
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
  "version": "1.7.1"
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
  "version": "1.4.3"
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
  "version": "6.4.0",
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
  "version": "1.3.2"
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
  "version": "0.16.1"
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
  "version": "0.1.6",
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
//# sourceMappingURL=data:application/json;charset=utf8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIm1ldGVvcjovL/CfkrthcHAvcGFja2FnZXMvd2ViYXBwL3dlYmFwcF9zZXJ2ZXIuanMiLCJtZXRlb3I6Ly/wn5K7YXBwL3BhY2thZ2VzL3dlYmFwcC9jb25uZWN0LmpzIiwibWV0ZW9yOi8v8J+Su2FwcC9wYWNrYWdlcy93ZWJhcHAvc29ja2V0X2ZpbGUuanMiXSwibmFtZXMiOlsiX29iamVjdFNwcmVhZCIsIm1vZHVsZTEiLCJsaW5rIiwiZGVmYXVsdCIsInYiLCJleHBvcnQiLCJXZWJBcHAiLCJXZWJBcHBJbnRlcm5hbHMiLCJhc3NlcnQiLCJyZWFkRmlsZVN5bmMiLCJjaG1vZFN5bmMiLCJjaG93blN5bmMiLCJjcmVhdGVTZXJ2ZXIiLCJ1c2VySW5mbyIsInBhdGhKb2luIiwicGF0aERpcm5hbWUiLCJqb2luIiwiZGlybmFtZSIsInBhcnNlVXJsIiwicGFyc2UiLCJjcmVhdGVIYXNoIiwiY29ubmVjdCIsImNvbXByZXNzIiwiY29va2llUGFyc2VyIiwicXMiLCJwYXJzZVJlcXVlc3QiLCJiYXNpY0F1dGgiLCJsb29rdXBVc2VyQWdlbnQiLCJsb29rdXAiLCJpc01vZGVybiIsInNlbmQiLCJyZW1vdmVFeGlzdGluZ1NvY2tldEZpbGUiLCJyZWdpc3RlclNvY2tldEZpbGVDbGVhbnVwIiwiY2x1c3RlciIsIndob21zdCIsIm9uTWVzc2FnZSIsIlNIT1JUX1NPQ0tFVF9USU1FT1VUIiwiTE9OR19TT0NLRVRfVElNRU9VVCIsImhhc093biIsIk9iamVjdCIsInByb3RvdHlwZSIsImhhc093blByb3BlcnR5IiwiTnBtTW9kdWxlcyIsInZlcnNpb24iLCJOcG0iLCJyZXF1aXJlIiwibW9kdWxlIiwiZGVmYXVsdEFyY2giLCJjbGllbnRQcm9ncmFtcyIsImFyY2hQYXRoIiwiYnVuZGxlZEpzQ3NzVXJsUmV3cml0ZUhvb2siLCJ1cmwiLCJidW5kbGVkUHJlZml4IiwiX19tZXRlb3JfcnVudGltZV9jb25maWdfXyIsIlJPT1RfVVJMX1BBVEhfUFJFRklYIiwic2hhMSIsImNvbnRlbnRzIiwiaGFzaCIsInVwZGF0ZSIsImRpZ2VzdCIsInNob3VsZENvbXByZXNzIiwicmVxIiwicmVzIiwiaGVhZGVycyIsImZpbHRlciIsImNhbWVsQ2FzZSIsIm5hbWUiLCJwYXJ0cyIsInNwbGl0IiwidG9Mb3dlckNhc2UiLCJpIiwibGVuZ3RoIiwiY2hhckF0IiwidG9VcHBlckNhc2UiLCJzdWJzdHIiLCJpZGVudGlmeUJyb3dzZXIiLCJ1c2VyQWdlbnRTdHJpbmciLCJ1c2VyQWdlbnQiLCJmYW1pbHkiLCJtYWpvciIsIm1pbm9yIiwicGF0Y2giLCJjYXRlZ29yaXplUmVxdWVzdCIsImJyb3dzZXIiLCJhcmNoIiwibW9kZXJuIiwicGF0aCIsInBhdGhuYW1lIiwiY2F0ZWdvcml6ZWQiLCJkeW5hbWljSGVhZCIsImR5bmFtaWNCb2R5IiwiY29va2llcyIsInBhdGhQYXJ0cyIsImFyY2hLZXkiLCJzdGFydHNXaXRoIiwiYXJjaENsZWFuZWQiLCJzbGljZSIsImNhbGwiLCJzcGxpY2UiLCJhc3NpZ24iLCJwcmVmZXJyZWRBcmNoT3JkZXIiLCJodG1sQXR0cmlidXRlSG9va3MiLCJnZXRIdG1sQXR0cmlidXRlcyIsInJlcXVlc3QiLCJjb21iaW5lZEF0dHJpYnV0ZXMiLCJfIiwiZWFjaCIsImhvb2siLCJhdHRyaWJ1dGVzIiwiRXJyb3IiLCJleHRlbmQiLCJhZGRIdG1sQXR0cmlidXRlSG9vayIsInB1c2giLCJhcHBVcmwiLCJSb3V0ZVBvbGljeSIsImNsYXNzaWZ5IiwiTWV0ZW9yIiwic3RhcnR1cCIsImdldHRlciIsImtleSIsInByb2dyYW0iLCJ2YWx1ZSIsImNhbGN1bGF0ZUNsaWVudEhhc2giLCJjbGllbnRIYXNoIiwiY2FsY3VsYXRlQ2xpZW50SGFzaFJlZnJlc2hhYmxlIiwiY2FsY3VsYXRlQ2xpZW50SGFzaE5vblJlZnJlc2hhYmxlIiwiY2FsY3VsYXRlQ2xpZW50SGFzaFJlcGxhY2VhYmxlIiwiZ2V0UmVmcmVzaGFibGVBc3NldHMiLCJfdGltZW91dEFkanVzdG1lbnRSZXF1ZXN0Q2FsbGJhY2siLCJzZXRUaW1lb3V0IiwiZmluaXNoTGlzdGVuZXJzIiwibGlzdGVuZXJzIiwicmVtb3ZlQWxsTGlzdGVuZXJzIiwib24iLCJsIiwiYm9pbGVycGxhdGVCeUFyY2giLCJib2lsZXJwbGF0ZURhdGFDYWxsYmFja3MiLCJjcmVhdGUiLCJyZWdpc3RlckJvaWxlcnBsYXRlRGF0YUNhbGxiYWNrIiwiY2FsbGJhY2siLCJwcmV2aW91c0NhbGxiYWNrIiwic3RyaWN0RXF1YWwiLCJnZXRCb2lsZXJwbGF0ZSIsImdldEJvaWxlcnBsYXRlQXN5bmMiLCJhd2FpdCIsImJvaWxlcnBsYXRlIiwiZGF0YSIsImJhc2VEYXRhIiwiaHRtbEF0dHJpYnV0ZXMiLCJwaWNrIiwibWFkZUNoYW5nZXMiLCJwcm9taXNlIiwiUHJvbWlzZSIsInJlc29sdmUiLCJrZXlzIiwiZm9yRWFjaCIsInRoZW4iLCJyZXN1bHQiLCJzdHJlYW0iLCJ0b0hUTUxTdHJlYW0iLCJzdGF0dXNDb2RlIiwiZ2VuZXJhdGVCb2lsZXJwbGF0ZUluc3RhbmNlIiwibWFuaWZlc3QiLCJhZGRpdGlvbmFsT3B0aW9ucyIsIm1ldGVvclJ1bnRpbWVDb25maWciLCJKU09OIiwic3RyaW5naWZ5IiwiZW5jb2RlVVJJQ29tcG9uZW50IiwicnVudGltZUNvbmZpZ092ZXJyaWRlcyIsIkJvaWxlcnBsYXRlIiwicGF0aE1hcHBlciIsIml0ZW1QYXRoIiwiYmFzZURhdGFFeHRlbnNpb24iLCJhZGRpdGlvbmFsU3RhdGljSnMiLCJtYXAiLCJtZXRlb3JSdW50aW1lSGFzaCIsInJvb3RVcmxQYXRoUHJlZml4Iiwic3JpTW9kZSIsImlubGluZVNjcmlwdHNBbGxvd2VkIiwiaW5saW5lIiwic3RhdGljRmlsZXNNaWRkbGV3YXJlIiwic3RhdGljRmlsZXNCeUFyY2giLCJuZXh0IiwiZGVjb2RlVVJJQ29tcG9uZW50IiwiZSIsInNlcnZlU3RhdGljSnMiLCJzIiwibWV0aG9kIiwid3JpdGVIZWFkIiwiQnVmZmVyIiwiYnl0ZUxlbmd0aCIsIndyaXRlIiwiZW5kIiwic3RhdHVzIiwiaGFzIiwicGF1c2VkIiwiaW5mbyIsImdldFN0YXRpY0ZpbGVJbmZvIiwibWF4QWdlIiwiY2FjaGVhYmxlIiwic2V0SGVhZGVyIiwic291cmNlTWFwVXJsIiwidHlwZSIsImNvbnRlbnQiLCJhYnNvbHV0ZVBhdGgiLCJtYXhhZ2UiLCJkb3RmaWxlcyIsImxhc3RNb2RpZmllZCIsImVyciIsIkxvZyIsImVycm9yIiwicGlwZSIsIm9yaWdpbmFsUGF0aCIsInN0YXRpY0FyY2hMaXN0IiwiYXJjaEluZGV4IiwiaW5kZXhPZiIsInVuc2hpZnQiLCJzb21lIiwic3RhdGljRmlsZXMiLCJmaW5hbGl6ZSIsInBhcnNlUG9ydCIsInBvcnQiLCJwYXJzZWRQb3J0IiwicGFyc2VJbnQiLCJOdW1iZXIiLCJpc05hTiIsInBhdXNlQ2xpZW50IiwiZ2VuZXJhdGVDbGllbnRQcm9ncmFtIiwicnVuV2ViQXBwU2VydmVyIiwic2h1dHRpbmdEb3duIiwic3luY1F1ZXVlIiwiX1N5bmNocm9ub3VzUXVldWUiLCJnZXRJdGVtUGF0aG5hbWUiLCJpdGVtVXJsIiwicmVsb2FkQ2xpZW50UHJvZ3JhbXMiLCJydW5UYXNrIiwiY29uZmlnSnNvbiIsIl9fbWV0ZW9yX2Jvb3RzdHJhcF9fIiwiY2xpZW50QXJjaHMiLCJjbGllbnRQYXRocyIsInN0YWNrIiwicHJvY2VzcyIsImV4aXQiLCJ1bnBhdXNlIiwiY2xpZW50RGlyIiwic2VydmVyRGlyIiwicHJvZ3JhbUpzb25QYXRoIiwicHJvZ3JhbUpzb24iLCJjb2RlIiwiZm9ybWF0IiwiaXRlbSIsIndoZXJlIiwic291cmNlTWFwIiwiUFVCTElDX1NFVFRJTkdTIiwiY29uZmlnT3ZlcnJpZGVzIiwib2xkUHJvZ3JhbSIsIm5ld1Byb2dyYW0iLCJXZWJBcHBIYXNoaW5nIiwidmVyc2lvblJlZnJlc2hhYmxlIiwidmVyc2lvbk5vblJlZnJlc2hhYmxlIiwicmVwbGFjZWFibGUiLCJ2ZXJzaW9uUmVwbGFjZWFibGUiLCJfdHlwZSIsImlzUHJvZHVjdGlvbiIsImNvcmRvdmFDb21wYXRpYmlsaXR5VmVyc2lvbnMiLCJtYW5pZmVzdFVybFByZWZpeCIsInJlcGxhY2UiLCJtYW5pZmVzdFVybCIsIlBhY2thZ2UiLCJhdXRvdXBkYXRlIiwiQVVUT1VQREFURV9WRVJTSU9OIiwiQXV0b3VwZGF0ZSIsImF1dG91cGRhdGVWZXJzaW9uIiwiZW52IiwiZ2VuZXJhdGVCb2lsZXJwbGF0ZUZvckFyY2giLCJkZWZhdWx0T3B0aW9uc0ZvckFyY2giLCJERFBfREVGQVVMVF9DT05ORUNUSU9OX1VSTCIsIk1PQklMRV9ERFBfVVJMIiwiYWJzb2x1dGVVcmwiLCJST09UX1VSTCIsIk1PQklMRV9ST09UX1VSTCIsImdlbmVyYXRlQm9pbGVycGxhdGUiLCJyZWZyZXNoYWJsZUFzc2V0cyIsImNzcyIsImZpbGUiLCJhcHAiLCJyYXdDb25uZWN0SGFuZGxlcnMiLCJ1c2UiLCJpc1ZhbGlkVXJsIiwicmVzcG9uc2UiLCJxdWVyeSIsImdldFBhdGhQYXJ0cyIsInNoaWZ0IiwiaXNQcmVmaXhPZiIsInByZWZpeCIsImFycmF5IiwiZXZlcnkiLCJwYXJ0IiwicGF0aFByZWZpeCIsInNlYXJjaCIsInByZWZpeFBhcnRzIiwibWV0ZW9ySW50ZXJuYWxIYW5kbGVycyIsInBhY2thZ2VBbmRBcHBIYW5kbGVycyIsInN1cHByZXNzQ29ubmVjdEVycm9ycyIsImlzRGV2ZWxvcG1lbnQiLCJuZXdIZWFkZXJzIiwiY2F0Y2giLCJodHRwU2VydmVyIiwib25MaXN0ZW5pbmdDYWxsYmFja3MiLCJzb2NrZXQiLCJkZXN0cm95ZWQiLCJtZXNzYWdlIiwiZGVzdHJveSIsImNvbm5lY3RIYW5kbGVycyIsImNvbm5lY3RBcHAiLCJvbkxpc3RlbmluZyIsImYiLCJzdGFydExpc3RlbmluZyIsImxpc3Rlbk9wdGlvbnMiLCJjYiIsImxpc3RlbiIsImV4cG9ydHMiLCJtYWluIiwiYXJndiIsInN0YXJ0SHR0cFNlcnZlciIsImJpbmRFbnZpcm9ubWVudCIsIk1FVEVPUl9QUklOVF9PTl9MSVNURU4iLCJjb25zb2xlIiwibG9nIiwiY2FsbGJhY2tzIiwibG9jYWxQb3J0IiwiUE9SVCIsInVuaXhTb2NrZXRQYXRoIiwiVU5JWF9TT0NLRVRfUEFUSCIsImlzV29ya2VyIiwid29ya2VyTmFtZSIsIndvcmtlciIsImlkIiwidW5peFNvY2tldFBlcm1pc3Npb25zIiwiVU5JWF9TT0NLRVRfUEVSTUlTU0lPTlMiLCJ0cmltIiwidGVzdCIsInVuaXhTb2NrZXRHcm91cCIsIlVOSVhfU09DS0VUX0dST1VQIiwidW5peFNvY2tldEdyb3VwSW5mbyIsInN5bmMiLCJncm91cCIsInVpZCIsImdpZCIsImhvc3QiLCJCSU5EX0lQIiwic2V0SW5saW5lU2NyaXB0c0FsbG93ZWQiLCJlbmFibGVTdWJyZXNvdXJjZUludGVncml0eSIsInVzZV9jcmVkZW50aWFscyIsInNldEJ1bmRsZWRKc0Nzc1VybFJld3JpdGVIb29rIiwiaG9va0ZuIiwic2V0QnVuZGxlZEpzQ3NzUHJlZml4Iiwic2VsZiIsImFkZFN0YXRpY0pzIiwibnBtQ29ubmVjdCIsImNvbm5lY3RBcmdzIiwiaGFuZGxlcnMiLCJhcHBseSIsIm9yaWdpbmFsVXNlIiwidXNlQXJncyIsIm9yaWdpbmFsTGVuZ3RoIiwiZW50cnkiLCJvcmlnaW5hbEhhbmRsZSIsImhhbmRsZSIsImFzeW5jQXBwbHkiLCJhcmd1bWVudHMiLCJzdGF0U3luYyIsInVubGlua1N5bmMiLCJleGlzdHNTeW5jIiwic29ja2V0UGF0aCIsImlzU29ja2V0IiwiZXZlbnRFbWl0dGVyIiwic2lnbmFsIl0sIm1hcHBpbmdzIjoiOzs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7QUFBQSxNQUFJQSxhQUFKOztBQUFrQkMsU0FBTyxDQUFDQyxJQUFSLENBQWEsc0NBQWIsRUFBb0Q7QUFBQ0MsV0FBTyxDQUFDQyxDQUFELEVBQUc7QUFBQ0osbUJBQWEsR0FBQ0ksQ0FBZDtBQUFnQjs7QUFBNUIsR0FBcEQsRUFBa0YsQ0FBbEY7QUFBbEJILFNBQU8sQ0FBQ0ksTUFBUixDQUFlO0FBQUNDLFVBQU0sRUFBQyxNQUFJQSxNQUFa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LEVBQXdDO0FBQUEsTUFBM0JFLFlBQTJCLHVFQUFadkksT0FBWTtBQUN0QyxHQUFDLE1BQUQsRUFBUyxRQUFULEVBQW1CLFFBQW5CLEVBQTZCLFNBQTdCLEVBQXdDdEYsT0FBeEMsQ0FBZ0Q4TixNQUFNLElBQUk7QUFDeERELGdCQUFZLENBQUNuUCxFQUFiLENBQWdCb1AsTUFBaEIsRUFBd0JyUSxNQUFNLENBQUNpTixlQUFQLENBQXVCLE1BQU07QUFDbkQsVUFBSWdELFVBQVUsQ0FBQ0MsVUFBRCxDQUFkLEVBQTRCO0FBQzFCRixrQkFBVSxDQUFDRSxVQUFELENBQVY7QUFDRDtBQUNGLEtBSnVCLENBQXhCO0FBS0QsR0FORDtBQU9ELENBVEksQyIsImZpbGUiOiIvcGFja2FnZXMvd2ViYXBwLmpzIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0IGFzc2VydCBmcm9tIFwiYXNzZXJ0XCI7XHJcbmltcG9ydCB7XHJcbiAgcmVhZEZpbGVTeW5jLFxyXG4gIGNobW9kU3luYyxcclxuICBjaG93blN5bmNcclxufSBmcm9tIFwiZnNcIjtcclxuaW1wb3J0IHsgY3JlYXRlU2VydmVyIH0gZnJvbSBcImh0dHBcIjtcclxuaW1wb3J0IHsgdXNlckluZm8gfSBmcm9tIFwib3NcIjtcclxuaW1wb3J0IHtcclxuICBqb2luIGFzIHBhdGhKb2luLFxyXG4gIGRpcm5hbWUgYXMgcGF0aERpcm5hbWUsXHJcbn0gZnJvbSBcInBhdGhcIjtcclxuaW1wb3J0IHsgcGFyc2UgYXMgcGFyc2VVcmwgfSBmcm9tIFwidXJsXCI7XHJcbmltcG9ydCB7IGNyZWF0ZUhhc2ggfSBmcm9tIFwiY3J5cHRvXCI7XHJcbmltcG9ydCB7IGNvbm5lY3QgfSBmcm9tIFwiLi9jb25uZWN0LmpzXCI7XHJcbmltcG9ydCBjb21wcmVzcyBmcm9tIFwiY29tcHJlc3Npb25cIjtcclxuaW1wb3J0IGNvb2tpZVBhcnNlciBmcm9tIFwiY29va2llLXBhcnNlclwiO1xyXG5pbXBvcnQgcXMgZnJvbSBcInFzXCI7XHJcbmltcG9ydCBwYXJzZVJlcXVlc3QgZnJvbSBcInBhcnNldXJsXCI7XHJcbmltcG9ydCBiYXNpY0F1dGggZnJvbSBcImJhc2ljLWF1dGgtY29ubmVjdFwiO1xyXG5pbXBvcnQgeyBsb29rdXAgYXMgbG9va3VwVXNlckFnZW50IH0gZnJvbSBcInVzZXJhZ2VudFwiO1xyXG5pbXBvcnQgeyBpc01vZGVybiB9IGZyb20gXCJtZXRlb3IvbW9kZXJuLWJyb3dzZXJzXCI7XHJcbmltcG9ydCBzZW5kIGZyb20gXCJzZW5kXCI7XHJcbmltcG9ydCB7XHJcbiAgcmVtb3ZlRXhpc3RpbmdTb2NrZXRGaWxlLFxyXG4gIHJlZ2lzdGVyU29ja2V0RmlsZUNsZWFudXAsXHJcbn0gZnJvbSAnLi9zb2NrZXRfZmlsZS5qcyc7XHJcbmltcG9ydCBjbHVzdGVyIGZyb20gXCJjbHVzdGVyXCI7XHJcbmltcG9ydCB3aG9tc3QgZnJvbSBcIkB2bGFza3kvd2hvbXN0XCI7XHJcblxyXG52YXIgU0hPUlRfU09DS0VUX1RJTUVPVVQgPSA1KjEwMDA7XHJcbnZhciBMT05HX1NPQ0tFVF9USU1FT1VUID0gMTIwKjEwMDA7XHJcblxyXG5leHBvcnQgY29uc3QgV2ViQXBwID0ge307XHJcbmV4cG9ydCBjb25zdCBXZWJBcHBJbnRlcm5hbHMgPSB7fTtcclxuXHJcbmNvbnN0IGhhc093biA9IE9iamVjdC5wcm90b3R5cGUuaGFzT3duUHJvcGVydHk7XHJcblxyXG4vLyBiYWNrd2FyZHMgY29tcGF0IHRvIDIuMCBvZiBjb25uZWN0XHJcbmNvbm5lY3QuYmFzaWNBdXRoID0gYmFzaWNBdXRoO1xyXG5cclxuV2ViQXBwSW50ZXJuYWxzLk5wbU1vZHVsZXMgPSB7XHJcbiAgY29ubmVjdDoge1xyXG4gICAgdmVyc2lvbjogTnBtLnJlcXVpcmUoJ2Nvbm5lY3QvcGFja2FnZS5qc29uJykudmVyc2lvbixcclxuICAgIG1vZHVsZTogY29ubmVjdCxcclxuICB9XHJcbn07XHJcblxyXG4vLyBUaG91Z2ggd2UgbWlnaHQgcHJlZmVyIHRvIHVzZSB3ZWIuYnJvd3NlciAobW9kZXJuKSBhcyB0aGUgZGVmYXVsdFxyXG4vLyBhcmNoaXRlY3R1cmUsIHNhZmV0eSByZXF1aXJlcyBhIG1vcmUgY29tcGF0aWJsZSBkZWZhdWx0QXJjaC5cclxuV2ViQXBwLmRlZmF1bHRBcmNoID0gJ3dlYi5icm93c2VyLmxlZ2FjeSc7XHJcblxyXG4vLyBYWFggbWFwcyBhcmNocyB0byBtYW5pZmVzdHNcclxuV2ViQXBwLmNsaWVudFByb2dyYW1zID0ge307XHJcblxyXG4vLyBYWFggbWFwcyBhcmNocyB0byBwcm9ncmFtIHBhdGggb24gZmlsZXN5c3RlbVxyXG52YXIgYXJjaFBhdGggPSB7fTtcclxuXHJcbnZhciBidW5kbGVkSnNDc3NVcmxSZXdyaXRlSG9vayA9IGZ1bmN0aW9uICh1cmwpIHtcclxuICB2YXIgYnVuZGxlZFByZWZpeCA9XHJcbiAgICAgX19tZXRlb3JfcnVudGltZV9jb25maWdfXy5ST09UX1VSTF9QQVRIX1BSRUZJWCB8fCAnJztcclxuICByZXR1cm4gYnVuZGxlZFByZWZpeCArIHVybDtcclxufTtcclxuXHJcbnZhciBzaGExID0gZnVuY3Rpb24gKGNvbnRlbnRzKSB7XHJcbiAgdmFyIGhhc2ggPSBjcmVhdGVIYXNoKCdzaGExJyk7XHJcbiAgaGFzaC51cGRhdGUoY29udGVudHMpO1xyXG4gIHJldHVybiBoYXNoLmRpZ2VzdCgnaGV4Jyk7XHJcbn07XHJcblxyXG4gZnVuY3Rpb24gc2hvdWxkQ29tcHJlc3MocmVxLCByZXMpIHtcclxuICBpZiAocmVxLmhlYWRlcnNbJ3gtbm8tY29tcHJlc3Npb24nXSkge1xyXG4gICAgLy8gZG9uJ3QgY29tcHJlc3MgcmVzcG9uc2VzIHdpdGggdGhpcyByZXF1ZXN0IGhlYWRlclxyXG4gICAgcmV0dXJuIGZhbHNlO1xyXG4gIH1cclxuXHJcbiAgLy8gZmFsbGJhY2sgdG8gc3RhbmRhcmQgZmlsdGVyIGZ1bmN0aW9uXHJcbiAgcmV0dXJuIGNvbXByZXNzLmZpbHRlcihyZXEsIHJlcyk7XHJcbn07XHJcblxyXG4vLyAjQnJvd3NlcklkZW50aWZpY2F0aW9uXHJcbi8vXHJcbi8vIFdlIGhhdmUgbXVsdGlwbGUgcGxhY2VzIHRoYXQgd2FudCB0byBpZGVudGlmeSB0aGUgYnJvd3NlcjogdGhlXHJcbi8vIHVuc3VwcG9ydGVkIGJyb3dzZXIgcGFnZSwgdGhlIGFwcGNhY2hlIHBhY2thZ2UsIGFuZCwgZXZlbnR1YWxseVxyXG4vLyBkZWxpdmVyaW5nIGJyb3dzZXIgcG9seWZpbGxzIG9ubHkgYXMgbmVlZGVkLlxyXG4vL1xyXG4vLyBUbyBhdm9pZCBkZXRlY3RpbmcgdGhlIGJyb3dzZXIgaW4gbXVsdGlwbGUgcGxhY2VzIGFkLWhvYywgd2UgY3JlYXRlIGFcclxuLy8gTWV0ZW9yIFwiYnJvd3NlclwiIG9iamVjdC4gSXQgdXNlcyBidXQgZG9lcyBub3QgZXhwb3NlIHRoZSBucG1cclxuLy8gdXNlcmFnZW50IG1vZHVsZSAod2UgY291bGQgY2hvb3NlIGEgZGlmZmVyZW50IG1lY2hhbmlzbSB0byBpZGVudGlmeVxyXG4vLyB0aGUgYnJvd3NlciBpbiB0aGUgZnV0dXJlIGlmIHdlIHdhbnRlZCB0bykuICBUaGUgYnJvd3NlciBvYmplY3RcclxuLy8gY29udGFpbnNcclxuLy9cclxuLy8gKiBgbmFtZWA6IHRoZSBuYW1lIG9mIHRoZSBicm93c2VyIGluIGNhbWVsIGNhc2VcclxuLy8gKiBgbWFqb3JgLCBgbWlub3JgLCBgcGF0Y2hgOiBpbnRlZ2VycyBkZXNjcmliaW5nIHRoZSBicm93c2VyIHZlcnNpb25cclxuLy9cclxuLy8gQWxzbyBoZXJlIGlzIGFuIGVhcmx5IHZlcnNpb24gb2YgYSBNZXRlb3IgYHJlcXVlc3RgIG9iamVjdCwgaW50ZW5kZWRcclxuLy8gdG8gYmUgYSBoaWdoLWxldmVsIGRlc2NyaXB0aW9uIG9mIHRoZSByZXF1ZXN0IHdpdGhvdXQgZXhwb3NpbmdcclxuLy8gZGV0YWlscyBvZiBjb25uZWN0J3MgbG93LWxldmVsIGByZXFgLiAgQ3VycmVudGx5IGl0IGNvbnRhaW5zOlxyXG4vL1xyXG4vLyAqIGBicm93c2VyYDogYnJvd3NlciBpZGVudGlmaWNhdGlvbiBvYmplY3QgZGVzY3JpYmVkIGFib3ZlXHJcbi8vICogYHVybGA6IHBhcnNlZCB1cmwsIGluY2x1ZGluZyBwYXJzZWQgcXVlcnkgcGFyYW1zXHJcbi8vXHJcbi8vIEFzIGEgdGVtcG9yYXJ5IGhhY2sgdGhlcmUgaXMgYSBgY2F0ZWdvcml6ZVJlcXVlc3RgIGZ1bmN0aW9uIG9uIFdlYkFwcCB3aGljaFxyXG4vLyBjb252ZXJ0cyBhIGNvbm5lY3QgYHJlcWAgdG8gYSBNZXRlb3IgYHJlcXVlc3RgLiBUaGlzIGNhbiBnbyBhd2F5IG9uY2Ugc21hcnRcclxuLy8gcGFja2FnZXMgc3VjaCBhcyBhcHBjYWNoZSBhcmUgYmVpbmcgcGFzc2VkIGEgYHJlcXVlc3RgIG9iamVjdCBkaXJlY3RseSB3aGVuXHJcbi8vIHRoZXkgc2VydmUgY29udGVudC5cclxuLy9cclxuLy8gVGhpcyBhbGxvd3MgYHJlcXVlc3RgIHRvIGJlIHVzZWQgdW5pZm9ybWx5OiBpdCBpcyBwYXNzZWQgdG8gdGhlIGh0bWxcclxuLy8gYXR0cmlidXRlcyBob29rLCBhbmQgdGhlIGFwcGNhY2hlIHBhY2thZ2UgY2FuIHVzZSBpdCB3aGVuIGRlY2lkaW5nXHJcbi8vIHdoZXRoZXIgdG8gZ2VuZXJhdGUgYSA0MDQgZm9yIHRoZSBtYW5pZmVzdC5cclxuLy9cclxuLy8gUmVhbCByb3V0aW5nIC8gc2VydmVyIHNpZGUgcmVuZGVyaW5nIHdpbGwgcHJvYmFibHkgcmVmYWN0b3IgdGhpc1xyXG4vLyBoZWF2aWx5LlxyXG5cclxuXHJcbi8vIGUuZy4gXCJNb2JpbGUgU2FmYXJpXCIgPT4gXCJtb2JpbGVTYWZhcmlcIlxyXG52YXIgY2FtZWxDYXNlID0gZnVuY3Rpb24gKG5hbWUpIHtcclxuICB2YXIgcGFydHMgPSBuYW1lLnNwbGl0KCcgJyk7XHJcbiAgcGFydHNbMF0gPSBwYXJ0c1swXS50b0xvd2VyQ2FzZSgpO1xyXG4gIGZvciAodmFyIGkgPSAxOyAgaSA8IHBhcnRzLmxlbmd0aDsgICsraSkge1xyXG4gICAgcGFydHNbaV0gPSBwYXJ0c1tpXS5jaGFyQXQoMCkudG9VcHBlckNhc2UoKSArIHBhcnRzW2ldLnN1YnN0cigxKTtcclxuICB9XHJcbiAgcmV0dXJuIHBhcnRzLmpvaW4oJycpO1xyXG59O1xyXG5cclxudmFyIGlkZW50aWZ5QnJvd3NlciA9IGZ1bmN0aW9uICh1c2VyQWdlbnRTdHJpbmcpIHtcclxuICB2YXIgdXNlckFnZW50ID0gbG9va3VwVXNlckFnZW50KHVzZXJBZ2VudFN0cmluZyk7XHJcbiAgcmV0dXJuIHtcclxuICAgIG5hbWU6IGNhbWVsQ2FzZSh1c2VyQWdlbnQuZmFtaWx5KSxcclxuICAgIG1ham9yOiArdXNlckFnZW50Lm1ham9yLFxyXG4gICAgbWlub3I6ICt1c2VyQWdlbnQubWlub3IsXHJcbiAgICBwYXRjaDogK3VzZXJBZ2VudC5wYXRjaFxyXG4gIH07XHJcbn07XHJcblxyXG4vLyBYWFggUmVmYWN0b3IgYXMgcGFydCBvZiBpbXBsZW1lbnRpbmcgcmVhbCByb3V0aW5nLlxyXG5XZWJBcHBJbnRlcm5hbHMuaWRlbnRpZnlCcm93c2VyID0gaWRlbnRpZnlCcm93c2VyO1xyXG5cclxuV2ViQXBwLmNhdGVnb3JpemVSZXF1ZXN0ID0gZnVuY3Rpb24gKHJlcSkge1xyXG4gIGlmIChyZXEuYnJvd3NlciAmJiByZXEuYXJjaCAmJiB0eXBlb2YgcmVxLm1vZGVybiA9PT0gXCJib29sZWFuXCIpIHtcclxuICAgIC8vIEFscmVhZHkgY2F0ZWdvcml6ZWQuXHJcbiAgICByZXR1cm4gcmVxO1xyXG4gIH1cclxuXHJcbiAgY29uc3QgYnJvd3NlciA9IGlkZW50aWZ5QnJvd3NlcihyZXEuaGVhZGVyc1tcInVzZXItYWdlbnRcIl0pO1xyXG4gIGNvbnN0IG1vZGVybiA9IGlzTW9kZXJuKGJyb3dzZXIpO1xyXG4gIGNvbnN0IHBhdGggPSB0eXBlb2YgcmVxLnBhdGhuYW1lID09PSBcInN0cmluZ1wiXHJcbiAgID8gcmVxLnBhdGhuYW1lXHJcbiAgIDogcGFyc2VSZXF1ZXN0KHJlcSkucGF0aG5hbWU7XHJcblxyXG4gIGNvbnN0IGNhdGVnb3JpemVkID0ge1xyXG4gICAgYnJvd3NlcixcclxuICAgIG1vZGVybixcclxuICAgIHBhdGgsXHJcbiAgICBhcmNoOiBXZWJBcHAuZGVmYXVsdEFyY2gsXHJcbiAgICB1cmw6IHBhcnNlVXJsKHJlcS51cmwsIHRydWUpLFxyXG4gICAgZHluYW1pY0hlYWQ6IHJlcS5keW5hbWljSGVhZCxcclxuICAgIGR5bmFtaWNCb2R5OiByZXEuZHluYW1pY0JvZHksXHJcbiAgICBoZWFkZXJzOiByZXEuaGVhZGVycyxcclxuICAgIGNvb2tpZXM6IHJlcS5jb29raWVzLFxyXG4gIH07XHJcblxyXG4gIGNvbnN0IHBhdGhQYXJ0cyA9IHBhdGguc3BsaXQoXCIvXCIpO1xyXG4gIGNvbnN0IGFyY2hLZXkgPSBwYXRoUGFydHNbMV07XHJcblxyXG4gIGlmIChhcmNoS2V5LnN0YXJ0c1dpdGgoXCJfX1wiKSkge1xyXG4gICAgY29uc3QgYXJjaENsZWFuZWQgPSBcIndlYi5cIiArIGFyY2hLZXkuc2xpY2UoMik7XHJcbiAgICBpZiAoaGFzT3duLmNhbGwoV2ViQXBwLmNsaWVudFByb2dyYW1zLCBhcmNoQ2xlYW5lZCkpIHtcclxuICAgICAgcGF0aFBhcnRzLnNwbGljZSgxLCAxKTsgLy8gUmVtb3ZlIHRoZSBhcmNoS2V5IHBhcnQuXHJcbiAgICAgIHJldHVybiBPYmplY3QuYXNzaWduKGNhdGVnb3JpemVkLCB7XHJcbiAgICAgICAgYXJjaDogYXJjaENsZWFuZWQsXHJcbiAgICAgICAgcGF0aDogcGF0aFBhcnRzLmpvaW4oXCIvXCIpLFxyXG4gICAgICB9KTtcclxuICAgIH1cclxuICB9XHJcblxyXG4gIC8vIFRPRE8gUGVyaGFwcyBvbmUgZGF5IHdlIGNvdWxkIGluZmVyIENvcmRvdmEgY2xpZW50cyBoZXJlLCBzbyB0aGF0IHdlXHJcbiAgLy8gd291bGRuJ3QgaGF2ZSB0byB1c2UgcHJlZml4ZWQgXCIvX19jb3Jkb3ZhLy4uLlwiIFVSTHMuXHJcbiAgY29uc3QgcHJlZmVycmVkQXJjaE9yZGVyID0gaXNNb2Rlcm4oYnJvd3NlcilcclxuICAgID8gW1wid2ViLmJyb3dzZXJcIiwgXCJ3ZWIuYnJvd3Nlci5sZWdhY3lcIl1cclxuICAgIDogW1wid2ViLmJyb3dzZXIubGVnYWN5XCIsIFwid2ViLmJyb3dzZXJcIl07XHJcblxyXG4gIGZvciAoY29uc3QgYXJjaCBvZiBwcmVmZXJyZWRBcmNoT3JkZXIpIHtcclxuICAgIC8vIElmIG91ciBwcmVmZXJyZWQgYXJjaCBpcyBub3QgYXZhaWxhYmxlLCBpdCdzIGJldHRlciB0byB1c2UgYW5vdGhlclxyXG4gICAgLy8gY2xpZW50IGFyY2ggdGhhdCBpcyBhdmFpbGFibGUgdGhhbiB0byBndWFyYW50ZWUgdGhlIHNpdGUgd29uJ3Qgd29ya1xyXG4gICAgLy8gYnkgcmV0dXJuaW5nIGFuIHVua25vd24gYXJjaC4gRm9yIGV4YW1wbGUsIGlmIHdlYi5icm93c2VyLmxlZ2FjeSBpc1xyXG4gICAgLy8gZXhjbHVkZWQgdXNpbmcgdGhlIC0tZXhjbHVkZS1hcmNocyBjb21tYW5kLWxpbmUgb3B0aW9uLCBsZWdhY3lcclxuICAgIC8vIGNsaWVudHMgYXJlIGJldHRlciBvZmYgcmVjZWl2aW5nIHdlYi5icm93c2VyICh3aGljaCBtaWdodCBhY3R1YWxseVxyXG4gICAgLy8gd29yaykgdGhhbiByZWNlaXZpbmcgYW4gSFRUUCA0MDQgcmVzcG9uc2UuIElmIG5vbmUgb2YgdGhlIGFyY2hzIGluXHJcbiAgICAvLyBwcmVmZXJyZWRBcmNoT3JkZXIgYXJlIGRlZmluZWQsIG9ubHkgdGhlbiBzaG91bGQgd2Ugc2VuZCBhIDQwNC5cclxuICAgIGlmIChoYXNPd24uY2FsbChXZWJBcHAuY2xpZW50UHJvZ3JhbXMsIGFyY2gpKSB7XHJcbiAgICAgIHJldHVybiBPYmplY3QuYXNzaWduKGNhdGVnb3JpemVkLCB7IGFyY2ggfSk7XHJcbiAgICB9XHJcbiAgfVxyXG5cclxuICByZXR1cm4gY2F0ZWdvcml6ZWQ7XHJcbn07XHJcblxyXG4vLyBIVE1MIGF0dHJpYnV0ZSBob29rczogZnVuY3Rpb25zIHRvIGJlIGNhbGxlZCB0byBkZXRlcm1pbmUgYW55IGF0dHJpYnV0ZXMgdG9cclxuLy8gYmUgYWRkZWQgdG8gdGhlICc8aHRtbD4nIHRhZy4gRWFjaCBmdW5jdGlvbiBpcyBwYXNzZWQgYSAncmVxdWVzdCcgb2JqZWN0IChzZWVcclxuLy8gI0Jyb3dzZXJJZGVudGlmaWNhdGlvbikgYW5kIHNob3VsZCByZXR1cm4gbnVsbCBvciBvYmplY3QuXHJcbnZhciBodG1sQXR0cmlidXRlSG9va3MgPSBbXTtcclxudmFyIGdldEh0bWxBdHRyaWJ1dGVzID0gZnVuY3Rpb24gKHJlcXVlc3QpIHtcclxuICB2YXIgY29tYmluZWRBdHRyaWJ1dGVzICA9IHt9O1xyXG4gIF8uZWFjaChodG1sQXR0cmlidXRlSG9va3MgfHwgW10sIGZ1bmN0aW9uIChob29rKSB7XHJcbiAgICB2YXIgYXR0cmlidXRlcyA9IGhvb2socmVxdWVzdCk7XHJcbiAgICBpZiAoYXR0cmlidXRlcyA9PT0gbnVsbClcclxuICAgICAgcmV0dXJuO1xyXG4gICAgaWYgKHR5cGVvZiBhdHRyaWJ1dGVzICE9PSAnb2JqZWN0JylcclxuICAgICAgdGhyb3cgRXJyb3IoXCJIVE1MIGF0dHJpYnV0ZSBob29rIG11c3QgcmV0dXJuIG51bGwgb3Igb2JqZWN0XCIpO1xyXG4gICAgXy5leHRlbmQoY29tYmluZWRBdHRyaWJ1dGVzLCBhdHRyaWJ1dGVzKTtcclxuICB9KTtcclxuICByZXR1cm4gY29tYmluZWRBdHRyaWJ1dGVzO1xyXG59O1xyXG5XZWJBcHAuYWRkSHRtbEF0dHJpYnV0ZUhvb2sgPSBmdW5jdGlvbiAoaG9vaykge1xyXG4gIGh0bWxBdHRyaWJ1dGVIb29rcy5wdXNoKGhvb2spO1xyXG59O1xyXG5cclxuLy8gU2VydmUgYXBwIEhUTUwgZm9yIHRoaXMgVVJMP1xyXG52YXIgYXBwVXJsID0gZnVuY3Rpb24gKHVybCkge1xyXG4gIGlmICh1cmwgPT09ICcvZmF2aWNvbi5pY28nIHx8IHVybCA9PT0gJy9yb2JvdHMudHh0JylcclxuICAgIHJldHVybiBmYWxzZTtcclxuXHJcbiAgLy8gTk9URTogYXBwLm1hbmlmZXN0IGlzIG5vdCBhIHdlYiBzdGFuZGFyZCBsaWtlIGZhdmljb24uaWNvIGFuZFxyXG4gIC8vIHJvYm90cy50eHQuIEl0IGlzIGEgZmlsZSBuYW1lIHdlIGhhdmUgY2hvc2VuIHRvIHVzZSBmb3IgSFRNTDVcclxuICAvLyBhcHBjYWNoZSBVUkxzLiBJdCBpcyBpbmNsdWRlZCBoZXJlIHRvIHByZXZlbnQgdXNpbmcgYW4gYXBwY2FjaGVcclxuICAvLyB0aGVuIHJlbW92aW5nIGl0IGZyb20gcG9pc29uaW5nIGFuIGFwcCBwZXJtYW5lbnRseS4gRXZlbnR1YWxseSxcclxuICAvLyBvbmNlIHdlIGhhdmUgc2VydmVyIHNpZGUgcm91dGluZywgdGhpcyB3b24ndCBiZSBuZWVkZWQgYXNcclxuICAvLyB1bmtub3duIFVSTHMgd2l0aCByZXR1cm4gYSA0MDQgYXV0b21hdGljYWxseS5cclxuICBpZiAodXJsID09PSAnL2FwcC5tYW5pZmVzdCcpXHJcbiAgICByZXR1cm4gZmFsc2U7XHJcblxyXG4gIC8vIEF2b2lkIHNlcnZpbmcgYXBwIEhUTUwgZm9yIGRlY2xhcmVkIHJvdXRlcyBzdWNoIGFzIC9zb2NranMvLlxyXG4gIGlmIChSb3V0ZVBvbGljeS5jbGFzc2lmeSh1cmwpKVxyXG4gICAgcmV0dXJuIGZhbHNlO1xyXG5cclxuICAvLyB3ZSBjdXJyZW50bHkgcmV0dXJuIGFwcCBIVE1MIG9uIGFsbCBVUkxzIGJ5IGRlZmF1bHRcclxuICByZXR1cm4gdHJ1ZTtcclxufTtcclxuXHJcblxyXG4vLyBXZSBuZWVkIHRvIGNhbGN1bGF0ZSB0aGUgY2xpZW50IGhhc2ggYWZ0ZXIgYWxsIHBhY2thZ2VzIGhhdmUgbG9hZGVkXHJcbi8vIHRvIGdpdmUgdGhlbSBhIGNoYW5jZSB0byBwb3B1bGF0ZSBfX21ldGVvcl9ydW50aW1lX2NvbmZpZ19fLlxyXG4vL1xyXG4vLyBDYWxjdWxhdGluZyB0aGUgaGFzaCBkdXJpbmcgc3RhcnR1cCBtZWFucyB0aGF0IHBhY2thZ2VzIGNhbiBvbmx5XHJcbi8vIHBvcHVsYXRlIF9fbWV0ZW9yX3J1bnRpbWVfY29uZmlnX18gZHVyaW5nIGxvYWQsIG5vdCBkdXJpbmcgc3RhcnR1cC5cclxuLy9cclxuLy8gQ2FsY3VsYXRpbmcgaW5zdGVhZCBpdCBhdCB0aGUgYmVnaW5uaW5nIG9mIG1haW4gYWZ0ZXIgYWxsIHN0YXJ0dXBcclxuLy8gaG9va3MgaGFkIHJ1biB3b3VsZCBhbGxvdyBwYWNrYWdlcyB0byBhbHNvIHBvcHVsYXRlXHJcbi8vIF9fbWV0ZW9yX3J1bnRpbWVfY29uZmlnX18gZHVyaW5nIHN0YXJ0dXAsIGJ1dCB0aGF0J3MgdG9vIGxhdGUgZm9yXHJcbi8vIGF1dG91cGRhdGUgYmVjYXVzZSBpdCBuZWVkcyB0byBoYXZlIHRoZSBjbGllbnQgaGFzaCBhdCBzdGFydHVwIHRvXHJcbi8vIGluc2VydCB0aGUgYXV0byB1cGRhdGUgdmVyc2lvbiBpdHNlbGYgaW50b1xyXG4vLyBfX21ldGVvcl9ydW50aW1lX2NvbmZpZ19fIHRvIGdldCBpdCB0byB0aGUgY2xpZW50LlxyXG4vL1xyXG4vLyBBbiBhbHRlcm5hdGl2ZSB3b3VsZCBiZSB0byBnaXZlIGF1dG91cGRhdGUgYSBcInBvc3Qtc3RhcnQsXHJcbi8vIHByZS1saXN0ZW5cIiBob29rIHRvIGFsbG93IGl0IHRvIGluc2VydCB0aGUgYXV0byB1cGRhdGUgdmVyc2lvbiBhdFxyXG4vLyB0aGUgcmlnaHQgbW9tZW50LlxyXG5cclxuTWV0ZW9yLnN0YXJ0dXAoZnVuY3Rpb24gKCkge1xyXG4gIGZ1bmN0aW9uIGdldHRlcihrZXkpIHtcclxuICAgIHJldHVybiBmdW5jdGlvbiAoYXJjaCkge1xyXG4gICAgICBhcmNoID0gYXJjaCB8fCBXZWJBcHAuZGVmYXVsdEFyY2g7XHJcbiAgICAgIGNvbnN0IHByb2dyYW0gPSBXZWJBcHAuY2xpZW50UHJvZ3JhbXNbYXJjaF07XHJcbiAgICAgIGNvbnN0IHZhbHVlID0gcHJvZ3JhbSAmJiBwcm9ncmFtW2tleV07XHJcbiAgICAgIC8vIElmIHRoaXMgaXMgdGhlIGZpcnN0IHRpbWUgd2UgaGF2ZSBjYWxjdWxhdGVkIHRoaXMgaGFzaCxcclxuICAgICAgLy8gcHJvZ3JhbVtrZXldIHdpbGwgYmUgYSB0aHVuayAobGF6eSBmdW5jdGlvbiB3aXRoIG5vIHBhcmFtZXRlcnMpXHJcbiAgICAgIC8vIHRoYXQgd2Ugc2hvdWxkIGNhbGwgdG8gZG8gdGhlIGFjdHVhbCBjb21wdXRhdGlvbi5cclxuICAgICAgcmV0dXJuIHR5cGVvZiB2YWx1ZSA9PT0gXCJmdW5jdGlvblwiXHJcbiAgICAgICAgPyBwcm9ncmFtW2tleV0gPSB2YWx1ZSgpXHJcbiAgICAgICAgOiB2YWx1ZTtcclxuICAgIH07XHJcbiAgfVxyXG5cclxuICBXZWJBcHAuY2FsY3VsYXRlQ2xpZW50SGFzaCA9IFdlYkFwcC5jbGllbnRIYXNoID0gZ2V0dGVyKFwidmVyc2lvblwiKTtcclxuICBXZWJBcHAuY2FsY3VsYXRlQ2xpZW50SGFzaFJlZnJlc2hhYmxlID0gZ2V0dGVyKFwidmVyc2lvblJlZnJlc2hhYmxlXCIpO1xyXG4gIFdlYkFwcC5jYWxjdWxhdGVDbGllbnRIYXNoTm9uUmVmcmVzaGFibGUgPSBnZXR0ZXIoXCJ2ZXJzaW9uTm9uUmVmcmVzaGFibGVcIik7XHJcbiAgV2ViQXBwLmNhbGN1bGF0ZUNsaWVudEhhc2hSZXBsYWNlYWJsZSA9IGdldHRlcihcInZlcnNpb25SZXBsYWNlYWJsZVwiKTtcclxuICBXZWJBcHAuZ2V0UmVmcmVzaGFibGVBc3NldHMgPSBnZXR0ZXIoXCJyZWZyZXNoYWJsZUFzc2V0c1wiKTtcclxufSk7XHJcblxyXG5cclxuXHJcbi8vIFdoZW4gd2UgaGF2ZSBhIHJlcXVlc3QgcGVuZGluZywgd2Ugd2FudCB0aGUgc29ja2V0IHRpbWVvdXQgdG8gYmUgbG9uZywgdG9cclxuLy8gZ2l2ZSBvdXJzZWx2ZXMgYSB3aGlsZSB0byBzZXJ2ZSBpdCwgYW5kIHRvIGFsbG93IHNvY2tqcyBsb25nIHBvbGxzIHRvXHJcbi8vIGNvbXBsZXRlLiAgT24gdGhlIG90aGVyIGhhbmQsIHdlIHdhbnQgdG8gY2xvc2UgaWRsZSBzb2NrZXRzIHJlbGF0aXZlbHlcclxuLy8gcXVpY2tseSwgc28gdGhhdCB3ZSBjYW4gc2h1dCBkb3duIHJlbGF0aXZlbHkgcHJvbXB0bHkgYnV0IGNsZWFubHksIHdpdGhvdXRcclxuLy8gY3V0dGluZyBvZmYgYW55b25lJ3MgcmVzcG9uc2UuXHJcbldlYkFwcC5fdGltZW91dEFkanVzdG1lbnRSZXF1ZXN0Q2FsbGJhY2sgPSBmdW5jdGlvbiAocmVxLCByZXMpIHtcclxuICAvLyB0aGlzIGlzIHJlYWxseSBqdXN0IHJlcS5zb2NrZXQuc2V0VGltZW91dChMT05HX1NPQ0tFVF9USU1FT1VUKTtcclxuICByZXEuc2V0VGltZW91dChMT05HX1NPQ0tFVF9USU1FT1VUKTtcclxuICAvLyBJbnNlcnQgb3VyIG5ldyBmaW5pc2ggbGlzdGVuZXIgdG8gcnVuIEJFRk9SRSB0aGUgZXhpc3Rpbmcgb25lIHdoaWNoIHJlbW92ZXNcclxuICAvLyB0aGUgcmVzcG9uc2UgZnJvbSB0aGUgc29ja2V0LlxyXG4gIHZhciBmaW5pc2hMaXN0ZW5lcnMgPSByZXMubGlzdGVuZXJzKCdmaW5pc2gnKTtcclxuICAvLyBYWFggQXBwYXJlbnRseSBpbiBOb2RlIDAuMTIgdGhpcyBldmVudCB3YXMgY2FsbGVkICdwcmVmaW5pc2gnLlxyXG4gIC8vIGh0dHBzOi8vZ2l0aHViLmNvbS9qb3llbnQvbm9kZS9jb21taXQvN2M5YjYwNzBcclxuICAvLyBCdXQgaXQgaGFzIHN3aXRjaGVkIGJhY2sgdG8gJ2ZpbmlzaCcgaW4gTm9kZSB2NDpcclxuICAvLyBodHRwczovL2dpdGh1Yi5jb20vbm9kZWpzL25vZGUvcHVsbC8xNDExXHJcbiAgcmVzLnJlbW92ZUFsbExpc3RlbmVycygnZmluaXNoJyk7XHJcbiAgcmVzLm9uKCdmaW5pc2gnLCBmdW5jdGlvbiAoKSB7XHJcbiAgICByZXMuc2V0VGltZW91dChTSE9SVF9TT0NLRVRfVElNRU9VVCk7XHJcbiAgfSk7XHJcbiAgXy5lYWNoKGZpbmlzaExpc3RlbmVycywgZnVuY3Rpb24gKGwpIHsgcmVzLm9uKCdmaW5pc2gnLCBsKTsgfSk7XHJcbn07XHJcblxyXG5cclxuLy8gV2lsbCBiZSB1cGRhdGVkIGJ5IG1haW4gYmVmb3JlIHdlIGxpc3Rlbi5cclxuLy8gTWFwIGZyb20gY2xpZW50IGFyY2ggdG8gYm9pbGVycGxhdGUgb2JqZWN0LlxyXG4vLyBCb2lsZXJwbGF0ZSBvYmplY3QgaGFzOlxyXG4vLyAgIC0gZnVuYzogWFhYXHJcbi8vICAgLSBiYXNlRGF0YTogWFhYXHJcbnZhciBib2lsZXJwbGF0ZUJ5QXJjaCA9IHt9O1xyXG5cclxuLy8gUmVnaXN0ZXIgYSBjYWxsYmFjayBmdW5jdGlvbiB0aGF0IGNhbiBzZWxlY3RpdmVseSBtb2RpZnkgYm9pbGVycGxhdGVcclxuLy8gZGF0YSBnaXZlbiBhcmd1bWVudHMgKHJlcXVlc3QsIGRhdGEsIGFyY2gpLiBUaGUga2V5IHNob3VsZCBiZSBhIHVuaXF1ZVxyXG4vLyBpZGVudGlmaWVyLCB0byBwcmV2ZW50IGFjY3VtdWxhdGluZyBkdXBsaWNhdGUgY2FsbGJhY2tzIGZyb20gdGhlIHNhbWVcclxuLy8gY2FsbCBzaXRlIG92ZXIgdGltZS4gQ2FsbGJhY2tzIHdpbGwgYmUgY2FsbGVkIGluIHRoZSBvcmRlciB0aGV5IHdlcmVcclxuLy8gcmVnaXN0ZXJlZC4gQSBjYWxsYmFjayBzaG91bGQgcmV0dXJuIGZhbHNlIGlmIGl0IGRpZCBub3QgbWFrZSBhbnlcclxuLy8gY2hhbmdlcyBhZmZlY3RpbmcgdGhlIGJvaWxlcnBsYXRlLiBQYXNzaW5nIG51bGwgZGVsZXRlcyB0aGUgY2FsbGJhY2suXHJcbi8vIEFueSBwcmV2aW91cyBjYWxsYmFjayByZWdpc3RlcmVkIGZvciB0aGlzIGtleSB3aWxsIGJlIHJldHVybmVkLlxyXG5jb25zdCBib2lsZXJwbGF0ZURhdGFDYWxsYmFja3MgPSBPYmplY3QuY3JlYXRlKG51bGwpO1xyXG5XZWJBcHBJbnRlcm5hbHMucmVnaXN0ZXJCb2lsZXJwbGF0ZURhdGFDYWxsYmFjayA9IGZ1bmN0aW9uIChrZXksIGNhbGxiYWNrKSB7XHJcbiAgY29uc3QgcHJldmlvdXNDYWxsYmFjayA9IGJvaWxlcnBsYXRlRGF0YUNhbGxiYWNrc1trZXldO1xyXG5cclxuICBpZiAodHlwZW9mIGNhbGxiYWNrID09PSBcImZ1bmN0aW9uXCIpIHtcclxuICAgIGJvaWxlcnBsYXRlRGF0YUNhbGxiYWNrc1trZXldID0gY2FsbGJhY2s7XHJcbiAgfSBlbHNlIHtcclxuICAgIGFzc2VydC5zdHJpY3RFcXVhbChjYWxsYmFjaywgbnVsbCk7XHJcbiAgICBkZWxldGUgYm9pbGVycGxhdGVEYXRhQ2FsbGJhY2tzW2tleV07XHJcbiAgfVxyXG5cclxuICAvLyBSZXR1cm4gdGhlIHByZXZpb3VzIGNhbGxiYWNrIGluIGNhc2UgdGhlIG5ldyBjYWxsYmFjayBuZWVkcyB0byBjYWxsXHJcbiAgLy8gaXQ7IGZvciBleGFtcGxlLCB3aGVuIHRoZSBuZXcgY2FsbGJhY2sgaXMgYSB3cmFwcGVyIGZvciB0aGUgb2xkLlxyXG4gIHJldHVybiBwcmV2aW91c0NhbGxiYWNrIHx8IG51bGw7XHJcbn07XHJcblxyXG4vLyBHaXZlbiBhIHJlcXVlc3QgKGFzIHJldHVybmVkIGZyb20gYGNhdGVnb3JpemVSZXF1ZXN0YCksIHJldHVybiB0aGVcclxuLy8gYm9pbGVycGxhdGUgSFRNTCB0byBzZXJ2ZSBmb3IgdGhhdCByZXF1ZXN0LlxyXG4vL1xyXG4vLyBJZiBhIHByZXZpb3VzIGNvbm5lY3QgbWlkZGxld2FyZSBoYXMgcmVuZGVyZWQgY29udGVudCBmb3IgdGhlIGhlYWQgb3IgYm9keSxcclxuLy8gcmV0dXJucyB0aGUgYm9pbGVycGxhdGUgd2l0aCB0aGF0IGNvbnRlbnQgcGF0Y2hlZCBpbiBvdGhlcndpc2VcclxuLy8gbWVtb2l6ZXMgb24gSFRNTCBhdHRyaWJ1dGVzICh1c2VkIGJ5LCBlZywgYXBwY2FjaGUpIGFuZCB3aGV0aGVyIGlubGluZVxyXG4vLyBzY3JpcHRzIGFyZSBjdXJyZW50bHkgYWxsb3dlZC5cclxuLy8gWFhYIHNvIGZhciB0aGlzIGZ1bmN0aW9uIGlzIGFsd2F5cyBjYWxsZWQgd2l0aCBhcmNoID09PSAnd2ViLmJyb3dzZXInXHJcbmZ1bmN0aW9uIGdldEJvaWxlcnBsYXRlKHJlcXVlc3QsIGFyY2gpIHtcclxuICByZXR1cm4gZ2V0Qm9pbGVycGxhdGVBc3luYyhyZXF1ZXN0LCBhcmNoKS5hd2FpdCgpO1xyXG59XHJcblxyXG5mdW5jdGlvbiBnZXRCb2lsZXJwbGF0ZUFzeW5jKHJlcXVlc3QsIGFyY2gpIHtcclxuICBjb25zdCBib2lsZXJwbGF0ZSA9IGJvaWxlcnBsYXRlQnlBcmNoW2FyY2hdO1xyXG4gIGNvbnN0IGRhdGEgPSBPYmplY3QuYXNzaWduKHt9LCBib2lsZXJwbGF0ZS5iYXNlRGF0YSwge1xyXG4gICAgaHRtbEF0dHJpYnV0ZXM6IGdldEh0bWxBdHRyaWJ1dGVzKHJlcXVlc3QpLFxyXG4gIH0sIF8ucGljayhyZXF1ZXN0LCBcImR5bmFtaWNIZWFkXCIsIFwiZHluYW1pY0JvZHlcIikpO1xyXG5cclxuICBsZXQgbWFkZUNoYW5nZXMgPSBmYWxzZTtcclxuICBsZXQgcHJvbWlzZSA9IFByb21pc2UucmVzb2x2ZSgpO1xyXG5cclxuICBPYmplY3Qua2V5cyhib2lsZXJwbGF0ZURhdGFDYWxsYmFja3MpLmZvckVhY2goa2V5ID0+IHtcclxuICAgIHByb21pc2UgPSBwcm9taXNlLnRoZW4oKCkgPT4ge1xyXG4gICAgICBjb25zdCBjYWxsYmFjayA9IGJvaWxlcnBsYXRlRGF0YUNhbGxiYWNrc1trZXldO1xyXG4gICAgICByZXR1cm4gY2FsbGJhY2socmVxdWVzdCwgZGF0YSwgYXJjaCk7XHJcbiAgICB9KS50aGVuKHJlc3VsdCA9PiB7XHJcbiAgICAgIC8vIENhbGxiYWNrcyBzaG91bGQgcmV0dXJuIGZhbHNlIGlmIHRoZXkgZGlkIG5vdCBtYWtlIGFueSBjaGFuZ2VzLlxyXG4gICAgICBpZiAocmVzdWx0ICE9PSBmYWxzZSkge1xyXG4gICAgICAgIG1hZGVDaGFuZ2VzID0gdHJ1ZTtcclxuICAgICAgfVxyXG4gICAgfSk7XHJcbiAgfSk7XHJcblxyXG4gIHJldHVybiBwcm9taXNlLnRoZW4oKCkgPT4gKHtcclxuICAgIHN0cmVhbTogYm9pbGVycGxhdGUudG9IVE1MU3RyZWFtKGRhdGEpLFxyXG4gICAgc3RhdHVzQ29kZTogZGF0YS5zdGF0dXNDb2RlLFxyXG4gICAgaGVhZGVyczogZGF0YS5oZWFkZXJzLFxyXG4gIH0pKTtcclxufVxyXG5cclxuV2ViQXBwSW50ZXJuYWxzLmdlbmVyYXRlQm9pbGVycGxhdGVJbnN0YW5jZSA9IGZ1bmN0aW9uIChhcmNoLFxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIG1hbmlmZXN0LFxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGFkZGl0aW9uYWxPcHRpb25zKSB7XHJcbiAgYWRkaXRpb25hbE9wdGlvbnMgPSBhZGRpdGlvbmFsT3B0aW9ucyB8fCB7fTtcclxuXHJcbiAgY29uc3QgbWV0ZW9yUnVudGltZUNvbmZpZyA9IEpTT04uc3RyaW5naWZ5KFxyXG4gICAgZW5jb2RlVVJJQ29tcG9uZW50KEpTT04uc3RyaW5naWZ5KHtcclxuICAgICAgLi4uX19tZXRlb3JfcnVudGltZV9jb25maWdfXyxcclxuICAgICAgLi4uKGFkZGl0aW9uYWxPcHRpb25zLnJ1bnRpbWVDb25maWdPdmVycmlkZXMgfHwge30pXHJcbiAgICB9KSlcclxuICApO1xyXG5cclxuICByZXR1cm4gbmV3IEJvaWxlcnBsYXRlKGFyY2gsIG1hbmlmZXN0LCBfLmV4dGVuZCh7XHJcbiAgICBwYXRoTWFwcGVyKGl0ZW1QYXRoKSB7XHJcbiAgICAgIHJldHVybiBwYXRoSm9pbihhcmNoUGF0aFthcmNoXSwgaXRlbVBhdGgpO1xyXG4gICAgfSxcclxuICAgIGJhc2VEYXRhRXh0ZW5zaW9uOiB7XHJcbiAgICAgIGFkZGl0aW9uYWxTdGF0aWNKczogXy5tYXAoXHJcbiAgICAgICAgYWRkaXRpb25hbFN0YXRpY0pzIHx8IFtdLFxyXG4gICAgICAgIGZ1bmN0aW9uIChjb250ZW50cywgcGF0aG5hbWUpIHtcclxuICAgICAgICAgIHJldHVybiB7XHJcbiAgICAgICAgICAgIHBhdGhuYW1lOiBwYXRobmFtZSxcclxuICAgICAgICAgICAgY29udGVudHM6IGNvbnRlbnRzXHJcbiAgICAgICAgICB9O1xyXG4gICAgICAgIH1cclxuICAgICAgKSxcclxuICAgICAgLy8gQ29udmVydCB0byBhIEpTT04gc3RyaW5nLCB0aGVuIGdldCByaWQgb2YgbW9zdCB3ZWlyZCBjaGFyYWN0ZXJzLCB0aGVuXHJcbiAgICAgIC8vIHdyYXAgaW4gZG91YmxlIHF1b3Rlcy4gKFRoZSBvdXRlcm1vc3QgSlNPTi5zdHJpbmdpZnkgcmVhbGx5IG91Z2h0IHRvXHJcbiAgICAgIC8vIGp1c3QgYmUgXCJ3cmFwIGluIGRvdWJsZSBxdW90ZXNcIiBidXQgd2UgdXNlIGl0IHRvIGJlIHNhZmUuKSBUaGlzIG1pZ2h0XHJcbiAgICAgIC8vIGVuZCB1cCBpbnNpZGUgYSA8c2NyaXB0PiB0YWcgc28gd2UgbmVlZCB0byBiZSBjYXJlZnVsIHRvIG5vdCBpbmNsdWRlXHJcbiAgICAgIC8vIFwiPC9zY3JpcHQ+XCIsIGJ1dCBub3JtYWwge3tzcGFjZWJhcnN9fSBlc2NhcGluZyBlc2NhcGVzIHRvbyBtdWNoISBTZWVcclxuICAgICAgLy8gaHR0cHM6Ly9naXRodWIuY29tL21ldGVvci9tZXRlb3IvaXNzdWVzLzM3MzBcclxuICAgICAgbWV0ZW9yUnVudGltZUNvbmZpZyxcclxuICAgICAgbWV0ZW9yUnVudGltZUhhc2g6IHNoYTEobWV0ZW9yUnVudGltZUNvbmZpZyksXHJcbiAgICAgIHJvb3RVcmxQYXRoUHJlZml4OiBfX21ldGVvcl9ydW50aW1lX2NvbmZpZ19fLlJPT1RfVVJMX1BBVEhfUFJFRklYIHx8ICcnLFxyXG4gICAgICBidW5kbGVkSnNDc3NVcmxSZXdyaXRlSG9vazogYnVuZGxlZEpzQ3NzVXJsUmV3cml0ZUhvb2ssXHJcbiAgICAgIHNyaU1vZGU6IHNyaU1vZGUsXHJcbiAgICAgIGlubGluZVNjcmlwdHNBbGxvd2VkOiBXZWJBcHBJbnRlcm5hbHMuaW5saW5lU2NyaXB0c0FsbG93ZWQoKSxcclxuICAgICAgaW5saW5lOiBhZGRpdGlvbmFsT3B0aW9ucy5pbmxpbmVcclxuICAgIH1cclxuICB9LCBhZGRpdGlvbmFsT3B0aW9ucykpO1xyXG59O1xyXG5cclxuLy8gQSBtYXBwaW5nIGZyb20gdXJsIHBhdGggdG8gYXJjaGl0ZWN0dXJlIChlLmcuIFwid2ViLmJyb3dzZXJcIikgdG8gc3RhdGljXHJcbi8vIGZpbGUgaW5mb3JtYXRpb24gd2l0aCB0aGUgZm9sbG93aW5nIGZpZWxkczpcclxuLy8gLSB0eXBlOiB0aGUgdHlwZSBvZiBmaWxlIHRvIGJlIHNlcnZlZFxyXG4vLyAtIGNhY2hlYWJsZTogb3B0aW9uYWxseSwgd2hldGhlciB0aGUgZmlsZSBzaG91bGQgYmUgY2FjaGVkIG9yIG5vdFxyXG4vLyAtIHNvdXJjZU1hcFVybDogb3B0aW9uYWxseSwgdGhlIHVybCBvZiB0aGUgc291cmNlIG1hcFxyXG4vL1xyXG4vLyBJbmZvIGFsc28gY29udGFpbnMgb25lIG9mIHRoZSBmb2xsb3dpbmc6XHJcbi8vIC0gY29udGVudDogdGhlIHN0cmluZ2lmaWVkIGNvbnRlbnQgdGhhdCBzaG91bGQgYmUgc2VydmVkIGF0IHRoaXMgcGF0aFxyXG4vLyAtIGFic29sdXRlUGF0aDogdGhlIGFic29sdXRlIHBhdGggb24gZGlzayB0byB0aGUgZmlsZVxyXG5cclxuLy8gU2VydmUgc3RhdGljIGZpbGVzIGZyb20gdGhlIG1hbmlmZXN0IG9yIGFkZGVkIHdpdGhcclxuLy8gYGFkZFN0YXRpY0pzYC4gRXhwb3J0ZWQgZm9yIHRlc3RzLlxyXG5XZWJBcHBJbnRlcm5hbHMuc3RhdGljRmlsZXNNaWRkbGV3YXJlID0gYXN5bmMgZnVuY3Rpb24gKFxyXG4gIHN0YXRpY0ZpbGVzQnlBcmNoLFxyXG4gIHJlcSxcclxuICByZXMsXHJcbiAgbmV4dCxcclxuKSB7XHJcbiAgdmFyIHBhdGhuYW1lID0gcGFyc2VSZXF1ZXN0KHJlcSkucGF0aG5hbWU7XHJcbiAgdHJ5IHtcclxuICAgIHBhdGhuYW1lID0gZGVjb2RlVVJJQ29tcG9uZW50KHBhdGhuYW1lKTtcclxuICB9IGNhdGNoIChlKSB7XHJcbiAgICBuZXh0KCk7XHJcbiAgICByZXR1cm47XHJcbiAgfVxyXG5cclxuICB2YXIgc2VydmVTdGF0aWNKcyA9IGZ1bmN0aW9uIChzKSB7XHJcbiAgICBpZiAocmVxLm1ldGhvZCA9PT0gJ0dFVCcgfHwgcmVxLm1ldGhvZCA9PT0gJ0hFQUQnKSB7XHJcbiAgICAgIHJlcy53cml0ZUhlYWQoMjAwLCB7XHJcbiAgICAgICAgJ0NvbnRlbnQtdHlwZSc6ICdhcHBsaWNhdGlvbi9qYXZhc2NyaXB0OyBjaGFyc2V0PVVURi04JyxcclxuICAgICAgICAnQ29udGVudC1MZW5ndGgnOiBCdWZmZXIuYnl0ZUxlbmd0aChzKSxcclxuICAgICAgfSk7XHJcbiAgICAgIHJlcy53cml0ZShzKTtcclxuICAgICAgcmVzLmVuZCgpO1xyXG4gICAgfSBlbHNlIHtcclxuICAgICAgY29uc3Qgc3RhdHVzID0gcmVxLm1ldGhvZCA9PT0gJ09QVElPTlMnID8gMjAwIDogNDA1O1xyXG4gICAgICByZXMud3JpdGVIZWFkKHN0YXR1cywge1xyXG4gICAgICAgICdBbGxvdyc6ICdPUFRJT05TLCBHRVQsIEhFQUQnLFxyXG4gICAgICAgICdDb250ZW50LUxlbmd0aCc6ICcwJyxcclxuICAgICAgfSk7XHJcbiAgICAgIHJlcy5lbmQoKTtcclxuICAgIH1cclxuICB9O1xyXG5cclxuICBpZiAoXy5oYXMoYWRkaXRpb25hbFN0YXRpY0pzLCBwYXRobmFtZSkgJiZcclxuICAgICAgICAgICAgICAhIFdlYkFwcEludGVybmFscy5pbmxpbmVTY3JpcHRzQWxsb3dlZCgpKSB7XHJcbiAgICBzZXJ2ZVN0YXRpY0pzKGFkZGl0aW9uYWxTdGF0aWNKc1twYXRobmFtZV0pO1xyXG4gICAgcmV0dXJuO1xyXG4gIH1cclxuXHJcbiAgY29uc3QgeyBhcmNoLCBwYXRoIH0gPSBXZWJBcHAuY2F0ZWdvcml6ZVJlcXVlc3QocmVxKTtcclxuXHJcbiAgaWYgKCEgaGFzT3duLmNhbGwoV2ViQXBwLmNsaWVudFByb2dyYW1zLCBhcmNoKSkge1xyXG4gICAgLy8gV2UgY291bGQgY29tZSBoZXJlIGluIGNhc2Ugd2UgcnVuIHdpdGggc29tZSBhcmNoaXRlY3R1cmVzIGV4Y2x1ZGVkXHJcbiAgICBuZXh0KCk7XHJcbiAgICByZXR1cm47XHJcbiAgfVxyXG5cclxuICAvLyBJZiBwYXVzZUNsaWVudChhcmNoKSBoYXMgYmVlbiBjYWxsZWQsIHByb2dyYW0ucGF1c2VkIHdpbGwgYmUgYVxyXG4gIC8vIFByb21pc2UgdGhhdCB3aWxsIGJlIHJlc29sdmVkIHdoZW4gdGhlIHByb2dyYW0gaXMgdW5wYXVzZWQuXHJcbiAgY29uc3QgcHJvZ3JhbSA9IFdlYkFwcC5jbGllbnRQcm9ncmFtc1thcmNoXTtcclxuICBhd2FpdCBwcm9ncmFtLnBhdXNlZDtcclxuXHJcbiAgaWYgKHBhdGggPT09IFwiL21ldGVvcl9ydW50aW1lX2NvbmZpZy5qc1wiICYmXHJcbiAgICAgICEgV2ViQXBwSW50ZXJuYWxzLmlubGluZVNjcmlwdHNBbGxvd2VkKCkpIHtcclxuICAgIHNlcnZlU3RhdGljSnMoYF9fbWV0ZW9yX3J1bnRpbWVfY29uZmlnX18gPSAke3Byb2dyYW0ubWV0ZW9yUnVudGltZUNvbmZpZ307YCk7XHJcbiAgICByZXR1cm47XHJcbiAgfVxyXG5cclxuICBjb25zdCBpbmZvID0gZ2V0U3RhdGljRmlsZUluZm8oc3RhdGljRmlsZXNCeUFyY2gsIHBhdGhuYW1lLCBwYXRoLCBhcmNoKTtcclxuICBpZiAoISBpbmZvKSB7XHJcbiAgICBuZXh0KCk7XHJcbiAgICByZXR1cm47XHJcbiAgfVxyXG4gIC8vIFwic2VuZFwiIHdpbGwgaGFuZGxlIEhFQUQgJiBHRVQgcmVxdWVzdHNcclxuICBpZiAocmVxLm1ldGhvZCAhPT0gJ0hFQUQnICYmIHJlcS5tZXRob2QgIT09ICdHRVQnKSB7XHJcbiAgICBjb25zdCBzdGF0dXMgPSByZXEubWV0aG9kID09PSAnT1BUSU9OUycgPyAyMDAgOiA0MDU7XHJcbiAgICByZXMud3JpdGVIZWFkKHN0YXR1cywge1xyXG4gICAgICAnQWxsb3cnOiAnT1BUSU9OUywgR0VULCBIRUFEJyxcclxuICAgICAgJ0NvbnRlbnQtTGVuZ3RoJzogJzAnLFxyXG4gICAgfSlcclxuICAgIHJlcy5lbmQoKTtcclxuICAgIHJldHVybjtcclxuICB9XHJcblxyXG4gIC8vIFdlIGRvbid0IG5lZWQgdG8gY2FsbCBwYXVzZSBiZWNhdXNlLCB1bmxpa2UgJ3N0YXRpYycsIG9uY2Ugd2UgY2FsbCBpbnRvXHJcbiAgLy8gJ3NlbmQnIGFuZCB5aWVsZCB0byB0aGUgZXZlbnQgbG9vcCwgd2UgbmV2ZXIgY2FsbCBhbm90aGVyIGhhbmRsZXIgd2l0aFxyXG4gIC8vICduZXh0Jy5cclxuXHJcbiAgLy8gQ2FjaGVhYmxlIGZpbGVzIGFyZSBmaWxlcyB0aGF0IHNob3VsZCBuZXZlciBjaGFuZ2UuIFR5cGljYWxseVxyXG4gIC8vIG5hbWVkIGJ5IHRoZWlyIGhhc2ggKGVnIG1ldGVvciBidW5kbGVkIGpzIGFuZCBjc3MgZmlsZXMpLlxyXG4gIC8vIFdlIGNhY2hlIHRoZW0gfmZvcmV2ZXIgKDF5cikuXHJcbiAgY29uc3QgbWF4QWdlID0gaW5mby5jYWNoZWFibGVcclxuICAgID8gMTAwMCAqIDYwICogNjAgKiAyNCAqIDM2NVxyXG4gICAgOiAwO1xyXG5cclxuICBpZiAoaW5mby5jYWNoZWFibGUpIHtcclxuICAgIC8vIFNpbmNlIHdlIHVzZSByZXEuaGVhZGVyc1tcInVzZXItYWdlbnRcIl0gdG8gZGV0ZXJtaW5lIHdoZXRoZXIgdGhlXHJcbiAgICAvLyBjbGllbnQgc2hvdWxkIHJlY2VpdmUgbW9kZXJuIG9yIGxlZ2FjeSByZXNvdXJjZXMsIHRlbGwgdGhlIGNsaWVudFxyXG4gICAgLy8gdG8gaW52YWxpZGF0ZSBjYWNoZWQgcmVzb3VyY2VzIHdoZW4vaWYgaXRzIHVzZXIgYWdlbnQgc3RyaW5nXHJcbiAgICAvLyBjaGFuZ2VzIGluIHRoZSBmdXR1cmUuXHJcbiAgICByZXMuc2V0SGVhZGVyKFwiVmFyeVwiLCBcIlVzZXItQWdlbnRcIik7XHJcbiAgfVxyXG5cclxuICAvLyBTZXQgdGhlIFgtU291cmNlTWFwIGhlYWRlciwgd2hpY2ggY3VycmVudCBDaHJvbWUsIEZpcmVGb3gsIGFuZCBTYWZhcmlcclxuICAvLyB1bmRlcnN0YW5kLiAgKFRoZSBTb3VyY2VNYXAgaGVhZGVyIGlzIHNsaWdodGx5IG1vcmUgc3BlYy1jb3JyZWN0IGJ1dCBGRlxyXG4gIC8vIGRvZXNuJ3QgdW5kZXJzdGFuZCBpdC4pXHJcbiAgLy9cclxuICAvLyBZb3UgbWF5IGFsc28gbmVlZCB0byBlbmFibGUgc291cmNlIG1hcHMgaW4gQ2hyb21lOiBvcGVuIGRldiB0b29scywgY2xpY2tcclxuICAvLyB0aGUgZ2VhciBpbiB0aGUgYm90dG9tIHJpZ2h0IGNvcm5lciwgYW5kIHNlbGVjdCBcImVuYWJsZSBzb3VyY2UgbWFwc1wiLlxyXG4gIGlmIChpbmZvLnNvdXJjZU1hcFVybCkge1xyXG4gICAgcmVzLnNldEhlYWRlcignWC1Tb3VyY2VNYXAnLFxyXG4gICAgICAgICAgICAgICAgICBfX21ldGVvcl9ydW50aW1lX2NvbmZpZ19fLlJPT1RfVVJMX1BBVEhfUFJFRklYICtcclxuICAgICAgICAgICAgICAgICAgaW5mby5zb3VyY2VNYXBVcmwpO1xyXG4gIH1cclxuXHJcbiAgaWYgKGluZm8udHlwZSA9PT0gXCJqc1wiIHx8XHJcbiAgICAgIGluZm8udHlwZSA9PT0gXCJkeW5hbWljIGpzXCIpIHtcclxuICAgIHJlcy5zZXRIZWFkZXIoXCJDb250ZW50LVR5cGVcIiwgXCJhcHBsaWNhdGlvbi9qYXZhc2NyaXB0OyBjaGFyc2V0PVVURi04XCIpO1xyXG4gIH0gZWxzZSBpZiAoaW5mby50eXBlID09PSBcImNzc1wiKSB7XHJcbiAgICByZXMuc2V0SGVhZGVyKFwiQ29udGVudC1UeXBlXCIsIFwidGV4dC9jc3M7IGNoYXJzZXQ9VVRGLThcIik7XHJcbiAgfSBlbHNlIGlmIChpbmZvLnR5cGUgPT09IFwianNvblwiKSB7XHJcbiAgICByZXMuc2V0SGVhZGVyKFwiQ29udGVudC1UeXBlXCIsIFwiYXBwbGljYXRpb24vanNvbjsgY2hhcnNldD1VVEYtOFwiKTtcclxuICB9XHJcblxyXG4gIGlmIChpbmZvLmhhc2gpIHtcclxuICAgIHJlcy5zZXRIZWFkZXIoJ0VUYWcnLCAnXCInICsgaW5mby5oYXNoICsgJ1wiJyk7XHJcbiAgfVxyXG5cclxuICBpZiAoaW5mby5jb250ZW50KSB7XHJcbiAgICByZXMuc2V0SGVhZGVyKCdDb250ZW50LUxlbmd0aCcsIEJ1ZmZlci5ieXRlTGVuZ3RoKGluZm8uY29udGVudCkpO1xyXG4gICAgcmVzLndyaXRlKGluZm8uY29udGVudCk7XHJcbiAgICByZXMuZW5kKCk7XHJcbiAgfSBlbHNlIHtcclxuICAgIHNlbmQocmVxLCBpbmZvLmFic29sdXRlUGF0aCwge1xyXG4gICAgICBtYXhhZ2U6IG1heEFnZSxcclxuICAgICAgZG90ZmlsZXM6ICdhbGxvdycsIC8vIGlmIHdlIHNwZWNpZmllZCBhIGRvdGZpbGUgaW4gdGhlIG1hbmlmZXN0LCBzZXJ2ZSBpdFxyXG4gICAgICBsYXN0TW9kaWZpZWQ6IGZhbHNlIC8vIGRvbid0IHNldCBsYXN0LW1vZGlmaWVkIGJhc2VkIG9uIHRoZSBmaWxlIGRhdGVcclxuICAgIH0pLm9uKCdlcnJvcicsIGZ1bmN0aW9uIChlcnIpIHtcclxuICAgICAgTG9nLmVycm9yKFwiRXJyb3Igc2VydmluZyBzdGF0aWMgZmlsZSBcIiArIGVycik7XHJcbiAgICAgIHJlcy53cml0ZUhlYWQoNTAwKTtcclxuICAgICAgcmVzLmVuZCgpO1xyXG4gICAgfSkub24oJ2RpcmVjdG9yeScsIGZ1bmN0aW9uICgpIHtcclxuICAgICAgTG9nLmVycm9yKFwiVW5leHBlY3RlZCBkaXJlY3RvcnkgXCIgKyBpbmZvLmFic29sdXRlUGF0aCk7XHJcbiAgICAgIHJlcy53cml0ZUhlYWQoNTAwKTtcclxuICAgICAgcmVzLmVuZCgpO1xyXG4gICAgfSkucGlwZShyZXMpO1xyXG4gIH1cclxufTtcclxuXHJcbmZ1bmN0aW9uIGdldFN0YXRpY0ZpbGVJbmZvKHN0YXRpY0ZpbGVzQnlBcmNoLCBvcmlnaW5hbFBhdGgsIHBhdGgsIGFyY2gpIHtcclxuICBpZiAoISBoYXNPd24uY2FsbChXZWJBcHAuY2xpZW50UHJvZ3JhbXMsIGFyY2gpKSB7XHJcbiAgICByZXR1cm4gbnVsbDtcclxuICB9XHJcblxyXG4gIC8vIEdldCBhIGxpc3Qgb2YgYWxsIGF2YWlsYWJsZSBzdGF0aWMgZmlsZSBhcmNoaXRlY3R1cmVzLCB3aXRoIGFyY2hcclxuICAvLyBmaXJzdCBpbiB0aGUgbGlzdCBpZiBpdCBleGlzdHMuXHJcbiAgY29uc3Qgc3RhdGljQXJjaExpc3QgPSBPYmplY3Qua2V5cyhzdGF0aWNGaWxlc0J5QXJjaCk7XHJcbiAgY29uc3QgYXJjaEluZGV4ID0gc3RhdGljQXJjaExpc3QuaW5kZXhPZihhcmNoKTtcclxuICBpZiAoYXJjaEluZGV4ID4gMCkge1xyXG4gICAgc3RhdGljQXJjaExpc3QudW5zaGlmdChzdGF0aWNBcmNoTGlzdC5zcGxpY2UoYXJjaEluZGV4LCAxKVswXSk7XHJcbiAgfVxyXG5cclxuICBsZXQgaW5mbyA9IG51bGw7XHJcblxyXG4gIHN0YXRpY0FyY2hMaXN0LnNvbWUoYXJjaCA9PiB7XHJcbiAgICBjb25zdCBzdGF0aWNGaWxlcyA9IHN0YXRpY0ZpbGVzQnlBcmNoW2FyY2hdO1xyXG5cclxuICAgIGZ1bmN0aW9uIGZpbmFsaXplKHBhdGgpIHtcclxuICAgICAgaW5mbyA9IHN0YXRpY0ZpbGVzW3BhdGhdO1xyXG4gICAgICAvLyBTb21ldGltZXMgd2UgcmVnaXN0ZXIgYSBsYXp5IGZ1bmN0aW9uIGluc3RlYWQgb2YgYWN0dWFsIGRhdGEgaW5cclxuICAgICAgLy8gdGhlIHN0YXRpY0ZpbGVzIG1hbmlmZXN0LlxyXG4gICAgICBpZiAodHlwZW9mIGluZm8gPT09IFwiZnVuY3Rpb25cIikge1xyXG4gICAgICAgIGluZm8gPSBzdGF0aWNGaWxlc1twYXRoXSA9IGluZm8oKTtcclxuICAgICAgfVxyXG4gICAgICByZXR1cm4gaW5mbztcclxuICAgIH1cclxuXHJcbiAgICAvLyBJZiBzdGF0aWNGaWxlcyBjb250YWlucyBvcmlnaW5hbFBhdGggd2l0aCB0aGUgYXJjaCBpbmZlcnJlZCBhYm92ZSxcclxuICAgIC8vIHVzZSB0aGF0IGluZm9ybWF0aW9uLlxyXG4gICAgaWYgKGhhc093bi5jYWxsKHN0YXRpY0ZpbGVzLCBvcmlnaW5hbFBhdGgpKSB7XHJcbiAgICAgIHJldHVybiBmaW5hbGl6ZShvcmlnaW5hbFBhdGgpO1xyXG4gICAgfVxyXG5cclxuICAgIC8vIElmIGNhdGVnb3JpemVSZXF1ZXN0IHJldHVybmVkIGFuIGFsdGVybmF0ZSBwYXRoLCB0cnkgdGhhdCBpbnN0ZWFkLlxyXG4gICAgaWYgKHBhdGggIT09IG9yaWdpbmFsUGF0aCAmJlxyXG4gICAgICAgIGhhc093bi5jYWxsKHN0YXRpY0ZpbGVzLCBwYXRoKSkge1xyXG4gICAgICByZXR1cm4gZmluYWxpemUocGF0aCk7XHJcbiAgICB9XHJcbiAgfSk7XHJcblxyXG4gIHJldHVybiBpbmZvO1xyXG59XHJcblxyXG4vLyBQYXJzZSB0aGUgcGFzc2VkIGluIHBvcnQgdmFsdWUuIFJldHVybiB0aGUgcG9ydCBhcy1pcyBpZiBpdCdzIGEgU3RyaW5nXHJcbi8vIChlLmcuIGEgV2luZG93cyBTZXJ2ZXIgc3R5bGUgbmFtZWQgcGlwZSksIG90aGVyd2lzZSByZXR1cm4gdGhlIHBvcnQgYXMgYW5cclxuLy8gaW50ZWdlci5cclxuLy9cclxuLy8gREVQUkVDQVRFRDogRGlyZWN0IHVzZSBvZiB0aGlzIGZ1bmN0aW9uIGlzIG5vdCByZWNvbW1lbmRlZDsgaXQgaXMgbm9cclxuLy8gbG9uZ2VyIHVzZWQgaW50ZXJuYWxseSwgYW5kIHdpbGwgYmUgcmVtb3ZlZCBpbiBhIGZ1dHVyZSByZWxlYXNlLlxyXG5XZWJBcHBJbnRlcm5hbHMucGFyc2VQb3J0ID0gcG9ydCA9PiB7XHJcbiAgbGV0IHBhcnNlZFBvcnQgPSBwYXJzZUludChwb3J0KTtcclxuICBpZiAoTnVtYmVyLmlzTmFOKHBhcnNlZFBvcnQpKSB7XHJcbiAgICBwYXJzZWRQb3J0ID0gcG9ydDtcclxuICB9XHJcbiAgcmV0dXJuIHBhcnNlZFBvcnQ7XHJcbn1cclxuXHJcbmltcG9ydCB7IG9uTWVzc2FnZSB9IGZyb20gXCJtZXRlb3IvaW50ZXItcHJvY2Vzcy1tZXNzYWdpbmdcIjtcclxuXHJcbm9uTWVzc2FnZShcIndlYmFwcC1wYXVzZS1jbGllbnRcIiwgYXN5bmMgKHsgYXJjaCB9KSA9PiB7XHJcbiAgV2ViQXBwSW50ZXJuYWxzLnBhdXNlQ2xpZW50KGFyY2gpO1xyXG59KTtcclxuXHJcbm9uTWVzc2FnZShcIndlYmFwcC1yZWxvYWQtY2xpZW50XCIsIGFzeW5jICh7IGFyY2ggfSkgPT4ge1xyXG4gIFdlYkFwcEludGVybmFscy5nZW5lcmF0ZUNsaWVudFByb2dyYW0oYXJjaCk7XHJcbn0pO1xyXG5cclxuZnVuY3Rpb24gcnVuV2ViQXBwU2VydmVyKCkge1xyXG4gIHZhciBzaHV0dGluZ0Rvd24gPSBmYWxzZTtcclxuICB2YXIgc3luY1F1ZXVlID0gbmV3IE1ldGVvci5fU3luY2hyb25vdXNRdWV1ZSgpO1xyXG5cclxuICB2YXIgZ2V0SXRlbVBhdGhuYW1lID0gZnVuY3Rpb24gKGl0ZW1VcmwpIHtcclxuICAgIHJldHVybiBkZWNvZGVVUklDb21wb25lbnQocGFyc2VVcmwoaXRlbVVybCkucGF0aG5hbWUpO1xyXG4gIH07XHJcblxyXG4gIFdlYkFwcEludGVybmFscy5yZWxvYWRDbGllbnRQcm9ncmFtcyA9IGZ1bmN0aW9uICgpIHtcclxuICAgIHN5bmNRdWV1ZS5ydW5UYXNrKGZ1bmN0aW9uKCkge1xyXG4gICAgICBjb25zdCBzdGF0aWNGaWxlc0J5QXJjaCA9IE9iamVjdC5jcmVhdGUobnVsbCk7XHJcblxyXG4gICAgICBjb25zdCB7IGNvbmZpZ0pzb24gfSA9IF9fbWV0ZW9yX2Jvb3RzdHJhcF9fO1xyXG4gICAgICBjb25zdCBjbGllbnRBcmNocyA9IGNvbmZpZ0pzb24uY2xpZW50QXJjaHMgfHxcclxuICAgICAgICBPYmplY3Qua2V5cyhjb25maWdKc29uLmNsaWVudFBhdGhzKTtcclxuXHJcbiAgICAgIHRyeSB7XHJcbiAgICAgICAgY2xpZW50QXJjaHMuZm9yRWFjaChhcmNoID0+IHtcclxuICAgICAgICAgIGdlbmVyYXRlQ2xpZW50UHJvZ3JhbShhcmNoLCBzdGF0aWNGaWxlc0J5QXJjaCk7XHJcbiAgICAgICAgfSk7XHJcbiAgICAgICAgV2ViQXBwSW50ZXJuYWxzLnN0YXRpY0ZpbGVzQnlBcmNoID0gc3RhdGljRmlsZXNCeUFyY2g7XHJcbiAgICAgIH0gY2F0Y2ggKGUpIHtcclxuICAgICAgICBMb2cuZXJyb3IoXCJFcnJvciByZWxvYWRpbmcgdGhlIGNsaWVudCBwcm9ncmFtOiBcIiArIGUuc3RhY2spO1xyXG4gICAgICAgIHByb2Nlc3MuZXhpdCgxKTtcclxuICAgICAgfVxyXG4gICAgfSk7XHJcbiAgfTtcclxuXHJcbiAgLy8gUGF1c2UgYW55IGluY29taW5nIHJlcXVlc3RzIGFuZCBtYWtlIHRoZW0gd2FpdCBmb3IgdGhlIHByb2dyYW0gdG8gYmVcclxuICAvLyB1bnBhdXNlZCB0aGUgbmV4dCB0aW1lIGdlbmVyYXRlQ2xpZW50UHJvZ3JhbShhcmNoKSBpcyBjYWxsZWQuXHJcbiAgV2ViQXBwSW50ZXJuYWxzLnBhdXNlQ2xpZW50ID0gZnVuY3Rpb24gKGFyY2gpIHtcclxuICAgIHN5bmNRdWV1ZS5ydW5UYXNrKCgpID0+IHtcclxuICAgICAgY29uc3QgcHJvZ3JhbSA9IFdlYkFwcC5jbGllbnRQcm9ncmFtc1thcmNoXTtcclxuICAgICAgY29uc3QgeyB1bnBhdXNlIH0gPSBwcm9ncmFtO1xyXG4gICAgICBwcm9ncmFtLnBhdXNlZCA9IG5ldyBQcm9taXNlKHJlc29sdmUgPT4ge1xyXG4gICAgICAgIGlmICh0eXBlb2YgdW5wYXVzZSA9PT0gXCJmdW5jdGlvblwiKSB7XHJcbiAgICAgICAgICAvLyBJZiB0aGVyZSBoYXBwZW5zIHRvIGJlIGFuIGV4aXN0aW5nIHByb2dyYW0udW5wYXVzZSBmdW5jdGlvbixcclxuICAgICAgICAgIC8vIGNvbXBvc2UgaXQgd2l0aCB0aGUgcmVzb2x2ZSBmdW5jdGlvbi5cclxuICAgICAgICAgIHByb2dyYW0udW5wYXVzZSA9IGZ1bmN0aW9uICgpIHtcclxuICAgICAgICAgICAgdW5wYXVzZSgpO1xyXG4gICAgICAgICAgICByZXNvbHZlKCk7XHJcbiAgICAgICAgICB9O1xyXG4gICAgICAgIH0gZWxzZSB7XHJcbiAgICAgICAgICBwcm9ncmFtLnVucGF1c2UgPSByZXNvbHZlO1xyXG4gICAgICAgIH1cclxuICAgICAgfSk7XHJcbiAgICB9KTtcclxuICB9O1xyXG5cclxuICBXZWJBcHBJbnRlcm5hbHMuZ2VuZXJhdGVDbGllbnRQcm9ncmFtID0gZnVuY3Rpb24gKGFyY2gpIHtcclxuICAgIHN5bmNRdWV1ZS5ydW5UYXNrKCgpID0+IGdlbmVyYXRlQ2xpZW50UHJvZ3JhbShhcmNoKSk7XHJcbiAgfTtcclxuXHJcbiAgZnVuY3Rpb24gZ2VuZXJhdGVDbGllbnRQcm9ncmFtKFxyXG4gICAgYXJjaCxcclxuICAgIHN0YXRpY0ZpbGVzQnlBcmNoID0gV2ViQXBwSW50ZXJuYWxzLnN0YXRpY0ZpbGVzQnlBcmNoLFxyXG4gICkge1xyXG4gICAgY29uc3QgY2xpZW50RGlyID0gcGF0aEpvaW4oXHJcbiAgICAgIHBhdGhEaXJuYW1lKF9fbWV0ZW9yX2Jvb3RzdHJhcF9fLnNlcnZlckRpciksXHJcbiAgICAgIGFyY2gsXHJcbiAgICApO1xyXG5cclxuICAgIC8vIHJlYWQgdGhlIGNvbnRyb2wgZm9yIHRoZSBjbGllbnQgd2UnbGwgYmUgc2VydmluZyB1cFxyXG4gICAgY29uc3QgcHJvZ3JhbUpzb25QYXRoID0gcGF0aEpvaW4oY2xpZW50RGlyLCBcInByb2dyYW0uanNvblwiKTtcclxuXHJcbiAgICBsZXQgcHJvZ3JhbUpzb247XHJcbiAgICB0cnkge1xyXG4gICAgICBwcm9ncmFtSnNvbiA9IEpTT04ucGFyc2UocmVhZEZpbGVTeW5jKHByb2dyYW1Kc29uUGF0aCkpO1xyXG4gICAgfSBjYXRjaCAoZSkge1xyXG4gICAgICBpZiAoZS5jb2RlID09PSBcIkVOT0VOVFwiKSByZXR1cm47XHJcbiAgICAgIHRocm93IGU7XHJcbiAgICB9XHJcblxyXG4gICAgaWYgKHByb2dyYW1Kc29uLmZvcm1hdCAhPT0gXCJ3ZWItcHJvZ3JhbS1wcmUxXCIpIHtcclxuICAgICAgdGhyb3cgbmV3IEVycm9yKFwiVW5zdXBwb3J0ZWQgZm9ybWF0IGZvciBjbGllbnQgYXNzZXRzOiBcIiArXHJcbiAgICAgICAgICAgICAgICAgICAgICBKU09OLnN0cmluZ2lmeShwcm9ncmFtSnNvbi5mb3JtYXQpKTtcclxuICAgIH1cclxuXHJcbiAgICBpZiAoISBwcm9ncmFtSnNvblBhdGggfHwgISBjbGllbnREaXIgfHwgISBwcm9ncmFtSnNvbikge1xyXG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXCJDbGllbnQgY29uZmlnIGZpbGUgbm90IHBhcnNlZC5cIik7XHJcbiAgICB9XHJcblxyXG4gICAgYXJjaFBhdGhbYXJjaF0gPSBjbGllbnREaXI7XHJcbiAgICBjb25zdCBzdGF0aWNGaWxlcyA9IHN0YXRpY0ZpbGVzQnlBcmNoW2FyY2hdID0gT2JqZWN0LmNyZWF0ZShudWxsKTtcclxuXHJcbiAgICBjb25zdCB7IG1hbmlmZXN0IH0gPSBwcm9ncmFtSnNvbjtcclxuICAgIG1hbmlmZXN0LmZvckVhY2goaXRlbSA9PiB7XHJcbiAgICAgIGlmIChpdGVtLnVybCAmJiBpdGVtLndoZXJlID09PSBcImNsaWVudFwiKSB7XHJcbiAgICAgICAgc3RhdGljRmlsZXNbZ2V0SXRlbVBhdGhuYW1lKGl0ZW0udXJsKV0gPSB7XHJcbiAgICAgICAgICBhYnNvbHV0ZVBhdGg6IHBhdGhKb2luKGNsaWVudERpciwgaXRlbS5wYXRoKSxcclxuICAgICAgICAgIGNhY2hlYWJsZTogaXRlbS5jYWNoZWFibGUsXHJcbiAgICAgICAgICBoYXNoOiBpdGVtLmhhc2gsXHJcbiAgICAgICAgICAvLyBMaW5rIGZyb20gc291cmNlIHRvIGl0cyBtYXBcclxuICAgICAgICAgIHNvdXJjZU1hcFVybDogaXRlbS5zb3VyY2VNYXBVcmwsXHJcbiAgICAgICAgICB0eXBlOiBpdGVtLnR5cGVcclxuICAgICAgICB9O1xyXG5cclxuICAgICAgICBpZiAoaXRlbS5zb3VyY2VNYXApIHtcclxuICAgICAgICAgIC8vIFNlcnZlIHRoZSBzb3VyY2UgbWFwIHRvbywgdW5kZXIgdGhlIHNwZWNpZmllZCBVUkwuIFdlIGFzc3VtZVxyXG4gICAgICAgICAgLy8gYWxsIHNvdXJjZSBtYXBzIGFyZSBjYWNoZWFibGUuXHJcbiAgICAgICAgICBzdGF0aWNGaWxlc1tnZXRJdGVtUGF0aG5hbWUoaXRlbS5zb3VyY2VNYXBVcmwpXSA9IHtcclxuICAgICAgICAgICAgYWJzb2x1dGVQYXRoOiBwYXRoSm9pbihjbGllbnREaXIsIGl0ZW0uc291cmNlTWFwKSxcclxuICAgICAgICAgICAgY2FjaGVhYmxlOiB0cnVlXHJcbiAgICAgICAgICB9O1xyXG4gICAgICAgIH1cclxuICAgICAgfVxyXG4gICAgfSk7XHJcblxyXG4gICAgY29uc3QgeyBQVUJMSUNfU0VUVElOR1MgfSA9IF9fbWV0ZW9yX3J1bnRpbWVfY29uZmlnX187XHJcbiAgICBjb25zdCBjb25maWdPdmVycmlkZXMgPSB7XHJcbiAgICAgIFBVQkxJQ19TRVRUSU5HUyxcclxuICAgIH07XHJcblxyXG4gICAgY29uc3Qgb2xkUHJvZ3JhbSA9IFdlYkFwcC5jbGllbnRQcm9ncmFtc1thcmNoXTtcclxuICAgIGNvbnN0IG5ld1Byb2dyYW0gPSBXZWJBcHAuY2xpZW50UHJvZ3JhbXNbYXJjaF0gPSB7XHJcbiAgICAgIGZvcm1hdDogXCJ3ZWItcHJvZ3JhbS1wcmUxXCIsXHJcbiAgICAgIG1hbmlmZXN0OiBtYW5pZmVzdCxcclxuICAgICAgLy8gVXNlIGFycm93IGZ1bmN0aW9ucyBzbyB0aGF0IHRoZXNlIHZlcnNpb25zIGNhbiBiZSBsYXppbHlcclxuICAgICAgLy8gY2FsY3VsYXRlZCBsYXRlciwgYW5kIHNvIHRoYXQgdGhleSB3aWxsIG5vdCBiZSBpbmNsdWRlZCBpbiB0aGVcclxuICAgICAgLy8gc3RhdGljRmlsZXNbbWFuaWZlc3RVcmxdLmNvbnRlbnQgc3RyaW5nIGJlbG93LlxyXG4gICAgICAvL1xyXG4gICAgICAvLyBOb3RlOiB0aGVzZSB2ZXJzaW9uIGNhbGN1bGF0aW9ucyBtdXN0IGJlIGtlcHQgaW4gYWdyZWVtZW50IHdpdGhcclxuICAgICAgLy8gQ29yZG92YUJ1aWxkZXIjYXBwZW5kVmVyc2lvbiBpbiB0b29scy9jb3Jkb3ZhL2J1aWxkZXIuanMsIG9yIGhvdFxyXG4gICAgICAvLyBjb2RlIHB1c2ggd2lsbCByZWxvYWQgQ29yZG92YSBhcHBzIHVubmVjZXNzYXJpbHkuXHJcbiAgICAgIHZlcnNpb246ICgpID0+IFdlYkFwcEhhc2hpbmcuY2FsY3VsYXRlQ2xpZW50SGFzaChcclxuICAgICAgICBtYW5pZmVzdCwgbnVsbCwgY29uZmlnT3ZlcnJpZGVzKSxcclxuICAgICAgdmVyc2lvblJlZnJlc2hhYmxlOiAoKSA9PiBXZWJBcHBIYXNoaW5nLmNhbGN1bGF0ZUNsaWVudEhhc2goXHJcbiAgICAgICAgbWFuaWZlc3QsIHR5cGUgPT4gdHlwZSA9PT0gXCJjc3NcIiwgY29uZmlnT3ZlcnJpZGVzKSxcclxuICAgICAgdmVyc2lvbk5vblJlZnJlc2hhYmxlOiAoKSA9PiBXZWJBcHBIYXNoaW5nLmNhbGN1bGF0ZUNsaWVudEhhc2goXHJcbiAgICAgICAgbWFuaWZlc3QsICh0eXBlLCByZXBsYWNlYWJsZSkgPT4gdHlwZSAhPT0gXCJjc3NcIiAmJiAhcmVwbGFjZWFibGUsIGNvbmZpZ092ZXJyaWRlcyksXHJcbiAgICAgIHZlcnNpb25SZXBsYWNlYWJsZTogKCkgPT4gV2ViQXBwSGFzaGluZy5jYWxjdWxhdGVDbGllbnRIYXNoKFxyXG4gICAgICAgIG1hbmlmZXN0LCAoX3R5cGUsIHJlcGxhY2VhYmxlKSA9PiB7XHJcbiAgICAgICAgICBpZiAoTWV0ZW9yLmlzUHJvZHVjdGlvbiAmJiByZXBsYWNlYWJsZSkge1xyXG4gICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoJ1VuZXhwZWN0ZWQgcmVwbGFjZWFibGUgZmlsZSBpbiBwcm9kdWN0aW9uJyk7XHJcbiAgICAgICAgICB9XHJcblxyXG4gICAgICAgICAgcmV0dXJuIHJlcGxhY2VhYmxlXHJcbiAgICAgICAgfSxcclxuICAgICAgICBjb25maWdPdmVycmlkZXNcclxuICAgICAgKSxcclxuICAgICAgY29yZG92YUNvbXBhdGliaWxpdHlWZXJzaW9uczogcHJvZ3JhbUpzb24uY29yZG92YUNvbXBhdGliaWxpdHlWZXJzaW9ucyxcclxuICAgICAgUFVCTElDX1NFVFRJTkdTLFxyXG4gICAgfTtcclxuXHJcbiAgICAvLyBFeHBvc2UgcHJvZ3JhbSBkZXRhaWxzIGFzIGEgc3RyaW5nIHJlYWNoYWJsZSB2aWEgdGhlIGZvbGxvd2luZyBVUkwuXHJcbiAgICBjb25zdCBtYW5pZmVzdFVybFByZWZpeCA9IFwiL19fXCIgKyBhcmNoLnJlcGxhY2UoL153ZWJcXC4vLCBcIlwiKTtcclxuICAgIGNvbnN0IG1hbmlmZXN0VXJsID0gbWFuaWZlc3RVcmxQcmVmaXggKyBnZXRJdGVtUGF0aG5hbWUoXCIvbWFuaWZlc3QuanNvblwiKTtcclxuXHJcbiAgICBzdGF0aWNGaWxlc1ttYW5pZmVzdFVybF0gPSAoKSA9PiB7XHJcbiAgICAgIGlmIChQYWNrYWdlLmF1dG91cGRhdGUpIHtcclxuICAgICAgICBjb25zdCB7XHJcbiAgICAgICAgICBBVVRPVVBEQVRFX1ZFUlNJT04gPVxyXG4gICAgICAgICAgICBQYWNrYWdlLmF1dG91cGRhdGUuQXV0b3VwZGF0ZS5hdXRvdXBkYXRlVmVyc2lvblxyXG4gICAgICAgIH0gPSBwcm9jZXNzLmVudjtcclxuXHJcbiAgICAgICAgaWYgKEFVVE9VUERBVEVfVkVSU0lPTikge1xyXG4gICAgICAgICAgbmV3UHJvZ3JhbS52ZXJzaW9uID0gQVVUT1VQREFURV9WRVJTSU9OO1xyXG4gICAgICAgIH1cclxuICAgICAgfVxyXG5cclxuICAgICAgaWYgKHR5cGVvZiBuZXdQcm9ncmFtLnZlcnNpb24gPT09IFwiZnVuY3Rpb25cIikge1xyXG4gICAgICAgIG5ld1Byb2dyYW0udmVyc2lvbiA9IG5ld1Byb2dyYW0udmVyc2lvbigpO1xyXG4gICAgICB9XHJcblxyXG4gICAgICByZXR1cm4ge1xyXG4gICAgICAgIGNvbnRlbnQ6IEpTT04uc3RyaW5naWZ5KG5ld1Byb2dyYW0pLFxyXG4gICAgICAgIGNhY2hlYWJsZTogZmFsc2UsXHJcbiAgICAgICAgaGFzaDogbmV3UHJvZ3JhbS52ZXJzaW9uLFxyXG4gICAgICAgIHR5cGU6IFwianNvblwiXHJcbiAgICAgIH07XHJcbiAgICB9O1xyXG5cclxuICAgIGdlbmVyYXRlQm9pbGVycGxhdGVGb3JBcmNoKGFyY2gpO1xyXG5cclxuICAgIC8vIElmIHRoZXJlIGFyZSBhbnkgcmVxdWVzdHMgd2FpdGluZyBvbiBvbGRQcm9ncmFtLnBhdXNlZCwgbGV0IHRoZW1cclxuICAgIC8vIGNvbnRpbnVlIG5vdyAodXNpbmcgdGhlIG5ldyBwcm9ncmFtKS5cclxuICAgIGlmIChvbGRQcm9ncmFtICYmXHJcbiAgICAgICAgb2xkUHJvZ3JhbS5wYXVzZWQpIHtcclxuICAgICAgb2xkUHJvZ3JhbS51bnBhdXNlKCk7XHJcbiAgICB9XHJcbiAgfTtcclxuXHJcbiAgY29uc3QgZGVmYXVsdE9wdGlvbnNGb3JBcmNoID0ge1xyXG4gICAgJ3dlYi5jb3Jkb3ZhJzoge1xyXG4gICAgICBydW50aW1lQ29uZmlnT3ZlcnJpZGVzOiB7XHJcbiAgICAgICAgLy8gWFhYIFdlIHVzZSBhYnNvbHV0ZVVybCgpIGhlcmUgc28gdGhhdCB3ZSBzZXJ2ZSBodHRwczovL1xyXG4gICAgICAgIC8vIFVSTHMgdG8gY29yZG92YSBjbGllbnRzIGlmIGZvcmNlLXNzbCBpcyBpbiB1c2UuIElmIHdlIHdlcmVcclxuICAgICAgICAvLyB0byB1c2UgX19tZXRlb3JfcnVudGltZV9jb25maWdfXy5ST09UX1VSTCBpbnN0ZWFkIG9mXHJcbiAgICAgICAgLy8gYWJzb2x1dGVVcmwoKSwgdGhlbiBDb3Jkb3ZhIGNsaWVudHMgd291bGQgaW1tZWRpYXRlbHkgZ2V0IGFcclxuICAgICAgICAvLyBIQ1Agc2V0dGluZyB0aGVpciBERFBfREVGQVVMVF9DT05ORUNUSU9OX1VSTCB0b1xyXG4gICAgICAgIC8vIGh0dHA6Ly9leGFtcGxlLm1ldGVvci5jb20uIFRoaXMgYnJlYWtzIHRoZSBhcHAsIGJlY2F1c2VcclxuICAgICAgICAvLyBmb3JjZS1zc2wgZG9lc24ndCBzZXJ2ZSBDT1JTIGhlYWRlcnMgb24gMzAyXHJcbiAgICAgICAgLy8gcmVkaXJlY3RzLiAoUGx1cyBpdCdzIHVuZGVzaXJhYmxlIHRvIGhhdmUgY2xpZW50c1xyXG4gICAgICAgIC8vIGNvbm5lY3RpbmcgdG8gaHR0cDovL2V4YW1wbGUubWV0ZW9yLmNvbSB3aGVuIGZvcmNlLXNzbCBpc1xyXG4gICAgICAgIC8vIGluIHVzZS4pXHJcbiAgICAgICAgRERQX0RFRkFVTFRfQ09OTkVDVElPTl9VUkw6IHByb2Nlc3MuZW52Lk1PQklMRV9ERFBfVVJMIHx8XHJcbiAgICAgICAgICBNZXRlb3IuYWJzb2x1dGVVcmwoKSxcclxuICAgICAgICBST09UX1VSTDogcHJvY2Vzcy5lbnYuTU9CSUxFX1JPT1RfVVJMIHx8XHJcbiAgICAgICAgICBNZXRlb3IuYWJzb2x1dGVVcmwoKVxyXG4gICAgICB9XHJcbiAgICB9LFxyXG5cclxuICAgIFwid2ViLmJyb3dzZXJcIjoge1xyXG4gICAgICBydW50aW1lQ29uZmlnT3ZlcnJpZGVzOiB7XHJcbiAgICAgICAgaXNNb2Rlcm46IHRydWUsXHJcbiAgICAgIH1cclxuICAgIH0sXHJcblxyXG4gICAgXCJ3ZWIuYnJvd3Nlci5sZWdhY3lcIjoge1xyXG4gICAgICBydW50aW1lQ29uZmlnT3ZlcnJpZGVzOiB7XHJcbiAgICAgICAgaXNNb2Rlcm46IGZhbHNlLFxyXG4gICAgICB9XHJcbiAgICB9LFxyXG4gIH07XHJcblxyXG4gIFdlYkFwcEludGVybmFscy5nZW5lcmF0ZUJvaWxlcnBsYXRlID0gZnVuY3Rpb24gKCkge1xyXG4gICAgLy8gVGhpcyBib2lsZXJwbGF0ZSB3aWxsIGJlIHNlcnZlZCB0byB0aGUgbW9iaWxlIGRldmljZXMgd2hlbiB1c2VkIHdpdGhcclxuICAgIC8vIE1ldGVvci9Db3Jkb3ZhIGZvciB0aGUgSG90LUNvZGUgUHVzaCBhbmQgc2luY2UgdGhlIGZpbGUgd2lsbCBiZSBzZXJ2ZWQgYnlcclxuICAgIC8vIHRoZSBkZXZpY2UncyBzZXJ2ZXIsIGl0IGlzIGltcG9ydGFudCB0byBzZXQgdGhlIEREUCB1cmwgdG8gdGhlIGFjdHVhbFxyXG4gICAgLy8gTWV0ZW9yIHNlcnZlciBhY2NlcHRpbmcgRERQIGNvbm5lY3Rpb25zIGFuZCBub3QgdGhlIGRldmljZSdzIGZpbGUgc2VydmVyLlxyXG4gICAgc3luY1F1ZXVlLnJ1blRhc2soZnVuY3Rpb24oKSB7XHJcbiAgICAgIE9iamVjdC5rZXlzKFdlYkFwcC5jbGllbnRQcm9ncmFtcylcclxuICAgICAgICAuZm9yRWFjaChnZW5lcmF0ZUJvaWxlcnBsYXRlRm9yQXJjaCk7XHJcbiAgICB9KTtcclxuICB9O1xyXG5cclxuICBmdW5jdGlvbiBnZW5lcmF0ZUJvaWxlcnBsYXRlRm9yQXJjaChhcmNoKSB7XHJcbiAgICBjb25zdCBwcm9ncmFtID0gV2ViQXBwLmNsaWVudFByb2dyYW1zW2FyY2hdO1xyXG4gICAgY29uc3QgYWRkaXRpb25hbE9wdGlvbnMgPSBkZWZhdWx0T3B0aW9uc0ZvckFyY2hbYXJjaF0gfHwge307XHJcbiAgICBjb25zdCB7IGJhc2VEYXRhIH0gPSBib2lsZXJwbGF0ZUJ5QXJjaFthcmNoXSA9XHJcbiAgICAgIFdlYkFwcEludGVybmFscy5nZW5lcmF0ZUJvaWxlcnBsYXRlSW5zdGFuY2UoXHJcbiAgICAgICAgYXJjaCxcclxuICAgICAgICBwcm9ncmFtLm1hbmlmZXN0LFxyXG4gICAgICAgIGFkZGl0aW9uYWxPcHRpb25zLFxyXG4gICAgICApO1xyXG4gICAgLy8gV2UgbmVlZCB0aGUgcnVudGltZSBjb25maWcgd2l0aCBvdmVycmlkZXMgZm9yIG1ldGVvcl9ydW50aW1lX2NvbmZpZy5qczpcclxuICAgIHByb2dyYW0ubWV0ZW9yUnVudGltZUNvbmZpZyA9IEpTT04uc3RyaW5naWZ5KHtcclxuICAgICAgLi4uX19tZXRlb3JfcnVudGltZV9jb25maWdfXyxcclxuICAgICAgLi4uKGFkZGl0aW9uYWxPcHRpb25zLnJ1bnRpbWVDb25maWdPdmVycmlkZXMgfHwgbnVsbCksXHJcbiAgICB9KTtcclxuICAgIHByb2dyYW0ucmVmcmVzaGFibGVBc3NldHMgPSBiYXNlRGF0YS5jc3MubWFwKGZpbGUgPT4gKHtcclxuICAgICAgdXJsOiBidW5kbGVkSnNDc3NVcmxSZXdyaXRlSG9vayhmaWxlLnVybCksXHJcbiAgICB9KSk7XHJcbiAgfVxyXG5cclxuICBXZWJBcHBJbnRlcm5hbHMucmVsb2FkQ2xpZW50UHJvZ3JhbXMoKTtcclxuXHJcbiAgLy8gd2Vic2VydmVyXHJcbiAgdmFyIGFwcCA9IGNvbm5lY3QoKTtcclxuXHJcbiAgLy8gUGFja2FnZXMgYW5kIGFwcHMgY2FuIGFkZCBoYW5kbGVycyB0aGF0IHJ1biBiZWZvcmUgYW55IG90aGVyIE1ldGVvclxyXG4gIC8vIGhhbmRsZXJzIHZpYSBXZWJBcHAucmF3Q29ubmVjdEhhbmRsZXJzLlxyXG4gIHZhciByYXdDb25uZWN0SGFuZGxlcnMgPSBjb25uZWN0KCk7XHJcbiAgYXBwLnVzZShyYXdDb25uZWN0SGFuZGxlcnMpO1xyXG5cclxuICAvLyBBdXRvLWNvbXByZXNzIGFueSBqc29uLCBqYXZhc2NyaXB0LCBvciB0ZXh0LlxyXG4gIGFwcC51c2UoY29tcHJlc3Moe2ZpbHRlcjogc2hvdWxkQ29tcHJlc3N9KSk7XHJcblxyXG4gIC8vIHBhcnNlIGNvb2tpZXMgaW50byBhbiBvYmplY3RcclxuICBhcHAudXNlKGNvb2tpZVBhcnNlcigpKTtcclxuXHJcbiAgLy8gV2UncmUgbm90IGEgcHJveHk7IHJlamVjdCAod2l0aG91dCBjcmFzaGluZykgYXR0ZW1wdHMgdG8gdHJlYXQgdXMgbGlrZVxyXG4gIC8vIG9uZS4gKFNlZSAjMTIxMi4pXHJcbiAgYXBwLnVzZShmdW5jdGlvbihyZXEsIHJlcywgbmV4dCkge1xyXG4gICAgaWYgKFJvdXRlUG9saWN5LmlzVmFsaWRVcmwocmVxLnVybCkpIHtcclxuICAgICAgbmV4dCgpO1xyXG4gICAgICByZXR1cm47XHJcbiAgICB9XHJcbiAgICByZXMud3JpdGVIZWFkKDQwMCk7XHJcbiAgICByZXMud3JpdGUoXCJOb3QgYSBwcm94eVwiKTtcclxuICAgIHJlcy5lbmQoKTtcclxuICB9KTtcclxuXHJcbiAgLy8gUGFyc2UgdGhlIHF1ZXJ5IHN0cmluZyBpbnRvIHJlcy5xdWVyeS4gVXNlZCBieSBvYXV0aF9zZXJ2ZXIsIGJ1dCBpdCdzXHJcbiAgLy8gZ2VuZXJhbGx5IHByZXR0eSBoYW5keS4uXHJcbiAgLy9cclxuICAvLyBEbyB0aGlzIGJlZm9yZSB0aGUgbmV4dCBtaWRkbGV3YXJlIGRlc3Ryb3lzIHJlcS51cmwgaWYgYSBwYXRoIHByZWZpeFxyXG4gIC8vIGlzIHNldCB0byBjbG9zZSAjMTAxMTEuXHJcbiAgYXBwLnVzZShmdW5jdGlvbiAocmVxdWVzdCwgcmVzcG9uc2UsIG5leHQpIHtcclxuICAgIHJlcXVlc3QucXVlcnkgPSBxcy5wYXJzZShwYXJzZVVybChyZXF1ZXN0LnVybCkucXVlcnkpO1xyXG4gICAgbmV4dCgpO1xyXG4gIH0pO1xyXG5cclxuICBmdW5jdGlvbiBnZXRQYXRoUGFydHMocGF0aCkge1xyXG4gICAgY29uc3QgcGFydHMgPSBwYXRoLnNwbGl0KFwiL1wiKTtcclxuICAgIHdoaWxlIChwYXJ0c1swXSA9PT0gXCJcIikgcGFydHMuc2hpZnQoKTtcclxuICAgIHJldHVybiBwYXJ0cztcclxuICB9XHJcblxyXG4gIGZ1bmN0aW9uIGlzUHJlZml4T2YocHJlZml4LCBhcnJheSkge1xyXG4gICAgcmV0dXJuIHByZWZpeC5sZW5ndGggPD0gYXJyYXkubGVuZ3RoICYmXHJcbiAgICAgIHByZWZpeC5ldmVyeSgocGFydCwgaSkgPT4gcGFydCA9PT0gYXJyYXlbaV0pO1xyXG4gIH1cclxuXHJcbiAgLy8gU3RyaXAgb2ZmIHRoZSBwYXRoIHByZWZpeCwgaWYgaXQgZXhpc3RzLlxyXG4gIGFwcC51c2UoZnVuY3Rpb24gKHJlcXVlc3QsIHJlc3BvbnNlLCBuZXh0KSB7XHJcbiAgICBjb25zdCBwYXRoUHJlZml4ID0gX19tZXRlb3JfcnVudGltZV9jb25maWdfXy5ST09UX1VSTF9QQVRIX1BSRUZJWDtcclxuICAgIGNvbnN0IHsgcGF0aG5hbWUsIHNlYXJjaCB9ID0gcGFyc2VVcmwocmVxdWVzdC51cmwpO1xyXG5cclxuICAgIC8vIGNoZWNrIGlmIHRoZSBwYXRoIGluIHRoZSB1cmwgc3RhcnRzIHdpdGggdGhlIHBhdGggcHJlZml4XHJcbiAgICBpZiAocGF0aFByZWZpeCkge1xyXG4gICAgICBjb25zdCBwcmVmaXhQYXJ0cyA9IGdldFBhdGhQYXJ0cyhwYXRoUHJlZml4KTtcclxuICAgICAgY29uc3QgcGF0aFBhcnRzID0gZ2V0UGF0aFBhcnRzKHBhdGhuYW1lKTtcclxuICAgICAgaWYgKGlzUHJlZml4T2YocHJlZml4UGFydHMsIHBhdGhQYXJ0cykpIHtcclxuICAgICAgICByZXF1ZXN0LnVybCA9IFwiL1wiICsgcGF0aFBhcnRzLnNsaWNlKHByZWZpeFBhcnRzLmxlbmd0aCkuam9pbihcIi9cIik7XHJcbiAgICAgICAgaWYgKHNlYXJjaCkge1xyXG4gICAgICAgICAgcmVxdWVzdC51cmwgKz0gc2VhcmNoO1xyXG4gICAgICAgIH1cclxuICAgICAgICByZXR1cm4gbmV4dCgpO1xyXG4gICAgICB9XHJcbiAgICB9XHJcblxyXG4gICAgaWYgKHBhdGhuYW1lID09PSBcIi9mYXZpY29uLmljb1wiIHx8XHJcbiAgICAgICAgcGF0aG5hbWUgPT09IFwiL3JvYm90cy50eHRcIikge1xyXG4gICAgICByZXR1cm4gbmV4dCgpO1xyXG4gICAgfVxyXG5cclxuICAgIGlmIChwYXRoUHJlZml4KSB7XHJcbiAgICAgIHJlc3BvbnNlLndyaXRlSGVhZCg0MDQpO1xyXG4gICAgICByZXNwb25zZS53cml0ZShcIlVua25vd24gcGF0aFwiKTtcclxuICAgICAgcmVzcG9uc2UuZW5kKCk7XHJcbiAgICAgIHJldHVybjtcclxuICAgIH1cclxuXHJcbiAgICBuZXh0KCk7XHJcbiAgfSk7XHJcblxyXG4gIC8vIFNlcnZlIHN0YXRpYyBmaWxlcyBmcm9tIHRoZSBtYW5pZmVzdC5cclxuICAvLyBUaGlzIGlzIGluc3BpcmVkIGJ5IHRoZSAnc3RhdGljJyBtaWRkbGV3YXJlLlxyXG4gIGFwcC51c2UoZnVuY3Rpb24gKHJlcSwgcmVzLCBuZXh0KSB7XHJcbiAgICBXZWJBcHBJbnRlcm5hbHMuc3RhdGljRmlsZXNNaWRkbGV3YXJlKFxyXG4gICAgICBXZWJBcHBJbnRlcm5hbHMuc3RhdGljRmlsZXNCeUFyY2gsXHJcbiAgICAgIHJlcSwgcmVzLCBuZXh0XHJcbiAgICApO1xyXG4gIH0pO1xyXG5cclxuICAvLyBDb3JlIE1ldGVvciBwYWNrYWdlcyBsaWtlIGR5bmFtaWMtaW1wb3J0IGNhbiBhZGQgaGFuZGxlcnMgYmVmb3JlXHJcbiAgLy8gb3RoZXIgaGFuZGxlcnMgYWRkZWQgYnkgcGFja2FnZSBhbmQgYXBwbGljYXRpb24gY29kZS5cclxuICBhcHAudXNlKFdlYkFwcEludGVybmFscy5tZXRlb3JJbnRlcm5hbEhhbmRsZXJzID0gY29ubmVjdCgpKTtcclxuXHJcbiAgLy8gUGFja2FnZXMgYW5kIGFwcHMgY2FuIGFkZCBoYW5kbGVycyB0byB0aGlzIHZpYSBXZWJBcHAuY29ubmVjdEhhbmRsZXJzLlxyXG4gIC8vIFRoZXkgYXJlIGluc2VydGVkIGJlZm9yZSBvdXIgZGVmYXVsdCBoYW5kbGVyLlxyXG4gIHZhciBwYWNrYWdlQW5kQXBwSGFuZGxlcnMgPSBjb25uZWN0KCk7XHJcbiAgYXBwLnVzZShwYWNrYWdlQW5kQXBwSGFuZGxlcnMpO1xyXG5cclxuICB2YXIgc3VwcHJlc3NDb25uZWN0RXJyb3JzID0gZmFsc2U7XHJcbiAgLy8gY29ubmVjdCBrbm93cyBpdCBpcyBhbiBlcnJvciBoYW5kbGVyIGJlY2F1c2UgaXQgaGFzIDQgYXJndW1lbnRzIGluc3RlYWQgb2ZcclxuICAvLyAzLiBnbyBmaWd1cmUuICAoSXQgaXMgbm90IHNtYXJ0IGVub3VnaCB0byBmaW5kIHN1Y2ggYSB0aGluZyBpZiBpdCdzIGhpZGRlblxyXG4gIC8vIGluc2lkZSBwYWNrYWdlQW5kQXBwSGFuZGxlcnMuKVxyXG4gIGFwcC51c2UoZnVuY3Rpb24gKGVyciwgcmVxLCByZXMsIG5leHQpIHtcclxuICAgIGlmICghZXJyIHx8ICFzdXBwcmVzc0Nvbm5lY3RFcnJvcnMgfHwgIXJlcS5oZWFkZXJzWyd4LXN1cHByZXNzLWVycm9yJ10pIHtcclxuICAgICAgbmV4dChlcnIpO1xyXG4gICAgICByZXR1cm47XHJcbiAgICB9XHJcbiAgICByZXMud3JpdGVIZWFkKGVyci5zdGF0dXMsIHsgJ0NvbnRlbnQtVHlwZSc6ICd0ZXh0L3BsYWluJyB9KTtcclxuICAgIHJlcy5lbmQoXCJBbiBlcnJvciBtZXNzYWdlXCIpO1xyXG4gIH0pO1xyXG5cclxuICBhcHAudXNlKGFzeW5jIGZ1bmN0aW9uIChyZXEsIHJlcywgbmV4dCkge1xyXG4gICAgaWYgKCEgYXBwVXJsKHJlcS51cmwpKSB7XHJcbiAgICAgIHJldHVybiBuZXh0KCk7XHJcblxyXG4gICAgfSBlbHNlIGlmIChyZXEubWV0aG9kICE9PSAnSEVBRCcgJiYgcmVxLm1ldGhvZCAhPT0gJ0dFVCcpIHtcclxuICAgICAgY29uc3Qgc3RhdHVzID0gcmVxLm1ldGhvZCA9PT0gJ09QVElPTlMnID8gMjAwIDogNDA1O1xyXG4gICAgICByZXMud3JpdGVIZWFkKHN0YXR1cywge1xyXG4gICAgICAgICdBbGxvdyc6ICdPUFRJT05TLCBHRVQsIEhFQUQnLFxyXG4gICAgICAgICdDb250ZW50LUxlbmd0aCc6ICcwJyxcclxuICAgICAgfSlcclxuICAgICAgcmVzLmVuZCgpO1xyXG4gICAgfSBlbHNlIHtcclxuICAgICAgdmFyIGhlYWRlcnMgPSB7XHJcbiAgICAgICAgJ0NvbnRlbnQtVHlwZSc6ICd0ZXh0L2h0bWw7IGNoYXJzZXQ9dXRmLTgnXHJcbiAgICAgIH07XHJcblxyXG4gICAgICBpZiAoc2h1dHRpbmdEb3duKSB7XHJcbiAgICAgICAgaGVhZGVyc1snQ29ubmVjdGlvbiddID0gJ0Nsb3NlJztcclxuICAgICAgfVxyXG5cclxuICAgICAgdmFyIHJlcXVlc3QgPSBXZWJBcHAuY2F0ZWdvcml6ZVJlcXVlc3QocmVxKTtcclxuXHJcbiAgICAgIGlmIChyZXF1ZXN0LnVybC5xdWVyeSAmJiByZXF1ZXN0LnVybC5xdWVyeVsnbWV0ZW9yX2Nzc19yZXNvdXJjZSddKSB7XHJcbiAgICAgICAgLy8gSW4gdGhpcyBjYXNlLCB3ZSdyZSByZXF1ZXN0aW5nIGEgQ1NTIHJlc291cmNlIGluIHRoZSBtZXRlb3Itc3BlY2lmaWNcclxuICAgICAgICAvLyB3YXksIGJ1dCB3ZSBkb24ndCBoYXZlIGl0LiAgU2VydmUgYSBzdGF0aWMgY3NzIGZpbGUgdGhhdCBpbmRpY2F0ZXMgdGhhdFxyXG4gICAgICAgIC8vIHdlIGRpZG4ndCBoYXZlIGl0LCBzbyB3ZSBjYW4gZGV0ZWN0IHRoYXQgYW5kIHJlZnJlc2guICBNYWtlIHN1cmVcclxuICAgICAgICAvLyB0aGF0IGFueSBwcm94aWVzIG9yIENETnMgZG9uJ3QgY2FjaGUgdGhpcyBlcnJvciEgIChOb3JtYWxseSBwcm94aWVzXHJcbiAgICAgICAgLy8gb3IgQ0ROcyBhcmUgc21hcnQgZW5vdWdoIG5vdCB0byBjYWNoZSBlcnJvciBwYWdlcywgYnV0IGluIG9yZGVyIHRvXHJcbiAgICAgICAgLy8gbWFrZSB0aGlzIGhhY2sgd29yaywgd2UgbmVlZCB0byByZXR1cm4gdGhlIENTUyBmaWxlIGFzIGEgMjAwLCB3aGljaFxyXG4gICAgICAgIC8vIHdvdWxkIG90aGVyd2lzZSBiZSBjYWNoZWQuKVxyXG4gICAgICAgIGhlYWRlcnNbJ0NvbnRlbnQtVHlwZSddID0gJ3RleHQvY3NzOyBjaGFyc2V0PXV0Zi04JztcclxuICAgICAgICBoZWFkZXJzWydDYWNoZS1Db250cm9sJ10gPSAnbm8tY2FjaGUnO1xyXG4gICAgICAgIHJlcy53cml0ZUhlYWQoMjAwLCBoZWFkZXJzKTtcclxuICAgICAgICByZXMud3JpdGUoXCIubWV0ZW9yLWNzcy1ub3QtZm91bmQtZXJyb3IgeyB3aWR0aDogMHB4O31cIik7XHJcbiAgICAgICAgcmVzLmVuZCgpO1xyXG4gICAgICAgIHJldHVybjtcclxuICAgICAgfVxyXG5cclxuICAgICAgaWYgKHJlcXVlc3QudXJsLnF1ZXJ5ICYmIHJlcXVlc3QudXJsLnF1ZXJ5WydtZXRlb3JfanNfcmVzb3VyY2UnXSkge1xyXG4gICAgICAgIC8vIFNpbWlsYXJseSwgd2UncmUgcmVxdWVzdGluZyBhIEpTIHJlc291cmNlIHRoYXQgd2UgZG9uJ3QgaGF2ZS5cclxuICAgICAgICAvLyBTZXJ2ZSBhbiB1bmNhY2hlZCA0MDQuIChXZSBjYW4ndCB1c2UgdGhlIHNhbWUgaGFjayB3ZSB1c2UgZm9yIENTUyxcclxuICAgICAgICAvLyBiZWNhdXNlIGFjdHVhbGx5IGFjdGluZyBvbiB0aGF0IGhhY2sgcmVxdWlyZXMgdXMgdG8gaGF2ZSB0aGUgSlNcclxuICAgICAgICAvLyBhbHJlYWR5ISlcclxuICAgICAgICBoZWFkZXJzWydDYWNoZS1Db250cm9sJ10gPSAnbm8tY2FjaGUnO1xyXG4gICAgICAgIHJlcy53cml0ZUhlYWQoNDA0LCBoZWFkZXJzKTtcclxuICAgICAgICByZXMuZW5kKFwiNDA0IE5vdCBGb3VuZFwiKTtcclxuICAgICAgICByZXR1cm47XHJcbiAgICAgIH1cclxuXHJcbiAgICAgIGlmIChyZXF1ZXN0LnVybC5xdWVyeSAmJiByZXF1ZXN0LnVybC5xdWVyeVsnbWV0ZW9yX2RvbnRfc2VydmVfaW5kZXgnXSkge1xyXG4gICAgICAgIC8vIFdoZW4gZG93bmxvYWRpbmcgZmlsZXMgZHVyaW5nIGEgQ29yZG92YSBob3QgY29kZSBwdXNoLCB3ZSBuZWVkXHJcbiAgICAgICAgLy8gdG8gZGV0ZWN0IGlmIGEgZmlsZSBpcyBub3QgYXZhaWxhYmxlIGluc3RlYWQgb2YgaW5hZHZlcnRlbnRseVxyXG4gICAgICAgIC8vIGRvd25sb2FkaW5nIHRoZSBkZWZhdWx0IGluZGV4IHBhZ2UuXHJcbiAgICAgICAgLy8gU28gc2ltaWxhciB0byB0aGUgc2l0dWF0aW9uIGFib3ZlLCB3ZSBzZXJ2ZSBhbiB1bmNhY2hlZCA0MDQuXHJcbiAgICAgICAgaGVhZGVyc1snQ2FjaGUtQ29udHJvbCddID0gJ25vLWNhY2hlJztcclxuICAgICAgICByZXMud3JpdGVIZWFkKDQwNCwgaGVhZGVycyk7XHJcbiAgICAgICAgcmVzLmVuZChcIjQwNCBOb3QgRm91bmRcIik7XHJcbiAgICAgICAgcmV0dXJuO1xyXG4gICAgICB9XHJcblxyXG4gICAgICBjb25zdCB7IGFyY2ggfSA9IHJlcXVlc3Q7XHJcbiAgICAgIGFzc2VydC5zdHJpY3RFcXVhbCh0eXBlb2YgYXJjaCwgXCJzdHJpbmdcIiwgeyBhcmNoIH0pO1xyXG5cclxuICAgICAgaWYgKCEgaGFzT3duLmNhbGwoV2ViQXBwLmNsaWVudFByb2dyYW1zLCBhcmNoKSkge1xyXG4gICAgICAgIC8vIFdlIGNvdWxkIGNvbWUgaGVyZSBpbiBjYXNlIHdlIHJ1biB3aXRoIHNvbWUgYXJjaGl0ZWN0dXJlcyBleGNsdWRlZFxyXG4gICAgICAgIGhlYWRlcnNbJ0NhY2hlLUNvbnRyb2wnXSA9ICduby1jYWNoZSc7XHJcbiAgICAgICAgcmVzLndyaXRlSGVhZCg0MDQsIGhlYWRlcnMpO1xyXG4gICAgICAgIGlmIChNZXRlb3IuaXNEZXZlbG9wbWVudCkge1xyXG4gICAgICAgICAgcmVzLmVuZChgTm8gY2xpZW50IHByb2dyYW0gZm91bmQgZm9yIHRoZSAke2FyY2h9IGFyY2hpdGVjdHVyZS5gKTtcclxuICAgICAgICB9IGVsc2Uge1xyXG4gICAgICAgICAgLy8gU2FmZXR5IG5ldCwgYnV0IHRoaXMgYnJhbmNoIHNob3VsZCBub3QgYmUgcG9zc2libGUuXHJcbiAgICAgICAgICByZXMuZW5kKFwiNDA0IE5vdCBGb3VuZFwiKTtcclxuICAgICAgICB9XHJcbiAgICAgICAgcmV0dXJuO1xyXG4gICAgICB9XHJcblxyXG4gICAgICAvLyBJZiBwYXVzZUNsaWVudChhcmNoKSBoYXMgYmVlbiBjYWxsZWQsIHByb2dyYW0ucGF1c2VkIHdpbGwgYmUgYVxyXG4gICAgICAvLyBQcm9taXNlIHRoYXQgd2lsbCBiZSByZXNvbHZlZCB3aGVuIHRoZSBwcm9ncmFtIGlzIHVucGF1c2VkLlxyXG4gICAgICBhd2FpdCBXZWJBcHAuY2xpZW50UHJvZ3JhbXNbYXJjaF0ucGF1c2VkO1xyXG5cclxuICAgICAgcmV0dXJuIGdldEJvaWxlcnBsYXRlQXN5bmMocmVxdWVzdCwgYXJjaCkudGhlbigoe1xyXG4gICAgICAgIHN0cmVhbSxcclxuICAgICAgICBzdGF0dXNDb2RlLFxyXG4gICAgICAgIGhlYWRlcnM6IG5ld0hlYWRlcnMsXHJcbiAgICAgIH0pID0+IHtcclxuICAgICAgICBpZiAoIXN0YXR1c0NvZGUpIHtcclxuICAgICAgICAgIHN0YXR1c0NvZGUgPSByZXMuc3RhdHVzQ29kZSA/IHJlcy5zdGF0dXNDb2RlIDogMjAwO1xyXG4gICAgICAgIH1cclxuXHJcbiAgICAgICAgaWYgKG5ld0hlYWRlcnMpIHtcclxuICAgICAgICAgIE9iamVjdC5hc3NpZ24oaGVhZGVycywgbmV3SGVhZGVycyk7XHJcbiAgICAgICAgfVxyXG5cclxuICAgICAgICByZXMud3JpdGVIZWFkKHN0YXR1c0NvZGUsIGhlYWRlcnMpO1xyXG5cclxuICAgICAgICBzdHJlYW0ucGlwZShyZXMsIHtcclxuICAgICAgICAgIC8vIEVuZCB0aGUgcmVzcG9uc2Ugd2hlbiB0aGUgc3RyZWFtIGVuZHMuXHJcbiAgICAgICAgICBlbmQ6IHRydWUsXHJcbiAgICAgICAgfSk7XHJcblxyXG4gICAgICB9KS5jYXRjaChlcnJvciA9PiB7XHJcbiAgICAgICAgTG9nLmVycm9yKFwiRXJyb3IgcnVubmluZyB0ZW1wbGF0ZTogXCIgKyBlcnJvci5zdGFjayk7XHJcbiAgICAgICAgcmVzLndyaXRlSGVhZCg1MDAsIGhlYWRlcnMpO1xyXG4gICAgICAgIHJlcy5lbmQoKTtcclxuICAgICAgfSk7XHJcbiAgICB9XHJcbiAgfSk7XHJcblxyXG4gIC8vIFJldHVybiA0MDQgYnkgZGVmYXVsdCwgaWYgbm8gb3RoZXIgaGFuZGxlcnMgc2VydmUgdGhpcyBVUkwuXHJcbiAgYXBwLnVzZShmdW5jdGlvbiAocmVxLCByZXMpIHtcclxuICAgIHJlcy53cml0ZUhlYWQoNDA0KTtcclxuICAgIHJlcy5lbmQoKTtcclxuICB9KTtcclxuXHJcblxyXG4gIHZhciBodHRwU2VydmVyID0gY3JlYXRlU2VydmVyKGFwcCk7XHJcbiAgdmFyIG9uTGlzdGVuaW5nQ2FsbGJhY2tzID0gW107XHJcblxyXG4gIC8vIEFmdGVyIDUgc2Vjb25kcyB3L28gZGF0YSBvbiBhIHNvY2tldCwga2lsbCBpdC4gIE9uIHRoZSBvdGhlciBoYW5kLCBpZlxyXG4gIC8vIHRoZXJlJ3MgYW4gb3V0c3RhbmRpbmcgcmVxdWVzdCwgZ2l2ZSBpdCBhIGhpZ2hlciB0aW1lb3V0IGluc3RlYWQgKHRvIGF2b2lkXHJcbiAgLy8ga2lsbGluZyBsb25nLXBvbGxpbmcgcmVxdWVzdHMpXHJcbiAgaHR0cFNlcnZlci5zZXRUaW1lb3V0KFNIT1JUX1NPQ0tFVF9USU1FT1VUKTtcclxuXHJcbiAgLy8gRG8gdGhpcyBoZXJlLCBhbmQgdGhlbiBhbHNvIGluIGxpdmVkYXRhL3N0cmVhbV9zZXJ2ZXIuanMsIGJlY2F1c2VcclxuICAvLyBzdHJlYW1fc2VydmVyLmpzIGtpbGxzIGFsbCB0aGUgY3VycmVudCByZXF1ZXN0IGhhbmRsZXJzIHdoZW4gaW5zdGFsbGluZyBpdHNcclxuICAvLyBvd24uXHJcbiAgaHR0cFNlcnZlci5vbigncmVxdWVzdCcsIFdlYkFwcC5fdGltZW91dEFkanVzdG1lbnRSZXF1ZXN0Q2FsbGJhY2spO1xyXG5cclxuICAvLyBJZiB0aGUgY2xpZW50IGdhdmUgdXMgYSBiYWQgcmVxdWVzdCwgdGVsbCBpdCBpbnN0ZWFkIG9mIGp1c3QgY2xvc2luZyB0aGVcclxuICAvLyBzb2NrZXQuIFRoaXMgbGV0cyBsb2FkIGJhbGFuY2VycyBpbiBmcm9udCBvZiB1cyBkaWZmZXJlbnRpYXRlIGJldHdlZW4gXCJhXHJcbiAgLy8gc2VydmVyIGlzIHJhbmRvbWx5IGNsb3Npbmcgc29ja2V0cyBmb3Igbm8gcmVhc29uXCIgYW5kIFwiY2xpZW50IHNlbnQgYSBiYWRcclxuICAvLyByZXF1ZXN0XCIuXHJcbiAgLy9cclxuICAvLyBUaGlzIHdpbGwgb25seSB3b3JrIG9uIE5vZGUgNjsgTm9kZSA0IGRlc3Ryb3lzIHRoZSBzb2NrZXQgYmVmb3JlIGNhbGxpbmdcclxuICAvLyB0aGlzIGV2ZW50LiBTZWUgaHR0cHM6Ly9naXRodWIuY29tL25vZGVqcy9ub2RlL3B1bGwvNDU1Ny8gZm9yIGRldGFpbHMuXHJcbiAgaHR0cFNlcnZlci5vbignY2xpZW50RXJyb3InLCAoZXJyLCBzb2NrZXQpID0+IHtcclxuICAgIC8vIFByZS1Ob2RlLTYsIGRvIG5vdGhpbmcuXHJcbiAgICBpZiAoc29ja2V0LmRlc3Ryb3llZCkge1xyXG4gICAgICByZXR1cm47XHJcbiAgICB9XHJcblxyXG4gICAgaWYgKGVyci5tZXNzYWdlID09PSAnUGFyc2UgRXJyb3InKSB7XHJcbiAgICAgIHNvY2tldC5lbmQoJ0hUVFAvMS4xIDQwMCBCYWQgUmVxdWVzdFxcclxcblxcclxcbicpO1xyXG4gICAgfSBlbHNlIHtcclxuICAgICAgLy8gRm9yIG90aGVyIGVycm9ycywgdXNlIHRoZSBkZWZhdWx0IGJlaGF2aW9yIGFzIGlmIHdlIGhhZCBubyBjbGllbnRFcnJvclxyXG4gICAgICAvLyBoYW5kbGVyLlxyXG4gICAgICBzb2NrZXQuZGVzdHJveShlcnIpO1xyXG4gICAgfVxyXG4gIH0pO1xyXG5cclxuICAvLyBzdGFydCB1cCBhcHBcclxuICBfLmV4dGVuZChXZWJBcHAsIHtcclxuICAgIGNvbm5lY3RIYW5kbGVyczogcGFja2FnZUFuZEFwcEhhbmRsZXJzLFxyXG4gICAgcmF3Q29ubmVjdEhhbmRsZXJzOiByYXdDb25uZWN0SGFuZGxlcnMsXHJcbiAgICBodHRwU2VydmVyOiBodHRwU2VydmVyLFxyXG4gICAgY29ubmVjdEFwcDogYXBwLFxyXG4gICAgLy8gRm9yIHRlc3RpbmcuXHJcbiAgICBzdXBwcmVzc0Nvbm5lY3RFcnJvcnM6IGZ1bmN0aW9uICgpIHtcclxuICAgICAgc3VwcHJlc3NDb25uZWN0RXJyb3JzID0gdHJ1ZTtcclxuICAgIH0sXHJcbiAgICBvbkxpc3RlbmluZzogZnVuY3Rpb24gKGYpIHtcclxuICAgICAgaWYgKG9uTGlzdGVuaW5nQ2FsbGJhY2tzKVxyXG4gICAgICAgIG9uTGlzdGVuaW5nQ2FsbGJhY2tzLnB1c2goZik7XHJcbiAgICAgIGVsc2VcclxuICAgICAgICBmKCk7XHJcbiAgICB9LFxyXG4gICAgLy8gVGhpcyBjYW4gYmUgb3ZlcnJpZGRlbiBieSB1c2VycyB3aG8gd2FudCB0byBtb2RpZnkgaG93IGxpc3RlbmluZyB3b3Jrc1xyXG4gICAgLy8gKGVnLCB0byBydW4gYSBwcm94eSBsaWtlIEFwb2xsbyBFbmdpbmUgUHJveHkgaW4gZnJvbnQgb2YgdGhlIHNlcnZlcikuXHJcbiAgICBzdGFydExpc3RlbmluZzogZnVuY3Rpb24gKGh0dHBTZXJ2ZXIsIGxpc3Rlbk9wdGlvbnMsIGNiKSB7XHJcbiAgICAgIGh0dHBTZXJ2ZXIubGlzdGVuKGxpc3Rlbk9wdGlvbnMsIGNiKTtcclxuICAgIH0sXHJcbiAgfSk7XHJcblxyXG4gIC8vIExldCB0aGUgcmVzdCBvZiB0aGUgcGFja2FnZXMgKGFuZCBNZXRlb3Iuc3RhcnR1cCBob29rcykgaW5zZXJ0IGNvbm5lY3RcclxuICAvLyBtaWRkbGV3YXJlcyBhbmQgdXBkYXRlIF9fbWV0ZW9yX3J1bnRpbWVfY29uZmlnX18sIHRoZW4ga2VlcCBnb2luZyB0byBzZXQgdXBcclxuICAvLyBhY3R1YWxseSBzZXJ2aW5nIEhUTUwuXHJcbiAgZXhwb3J0cy5tYWluID0gYXJndiA9PiB7XHJcbiAgICBXZWJBcHBJbnRlcm5hbHMuZ2VuZXJhdGVCb2lsZXJwbGF0ZSgpO1xyXG5cclxuICAgIGNvbnN0IHN0YXJ0SHR0cFNlcnZlciA9IGxpc3Rlbk9wdGlvbnMgPT4ge1xyXG4gICAgICBXZWJBcHAuc3RhcnRMaXN0ZW5pbmcoaHR0cFNlcnZlciwgbGlzdGVuT3B0aW9ucywgTWV0ZW9yLmJpbmRFbnZpcm9ubWVudCgoKSA9PiB7XHJcbiAgICAgICAgaWYgKHByb2Nlc3MuZW52Lk1FVEVPUl9QUklOVF9PTl9MSVNURU4pIHtcclxuICAgICAgICAgIGNvbnNvbGUubG9nKFwiTElTVEVOSU5HXCIpO1xyXG4gICAgICAgIH1cclxuICAgICAgICBjb25zdCBjYWxsYmFja3MgPSBvbkxpc3RlbmluZ0NhbGxiYWNrcztcclxuICAgICAgICBvbkxpc3RlbmluZ0NhbGxiYWNrcyA9IG51bGw7XHJcbiAgICAgICAgY2FsbGJhY2tzLmZvckVhY2goY2FsbGJhY2sgPT4geyBjYWxsYmFjaygpOyB9KTtcclxuICAgICAgfSwgZSA9PiB7XHJcbiAgICAgICAgY29uc29sZS5lcnJvcihcIkVycm9yIGxpc3RlbmluZzpcIiwgZSk7XHJcbiAgICAgICAgY29uc29sZS5lcnJvcihlICYmIGUuc3RhY2spO1xyXG4gICAgICB9KSk7XHJcbiAgICB9O1xyXG5cclxuICAgIGxldCBsb2NhbFBvcnQgPSBwcm9jZXNzLmVudi5QT1JUIHx8IDA7XHJcbiAgICBsZXQgdW5peFNvY2tldFBhdGggPSBwcm9jZXNzLmVudi5VTklYX1NPQ0tFVF9QQVRIO1xyXG5cclxuICAgIGlmICh1bml4U29ja2V0UGF0aCkge1xyXG4gICAgICBpZiAoY2x1c3Rlci5pc1dvcmtlcikge1xyXG4gICAgICAgIGNvbnN0IHdvcmtlck5hbWUgPSBjbHVzdGVyLndvcmtlci5wcm9jZXNzLmVudi5uYW1lIHx8IGNsdXN0ZXIud29ya2VyLmlkXHJcbiAgICAgICAgdW5peFNvY2tldFBhdGggKz0gXCIuXCIgKyB3b3JrZXJOYW1lICsgXCIuc29ja1wiO1xyXG4gICAgICB9XHJcbiAgICAgIC8vIFN0YXJ0IHRoZSBIVFRQIHNlcnZlciB1c2luZyBhIHNvY2tldCBmaWxlLlxyXG4gICAgICByZW1vdmVFeGlzdGluZ1NvY2tldEZpbGUodW5peFNvY2tldFBhdGgpO1xyXG4gICAgICBzdGFydEh0dHBTZXJ2ZXIoeyBwYXRoOiB1bml4U29ja2V0UGF0aCB9KTtcclxuXHJcbiAgICAgIGNvbnN0IHVuaXhTb2NrZXRQZXJtaXNzaW9ucyA9IChwcm9jZXNzLmVudi5VTklYX1NPQ0tFVF9QRVJNSVNTSU9OUyB8fCBcIlwiKS50cmltKCk7XHJcbiAgICAgIGlmICh1bml4U29ja2V0UGVybWlzc2lvbnMpIHtcclxuICAgICAgICBpZiAoL15bMC03XXszfSQvLnRlc3QodW5peFNvY2tldFBlcm1pc3Npb25zKSkge1xyXG4gICAgICAgICAgY2htb2RTeW5jKHVuaXhTb2NrZXRQYXRoLCBwYXJzZUludCh1bml4U29ja2V0UGVybWlzc2lvbnMsIDgpKTtcclxuICAgICAgICB9IGVsc2Uge1xyXG4gICAgICAgICAgdGhyb3cgbmV3IEVycm9yKFwiSW52YWxpZCBVTklYX1NPQ0tFVF9QRVJNSVNTSU9OUyBzcGVjaWZpZWRcIik7XHJcbiAgICAgICAgfVxyXG4gICAgICB9XHJcblxyXG4gICAgICBjb25zdCB1bml4U29ja2V0R3JvdXAgPSAocHJvY2Vzcy5lbnYuVU5JWF9TT0NLRVRfR1JPVVAgfHwgXCJcIikudHJpbSgpO1xyXG4gICAgICBpZiAodW5peFNvY2tldEdyb3VwKSB7XHJcbiAgICAgICAgLy93aG9tc3QgYXV0b21hdGljYWxseSBoYW5kbGVzIGJvdGggZ3JvdXAgbmFtZXMgYW5kIG51bWVyaWNhbCBnaWRzXHJcbiAgICAgICAgY29uc3QgdW5peFNvY2tldEdyb3VwSW5mbyA9IHdob21zdC5zeW5jLmdyb3VwKHVuaXhTb2NrZXRHcm91cCk7XHJcbiAgICAgICAgaWYgKHVuaXhTb2NrZXRHcm91cEluZm8gPT09IG51bGwpIHtcclxuICAgICAgICAgIHRocm93IG5ldyBFcnJvcihcIkludmFsaWQgVU5JWF9TT0NLRVRfR1JPVVAgbmFtZSBzcGVjaWZpZWRcIik7XHJcbiAgICAgICAgfVxyXG4gICAgICAgIGNob3duU3luYyh1bml4U29ja2V0UGF0aCwgdXNlckluZm8oKS51aWQsIHVuaXhTb2NrZXRHcm91cEluZm8uZ2lkKTtcclxuICAgICAgfVxyXG5cclxuICAgICAgcmVnaXN0ZXJTb2NrZXRGaWxlQ2xlYW51cCh1bml4U29ja2V0UGF0aCk7XHJcbiAgICB9IGVsc2Uge1xyXG4gICAgICBsb2NhbFBvcnQgPSBpc05hTihOdW1iZXIobG9jYWxQb3J0KSkgPyBsb2NhbFBvcnQgOiBOdW1iZXIobG9jYWxQb3J0KTtcclxuICAgICAgaWYgKC9cXFxcXFxcXD8uK1xcXFxwaXBlXFxcXD8uKy8udGVzdChsb2NhbFBvcnQpKSB7XHJcbiAgICAgICAgLy8gU3RhcnQgdGhlIEhUVFAgc2VydmVyIHVzaW5nIFdpbmRvd3MgU2VydmVyIHN0eWxlIG5hbWVkIHBpcGUuXHJcbiAgICAgICAgc3RhcnRIdHRwU2VydmVyKHsgcGF0aDogbG9jYWxQb3J0IH0pO1xyXG4gICAgICB9IGVsc2UgaWYgKHR5cGVvZiBsb2NhbFBvcnQgPT09IFwibnVtYmVyXCIpIHtcclxuICAgICAgICAvLyBTdGFydCB0aGUgSFRUUCBzZXJ2ZXIgdXNpbmcgVENQLlxyXG4gICAgICAgIHN0YXJ0SHR0cFNlcnZlcih7XHJcbiAgICAgICAgICBwb3J0OiBsb2NhbFBvcnQsXHJcbiAgICAgICAgICBob3N0OiBwcm9jZXNzLmVudi5CSU5EX0lQIHx8IFwiMC4wLjAuMFwiXHJcbiAgICAgICAgfSk7XHJcbiAgICAgIH0gZWxzZSB7XHJcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKFwiSW52YWxpZCBQT1JUIHNwZWNpZmllZFwiKTtcclxuICAgICAgfVxyXG4gICAgfVxyXG5cclxuICAgIHJldHVybiBcIkRBRU1PTlwiO1xyXG4gIH07XHJcbn1cclxuXHJcbnZhciBpbmxpbmVTY3JpcHRzQWxsb3dlZCA9IHRydWU7XHJcblxyXG5XZWJBcHBJbnRlcm5hbHMuaW5saW5lU2NyaXB0c0FsbG93ZWQgPSBmdW5jdGlvbiAoKSB7XHJcbiAgcmV0dXJuIGlubGluZVNjcmlwdHNBbGxvd2VkO1xyXG59O1xyXG5cclxuV2ViQXBwSW50ZXJuYWxzLnNldElubGluZVNjcmlwdHNBbGxvd2VkID0gZnVuY3Rpb24gKHZhbHVlKSB7XHJcbiAgaW5saW5lU2NyaXB0c0FsbG93ZWQgPSB2YWx1ZTtcclxuICBXZWJBcHBJbnRlcm5hbHMuZ2VuZXJhdGVCb2lsZXJwbGF0ZSgpO1xyXG59O1xyXG5cclxudmFyIHNyaU1vZGU7XHJcblxyXG5XZWJBcHBJbnRlcm5hbHMuZW5hYmxlU3VicmVzb3VyY2VJbnRlZ3JpdHkgPSBmdW5jdGlvbih1c2VfY3JlZGVudGlhbHMgPSBmYWxzZSkge1xyXG4gIHNyaU1vZGUgPSB1c2VfY3JlZGVudGlhbHMgPyAndXNlLWNyZWRlbnRpYWxzJyA6ICdhbm9ueW1vdXMnO1xyXG4gIFdlYkFwcEludGVybmFscy5nZW5lcmF0ZUJvaWxlcnBsYXRlKCk7XHJcbn07XHJcblxyXG5XZWJBcHBJbnRlcm5hbHMuc2V0QnVuZGxlZEpzQ3NzVXJsUmV3cml0ZUhvb2sgPSBmdW5jdGlvbiAoaG9va0ZuKSB7XHJcbiAgYnVuZGxlZEpzQ3NzVXJsUmV3cml0ZUhvb2sgPSBob29rRm47XHJcbiAgV2ViQXBwSW50ZXJuYWxzLmdlbmVyYXRlQm9pbGVycGxhdGUoKTtcclxufTtcclxuXHJcbldlYkFwcEludGVybmFscy5zZXRCdW5kbGVkSnNDc3NQcmVmaXggPSBmdW5jdGlvbiAocHJlZml4KSB7XHJcbiAgdmFyIHNlbGYgPSB0aGlzO1xyXG4gIHNlbGYuc2V0QnVuZGxlZEpzQ3NzVXJsUmV3cml0ZUhvb2soXHJcbiAgICBmdW5jdGlvbiAodXJsKSB7XHJcbiAgICAgIHJldHVybiBwcmVmaXggKyB1cmw7XHJcbiAgfSk7XHJcbn07XHJcblxyXG4vLyBQYWNrYWdlcyBjYW4gY2FsbCBgV2ViQXBwSW50ZXJuYWxzLmFkZFN0YXRpY0pzYCB0byBzcGVjaWZ5IHN0YXRpY1xyXG4vLyBKYXZhU2NyaXB0IHRvIGJlIGluY2x1ZGVkIGluIHRoZSBhcHAuIFRoaXMgc3RhdGljIEpTIHdpbGwgYmUgaW5saW5lZCxcclxuLy8gdW5sZXNzIGlubGluZSBzY3JpcHRzIGhhdmUgYmVlbiBkaXNhYmxlZCwgaW4gd2hpY2ggY2FzZSBpdCB3aWxsIGJlXHJcbi8vIHNlcnZlZCB1bmRlciBgLzxzaGExIG9mIGNvbnRlbnRzPmAuXHJcbnZhciBhZGRpdGlvbmFsU3RhdGljSnMgPSB7fTtcclxuV2ViQXBwSW50ZXJuYWxzLmFkZFN0YXRpY0pzID0gZnVuY3Rpb24gKGNvbnRlbnRzKSB7XHJcbiAgYWRkaXRpb25hbFN0YXRpY0pzW1wiL1wiICsgc2hhMShjb250ZW50cykgKyBcIi5qc1wiXSA9IGNvbnRlbnRzO1xyXG59O1xyXG5cclxuLy8gRXhwb3J0ZWQgZm9yIHRlc3RzXHJcbldlYkFwcEludGVybmFscy5nZXRCb2lsZXJwbGF0ZSA9IGdldEJvaWxlcnBsYXRlO1xyXG5XZWJBcHBJbnRlcm5hbHMuYWRkaXRpb25hbFN0YXRpY0pzID0gYWRkaXRpb25hbFN0YXRpY0pzO1xyXG5cclxuLy8gU3RhcnQgdGhlIHNlcnZlciFcclxucnVuV2ViQXBwU2VydmVyKCk7XHJcbiIsImltcG9ydCBucG1Db25uZWN0IGZyb20gXCJjb25uZWN0XCI7XHJcblxyXG5leHBvcnQgZnVuY3Rpb24gY29ubmVjdCguLi5jb25uZWN0QXJncykge1xyXG4gIGNvbnN0IGhhbmRsZXJzID0gbnBtQ29ubmVjdC5hcHBseSh0aGlzLCBjb25uZWN0QXJncyk7XHJcbiAgY29uc3Qgb3JpZ2luYWxVc2UgPSBoYW5kbGVycy51c2U7XHJcblxyXG4gIC8vIFdyYXAgdGhlIGhhbmRsZXJzLnVzZSBtZXRob2Qgc28gdGhhdCBhbnkgcHJvdmlkZWQgaGFuZGxlciBmdW5jdGlvbnNcclxuICAvLyBhbHdheXMgcnVuIGluIGEgRmliZXIuXHJcbiAgaGFuZGxlcnMudXNlID0gZnVuY3Rpb24gdXNlKC4uLnVzZUFyZ3MpIHtcclxuICAgIGNvbnN0IHsgc3RhY2sgfSA9IHRoaXM7XHJcbiAgICBjb25zdCBvcmlnaW5hbExlbmd0aCA9IHN0YWNrLmxlbmd0aDtcclxuICAgIGNvbnN0IHJlc3VsdCA9IG9yaWdpbmFsVXNlLmFwcGx5KHRoaXMsIHVzZUFyZ3MpO1xyXG5cclxuICAgIC8vIElmIHdlIGp1c3QgYWRkZWQgYW55dGhpbmcgdG8gdGhlIHN0YWNrLCB3cmFwIGVhY2ggbmV3IGVudHJ5LmhhbmRsZVxyXG4gICAgLy8gd2l0aCBhIGZ1bmN0aW9uIHRoYXQgY2FsbHMgUHJvbWlzZS5hc3luY0FwcGx5IHRvIGVuc3VyZSB0aGVcclxuICAgIC8vIG9yaWdpbmFsIGhhbmRsZXIgcnVucyBpbiBhIEZpYmVyLlxyXG4gICAgZm9yIChsZXQgaSA9IG9yaWdpbmFsTGVuZ3RoOyBpIDwgc3RhY2subGVuZ3RoOyArK2kpIHtcclxuICAgICAgY29uc3QgZW50cnkgPSBzdGFja1tpXTtcclxuICAgICAgY29uc3Qgb3JpZ2luYWxIYW5kbGUgPSBlbnRyeS5oYW5kbGU7XHJcblxyXG4gICAgICBpZiAob3JpZ2luYWxIYW5kbGUubGVuZ3RoID49IDQpIHtcclxuICAgICAgICAvLyBJZiB0aGUgb3JpZ2luYWwgaGFuZGxlIGhhZCBmb3VyIChvciBtb3JlKSBwYXJhbWV0ZXJzLCB0aGVcclxuICAgICAgICAvLyB3cmFwcGVyIG11c3QgYWxzbyBoYXZlIGZvdXIgcGFyYW1ldGVycywgc2luY2UgY29ubmVjdCB1c2VzXHJcbiAgICAgICAgLy8gaGFuZGxlLmxlbmd0aCB0byBkZXRlcm1pbmUgd2hldGhlciB0byBwYXNzIHRoZSBlcnJvciBhcyB0aGUgZmlyc3RcclxuICAgICAgICAvLyBhcmd1bWVudCB0byB0aGUgaGFuZGxlIGZ1bmN0aW9uLlxyXG4gICAgICAgIGVudHJ5LmhhbmRsZSA9IGZ1bmN0aW9uIGhhbmRsZShlcnIsIHJlcSwgcmVzLCBuZXh0KSB7XHJcbiAgICAgICAgICByZXR1cm4gUHJvbWlzZS5hc3luY0FwcGx5KG9yaWdpbmFsSGFuZGxlLCB0aGlzLCBhcmd1bWVudHMpO1xyXG4gICAgICAgIH07XHJcbiAgICAgIH0gZWxzZSB7XHJcbiAgICAgICAgZW50cnkuaGFuZGxlID0gZnVuY3Rpb24gaGFuZGxlKHJlcSwgcmVzLCBuZXh0KSB7XHJcbiAgICAgICAgICByZXR1cm4gUHJvbWlzZS5hc3luY0FwcGx5KG9yaWdpbmFsSGFuZGxlLCB0aGlzLCBhcmd1bWVudHMpO1xyXG4gICAgICAgIH07XHJcbiAgICAgIH1cclxuICAgIH1cclxuXHJcbiAgICByZXR1cm4gcmVzdWx0O1xyXG4gIH07XHJcblxyXG4gIHJldHVybiBoYW5kbGVycztcclxufVxyXG4iLCJpbXBvcnQgeyBzdGF0U3luYywgdW5saW5rU3luYywgZXhpc3RzU3luYyB9IGZyb20gJ2ZzJztcclxuXHJcbi8vIFNpbmNlIGEgbmV3IHNvY2tldCBmaWxlIHdpbGwgYmUgY3JlYXRlZCB3aGVuIHRoZSBIVFRQIHNlcnZlclxyXG4vLyBzdGFydHMgdXAsIGlmIGZvdW5kIHJlbW92ZSB0aGUgZXhpc3RpbmcgZmlsZS5cclxuLy9cclxuLy8gV0FSTklORzpcclxuLy8gVGhpcyB3aWxsIHJlbW92ZSB0aGUgY29uZmlndXJlZCBzb2NrZXQgZmlsZSB3aXRob3V0IHdhcm5pbmcuIElmXHJcbi8vIHRoZSBjb25maWd1cmVkIHNvY2tldCBmaWxlIGlzIGFscmVhZHkgaW4gdXNlIGJ5IGFub3RoZXIgYXBwbGljYXRpb24sXHJcbi8vIGl0IHdpbGwgc3RpbGwgYmUgcmVtb3ZlZC4gTm9kZSBkb2VzIG5vdCBwcm92aWRlIGEgcmVsaWFibGUgd2F5IHRvXHJcbi8vIGRpZmZlcmVudGlhdGUgYmV0d2VlbiBhIHNvY2tldCBmaWxlIHRoYXQgaXMgYWxyZWFkeSBpbiB1c2UgYnlcclxuLy8gYW5vdGhlciBhcHBsaWNhdGlvbiBvciBhIHN0YWxlIHNvY2tldCBmaWxlIHRoYXQgaGFzIGJlZW5cclxuLy8gbGVmdCBvdmVyIGFmdGVyIGEgU0lHS0lMTC4gU2luY2Ugd2UgaGF2ZSBubyByZWxpYWJsZSB3YXkgdG9cclxuLy8gZGlmZmVyZW50aWF0ZSBiZXR3ZWVuIHRoZXNlIHR3byBzY2VuYXJpb3MsIHRoZSBiZXN0IGNvdXJzZSBvZlxyXG4vLyBhY3Rpb24gZHVyaW5nIHN0YXJ0dXAgaXMgdG8gcmVtb3ZlIGFueSBleGlzdGluZyBzb2NrZXQgZmlsZS4gVGhpc1xyXG4vLyBpcyBub3QgdGhlIHNhZmVzdCBjb3Vyc2Ugb2YgYWN0aW9uIGFzIHJlbW92aW5nIHRoZSBleGlzdGluZyBzb2NrZXRcclxuLy8gZmlsZSBjb3VsZCBpbXBhY3QgYW4gYXBwbGljYXRpb24gdXNpbmcgaXQsIGJ1dCB0aGlzIGFwcHJvYWNoIGhlbHBzXHJcbi8vIGVuc3VyZSB0aGUgSFRUUCBzZXJ2ZXIgY2FuIHN0YXJ0dXAgd2l0aG91dCBtYW51YWxcclxuLy8gaW50ZXJ2ZW50aW9uIChlLmcuIGFza2luZyBmb3IgdGhlIHZlcmlmaWNhdGlvbiBhbmQgY2xlYW51cCBvZiBzb2NrZXRcclxuLy8gZmlsZXMgYmVmb3JlIGFsbG93aW5nIHRoZSBIVFRQIHNlcnZlciB0byBiZSBzdGFydGVkKS5cclxuLy9cclxuLy8gVGhlIGFib3ZlIGJlaW5nIHNhaWQsIGFzIGxvbmcgYXMgdGhlIHNvY2tldCBmaWxlIHBhdGggaXNcclxuLy8gY29uZmlndXJlZCBjYXJlZnVsbHkgd2hlbiB0aGUgYXBwbGljYXRpb24gaXMgZGVwbG95ZWQgKGFuZCBleHRyYVxyXG4vLyBjYXJlIGlzIHRha2VuIHRvIG1ha2Ugc3VyZSB0aGUgY29uZmlndXJlZCBwYXRoIGlzIHVuaXF1ZSBhbmQgZG9lc24ndFxyXG4vLyBjb25mbGljdCB3aXRoIGFub3RoZXIgc29ja2V0IGZpbGUgcGF0aCksIHRoZW4gdGhlcmUgc2hvdWxkIG5vdCBiZVxyXG4vLyBhbnkgaXNzdWVzIHdpdGggdGhpcyBhcHByb2FjaC5cclxuZXhwb3J0IGNvbnN0IHJlbW92ZUV4aXN0aW5nU29ja2V0RmlsZSA9IChzb2NrZXRQYXRoKSA9PiB7XHJcbiAgdHJ5IHtcclxuICAgIGlmIChzdGF0U3luYyhzb2NrZXRQYXRoKS5pc1NvY2tldCgpKSB7XHJcbiAgICAgIC8vIFNpbmNlIGEgbmV3IHNvY2tldCBmaWxlIHdpbGwgYmUgY3JlYXRlZCwgcmVtb3ZlIHRoZSBleGlzdGluZ1xyXG4gICAgICAvLyBmaWxlLlxyXG4gICAgICB1bmxpbmtTeW5jKHNvY2tldFBhdGgpO1xyXG4gICAgfSBlbHNlIHtcclxuICAgICAgdGhyb3cgbmV3IEVycm9yKFxyXG4gICAgICAgIGBBbiBleGlzdGluZyBmaWxlIHdhcyBmb3VuZCBhdCBcIiR7c29ja2V0UGF0aH1cIiBhbmQgaXQgaXMgbm90IGAgK1xyXG4gICAgICAgICdhIHNvY2tldCBmaWxlLiBQbGVhc2UgY29uZmlybSBQT1JUIGlzIHBvaW50aW5nIHRvIHZhbGlkIGFuZCAnICtcclxuICAgICAgICAndW4tdXNlZCBzb2NrZXQgZmlsZSBwYXRoLidcclxuICAgICAgKTtcclxuICAgIH1cclxuICB9IGNhdGNoIChlcnJvcikge1xyXG4gICAgLy8gSWYgdGhlcmUgaXMgbm8gZXhpc3Rpbmcgc29ja2V0IGZpbGUgdG8gY2xlYW51cCwgZ3JlYXQsIHdlJ2xsXHJcbiAgICAvLyBjb250aW51ZSBub3JtYWxseS4gSWYgdGhlIGNhdWdodCBleGNlcHRpb24gcmVwcmVzZW50cyBhbnkgb3RoZXJcclxuICAgIC8vIGlzc3VlLCByZS10aHJvdy5cclxuICAgIGlmIChlcnJvci5jb2RlICE9PSAnRU5PRU5UJykge1xyXG4gICAgICB0aHJvdyBlcnJvcjtcclxuICAgIH1cclxuICB9XHJcbn07XHJcblxyXG4vLyBSZW1vdmUgdGhlIHNvY2tldCBmaWxlIHdoZW4gZG9uZSB0byBhdm9pZCBsZWF2aW5nIGJlaGluZCBhIHN0YWxlIG9uZS5cclxuLy8gTm90ZSAtIGEgc3RhbGUgc29ja2V0IGZpbGUgaXMgc3RpbGwgbGVmdCBiZWhpbmQgaWYgdGhlIHJ1bm5pbmcgbm9kZVxyXG4vLyBwcm9jZXNzIGlzIGtpbGxlZCB2aWEgc2lnbmFsIDkgLSBTSUdLSUxMLlxyXG5leHBvcnQgY29uc3QgcmVnaXN0ZXJTb2NrZXRGaWxlQ2xlYW51cCA9XHJcbiAgKHNvY2tldFBhdGgsIGV2ZW50RW1pdHRlciA9IHByb2Nlc3MpID0+IHtcclxuICAgIFsnZXhpdCcsICdTSUdJTlQnLCAnU0lHSFVQJywgJ1NJR1RFUk0nXS5mb3JFYWNoKHNpZ25hbCA9PiB7XHJcbiAgICAgIGV2ZW50RW1pdHRlci5vbihzaWduYWwsIE1ldGVvci5iaW5kRW52aXJvbm1lbnQoKCkgPT4ge1xyXG4gICAgICAgIGlmIChleGlzdHNTeW5jKHNvY2tldFBhdGgpKSB7XHJcbiAgICAgICAgICB1bmxpbmtTeW5jKHNvY2tldFBhdGgpO1xyXG4gICAgICAgIH1cclxuICAgICAgfSkpO1xyXG4gICAgfSk7XHJcbiAgfTtcclxuIl19
