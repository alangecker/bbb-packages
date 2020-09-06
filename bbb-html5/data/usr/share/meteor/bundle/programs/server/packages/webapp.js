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
  let readFileSync;
  module1.link("fs", {
    readFileSync(v) {
      readFileSync = v;
    }

  }, 1);
  let createServer;
  module1.link("http", {
    createServer(v) {
      createServer = v;
    }

  }, 2);
  let pathJoin, pathDirname;
  module1.link("path", {
    join(v) {
      pathJoin = v;
    },

    dirname(v) {
      pathDirname = v;
    }

  }, 3);
  let parseUrl;
  module1.link("url", {
    parse(v) {
      parseUrl = v;
    }

  }, 4);
  let createHash;
  module1.link("crypto", {
    createHash(v) {
      createHash = v;
    }

  }, 5);
  let connect;
  module1.link("./connect.js", {
    connect(v) {
      connect = v;
    }

  }, 6);
  let compress;
  module1.link("compression", {
    default(v) {
      compress = v;
    }

  }, 7);
  let cookieParser;
  module1.link("cookie-parser", {
    default(v) {
      cookieParser = v;
    }

  }, 8);
  let qs;
  module1.link("qs", {
    default(v) {
      qs = v;
    }

  }, 9);
  let parseRequest;
  module1.link("parseurl", {
    default(v) {
      parseRequest = v;
    }

  }, 10);
  let basicAuth;
  module1.link("basic-auth-connect", {
    default(v) {
      basicAuth = v;
    }

  }, 11);
  let lookupUserAgent;
  module1.link("useragent", {
    lookup(v) {
      lookupUserAgent = v;
    }

  }, 12);
  let isModern;
  module1.link("meteor/modern-browsers", {
    isModern(v) {
      isModern = v;
    }

  }, 13);
  let send;
  module1.link("send", {
    default(v) {
      send = v;
    }

  }, 14);
  let removeExistingSocketFile, registerSocketFileCleanup;
  module1.link("./socket_file.js", {
    removeExistingSocketFile(v) {
      removeExistingSocketFile = v;
    },

    registerSocketFileCleanup(v) {
      registerSocketFileCleanup = v;
    }

  }, 15);
  let onMessage;
  module1.link("meteor/inter-process-messaging", {
    onMessage(v) {
      onMessage = v;
    }

  }, 16);
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
    const meteorRuntimeConfig = JSON.stringify(encodeURIComponent(JSON.stringify(_objectSpread({}, __meteor_runtime_config__, {}, additionalOptions.runtimeConfigOverrides || {}))));
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
      if ('GET' != req.method && 'HEAD' != req.method && 'OPTIONS' != req.method) {
        next();
        return;
      }

      var pathname = parseRequest(req).pathname;

      try {
        pathname = decodeURIComponent(pathname);
      } catch (e) {
        next();
        return;
      }

      var serveStaticJs = function (s) {
        res.writeHead(200, {
          'Content-type': 'application/javascript; charset=UTF-8'
        });
        res.write(s);
        res.end();
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

  onMessage("webapp-pause-client", (_ref) => Promise.asyncApply(() => {
    let {
      arch
    } = _ref;
    WebAppInternals.pauseClient(arch);
  }));
  onMessage("webapp-reload-client", (_ref2) => Promise.asyncApply(() => {
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
        versionNonRefreshable: () => WebAppHashing.calculateClientHash(manifest, type => type !== "css", configOverrides),
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

      program.meteorRuntimeConfig = JSON.stringify(_objectSpread({}, __meteor_runtime_config__, {}, additionalOptions.runtimeConfigOverrides || null));
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
          return getBoilerplateAsync(request, arch).then((_ref3) => {
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
      const unixSocketPath = process.env.UNIX_SOCKET_PATH;

      if (unixSocketPath) {
        // Start the HTTP server using a socket file.
        removeExistingSocketFile(unixSocketPath);
        startHttpServer({
          path: unixSocketPath
        });
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
  // alway run in a Fiber.

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
        // handle.length to dermine whether to pass the error as the first
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

}}}}}}},{
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
//# sourceMappingURL=data:application/json;charset=utf8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIm1ldGVvcjovL/CfkrthcHAvcGFja2FnZXMvd2ViYXBwL3dlYmFwcF9zZXJ2ZXIuanMiLCJtZXRlb3I6Ly/wn5K7YXBwL3BhY2thZ2VzL3dlYmFwcC9jb25uZWN0LmpzIiwibWV0ZW9yOi8v8J+Su2FwcC9wYWNrYWdlcy93ZWJhcHAvc29ja2V0X2ZpbGUuanMiXSwibmFtZXMiOlsiX29iamVjdFNwcmVhZCIsIm1vZHVsZTEiLCJsaW5rIiwiZGVmYXVsdCIsInYiLCJleHBvcnQiLCJXZWJBcHAiLCJXZWJBcHBJbnRlcm5hbHMiLCJhc3NlcnQiLCJyZWFkRmlsZVN5bmMiLCJjcmVhdGVTZXJ2ZXIiLCJwYXRoSm9pbiIsInBhdGhEaXJuYW1lIiwiam9pbiIsImRpcm5hbWUiLCJwYXJzZVVybCIsInBhcnNlIiwiY3JlYXRlSGFzaCIsImNvbm5lY3QiLCJjb21wcmVzcyIsImNvb2tpZVBhcnNlciIsInFzIiwicGFyc2VSZXF1ZXN0IiwiYmFzaWNBdXRoIiwibG9va3VwVXNlckFnZW50IiwibG9va3VwIiwiaXNNb2Rlcm4iLCJzZW5kIiwicmVtb3ZlRXhpc3RpbmdTb2NrZXRGaWxlIiwicmVnaXN0ZXJTb2NrZXRGaWxlQ2xlYW51cCIsIm9uTWVzc2FnZSIsIlNIT1JUX1NPQ0tFVF9USU1FT1VUIiwiTE9OR19TT0NLRVRfVElNRU9VVCIsImhhc093biIsIk9iamVjdCIsInByb3RvdHlwZSIsImhhc093blByb3BlcnR5IiwiTnBtTW9kdWxlcyIsInZlcnNpb24iLCJOcG0iLCJyZXF1aXJlIiwibW9kdWxlIiwiZGVmYXVsdEFyY2giLCJjbGllbnRQcm9ncmFtcyIsImFyY2hQYXRoIiwiYnVuZGxlZEpzQ3NzVXJsUmV3cml0ZUhvb2siLCJ1cmwiLCJidW5kbGVkUHJlZml4IiwiX19tZXRlb3JfcnVudGltZV9jb25maWdfXyIsIlJPT1RfVVJMX1BBVEhfUFJFRklYIiwic2hhMSIsImNvbnRlbnRzIiwiaGFzaCIsInVwZGF0ZSIsImRpZ2VzdCIsInNob3VsZENvbXByZXNzIiwicmVxIiwicmVzIiwiaGVhZGVycyIsImZpbHRlciIsImNhbWVsQ2FzZSIsIm5hbWUiLCJwYXJ0cyIsInNwbGl0IiwidG9Mb3dlckNhc2UiLCJpIiwibGVuZ3RoIiwiY2hhckF0IiwidG9VcHBlckNhc2UiLCJzdWJzdHIiLCJpZGVudGlmeUJyb3dzZXIiLCJ1c2VyQWdlbnRTdHJpbmciLCJ1c2VyQWdlbnQiLCJmYW1pbHkiLCJtYWpvciIsIm1pbm9yIiwicGF0Y2giLCJjYXRlZ29yaXplUmVxdWVzdCIsImJyb3dzZXIiLCJhcmNoIiwibW9kZXJuIiwicGF0aCIsInBhdGhuYW1lIiwiY2F0ZWdvcml6ZWQiLCJkeW5hbWljSGVhZCIsImR5bmFtaWNCb2R5IiwiY29va2llcyIsInBhdGhQYXJ0cyIsImFyY2hLZXkiLCJzdGFydHNXaXRoIiwiYXJjaENsZWFuZWQiLCJzbGljZSIsImNhbGwiLCJzcGxpY2UiLCJhc3NpZ24iLCJwcmVmZXJyZWRBcmNoT3JkZXIiLCJodG1sQXR0cmlidXRlSG9va3MiLCJnZXRIdG1sQXR0cmlidXRlcyIsInJlcXVlc3QiLCJjb21iaW5lZEF0dHJpYnV0ZXMiLCJfIiwiZWFjaCIsImhvb2siLCJhdHRyaWJ1dGVzIiwiRXJyb3IiLCJleHRlbmQiLCJhZGRIdG1sQXR0cmlidXRlSG9vayIsInB1c2giLCJhcHBVcmwiLCJSb3V0ZVBvbGljeSIsImNsYXNzaWZ5IiwiTWV0ZW9yIiwic3RhcnR1cCIsImdldHRlciIsImtleSIsInByb2dyYW0iLCJ2YWx1ZSIsImNhbGN1bGF0ZUNsaWVudEhhc2giLCJjbGllbnRIYXNoIiwiY2FsY3VsYXRlQ2xpZW50SGFzaFJlZnJlc2hhYmxlIiwiY2FsY3VsYXRlQ2xpZW50SGFzaE5vblJlZnJlc2hhYmxlIiwiZ2V0UmVmcmVzaGFibGVBc3NldHMiLCJfdGltZW91dEFkanVzdG1lbnRSZXF1ZXN0Q2FsbGJhY2siLCJzZXRUaW1lb3V0IiwiZmluaXNoTGlzdGVuZXJzIiwibGlzdGVuZXJzIiwicmVtb3ZlQWxsTGlzdGVuZXJzIiwib24iLCJsIiwiYm9pbGVycGxhdGVCeUFyY2giLCJib2lsZXJwbGF0ZURhdGFDYWxsYmFja3MiLCJjcmVhdGUiLCJyZWdpc3RlckJvaWxlcnBsYXRlRGF0YUNhbGxiYWNrIiwiY2FsbGJhY2siLCJwcmV2aW91c0NhbGxiYWNrIiwic3RyaWN0RXF1YWwiLCJnZXRCb2lsZXJwbGF0ZSIsImdldEJvaWxlcnBsYXRlQXN5bmMiLCJhd2FpdCIsImJvaWxlcnBsYXRlIiwiZGF0YSIsImJhc2VEYXRhIiwiaHRtbEF0dHJpYnV0ZXMiLCJwaWNrIiwibWFkZUNoYW5nZXMiLCJwcm9taXNlIiwiUHJvbWlzZSIsInJlc29sdmUiLCJrZXlzIiwiZm9yRWFjaCIsInRoZW4iLCJyZXN1bHQiLCJzdHJlYW0iLCJ0b0hUTUxTdHJlYW0iLCJzdGF0dXNDb2RlIiwiZ2VuZXJhdGVCb2lsZXJwbGF0ZUluc3RhbmNlIiwibWFuaWZlc3QiLCJhZGRpdGlvbmFsT3B0aW9ucyIsIm1ldGVvclJ1bnRpbWVDb25maWciLCJKU09OIiwic3RyaW5naWZ5IiwiZW5jb2RlVVJJQ29tcG9uZW50IiwicnVudGltZUNvbmZpZ092ZXJyaWRlcyIsIkJvaWxlcnBsYXRlIiwicGF0aE1hcHBlciIsIml0ZW1QYXRoIiwiYmFzZURhdGFFeHRlbnNpb24iLCJhZGRpdGlvbmFsU3RhdGljSnMiLCJtYXAiLCJtZXRlb3JSdW50aW1lSGFzaCIsInJvb3RVcmxQYXRoUHJlZml4Iiwic3JpTW9kZSIsImlubGluZVNjcmlwdHNBbGxvd2VkIiwiaW5saW5lIiwic3RhdGljRmlsZXNNaWRkbGV3YXJlIiwic3RhdGljRmlsZXNCeUFyY2giLCJuZXh0IiwibWV0aG9kIiwiZGVjb2RlVVJJQ29tcG9uZW50IiwiZSIsInNlcnZlU3RhdGljSnMiLCJzIiwid3JpdGVIZWFkIiwid3JpdGUiLCJlbmQiLCJoYXMiLCJwYXVzZWQiLCJpbmZvIiwiZ2V0U3RhdGljRmlsZUluZm8iLCJtYXhBZ2UiLCJjYWNoZWFibGUiLCJzZXRIZWFkZXIiLCJzb3VyY2VNYXBVcmwiLCJ0eXBlIiwiY29udGVudCIsImFic29sdXRlUGF0aCIsIm1heGFnZSIsImRvdGZpbGVzIiwibGFzdE1vZGlmaWVkIiwiZXJyIiwiTG9nIiwiZXJyb3IiLCJwaXBlIiwib3JpZ2luYWxQYXRoIiwic3RhdGljQXJjaExpc3QiLCJhcmNoSW5kZXgiLCJpbmRleE9mIiwidW5zaGlmdCIsInNvbWUiLCJzdGF0aWNGaWxlcyIsImZpbmFsaXplIiwicGFyc2VQb3J0IiwicG9ydCIsInBhcnNlZFBvcnQiLCJwYXJzZUludCIsIk51bWJlciIsImlzTmFOIiwicGF1c2VDbGllbnQiLCJnZW5lcmF0ZUNsaWVudFByb2dyYW0iLCJydW5XZWJBcHBTZXJ2ZXIiLCJzaHV0dGluZ0Rvd24iLCJzeW5jUXVldWUiLCJfU3luY2hyb25vdXNRdWV1ZSIsImdldEl0ZW1QYXRobmFtZSIsIml0ZW1VcmwiLCJyZWxvYWRDbGllbnRQcm9ncmFtcyIsInJ1blRhc2siLCJjb25maWdKc29uIiwiX19tZXRlb3JfYm9vdHN0cmFwX18iLCJjbGllbnRBcmNocyIsImNsaWVudFBhdGhzIiwic3RhY2siLCJwcm9jZXNzIiwiZXhpdCIsInVucGF1c2UiLCJjbGllbnREaXIiLCJzZXJ2ZXJEaXIiLCJwcm9ncmFtSnNvblBhdGgiLCJwcm9ncmFtSnNvbiIsImNvZGUiLCJmb3JtYXQiLCJpdGVtIiwid2hlcmUiLCJzb3VyY2VNYXAiLCJQVUJMSUNfU0VUVElOR1MiLCJjb25maWdPdmVycmlkZXMiLCJvbGRQcm9ncmFtIiwibmV3UHJvZ3JhbSIsIldlYkFwcEhhc2hpbmciLCJ2ZXJzaW9uUmVmcmVzaGFibGUiLCJ2ZXJzaW9uTm9uUmVmcmVzaGFibGUiLCJjb3Jkb3ZhQ29tcGF0aWJpbGl0eVZlcnNpb25zIiwibWFuaWZlc3RVcmxQcmVmaXgiLCJyZXBsYWNlIiwibWFuaWZlc3RVcmwiLCJQYWNrYWdlIiwiYXV0b3VwZGF0ZSIsIkFVVE9VUERBVEVfVkVSU0lPTiIsIkF1dG91cGRhdGUiLCJhdXRvdXBkYXRlVmVyc2lvbiIsImVudiIsImdlbmVyYXRlQm9pbGVycGxhdGVGb3JBcmNoIiwiZGVmYXVsdE9wdGlvbnNGb3JBcmNoIiwiRERQX0RFRkFVTFRfQ09OTkVDVElPTl9VUkwiLCJNT0JJTEVfRERQX1VSTCIsImFic29sdXRlVXJsIiwiUk9PVF9VUkwiLCJNT0JJTEVfUk9PVF9VUkwiLCJnZW5lcmF0ZUJvaWxlcnBsYXRlIiwicmVmcmVzaGFibGVBc3NldHMiLCJjc3MiLCJmaWxlIiwiYXBwIiwicmF3Q29ubmVjdEhhbmRsZXJzIiwidXNlIiwiaXNWYWxpZFVybCIsInJlc3BvbnNlIiwicXVlcnkiLCJnZXRQYXRoUGFydHMiLCJzaGlmdCIsImlzUHJlZml4T2YiLCJwcmVmaXgiLCJhcnJheSIsImV2ZXJ5IiwicGFydCIsInBhdGhQcmVmaXgiLCJzZWFyY2giLCJwcmVmaXhQYXJ0cyIsIm1ldGVvckludGVybmFsSGFuZGxlcnMiLCJwYWNrYWdlQW5kQXBwSGFuZGxlcnMiLCJzdXBwcmVzc0Nvbm5lY3RFcnJvcnMiLCJzdGF0dXMiLCJpc0RldmVsb3BtZW50IiwibmV3SGVhZGVycyIsImNhdGNoIiwiaHR0cFNlcnZlciIsIm9uTGlzdGVuaW5nQ2FsbGJhY2tzIiwic29ja2V0IiwiZGVzdHJveWVkIiwibWVzc2FnZSIsImRlc3Ryb3kiLCJjb25uZWN0SGFuZGxlcnMiLCJjb25uZWN0QXBwIiwib25MaXN0ZW5pbmciLCJmIiwic3RhcnRMaXN0ZW5pbmciLCJsaXN0ZW5PcHRpb25zIiwiY2IiLCJsaXN0ZW4iLCJleHBvcnRzIiwibWFpbiIsImFyZ3YiLCJzdGFydEh0dHBTZXJ2ZXIiLCJiaW5kRW52aXJvbm1lbnQiLCJNRVRFT1JfUFJJTlRfT05fTElTVEVOIiwiY29uc29sZSIsImxvZyIsImNhbGxiYWNrcyIsImxvY2FsUG9ydCIsIlBPUlQiLCJ1bml4U29ja2V0UGF0aCIsIlVOSVhfU09DS0VUX1BBVEgiLCJ0ZXN0IiwiaG9zdCIsIkJJTkRfSVAiLCJzZXRJbmxpbmVTY3JpcHRzQWxsb3dlZCIsImVuYWJsZVN1YnJlc291cmNlSW50ZWdyaXR5IiwidXNlX2NyZWRlbnRpYWxzIiwic2V0QnVuZGxlZEpzQ3NzVXJsUmV3cml0ZUhvb2siLCJob29rRm4iLCJzZXRCdW5kbGVkSnNDc3NQcmVmaXgiLCJzZWxmIiwiYWRkU3RhdGljSnMiLCJucG1Db25uZWN0IiwiY29ubmVjdEFyZ3MiLCJoYW5kbGVycyIsImFwcGx5Iiwib3JpZ2luYWxVc2UiLCJ1c2VBcmdzIiwib3JpZ2luYWxMZW5ndGgiLCJlbnRyeSIsIm9yaWdpbmFsSGFuZGxlIiwiaGFuZGxlIiwiYXN5bmNBcHBseSIsImFyZ3VtZW50cyIsInN0YXRTeW5jIiwidW5saW5rU3luYyIsImV4aXN0c1N5bmMiLCJzb2NrZXRQYXRoIiwiaXNTb2NrZXQiLCJldmVudEVtaXR0ZXIiLCJzaWduYWwiXSwibWFwcGluZ3MiOiI7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7OztBQUFBLE1BQUlBLGFBQUo7O0FBQWtCQyxTQUFPLENBQUNDLElBQVIsQ0FBYSxzQ0FBYixFQUFvRDtBQUFDQyxXQUFPLENBQUNDLENBQUQsRUFBRztBQUFDSixtQkFBYSxHQUFDSSxDQUFkO0FBQWdCOztBQUE1QixHQUFwRCxFQUFrRixDQUFsRjtBQUFsQkgsU0FBTyxDQUFDSSxNQUFSLENBQWU7QUFBQ0MsVUFBTSxFQUFDLE1BQUlBLE1BQVo7QUFBbUJDLG1CQUFlLEVBQUMsTUFBSUE7QUFBdkMsR0FBZjtBQUF3RSxNQUFJQyxNQUFKO0FBQVdQLFNBQU8sQ0FBQ0MsSUFBUixDQUFhLFFBQWIsRUFBc0I7QUFBQ0MsV0FBTyxDQUFDQyxDQUFELEVBQUc7QUFBQ0ksWUFBTSxHQUFDSixDQUFQO0FBQVM7O0FBQXJCLEdBQXRCLEVBQTZDLENBQTdDO0FBQWdELE1BQUlLLFlBQUo7QUFBaUJSLFNBQU8sQ0FBQ0MsSUFBUixDQUFhLElBQWIsRUFBa0I7QUFBQ08sZ0JBQVksQ0FBQ0wsQ0FBRCxFQUFHO0FBQUNLLGtCQUFZLEdBQUNMLENBQWI7QUFBZTs7QUFBaEMsR0FBbEIsRUFBb0QsQ0FBcEQ7QUFBdUQsTUFBSU0sWUFBSjtBQUFpQlQsU0FBTyxDQUFDQyxJQUFSLENB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QU5EO0FBT0QsQ0FUSSxDIiwiZmlsZSI6Ii9wYWNrYWdlcy93ZWJhcHAuanMiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgYXNzZXJ0IGZyb20gXCJhc3NlcnRcIjtcbmltcG9ydCB7IHJlYWRGaWxlU3luYyB9IGZyb20gXCJmc1wiO1xuaW1wb3J0IHsgY3JlYXRlU2VydmVyIH0gZnJvbSBcImh0dHBcIjtcbmltcG9ydCB7XG4gIGpvaW4gYXMgcGF0aEpvaW4sXG4gIGRpcm5hbWUgYXMgcGF0aERpcm5hbWUsXG59IGZyb20gXCJwYXRoXCI7XG5pbXBvcnQgeyBwYXJzZSBhcyBwYXJzZVVybCB9IGZyb20gXCJ1cmxcIjtcbmltcG9ydCB7IGNyZWF0ZUhhc2ggfSBmcm9tIFwiY3J5cHRvXCI7XG5pbXBvcnQgeyBjb25uZWN0IH0gZnJvbSBcIi4vY29ubmVjdC5qc1wiO1xuaW1wb3J0IGNvbXByZXNzIGZyb20gXCJjb21wcmVzc2lvblwiO1xuaW1wb3J0IGNvb2tpZVBhcnNlciBmcm9tIFwiY29va2llLXBhcnNlclwiO1xuaW1wb3J0IHFzIGZyb20gXCJxc1wiO1xuaW1wb3J0IHBhcnNlUmVxdWVzdCBmcm9tIFwicGFyc2V1cmxcIjtcbmltcG9ydCBiYXNpY0F1dGggZnJvbSBcImJhc2ljLWF1dGgtY29ubmVjdFwiO1xuaW1wb3J0IHsgbG9va3VwIGFzIGxvb2t1cFVzZXJBZ2VudCB9IGZyb20gXCJ1c2VyYWdlbnRcIjtcbmltcG9ydCB7IGlzTW9kZXJuIH0gZnJvbSBcIm1ldGVvci9tb2Rlcm4tYnJvd3NlcnNcIjtcbmltcG9ydCBzZW5kIGZyb20gXCJzZW5kXCI7XG5pbXBvcnQge1xuICByZW1vdmVFeGlzdGluZ1NvY2tldEZpbGUsXG4gIHJlZ2lzdGVyU29ja2V0RmlsZUNsZWFudXAsXG59IGZyb20gJy4vc29ja2V0X2ZpbGUuanMnO1xuXG52YXIgU0hPUlRfU09DS0VUX1RJTUVPVVQgPSA1KjEwMDA7XG52YXIgTE9OR19TT0NLRVRfVElNRU9VVCA9IDEyMCoxMDAwO1xuXG5leHBvcnQgY29uc3QgV2ViQXBwID0ge307XG5leHBvcnQgY29uc3QgV2ViQXBwSW50ZXJuYWxzID0ge307XG5cbmNvbnN0IGhhc093biA9IE9iamVjdC5wcm90b3R5cGUuaGFzT3duUHJvcGVydHk7XG5cbi8vIGJhY2t3YXJkcyBjb21wYXQgdG8gMi4wIG9mIGNvbm5lY3RcbmNvbm5lY3QuYmFzaWNBdXRoID0gYmFzaWNBdXRoO1xuXG5XZWJBcHBJbnRlcm5hbHMuTnBtTW9kdWxlcyA9IHtcbiAgY29ubmVjdDoge1xuICAgIHZlcnNpb246IE5wbS5yZXF1aXJlKCdjb25uZWN0L3BhY2thZ2UuanNvbicpLnZlcnNpb24sXG4gICAgbW9kdWxlOiBjb25uZWN0LFxuICB9XG59O1xuXG4vLyBUaG91Z2ggd2UgbWlnaHQgcHJlZmVyIHRvIHVzZSB3ZWIuYnJvd3NlciAobW9kZXJuKSBhcyB0aGUgZGVmYXVsdFxuLy8gYXJjaGl0ZWN0dXJlLCBzYWZldHkgcmVxdWlyZXMgYSBtb3JlIGNvbXBhdGlibGUgZGVmYXVsdEFyY2guXG5XZWJBcHAuZGVmYXVsdEFyY2ggPSAnd2ViLmJyb3dzZXIubGVnYWN5JztcblxuLy8gWFhYIG1hcHMgYXJjaHMgdG8gbWFuaWZlc3RzXG5XZWJBcHAuY2xpZW50UHJvZ3JhbXMgPSB7fTtcblxuLy8gWFhYIG1hcHMgYXJjaHMgdG8gcHJvZ3JhbSBwYXRoIG9uIGZpbGVzeXN0ZW1cbnZhciBhcmNoUGF0aCA9IHt9O1xuXG52YXIgYnVuZGxlZEpzQ3NzVXJsUmV3cml0ZUhvb2sgPSBmdW5jdGlvbiAodXJsKSB7XG4gIHZhciBidW5kbGVkUHJlZml4ID1cbiAgICAgX19tZXRlb3JfcnVudGltZV9jb25maWdfXy5ST09UX1VSTF9QQVRIX1BSRUZJWCB8fCAnJztcbiAgcmV0dXJuIGJ1bmRsZWRQcmVmaXggKyB1cmw7XG59O1xuXG52YXIgc2hhMSA9IGZ1bmN0aW9uIChjb250ZW50cykge1xuICB2YXIgaGFzaCA9IGNyZWF0ZUhhc2goJ3NoYTEnKTtcbiAgaGFzaC51cGRhdGUoY29udGVudHMpO1xuICByZXR1cm4gaGFzaC5kaWdlc3QoJ2hleCcpO1xufTtcblxuIGZ1bmN0aW9uIHNob3VsZENvbXByZXNzKHJlcSwgcmVzKSB7XG4gIGlmIChyZXEuaGVhZGVyc1sneC1uby1jb21wcmVzc2lvbiddKSB7XG4gICAgLy8gZG9uJ3QgY29tcHJlc3MgcmVzcG9uc2VzIHdpdGggdGhpcyByZXF1ZXN0IGhlYWRlclxuICAgIHJldHVybiBmYWxzZTtcbiAgfVxuXG4gIC8vIGZhbGxiYWNrIHRvIHN0YW5kYXJkIGZpbHRlciBmdW5jdGlvblxuICByZXR1cm4gY29tcHJlc3MuZmlsdGVyKHJlcSwgcmVzKTtcbn07XG5cbi8vICNCcm93c2VySWRlbnRpZmljYXRpb25cbi8vXG4vLyBXZSBoYXZlIG11bHRpcGxlIHBsYWNlcyB0aGF0IHdhbnQgdG8gaWRlbnRpZnkgdGhlIGJyb3dzZXI6IHRoZVxuLy8gdW5zdXBwb3J0ZWQgYnJvd3NlciBwYWdlLCB0aGUgYXBwY2FjaGUgcGFja2FnZSwgYW5kLCBldmVudHVhbGx5XG4vLyBkZWxpdmVyaW5nIGJyb3dzZXIgcG9seWZpbGxzIG9ubHkgYXMgbmVlZGVkLlxuLy9cbi8vIFRvIGF2b2lkIGRldGVjdGluZyB0aGUgYnJvd3NlciBpbiBtdWx0aXBsZSBwbGFjZXMgYWQtaG9jLCB3ZSBjcmVhdGUgYVxuLy8gTWV0ZW9yIFwiYnJvd3NlclwiIG9iamVjdC4gSXQgdXNlcyBidXQgZG9lcyBub3QgZXhwb3NlIHRoZSBucG1cbi8vIHVzZXJhZ2VudCBtb2R1bGUgKHdlIGNvdWxkIGNob29zZSBhIGRpZmZlcmVudCBtZWNoYW5pc20gdG8gaWRlbnRpZnlcbi8vIHRoZSBicm93c2VyIGluIHRoZSBmdXR1cmUgaWYgd2Ugd2FudGVkIHRvKS4gIFRoZSBicm93c2VyIG9iamVjdFxuLy8gY29udGFpbnNcbi8vXG4vLyAqIGBuYW1lYDogdGhlIG5hbWUgb2YgdGhlIGJyb3dzZXIgaW4gY2FtZWwgY2FzZVxuLy8gKiBgbWFqb3JgLCBgbWlub3JgLCBgcGF0Y2hgOiBpbnRlZ2VycyBkZXNjcmliaW5nIHRoZSBicm93c2VyIHZlcnNpb25cbi8vXG4vLyBBbHNvIGhlcmUgaXMgYW4gZWFybHkgdmVyc2lvbiBvZiBhIE1ldGVvciBgcmVxdWVzdGAgb2JqZWN0LCBpbnRlbmRlZFxuLy8gdG8gYmUgYSBoaWdoLWxldmVsIGRlc2NyaXB0aW9uIG9mIHRoZSByZXF1ZXN0IHdpdGhvdXQgZXhwb3Npbmdcbi8vIGRldGFpbHMgb2YgY29ubmVjdCdzIGxvdy1sZXZlbCBgcmVxYC4gIEN1cnJlbnRseSBpdCBjb250YWluczpcbi8vXG4vLyAqIGBicm93c2VyYDogYnJvd3NlciBpZGVudGlmaWNhdGlvbiBvYmplY3QgZGVzY3JpYmVkIGFib3ZlXG4vLyAqIGB1cmxgOiBwYXJzZWQgdXJsLCBpbmNsdWRpbmcgcGFyc2VkIHF1ZXJ5IHBhcmFtc1xuLy9cbi8vIEFzIGEgdGVtcG9yYXJ5IGhhY2sgdGhlcmUgaXMgYSBgY2F0ZWdvcml6ZVJlcXVlc3RgIGZ1bmN0aW9uIG9uIFdlYkFwcCB3aGljaFxuLy8gY29udmVydHMgYSBjb25uZWN0IGByZXFgIHRvIGEgTWV0ZW9yIGByZXF1ZXN0YC4gVGhpcyBjYW4gZ28gYXdheSBvbmNlIHNtYXJ0XG4vLyBwYWNrYWdlcyBzdWNoIGFzIGFwcGNhY2hlIGFyZSBiZWluZyBwYXNzZWQgYSBgcmVxdWVzdGAgb2JqZWN0IGRpcmVjdGx5IHdoZW5cbi8vIHRoZXkgc2VydmUgY29udGVudC5cbi8vXG4vLyBUaGlzIGFsbG93cyBgcmVxdWVzdGAgdG8gYmUgdXNlZCB1bmlmb3JtbHk6IGl0IGlzIHBhc3NlZCB0byB0aGUgaHRtbFxuLy8gYXR0cmlidXRlcyBob29rLCBhbmQgdGhlIGFwcGNhY2hlIHBhY2thZ2UgY2FuIHVzZSBpdCB3aGVuIGRlY2lkaW5nXG4vLyB3aGV0aGVyIHRvIGdlbmVyYXRlIGEgNDA0IGZvciB0aGUgbWFuaWZlc3QuXG4vL1xuLy8gUmVhbCByb3V0aW5nIC8gc2VydmVyIHNpZGUgcmVuZGVyaW5nIHdpbGwgcHJvYmFibHkgcmVmYWN0b3IgdGhpc1xuLy8gaGVhdmlseS5cblxuXG4vLyBlLmcuIFwiTW9iaWxlIFNhZmFyaVwiID0+IFwibW9iaWxlU2FmYXJpXCJcbnZhciBjYW1lbENhc2UgPSBmdW5jdGlvbiAobmFtZSkge1xuICB2YXIgcGFydHMgPSBuYW1lLnNwbGl0KCcgJyk7XG4gIHBhcnRzWzBdID0gcGFydHNbMF0udG9Mb3dlckNhc2UoKTtcbiAgZm9yICh2YXIgaSA9IDE7ICBpIDwgcGFydHMubGVuZ3RoOyAgKytpKSB7XG4gICAgcGFydHNbaV0gPSBwYXJ0c1tpXS5jaGFyQXQoMCkudG9VcHBlckNhc2UoKSArIHBhcnRzW2ldLnN1YnN0cigxKTtcbiAgfVxuICByZXR1cm4gcGFydHMuam9pbignJyk7XG59O1xuXG52YXIgaWRlbnRpZnlCcm93c2VyID0gZnVuY3Rpb24gKHVzZXJBZ2VudFN0cmluZykge1xuICB2YXIgdXNlckFnZW50ID0gbG9va3VwVXNlckFnZW50KHVzZXJBZ2VudFN0cmluZyk7XG4gIHJldHVybiB7XG4gICAgbmFtZTogY2FtZWxDYXNlKHVzZXJBZ2VudC5mYW1pbHkpLFxuICAgIG1ham9yOiArdXNlckFnZW50Lm1ham9yLFxuICAgIG1pbm9yOiArdXNlckFnZW50Lm1pbm9yLFxuICAgIHBhdGNoOiArdXNlckFnZW50LnBhdGNoXG4gIH07XG59O1xuXG4vLyBYWFggUmVmYWN0b3IgYXMgcGFydCBvZiBpbXBsZW1lbnRpbmcgcmVhbCByb3V0aW5nLlxuV2ViQXBwSW50ZXJuYWxzLmlkZW50aWZ5QnJvd3NlciA9IGlkZW50aWZ5QnJvd3NlcjtcblxuV2ViQXBwLmNhdGVnb3JpemVSZXF1ZXN0ID0gZnVuY3Rpb24gKHJlcSkge1xuICBpZiAocmVxLmJyb3dzZXIgJiYgcmVxLmFyY2ggJiYgdHlwZW9mIHJlcS5tb2Rlcm4gPT09IFwiYm9vbGVhblwiKSB7XG4gICAgLy8gQWxyZWFkeSBjYXRlZ29yaXplZC5cbiAgICByZXR1cm4gcmVxO1xuICB9XG5cbiAgY29uc3QgYnJvd3NlciA9IGlkZW50aWZ5QnJvd3NlcihyZXEuaGVhZGVyc1tcInVzZXItYWdlbnRcIl0pO1xuICBjb25zdCBtb2Rlcm4gPSBpc01vZGVybihicm93c2VyKTtcbiAgY29uc3QgcGF0aCA9IHR5cGVvZiByZXEucGF0aG5hbWUgPT09IFwic3RyaW5nXCJcbiAgID8gcmVxLnBhdGhuYW1lXG4gICA6IHBhcnNlUmVxdWVzdChyZXEpLnBhdGhuYW1lO1xuXG4gIGNvbnN0IGNhdGVnb3JpemVkID0ge1xuICAgIGJyb3dzZXIsXG4gICAgbW9kZXJuLFxuICAgIHBhdGgsXG4gICAgYXJjaDogV2ViQXBwLmRlZmF1bHRBcmNoLFxuICAgIHVybDogcGFyc2VVcmwocmVxLnVybCwgdHJ1ZSksXG4gICAgZHluYW1pY0hlYWQ6IHJlcS5keW5hbWljSGVhZCxcbiAgICBkeW5hbWljQm9keTogcmVxLmR5bmFtaWNCb2R5LFxuICAgIGhlYWRlcnM6IHJlcS5oZWFkZXJzLFxuICAgIGNvb2tpZXM6IHJlcS5jb29raWVzLFxuICB9O1xuXG4gIGNvbnN0IHBhdGhQYXJ0cyA9IHBhdGguc3BsaXQoXCIvXCIpO1xuICBjb25zdCBhcmNoS2V5ID0gcGF0aFBhcnRzWzFdO1xuXG4gIGlmIChhcmNoS2V5LnN0YXJ0c1dpdGgoXCJfX1wiKSkge1xuICAgIGNvbnN0IGFyY2hDbGVhbmVkID0gXCJ3ZWIuXCIgKyBhcmNoS2V5LnNsaWNlKDIpO1xuICAgIGlmIChoYXNPd24uY2FsbChXZWJBcHAuY2xpZW50UHJvZ3JhbXMsIGFyY2hDbGVhbmVkKSkge1xuICAgICAgcGF0aFBhcnRzLnNwbGljZSgxLCAxKTsgLy8gUmVtb3ZlIHRoZSBhcmNoS2V5IHBhcnQuXG4gICAgICByZXR1cm4gT2JqZWN0LmFzc2lnbihjYXRlZ29yaXplZCwge1xuICAgICAgICBhcmNoOiBhcmNoQ2xlYW5lZCxcbiAgICAgICAgcGF0aDogcGF0aFBhcnRzLmpvaW4oXCIvXCIpLFxuICAgICAgfSk7XG4gICAgfVxuICB9XG5cbiAgLy8gVE9ETyBQZXJoYXBzIG9uZSBkYXkgd2UgY291bGQgaW5mZXIgQ29yZG92YSBjbGllbnRzIGhlcmUsIHNvIHRoYXQgd2VcbiAgLy8gd291bGRuJ3QgaGF2ZSB0byB1c2UgcHJlZml4ZWQgXCIvX19jb3Jkb3ZhLy4uLlwiIFVSTHMuXG4gIGNvbnN0IHByZWZlcnJlZEFyY2hPcmRlciA9IGlzTW9kZXJuKGJyb3dzZXIpXG4gICAgPyBbXCJ3ZWIuYnJvd3NlclwiLCBcIndlYi5icm93c2VyLmxlZ2FjeVwiXVxuICAgIDogW1wid2ViLmJyb3dzZXIubGVnYWN5XCIsIFwid2ViLmJyb3dzZXJcIl07XG5cbiAgZm9yIChjb25zdCBhcmNoIG9mIHByZWZlcnJlZEFyY2hPcmRlcikge1xuICAgIC8vIElmIG91ciBwcmVmZXJyZWQgYXJjaCBpcyBub3QgYXZhaWxhYmxlLCBpdCdzIGJldHRlciB0byB1c2UgYW5vdGhlclxuICAgIC8vIGNsaWVudCBhcmNoIHRoYXQgaXMgYXZhaWxhYmxlIHRoYW4gdG8gZ3VhcmFudGVlIHRoZSBzaXRlIHdvbid0IHdvcmtcbiAgICAvLyBieSByZXR1cm5pbmcgYW4gdW5rbm93biBhcmNoLiBGb3IgZXhhbXBsZSwgaWYgd2ViLmJyb3dzZXIubGVnYWN5IGlzXG4gICAgLy8gZXhjbHVkZWQgdXNpbmcgdGhlIC0tZXhjbHVkZS1hcmNocyBjb21tYW5kLWxpbmUgb3B0aW9uLCBsZWdhY3lcbiAgICAvLyBjbGllbnRzIGFyZSBiZXR0ZXIgb2ZmIHJlY2VpdmluZyB3ZWIuYnJvd3NlciAod2hpY2ggbWlnaHQgYWN0dWFsbHlcbiAgICAvLyB3b3JrKSB0aGFuIHJlY2VpdmluZyBhbiBIVFRQIDQwNCByZXNwb25zZS4gSWYgbm9uZSBvZiB0aGUgYXJjaHMgaW5cbiAgICAvLyBwcmVmZXJyZWRBcmNoT3JkZXIgYXJlIGRlZmluZWQsIG9ubHkgdGhlbiBzaG91bGQgd2Ugc2VuZCBhIDQwNC5cbiAgICBpZiAoaGFzT3duLmNhbGwoV2ViQXBwLmNsaWVudFByb2dyYW1zLCBhcmNoKSkge1xuICAgICAgcmV0dXJuIE9iamVjdC5hc3NpZ24oY2F0ZWdvcml6ZWQsIHsgYXJjaCB9KTtcbiAgICB9XG4gIH1cblxuICByZXR1cm4gY2F0ZWdvcml6ZWQ7XG59O1xuXG4vLyBIVE1MIGF0dHJpYnV0ZSBob29rczogZnVuY3Rpb25zIHRvIGJlIGNhbGxlZCB0byBkZXRlcm1pbmUgYW55IGF0dHJpYnV0ZXMgdG9cbi8vIGJlIGFkZGVkIHRvIHRoZSAnPGh0bWw+JyB0YWcuIEVhY2ggZnVuY3Rpb24gaXMgcGFzc2VkIGEgJ3JlcXVlc3QnIG9iamVjdCAoc2VlXG4vLyAjQnJvd3NlcklkZW50aWZpY2F0aW9uKSBhbmQgc2hvdWxkIHJldHVybiBudWxsIG9yIG9iamVjdC5cbnZhciBodG1sQXR0cmlidXRlSG9va3MgPSBbXTtcbnZhciBnZXRIdG1sQXR0cmlidXRlcyA9IGZ1bmN0aW9uIChyZXF1ZXN0KSB7XG4gIHZhciBjb21iaW5lZEF0dHJpYnV0ZXMgID0ge307XG4gIF8uZWFjaChodG1sQXR0cmlidXRlSG9va3MgfHwgW10sIGZ1bmN0aW9uIChob29rKSB7XG4gICAgdmFyIGF0dHJpYnV0ZXMgPSBob29rKHJlcXVlc3QpO1xuICAgIGlmIChhdHRyaWJ1dGVzID09PSBudWxsKVxuICAgICAgcmV0dXJuO1xuICAgIGlmICh0eXBlb2YgYXR0cmlidXRlcyAhPT0gJ29iamVjdCcpXG4gICAgICB0aHJvdyBFcnJvcihcIkhUTUwgYXR0cmlidXRlIGhvb2sgbXVzdCByZXR1cm4gbnVsbCBvciBvYmplY3RcIik7XG4gICAgXy5leHRlbmQoY29tYmluZWRBdHRyaWJ1dGVzLCBhdHRyaWJ1dGVzKTtcbiAgfSk7XG4gIHJldHVybiBjb21iaW5lZEF0dHJpYnV0ZXM7XG59O1xuV2ViQXBwLmFkZEh0bWxBdHRyaWJ1dGVIb29rID0gZnVuY3Rpb24gKGhvb2spIHtcbiAgaHRtbEF0dHJpYnV0ZUhvb2tzLnB1c2goaG9vayk7XG59O1xuXG4vLyBTZXJ2ZSBhcHAgSFRNTCBmb3IgdGhpcyBVUkw/XG52YXIgYXBwVXJsID0gZnVuY3Rpb24gKHVybCkge1xuICBpZiAodXJsID09PSAnL2Zhdmljb24uaWNvJyB8fCB1cmwgPT09ICcvcm9ib3RzLnR4dCcpXG4gICAgcmV0dXJuIGZhbHNlO1xuXG4gIC8vIE5PVEU6IGFwcC5tYW5pZmVzdCBpcyBub3QgYSB3ZWIgc3RhbmRhcmQgbGlrZSBmYXZpY29uLmljbyBhbmRcbiAgLy8gcm9ib3RzLnR4dC4gSXQgaXMgYSBmaWxlIG5hbWUgd2UgaGF2ZSBjaG9zZW4gdG8gdXNlIGZvciBIVE1MNVxuICAvLyBhcHBjYWNoZSBVUkxzLiBJdCBpcyBpbmNsdWRlZCBoZXJlIHRvIHByZXZlbnQgdXNpbmcgYW4gYXBwY2FjaGVcbiAgLy8gdGhlbiByZW1vdmluZyBpdCBmcm9tIHBvaXNvbmluZyBhbiBhcHAgcGVybWFuZW50bHkuIEV2ZW50dWFsbHksXG4gIC8vIG9uY2Ugd2UgaGF2ZSBzZXJ2ZXIgc2lkZSByb3V0aW5nLCB0aGlzIHdvbid0IGJlIG5lZWRlZCBhc1xuICAvLyB1bmtub3duIFVSTHMgd2l0aCByZXR1cm4gYSA0MDQgYXV0b21hdGljYWxseS5cbiAgaWYgKHVybCA9PT0gJy9hcHAubWFuaWZlc3QnKVxuICAgIHJldHVybiBmYWxzZTtcblxuICAvLyBBdm9pZCBzZXJ2aW5nIGFwcCBIVE1MIGZvciBkZWNsYXJlZCByb3V0ZXMgc3VjaCBhcyAvc29ja2pzLy5cbiAgaWYgKFJvdXRlUG9saWN5LmNsYXNzaWZ5KHVybCkpXG4gICAgcmV0dXJuIGZhbHNlO1xuXG4gIC8vIHdlIGN1cnJlbnRseSByZXR1cm4gYXBwIEhUTUwgb24gYWxsIFVSTHMgYnkgZGVmYXVsdFxuICByZXR1cm4gdHJ1ZTtcbn07XG5cblxuLy8gV2UgbmVlZCB0byBjYWxjdWxhdGUgdGhlIGNsaWVudCBoYXNoIGFmdGVyIGFsbCBwYWNrYWdlcyBoYXZlIGxvYWRlZFxuLy8gdG8gZ2l2ZSB0aGVtIGEgY2hhbmNlIHRvIHBvcHVsYXRlIF9fbWV0ZW9yX3J1bnRpbWVfY29uZmlnX18uXG4vL1xuLy8gQ2FsY3VsYXRpbmcgdGhlIGhhc2ggZHVyaW5nIHN0YXJ0dXAgbWVhbnMgdGhhdCBwYWNrYWdlcyBjYW4gb25seVxuLy8gcG9wdWxhdGUgX19tZXRlb3JfcnVudGltZV9jb25maWdfXyBkdXJpbmcgbG9hZCwgbm90IGR1cmluZyBzdGFydHVwLlxuLy9cbi8vIENhbGN1bGF0aW5nIGluc3RlYWQgaXQgYXQgdGhlIGJlZ2lubmluZyBvZiBtYWluIGFmdGVyIGFsbCBzdGFydHVwXG4vLyBob29rcyBoYWQgcnVuIHdvdWxkIGFsbG93IHBhY2thZ2VzIHRvIGFsc28gcG9wdWxhdGVcbi8vIF9fbWV0ZW9yX3J1bnRpbWVfY29uZmlnX18gZHVyaW5nIHN0YXJ0dXAsIGJ1dCB0aGF0J3MgdG9vIGxhdGUgZm9yXG4vLyBhdXRvdXBkYXRlIGJlY2F1c2UgaXQgbmVlZHMgdG8gaGF2ZSB0aGUgY2xpZW50IGhhc2ggYXQgc3RhcnR1cCB0b1xuLy8gaW5zZXJ0IHRoZSBhdXRvIHVwZGF0ZSB2ZXJzaW9uIGl0c2VsZiBpbnRvXG4vLyBfX21ldGVvcl9ydW50aW1lX2NvbmZpZ19fIHRvIGdldCBpdCB0byB0aGUgY2xpZW50LlxuLy9cbi8vIEFuIGFsdGVybmF0aXZlIHdvdWxkIGJlIHRvIGdpdmUgYXV0b3VwZGF0ZSBhIFwicG9zdC1zdGFydCxcbi8vIHByZS1saXN0ZW5cIiBob29rIHRvIGFsbG93IGl0IHRvIGluc2VydCB0aGUgYXV0byB1cGRhdGUgdmVyc2lvbiBhdFxuLy8gdGhlIHJpZ2h0IG1vbWVudC5cblxuTWV0ZW9yLnN0YXJ0dXAoZnVuY3Rpb24gKCkge1xuICBmdW5jdGlvbiBnZXR0ZXIoa2V5KSB7XG4gICAgcmV0dXJuIGZ1bmN0aW9uIChhcmNoKSB7XG4gICAgICBhcmNoID0gYXJjaCB8fCBXZWJBcHAuZGVmYXVsdEFyY2g7XG4gICAgICBjb25zdCBwcm9ncmFtID0gV2ViQXBwLmNsaWVudFByb2dyYW1zW2FyY2hdO1xuICAgICAgY29uc3QgdmFsdWUgPSBwcm9ncmFtICYmIHByb2dyYW1ba2V5XTtcbiAgICAgIC8vIElmIHRoaXMgaXMgdGhlIGZpcnN0IHRpbWUgd2UgaGF2ZSBjYWxjdWxhdGVkIHRoaXMgaGFzaCxcbiAgICAgIC8vIHByb2dyYW1ba2V5XSB3aWxsIGJlIGEgdGh1bmsgKGxhenkgZnVuY3Rpb24gd2l0aCBubyBwYXJhbWV0ZXJzKVxuICAgICAgLy8gdGhhdCB3ZSBzaG91bGQgY2FsbCB0byBkbyB0aGUgYWN0dWFsIGNvbXB1dGF0aW9uLlxuICAgICAgcmV0dXJuIHR5cGVvZiB2YWx1ZSA9PT0gXCJmdW5jdGlvblwiXG4gICAgICAgID8gcHJvZ3JhbVtrZXldID0gdmFsdWUoKVxuICAgICAgICA6IHZhbHVlO1xuICAgIH07XG4gIH1cblxuICBXZWJBcHAuY2FsY3VsYXRlQ2xpZW50SGFzaCA9IFdlYkFwcC5jbGllbnRIYXNoID0gZ2V0dGVyKFwidmVyc2lvblwiKTtcbiAgV2ViQXBwLmNhbGN1bGF0ZUNsaWVudEhhc2hSZWZyZXNoYWJsZSA9IGdldHRlcihcInZlcnNpb25SZWZyZXNoYWJsZVwiKTtcbiAgV2ViQXBwLmNhbGN1bGF0ZUNsaWVudEhhc2hOb25SZWZyZXNoYWJsZSA9IGdldHRlcihcInZlcnNpb25Ob25SZWZyZXNoYWJsZVwiKTtcbiAgV2ViQXBwLmdldFJlZnJlc2hhYmxlQXNzZXRzID0gZ2V0dGVyKFwicmVmcmVzaGFibGVBc3NldHNcIik7XG59KTtcblxuXG5cbi8vIFdoZW4gd2UgaGF2ZSBhIHJlcXVlc3QgcGVuZGluZywgd2Ugd2FudCB0aGUgc29ja2V0IHRpbWVvdXQgdG8gYmUgbG9uZywgdG9cbi8vIGdpdmUgb3Vyc2VsdmVzIGEgd2hpbGUgdG8gc2VydmUgaXQsIGFuZCB0byBhbGxvdyBzb2NranMgbG9uZyBwb2xscyB0b1xuLy8gY29tcGxldGUuICBPbiB0aGUgb3RoZXIgaGFuZCwgd2Ugd2FudCB0byBjbG9zZSBpZGxlIHNvY2tldHMgcmVsYXRpdmVseVxuLy8gcXVpY2tseSwgc28gdGhhdCB3ZSBjYW4gc2h1dCBkb3duIHJlbGF0aXZlbHkgcHJvbXB0bHkgYnV0IGNsZWFubHksIHdpdGhvdXRcbi8vIGN1dHRpbmcgb2ZmIGFueW9uZSdzIHJlc3BvbnNlLlxuV2ViQXBwLl90aW1lb3V0QWRqdXN0bWVudFJlcXVlc3RDYWxsYmFjayA9IGZ1bmN0aW9uIChyZXEsIHJlcykge1xuICAvLyB0aGlzIGlzIHJlYWxseSBqdXN0IHJlcS5zb2NrZXQuc2V0VGltZW91dChMT05HX1NPQ0tFVF9USU1FT1VUKTtcbiAgcmVxLnNldFRpbWVvdXQoTE9OR19TT0NLRVRfVElNRU9VVCk7XG4gIC8vIEluc2VydCBvdXIgbmV3IGZpbmlzaCBsaXN0ZW5lciB0byBydW4gQkVGT1JFIHRoZSBleGlzdGluZyBvbmUgd2hpY2ggcmVtb3Zlc1xuICAvLyB0aGUgcmVzcG9uc2UgZnJvbSB0aGUgc29ja2V0LlxuICB2YXIgZmluaXNoTGlzdGVuZXJzID0gcmVzLmxpc3RlbmVycygnZmluaXNoJyk7XG4gIC8vIFhYWCBBcHBhcmVudGx5IGluIE5vZGUgMC4xMiB0aGlzIGV2ZW50IHdhcyBjYWxsZWQgJ3ByZWZpbmlzaCcuXG4gIC8vIGh0dHBzOi8vZ2l0aHViLmNvbS9qb3llbnQvbm9kZS9jb21taXQvN2M5YjYwNzBcbiAgLy8gQnV0IGl0IGhhcyBzd2l0Y2hlZCBiYWNrIHRvICdmaW5pc2gnIGluIE5vZGUgdjQ6XG4gIC8vIGh0dHBzOi8vZ2l0aHViLmNvbS9ub2RlanMvbm9kZS9wdWxsLzE0MTFcbiAgcmVzLnJlbW92ZUFsbExpc3RlbmVycygnZmluaXNoJyk7XG4gIHJlcy5vbignZmluaXNoJywgZnVuY3Rpb24gKCkge1xuICAgIHJlcy5zZXRUaW1lb3V0KFNIT1JUX1NPQ0tFVF9USU1FT1VUKTtcbiAgfSk7XG4gIF8uZWFjaChmaW5pc2hMaXN0ZW5lcnMsIGZ1bmN0aW9uIChsKSB7IHJlcy5vbignZmluaXNoJywgbCk7IH0pO1xufTtcblxuXG4vLyBXaWxsIGJlIHVwZGF0ZWQgYnkgbWFpbiBiZWZvcmUgd2UgbGlzdGVuLlxuLy8gTWFwIGZyb20gY2xpZW50IGFyY2ggdG8gYm9pbGVycGxhdGUgb2JqZWN0LlxuLy8gQm9pbGVycGxhdGUgb2JqZWN0IGhhczpcbi8vICAgLSBmdW5jOiBYWFhcbi8vICAgLSBiYXNlRGF0YTogWFhYXG52YXIgYm9pbGVycGxhdGVCeUFyY2ggPSB7fTtcblxuLy8gUmVnaXN0ZXIgYSBjYWxsYmFjayBmdW5jdGlvbiB0aGF0IGNhbiBzZWxlY3RpdmVseSBtb2RpZnkgYm9pbGVycGxhdGVcbi8vIGRhdGEgZ2l2ZW4gYXJndW1lbnRzIChyZXF1ZXN0LCBkYXRhLCBhcmNoKS4gVGhlIGtleSBzaG91bGQgYmUgYSB1bmlxdWVcbi8vIGlkZW50aWZpZXIsIHRvIHByZXZlbnQgYWNjdW11bGF0aW5nIGR1cGxpY2F0ZSBjYWxsYmFja3MgZnJvbSB0aGUgc2FtZVxuLy8gY2FsbCBzaXRlIG92ZXIgdGltZS4gQ2FsbGJhY2tzIHdpbGwgYmUgY2FsbGVkIGluIHRoZSBvcmRlciB0aGV5IHdlcmVcbi8vIHJlZ2lzdGVyZWQuIEEgY2FsbGJhY2sgc2hvdWxkIHJldHVybiBmYWxzZSBpZiBpdCBkaWQgbm90IG1ha2UgYW55XG4vLyBjaGFuZ2VzIGFmZmVjdGluZyB0aGUgYm9pbGVycGxhdGUuIFBhc3NpbmcgbnVsbCBkZWxldGVzIHRoZSBjYWxsYmFjay5cbi8vIEFueSBwcmV2aW91cyBjYWxsYmFjayByZWdpc3RlcmVkIGZvciB0aGlzIGtleSB3aWxsIGJlIHJldHVybmVkLlxuY29uc3QgYm9pbGVycGxhdGVEYXRhQ2FsbGJhY2tzID0gT2JqZWN0LmNyZWF0ZShudWxsKTtcbldlYkFwcEludGVybmFscy5yZWdpc3RlckJvaWxlcnBsYXRlRGF0YUNhbGxiYWNrID0gZnVuY3Rpb24gKGtleSwgY2FsbGJhY2spIHtcbiAgY29uc3QgcHJldmlvdXNDYWxsYmFjayA9IGJvaWxlcnBsYXRlRGF0YUNhbGxiYWNrc1trZXldO1xuXG4gIGlmICh0eXBlb2YgY2FsbGJhY2sgPT09IFwiZnVuY3Rpb25cIikge1xuICAgIGJvaWxlcnBsYXRlRGF0YUNhbGxiYWNrc1trZXldID0gY2FsbGJhY2s7XG4gIH0gZWxzZSB7XG4gICAgYXNzZXJ0LnN0cmljdEVxdWFsKGNhbGxiYWNrLCBudWxsKTtcbiAgICBkZWxldGUgYm9pbGVycGxhdGVEYXRhQ2FsbGJhY2tzW2tleV07XG4gIH1cblxuICAvLyBSZXR1cm4gdGhlIHByZXZpb3VzIGNhbGxiYWNrIGluIGNhc2UgdGhlIG5ldyBjYWxsYmFjayBuZWVkcyB0byBjYWxsXG4gIC8vIGl0OyBmb3IgZXhhbXBsZSwgd2hlbiB0aGUgbmV3IGNhbGxiYWNrIGlzIGEgd3JhcHBlciBmb3IgdGhlIG9sZC5cbiAgcmV0dXJuIHByZXZpb3VzQ2FsbGJhY2sgfHwgbnVsbDtcbn07XG5cbi8vIEdpdmVuIGEgcmVxdWVzdCAoYXMgcmV0dXJuZWQgZnJvbSBgY2F0ZWdvcml6ZVJlcXVlc3RgKSwgcmV0dXJuIHRoZVxuLy8gYm9pbGVycGxhdGUgSFRNTCB0byBzZXJ2ZSBmb3IgdGhhdCByZXF1ZXN0LlxuLy9cbi8vIElmIGEgcHJldmlvdXMgY29ubmVjdCBtaWRkbGV3YXJlIGhhcyByZW5kZXJlZCBjb250ZW50IGZvciB0aGUgaGVhZCBvciBib2R5LFxuLy8gcmV0dXJucyB0aGUgYm9pbGVycGxhdGUgd2l0aCB0aGF0IGNvbnRlbnQgcGF0Y2hlZCBpbiBvdGhlcndpc2Vcbi8vIG1lbW9pemVzIG9uIEhUTUwgYXR0cmlidXRlcyAodXNlZCBieSwgZWcsIGFwcGNhY2hlKSBhbmQgd2hldGhlciBpbmxpbmVcbi8vIHNjcmlwdHMgYXJlIGN1cnJlbnRseSBhbGxvd2VkLlxuLy8gWFhYIHNvIGZhciB0aGlzIGZ1bmN0aW9uIGlzIGFsd2F5cyBjYWxsZWQgd2l0aCBhcmNoID09PSAnd2ViLmJyb3dzZXInXG5mdW5jdGlvbiBnZXRCb2lsZXJwbGF0ZShyZXF1ZXN0LCBhcmNoKSB7XG4gIHJldHVybiBnZXRCb2lsZXJwbGF0ZUFzeW5jKHJlcXVlc3QsIGFyY2gpLmF3YWl0KCk7XG59XG5cbmZ1bmN0aW9uIGdldEJvaWxlcnBsYXRlQXN5bmMocmVxdWVzdCwgYXJjaCkge1xuICBjb25zdCBib2lsZXJwbGF0ZSA9IGJvaWxlcnBsYXRlQnlBcmNoW2FyY2hdO1xuICBjb25zdCBkYXRhID0gT2JqZWN0LmFzc2lnbih7fSwgYm9pbGVycGxhdGUuYmFzZURhdGEsIHtcbiAgICBodG1sQXR0cmlidXRlczogZ2V0SHRtbEF0dHJpYnV0ZXMocmVxdWVzdCksXG4gIH0sIF8ucGljayhyZXF1ZXN0LCBcImR5bmFtaWNIZWFkXCIsIFwiZHluYW1pY0JvZHlcIikpO1xuXG4gIGxldCBtYWRlQ2hhbmdlcyA9IGZhbHNlO1xuICBsZXQgcHJvbWlzZSA9IFByb21pc2UucmVzb2x2ZSgpO1xuXG4gIE9iamVjdC5rZXlzKGJvaWxlcnBsYXRlRGF0YUNhbGxiYWNrcykuZm9yRWFjaChrZXkgPT4ge1xuICAgIHByb21pc2UgPSBwcm9taXNlLnRoZW4oKCkgPT4ge1xuICAgICAgY29uc3QgY2FsbGJhY2sgPSBib2lsZXJwbGF0ZURhdGFDYWxsYmFja3Nba2V5XTtcbiAgICAgIHJldHVybiBjYWxsYmFjayhyZXF1ZXN0LCBkYXRhLCBhcmNoKTtcbiAgICB9KS50aGVuKHJlc3VsdCA9PiB7XG4gICAgICAvLyBDYWxsYmFja3Mgc2hvdWxkIHJldHVybiBmYWxzZSBpZiB0aGV5IGRpZCBub3QgbWFrZSBhbnkgY2hhbmdlcy5cbiAgICAgIGlmIChyZXN1bHQgIT09IGZhbHNlKSB7XG4gICAgICAgIG1hZGVDaGFuZ2VzID0gdHJ1ZTtcbiAgICAgIH1cbiAgICB9KTtcbiAgfSk7XG5cbiAgcmV0dXJuIHByb21pc2UudGhlbigoKSA9PiAoe1xuICAgIHN0cmVhbTogYm9pbGVycGxhdGUudG9IVE1MU3RyZWFtKGRhdGEpLFxuICAgIHN0YXR1c0NvZGU6IGRhdGEuc3RhdHVzQ29kZSxcbiAgICBoZWFkZXJzOiBkYXRhLmhlYWRlcnMsXG4gIH0pKTtcbn1cblxuV2ViQXBwSW50ZXJuYWxzLmdlbmVyYXRlQm9pbGVycGxhdGVJbnN0YW5jZSA9IGZ1bmN0aW9uIChhcmNoLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBtYW5pZmVzdCxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgYWRkaXRpb25hbE9wdGlvbnMpIHtcbiAgYWRkaXRpb25hbE9wdGlvbnMgPSBhZGRpdGlvbmFsT3B0aW9ucyB8fCB7fTtcblxuICBjb25zdCBtZXRlb3JSdW50aW1lQ29uZmlnID0gSlNPTi5zdHJpbmdpZnkoXG4gICAgZW5jb2RlVVJJQ29tcG9uZW50KEpTT04uc3RyaW5naWZ5KHtcbiAgICAgIC4uLl9fbWV0ZW9yX3J1bnRpbWVfY29uZmlnX18sXG4gICAgICAuLi4oYWRkaXRpb25hbE9wdGlvbnMucnVudGltZUNvbmZpZ092ZXJyaWRlcyB8fCB7fSlcbiAgICB9KSlcbiAgKTtcblxuICByZXR1cm4gbmV3IEJvaWxlcnBsYXRlKGFyY2gsIG1hbmlmZXN0LCBfLmV4dGVuZCh7XG4gICAgcGF0aE1hcHBlcihpdGVtUGF0aCkge1xuICAgICAgcmV0dXJuIHBhdGhKb2luKGFyY2hQYXRoW2FyY2hdLCBpdGVtUGF0aCk7XG4gICAgfSxcbiAgICBiYXNlRGF0YUV4dGVuc2lvbjoge1xuICAgICAgYWRkaXRpb25hbFN0YXRpY0pzOiBfLm1hcChcbiAgICAgICAgYWRkaXRpb25hbFN0YXRpY0pzIHx8IFtdLFxuICAgICAgICBmdW5jdGlvbiAoY29udGVudHMsIHBhdGhuYW1lKSB7XG4gICAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICAgIHBhdGhuYW1lOiBwYXRobmFtZSxcbiAgICAgICAgICAgIGNvbnRlbnRzOiBjb250ZW50c1xuICAgICAgICAgIH07XG4gICAgICAgIH1cbiAgICAgICksXG4gICAgICAvLyBDb252ZXJ0IHRvIGEgSlNPTiBzdHJpbmcsIHRoZW4gZ2V0IHJpZCBvZiBtb3N0IHdlaXJkIGNoYXJhY3RlcnMsIHRoZW5cbiAgICAgIC8vIHdyYXAgaW4gZG91YmxlIHF1b3Rlcy4gKFRoZSBvdXRlcm1vc3QgSlNPTi5zdHJpbmdpZnkgcmVhbGx5IG91Z2h0IHRvXG4gICAgICAvLyBqdXN0IGJlIFwid3JhcCBpbiBkb3VibGUgcXVvdGVzXCIgYnV0IHdlIHVzZSBpdCB0byBiZSBzYWZlLikgVGhpcyBtaWdodFxuICAgICAgLy8gZW5kIHVwIGluc2lkZSBhIDxzY3JpcHQ+IHRhZyBzbyB3ZSBuZWVkIHRvIGJlIGNhcmVmdWwgdG8gbm90IGluY2x1ZGVcbiAgICAgIC8vIFwiPC9zY3JpcHQ+XCIsIGJ1dCBub3JtYWwge3tzcGFjZWJhcnN9fSBlc2NhcGluZyBlc2NhcGVzIHRvbyBtdWNoISBTZWVcbiAgICAgIC8vIGh0dHBzOi8vZ2l0aHViLmNvbS9tZXRlb3IvbWV0ZW9yL2lzc3Vlcy8zNzMwXG4gICAgICBtZXRlb3JSdW50aW1lQ29uZmlnLFxuICAgICAgbWV0ZW9yUnVudGltZUhhc2g6IHNoYTEobWV0ZW9yUnVudGltZUNvbmZpZyksXG4gICAgICByb290VXJsUGF0aFByZWZpeDogX19tZXRlb3JfcnVudGltZV9jb25maWdfXy5ST09UX1VSTF9QQVRIX1BSRUZJWCB8fCAnJyxcbiAgICAgIGJ1bmRsZWRKc0Nzc1VybFJld3JpdGVIb29rOiBidW5kbGVkSnNDc3NVcmxSZXdyaXRlSG9vayxcbiAgICAgIHNyaU1vZGU6IHNyaU1vZGUsXG4gICAgICBpbmxpbmVTY3JpcHRzQWxsb3dlZDogV2ViQXBwSW50ZXJuYWxzLmlubGluZVNjcmlwdHNBbGxvd2VkKCksXG4gICAgICBpbmxpbmU6IGFkZGl0aW9uYWxPcHRpb25zLmlubGluZVxuICAgIH1cbiAgfSwgYWRkaXRpb25hbE9wdGlvbnMpKTtcbn07XG5cbi8vIEEgbWFwcGluZyBmcm9tIHVybCBwYXRoIHRvIGFyY2hpdGVjdHVyZSAoZS5nLiBcIndlYi5icm93c2VyXCIpIHRvIHN0YXRpY1xuLy8gZmlsZSBpbmZvcm1hdGlvbiB3aXRoIHRoZSBmb2xsb3dpbmcgZmllbGRzOlxuLy8gLSB0eXBlOiB0aGUgdHlwZSBvZiBmaWxlIHRvIGJlIHNlcnZlZFxuLy8gLSBjYWNoZWFibGU6IG9wdGlvbmFsbHksIHdoZXRoZXIgdGhlIGZpbGUgc2hvdWxkIGJlIGNhY2hlZCBvciBub3Rcbi8vIC0gc291cmNlTWFwVXJsOiBvcHRpb25hbGx5LCB0aGUgdXJsIG9mIHRoZSBzb3VyY2UgbWFwXG4vL1xuLy8gSW5mbyBhbHNvIGNvbnRhaW5zIG9uZSBvZiB0aGUgZm9sbG93aW5nOlxuLy8gLSBjb250ZW50OiB0aGUgc3RyaW5naWZpZWQgY29udGVudCB0aGF0IHNob3VsZCBiZSBzZXJ2ZWQgYXQgdGhpcyBwYXRoXG4vLyAtIGFic29sdXRlUGF0aDogdGhlIGFic29sdXRlIHBhdGggb24gZGlzayB0byB0aGUgZmlsZVxuXG4vLyBTZXJ2ZSBzdGF0aWMgZmlsZXMgZnJvbSB0aGUgbWFuaWZlc3Qgb3IgYWRkZWQgd2l0aFxuLy8gYGFkZFN0YXRpY0pzYC4gRXhwb3J0ZWQgZm9yIHRlc3RzLlxuV2ViQXBwSW50ZXJuYWxzLnN0YXRpY0ZpbGVzTWlkZGxld2FyZSA9IGFzeW5jIGZ1bmN0aW9uIChcbiAgc3RhdGljRmlsZXNCeUFyY2gsXG4gIHJlcSxcbiAgcmVzLFxuICBuZXh0LFxuKSB7XG4gIGlmICgnR0VUJyAhPSByZXEubWV0aG9kICYmICdIRUFEJyAhPSByZXEubWV0aG9kICYmICdPUFRJT05TJyAhPSByZXEubWV0aG9kKSB7XG4gICAgbmV4dCgpO1xuICAgIHJldHVybjtcbiAgfVxuICB2YXIgcGF0aG5hbWUgPSBwYXJzZVJlcXVlc3QocmVxKS5wYXRobmFtZTtcbiAgdHJ5IHtcbiAgICBwYXRobmFtZSA9IGRlY29kZVVSSUNvbXBvbmVudChwYXRobmFtZSk7XG4gIH0gY2F0Y2ggKGUpIHtcbiAgICBuZXh0KCk7XG4gICAgcmV0dXJuO1xuICB9XG5cbiAgdmFyIHNlcnZlU3RhdGljSnMgPSBmdW5jdGlvbiAocykge1xuICAgIHJlcy53cml0ZUhlYWQoMjAwLCB7XG4gICAgICAnQ29udGVudC10eXBlJzogJ2FwcGxpY2F0aW9uL2phdmFzY3JpcHQ7IGNoYXJzZXQ9VVRGLTgnXG4gICAgfSk7XG4gICAgcmVzLndyaXRlKHMpO1xuICAgIHJlcy5lbmQoKTtcbiAgfTtcblxuICBpZiAoXy5oYXMoYWRkaXRpb25hbFN0YXRpY0pzLCBwYXRobmFtZSkgJiZcbiAgICAgICAgICAgICAgISBXZWJBcHBJbnRlcm5hbHMuaW5saW5lU2NyaXB0c0FsbG93ZWQoKSkge1xuICAgIHNlcnZlU3RhdGljSnMoYWRkaXRpb25hbFN0YXRpY0pzW3BhdGhuYW1lXSk7XG4gICAgcmV0dXJuO1xuICB9XG5cbiAgY29uc3QgeyBhcmNoLCBwYXRoIH0gPSBXZWJBcHAuY2F0ZWdvcml6ZVJlcXVlc3QocmVxKTtcblxuICBpZiAoISBoYXNPd24uY2FsbChXZWJBcHAuY2xpZW50UHJvZ3JhbXMsIGFyY2gpKSB7XG4gICAgLy8gV2UgY291bGQgY29tZSBoZXJlIGluIGNhc2Ugd2UgcnVuIHdpdGggc29tZSBhcmNoaXRlY3R1cmVzIGV4Y2x1ZGVkXG4gICAgbmV4dCgpO1xuICAgIHJldHVybjtcbiAgfVxuXG4gIC8vIElmIHBhdXNlQ2xpZW50KGFyY2gpIGhhcyBiZWVuIGNhbGxlZCwgcHJvZ3JhbS5wYXVzZWQgd2lsbCBiZSBhXG4gIC8vIFByb21pc2UgdGhhdCB3aWxsIGJlIHJlc29sdmVkIHdoZW4gdGhlIHByb2dyYW0gaXMgdW5wYXVzZWQuXG4gIGNvbnN0IHByb2dyYW0gPSBXZWJBcHAuY2xpZW50UHJvZ3JhbXNbYXJjaF07XG4gIGF3YWl0IHByb2dyYW0ucGF1c2VkO1xuXG4gIGlmIChwYXRoID09PSBcIi9tZXRlb3JfcnVudGltZV9jb25maWcuanNcIiAmJlxuICAgICAgISBXZWJBcHBJbnRlcm5hbHMuaW5saW5lU2NyaXB0c0FsbG93ZWQoKSkge1xuICAgIHNlcnZlU3RhdGljSnMoYF9fbWV0ZW9yX3J1bnRpbWVfY29uZmlnX18gPSAke3Byb2dyYW0ubWV0ZW9yUnVudGltZUNvbmZpZ307YCk7XG4gICAgcmV0dXJuO1xuICB9XG5cbiAgY29uc3QgaW5mbyA9IGdldFN0YXRpY0ZpbGVJbmZvKHN0YXRpY0ZpbGVzQnlBcmNoLCBwYXRobmFtZSwgcGF0aCwgYXJjaCk7XG4gIGlmICghIGluZm8pIHtcbiAgICBuZXh0KCk7XG4gICAgcmV0dXJuO1xuICB9XG5cbiAgLy8gV2UgZG9uJ3QgbmVlZCB0byBjYWxsIHBhdXNlIGJlY2F1c2UsIHVubGlrZSAnc3RhdGljJywgb25jZSB3ZSBjYWxsIGludG9cbiAgLy8gJ3NlbmQnIGFuZCB5aWVsZCB0byB0aGUgZXZlbnQgbG9vcCwgd2UgbmV2ZXIgY2FsbCBhbm90aGVyIGhhbmRsZXIgd2l0aFxuICAvLyAnbmV4dCcuXG5cbiAgLy8gQ2FjaGVhYmxlIGZpbGVzIGFyZSBmaWxlcyB0aGF0IHNob3VsZCBuZXZlciBjaGFuZ2UuIFR5cGljYWxseVxuICAvLyBuYW1lZCBieSB0aGVpciBoYXNoIChlZyBtZXRlb3IgYnVuZGxlZCBqcyBhbmQgY3NzIGZpbGVzKS5cbiAgLy8gV2UgY2FjaGUgdGhlbSB+Zm9yZXZlciAoMXlyKS5cbiAgY29uc3QgbWF4QWdlID0gaW5mby5jYWNoZWFibGVcbiAgICA/IDEwMDAgKiA2MCAqIDYwICogMjQgKiAzNjVcbiAgICA6IDA7XG5cbiAgaWYgKGluZm8uY2FjaGVhYmxlKSB7XG4gICAgLy8gU2luY2Ugd2UgdXNlIHJlcS5oZWFkZXJzW1widXNlci1hZ2VudFwiXSB0byBkZXRlcm1pbmUgd2hldGhlciB0aGVcbiAgICAvLyBjbGllbnQgc2hvdWxkIHJlY2VpdmUgbW9kZXJuIG9yIGxlZ2FjeSByZXNvdXJjZXMsIHRlbGwgdGhlIGNsaWVudFxuICAgIC8vIHRvIGludmFsaWRhdGUgY2FjaGVkIHJlc291cmNlcyB3aGVuL2lmIGl0cyB1c2VyIGFnZW50IHN0cmluZ1xuICAgIC8vIGNoYW5nZXMgaW4gdGhlIGZ1dHVyZS5cbiAgICByZXMuc2V0SGVhZGVyKFwiVmFyeVwiLCBcIlVzZXItQWdlbnRcIik7XG4gIH1cblxuICAvLyBTZXQgdGhlIFgtU291cmNlTWFwIGhlYWRlciwgd2hpY2ggY3VycmVudCBDaHJvbWUsIEZpcmVGb3gsIGFuZCBTYWZhcmlcbiAgLy8gdW5kZXJzdGFuZC4gIChUaGUgU291cmNlTWFwIGhlYWRlciBpcyBzbGlnaHRseSBtb3JlIHNwZWMtY29ycmVjdCBidXQgRkZcbiAgLy8gZG9lc24ndCB1bmRlcnN0YW5kIGl0LilcbiAgLy9cbiAgLy8gWW91IG1heSBhbHNvIG5lZWQgdG8gZW5hYmxlIHNvdXJjZSBtYXBzIGluIENocm9tZTogb3BlbiBkZXYgdG9vbHMsIGNsaWNrXG4gIC8vIHRoZSBnZWFyIGluIHRoZSBib3R0b20gcmlnaHQgY29ybmVyLCBhbmQgc2VsZWN0IFwiZW5hYmxlIHNvdXJjZSBtYXBzXCIuXG4gIGlmIChpbmZvLnNvdXJjZU1hcFVybCkge1xuICAgIHJlcy5zZXRIZWFkZXIoJ1gtU291cmNlTWFwJyxcbiAgICAgICAgICAgICAgICAgIF9fbWV0ZW9yX3J1bnRpbWVfY29uZmlnX18uUk9PVF9VUkxfUEFUSF9QUkVGSVggK1xuICAgICAgICAgICAgICAgICAgaW5mby5zb3VyY2VNYXBVcmwpO1xuICB9XG5cbiAgaWYgKGluZm8udHlwZSA9PT0gXCJqc1wiIHx8XG4gICAgICBpbmZvLnR5cGUgPT09IFwiZHluYW1pYyBqc1wiKSB7XG4gICAgcmVzLnNldEhlYWRlcihcIkNvbnRlbnQtVHlwZVwiLCBcImFwcGxpY2F0aW9uL2phdmFzY3JpcHQ7IGNoYXJzZXQ9VVRGLThcIik7XG4gIH0gZWxzZSBpZiAoaW5mby50eXBlID09PSBcImNzc1wiKSB7XG4gICAgcmVzLnNldEhlYWRlcihcIkNvbnRlbnQtVHlwZVwiLCBcInRleHQvY3NzOyBjaGFyc2V0PVVURi04XCIpO1xuICB9IGVsc2UgaWYgKGluZm8udHlwZSA9PT0gXCJqc29uXCIpIHtcbiAgICByZXMuc2V0SGVhZGVyKFwiQ29udGVudC1UeXBlXCIsIFwiYXBwbGljYXRpb24vanNvbjsgY2hhcnNldD1VVEYtOFwiKTtcbiAgfVxuXG4gIGlmIChpbmZvLmhhc2gpIHtcbiAgICByZXMuc2V0SGVhZGVyKCdFVGFnJywgJ1wiJyArIGluZm8uaGFzaCArICdcIicpO1xuICB9XG5cbiAgaWYgKGluZm8uY29udGVudCkge1xuICAgIHJlcy53cml0ZShpbmZvLmNvbnRlbnQpO1xuICAgIHJlcy5lbmQoKTtcbiAgfSBlbHNlIHtcbiAgICBzZW5kKHJlcSwgaW5mby5hYnNvbHV0ZVBhdGgsIHtcbiAgICAgIG1heGFnZTogbWF4QWdlLFxuICAgICAgZG90ZmlsZXM6ICdhbGxvdycsIC8vIGlmIHdlIHNwZWNpZmllZCBhIGRvdGZpbGUgaW4gdGhlIG1hbmlmZXN0LCBzZXJ2ZSBpdFxuICAgICAgbGFzdE1vZGlmaWVkOiBmYWxzZSAvLyBkb24ndCBzZXQgbGFzdC1tb2RpZmllZCBiYXNlZCBvbiB0aGUgZmlsZSBkYXRlXG4gICAgfSkub24oJ2Vycm9yJywgZnVuY3Rpb24gKGVycikge1xuICAgICAgTG9nLmVycm9yKFwiRXJyb3Igc2VydmluZyBzdGF0aWMgZmlsZSBcIiArIGVycik7XG4gICAgICByZXMud3JpdGVIZWFkKDUwMCk7XG4gICAgICByZXMuZW5kKCk7XG4gICAgfSkub24oJ2RpcmVjdG9yeScsIGZ1bmN0aW9uICgpIHtcbiAgICAgIExvZy5lcnJvcihcIlVuZXhwZWN0ZWQgZGlyZWN0b3J5IFwiICsgaW5mby5hYnNvbHV0ZVBhdGgpO1xuICAgICAgcmVzLndyaXRlSGVhZCg1MDApO1xuICAgICAgcmVzLmVuZCgpO1xuICAgIH0pLnBpcGUocmVzKTtcbiAgfVxufTtcblxuZnVuY3Rpb24gZ2V0U3RhdGljRmlsZUluZm8oc3RhdGljRmlsZXNCeUFyY2gsIG9yaWdpbmFsUGF0aCwgcGF0aCwgYXJjaCkge1xuICBpZiAoISBoYXNPd24uY2FsbChXZWJBcHAuY2xpZW50UHJvZ3JhbXMsIGFyY2gpKSB7XG4gICAgcmV0dXJuIG51bGw7XG4gIH1cblxuICAvLyBHZXQgYSBsaXN0IG9mIGFsbCBhdmFpbGFibGUgc3RhdGljIGZpbGUgYXJjaGl0ZWN0dXJlcywgd2l0aCBhcmNoXG4gIC8vIGZpcnN0IGluIHRoZSBsaXN0IGlmIGl0IGV4aXN0cy5cbiAgY29uc3Qgc3RhdGljQXJjaExpc3QgPSBPYmplY3Qua2V5cyhzdGF0aWNGaWxlc0J5QXJjaCk7XG4gIGNvbnN0IGFyY2hJbmRleCA9IHN0YXRpY0FyY2hMaXN0LmluZGV4T2YoYXJjaCk7XG4gIGlmIChhcmNoSW5kZXggPiAwKSB7XG4gICAgc3RhdGljQXJjaExpc3QudW5zaGlmdChzdGF0aWNBcmNoTGlzdC5zcGxpY2UoYXJjaEluZGV4LCAxKVswXSk7XG4gIH1cblxuICBsZXQgaW5mbyA9IG51bGw7XG5cbiAgc3RhdGljQXJjaExpc3Quc29tZShhcmNoID0+IHtcbiAgICBjb25zdCBzdGF0aWNGaWxlcyA9IHN0YXRpY0ZpbGVzQnlBcmNoW2FyY2hdO1xuXG4gICAgZnVuY3Rpb24gZmluYWxpemUocGF0aCkge1xuICAgICAgaW5mbyA9IHN0YXRpY0ZpbGVzW3BhdGhdO1xuICAgICAgLy8gU29tZXRpbWVzIHdlIHJlZ2lzdGVyIGEgbGF6eSBmdW5jdGlvbiBpbnN0ZWFkIG9mIGFjdHVhbCBkYXRhIGluXG4gICAgICAvLyB0aGUgc3RhdGljRmlsZXMgbWFuaWZlc3QuXG4gICAgICBpZiAodHlwZW9mIGluZm8gPT09IFwiZnVuY3Rpb25cIikge1xuICAgICAgICBpbmZvID0gc3RhdGljRmlsZXNbcGF0aF0gPSBpbmZvKCk7XG4gICAgICB9XG4gICAgICByZXR1cm4gaW5mbztcbiAgICB9XG5cbiAgICAvLyBJZiBzdGF0aWNGaWxlcyBjb250YWlucyBvcmlnaW5hbFBhdGggd2l0aCB0aGUgYXJjaCBpbmZlcnJlZCBhYm92ZSxcbiAgICAvLyB1c2UgdGhhdCBpbmZvcm1hdGlvbi5cbiAgICBpZiAoaGFzT3duLmNhbGwoc3RhdGljRmlsZXMsIG9yaWdpbmFsUGF0aCkpIHtcbiAgICAgIHJldHVybiBmaW5hbGl6ZShvcmlnaW5hbFBhdGgpO1xuICAgIH1cblxuICAgIC8vIElmIGNhdGVnb3JpemVSZXF1ZXN0IHJldHVybmVkIGFuIGFsdGVybmF0ZSBwYXRoLCB0cnkgdGhhdCBpbnN0ZWFkLlxuICAgIGlmIChwYXRoICE9PSBvcmlnaW5hbFBhdGggJiZcbiAgICAgICAgaGFzT3duLmNhbGwoc3RhdGljRmlsZXMsIHBhdGgpKSB7XG4gICAgICByZXR1cm4gZmluYWxpemUocGF0aCk7XG4gICAgfVxuICB9KTtcblxuICByZXR1cm4gaW5mbztcbn1cblxuLy8gUGFyc2UgdGhlIHBhc3NlZCBpbiBwb3J0IHZhbHVlLiBSZXR1cm4gdGhlIHBvcnQgYXMtaXMgaWYgaXQncyBhIFN0cmluZ1xuLy8gKGUuZy4gYSBXaW5kb3dzIFNlcnZlciBzdHlsZSBuYW1lZCBwaXBlKSwgb3RoZXJ3aXNlIHJldHVybiB0aGUgcG9ydCBhcyBhblxuLy8gaW50ZWdlci5cbi8vXG4vLyBERVBSRUNBVEVEOiBEaXJlY3QgdXNlIG9mIHRoaXMgZnVuY3Rpb24gaXMgbm90IHJlY29tbWVuZGVkOyBpdCBpcyBub1xuLy8gbG9uZ2VyIHVzZWQgaW50ZXJuYWxseSwgYW5kIHdpbGwgYmUgcmVtb3ZlZCBpbiBhIGZ1dHVyZSByZWxlYXNlLlxuV2ViQXBwSW50ZXJuYWxzLnBhcnNlUG9ydCA9IHBvcnQgPT4ge1xuICBsZXQgcGFyc2VkUG9ydCA9IHBhcnNlSW50KHBvcnQpO1xuICBpZiAoTnVtYmVyLmlzTmFOKHBhcnNlZFBvcnQpKSB7XG4gICAgcGFyc2VkUG9ydCA9IHBvcnQ7XG4gIH1cbiAgcmV0dXJuIHBhcnNlZFBvcnQ7XG59XG5cbmltcG9ydCB7IG9uTWVzc2FnZSB9IGZyb20gXCJtZXRlb3IvaW50ZXItcHJvY2Vzcy1tZXNzYWdpbmdcIjtcblxub25NZXNzYWdlKFwid2ViYXBwLXBhdXNlLWNsaWVudFwiLCBhc3luYyAoeyBhcmNoIH0pID0+IHtcbiAgV2ViQXBwSW50ZXJuYWxzLnBhdXNlQ2xpZW50KGFyY2gpO1xufSk7XG5cbm9uTWVzc2FnZShcIndlYmFwcC1yZWxvYWQtY2xpZW50XCIsIGFzeW5jICh7IGFyY2ggfSkgPT4ge1xuICBXZWJBcHBJbnRlcm5hbHMuZ2VuZXJhdGVDbGllbnRQcm9ncmFtKGFyY2gpO1xufSk7XG5cbmZ1bmN0aW9uIHJ1bldlYkFwcFNlcnZlcigpIHtcbiAgdmFyIHNodXR0aW5nRG93biA9IGZhbHNlO1xuICB2YXIgc3luY1F1ZXVlID0gbmV3IE1ldGVvci5fU3luY2hyb25vdXNRdWV1ZSgpO1xuXG4gIHZhciBnZXRJdGVtUGF0aG5hbWUgPSBmdW5jdGlvbiAoaXRlbVVybCkge1xuICAgIHJldHVybiBkZWNvZGVVUklDb21wb25lbnQocGFyc2VVcmwoaXRlbVVybCkucGF0aG5hbWUpO1xuICB9O1xuXG4gIFdlYkFwcEludGVybmFscy5yZWxvYWRDbGllbnRQcm9ncmFtcyA9IGZ1bmN0aW9uICgpIHtcbiAgICBzeW5jUXVldWUucnVuVGFzayhmdW5jdGlvbigpIHtcbiAgICAgIGNvbnN0IHN0YXRpY0ZpbGVzQnlBcmNoID0gT2JqZWN0LmNyZWF0ZShudWxsKTtcblxuICAgICAgY29uc3QgeyBjb25maWdKc29uIH0gPSBfX21ldGVvcl9ib290c3RyYXBfXztcbiAgICAgIGNvbnN0IGNsaWVudEFyY2hzID0gY29uZmlnSnNvbi5jbGllbnRBcmNocyB8fFxuICAgICAgICBPYmplY3Qua2V5cyhjb25maWdKc29uLmNsaWVudFBhdGhzKTtcblxuICAgICAgdHJ5IHtcbiAgICAgICAgY2xpZW50QXJjaHMuZm9yRWFjaChhcmNoID0+IHtcbiAgICAgICAgICBnZW5lcmF0ZUNsaWVudFByb2dyYW0oYXJjaCwgc3RhdGljRmlsZXNCeUFyY2gpO1xuICAgICAgICB9KTtcbiAgICAgICAgV2ViQXBwSW50ZXJuYWxzLnN0YXRpY0ZpbGVzQnlBcmNoID0gc3RhdGljRmlsZXNCeUFyY2g7XG4gICAgICB9IGNhdGNoIChlKSB7XG4gICAgICAgIExvZy5lcnJvcihcIkVycm9yIHJlbG9hZGluZyB0aGUgY2xpZW50IHByb2dyYW06IFwiICsgZS5zdGFjayk7XG4gICAgICAgIHByb2Nlc3MuZXhpdCgxKTtcbiAgICAgIH1cbiAgICB9KTtcbiAgfTtcblxuICAvLyBQYXVzZSBhbnkgaW5jb21pbmcgcmVxdWVzdHMgYW5kIG1ha2UgdGhlbSB3YWl0IGZvciB0aGUgcHJvZ3JhbSB0byBiZVxuICAvLyB1bnBhdXNlZCB0aGUgbmV4dCB0aW1lIGdlbmVyYXRlQ2xpZW50UHJvZ3JhbShhcmNoKSBpcyBjYWxsZWQuXG4gIFdlYkFwcEludGVybmFscy5wYXVzZUNsaWVudCA9IGZ1bmN0aW9uIChhcmNoKSB7XG4gICAgc3luY1F1ZXVlLnJ1blRhc2soKCkgPT4ge1xuICAgICAgY29uc3QgcHJvZ3JhbSA9IFdlYkFwcC5jbGllbnRQcm9ncmFtc1thcmNoXTtcbiAgICAgIGNvbnN0IHsgdW5wYXVzZSB9ID0gcHJvZ3JhbTtcbiAgICAgIHByb2dyYW0ucGF1c2VkID0gbmV3IFByb21pc2UocmVzb2x2ZSA9PiB7XG4gICAgICAgIGlmICh0eXBlb2YgdW5wYXVzZSA9PT0gXCJmdW5jdGlvblwiKSB7XG4gICAgICAgICAgLy8gSWYgdGhlcmUgaGFwcGVucyB0byBiZSBhbiBleGlzdGluZyBwcm9ncmFtLnVucGF1c2UgZnVuY3Rpb24sXG4gICAgICAgICAgLy8gY29tcG9zZSBpdCB3aXRoIHRoZSByZXNvbHZlIGZ1bmN0aW9uLlxuICAgICAgICAgIHByb2dyYW0udW5wYXVzZSA9IGZ1bmN0aW9uICgpIHtcbiAgICAgICAgICAgIHVucGF1c2UoKTtcbiAgICAgICAgICAgIHJlc29sdmUoKTtcbiAgICAgICAgICB9O1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIHByb2dyYW0udW5wYXVzZSA9IHJlc29sdmU7XG4gICAgICAgIH1cbiAgICAgIH0pO1xuICAgIH0pO1xuICB9O1xuXG4gIFdlYkFwcEludGVybmFscy5nZW5lcmF0ZUNsaWVudFByb2dyYW0gPSBmdW5jdGlvbiAoYXJjaCkge1xuICAgIHN5bmNRdWV1ZS5ydW5UYXNrKCgpID0+IGdlbmVyYXRlQ2xpZW50UHJvZ3JhbShhcmNoKSk7XG4gIH07XG5cbiAgZnVuY3Rpb24gZ2VuZXJhdGVDbGllbnRQcm9ncmFtKFxuICAgIGFyY2gsXG4gICAgc3RhdGljRmlsZXNCeUFyY2ggPSBXZWJBcHBJbnRlcm5hbHMuc3RhdGljRmlsZXNCeUFyY2gsXG4gICkge1xuICAgIGNvbnN0IGNsaWVudERpciA9IHBhdGhKb2luKFxuICAgICAgcGF0aERpcm5hbWUoX19tZXRlb3JfYm9vdHN0cmFwX18uc2VydmVyRGlyKSxcbiAgICAgIGFyY2gsXG4gICAgKTtcblxuICAgIC8vIHJlYWQgdGhlIGNvbnRyb2wgZm9yIHRoZSBjbGllbnQgd2UnbGwgYmUgc2VydmluZyB1cFxuICAgIGNvbnN0IHByb2dyYW1Kc29uUGF0aCA9IHBhdGhKb2luKGNsaWVudERpciwgXCJwcm9ncmFtLmpzb25cIik7XG5cbiAgICBsZXQgcHJvZ3JhbUpzb247XG4gICAgdHJ5IHtcbiAgICAgIHByb2dyYW1Kc29uID0gSlNPTi5wYXJzZShyZWFkRmlsZVN5bmMocHJvZ3JhbUpzb25QYXRoKSk7XG4gICAgfSBjYXRjaCAoZSkge1xuICAgICAgaWYgKGUuY29kZSA9PT0gXCJFTk9FTlRcIikgcmV0dXJuO1xuICAgICAgdGhyb3cgZTtcbiAgICB9XG5cbiAgICBpZiAocHJvZ3JhbUpzb24uZm9ybWF0ICE9PSBcIndlYi1wcm9ncmFtLXByZTFcIikge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKFwiVW5zdXBwb3J0ZWQgZm9ybWF0IGZvciBjbGllbnQgYXNzZXRzOiBcIiArXG4gICAgICAgICAgICAgICAgICAgICAgSlNPTi5zdHJpbmdpZnkocHJvZ3JhbUpzb24uZm9ybWF0KSk7XG4gICAgfVxuXG4gICAgaWYgKCEgcHJvZ3JhbUpzb25QYXRoIHx8ICEgY2xpZW50RGlyIHx8ICEgcHJvZ3JhbUpzb24pIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihcIkNsaWVudCBjb25maWcgZmlsZSBub3QgcGFyc2VkLlwiKTtcbiAgICB9XG5cbiAgICBhcmNoUGF0aFthcmNoXSA9IGNsaWVudERpcjtcbiAgICBjb25zdCBzdGF0aWNGaWxlcyA9IHN0YXRpY0ZpbGVzQnlBcmNoW2FyY2hdID0gT2JqZWN0LmNyZWF0ZShudWxsKTtcblxuICAgIGNvbnN0IHsgbWFuaWZlc3QgfSA9IHByb2dyYW1Kc29uO1xuICAgIG1hbmlmZXN0LmZvckVhY2goaXRlbSA9PiB7XG4gICAgICBpZiAoaXRlbS51cmwgJiYgaXRlbS53aGVyZSA9PT0gXCJjbGllbnRcIikge1xuICAgICAgICBzdGF0aWNGaWxlc1tnZXRJdGVtUGF0aG5hbWUoaXRlbS51cmwpXSA9IHtcbiAgICAgICAgICBhYnNvbHV0ZVBhdGg6IHBhdGhKb2luKGNsaWVudERpciwgaXRlbS5wYXRoKSxcbiAgICAgICAgICBjYWNoZWFibGU6IGl0ZW0uY2FjaGVhYmxlLFxuICAgICAgICAgIGhhc2g6IGl0ZW0uaGFzaCxcbiAgICAgICAgICAvLyBMaW5rIGZyb20gc291cmNlIHRvIGl0cyBtYXBcbiAgICAgICAgICBzb3VyY2VNYXBVcmw6IGl0ZW0uc291cmNlTWFwVXJsLFxuICAgICAgICAgIHR5cGU6IGl0ZW0udHlwZVxuICAgICAgICB9O1xuXG4gICAgICAgIGlmIChpdGVtLnNvdXJjZU1hcCkge1xuICAgICAgICAgIC8vIFNlcnZlIHRoZSBzb3VyY2UgbWFwIHRvbywgdW5kZXIgdGhlIHNwZWNpZmllZCBVUkwuIFdlIGFzc3VtZVxuICAgICAgICAgIC8vIGFsbCBzb3VyY2UgbWFwcyBhcmUgY2FjaGVhYmxlLlxuICAgICAgICAgIHN0YXRpY0ZpbGVzW2dldEl0ZW1QYXRobmFtZShpdGVtLnNvdXJjZU1hcFVybCldID0ge1xuICAgICAgICAgICAgYWJzb2x1dGVQYXRoOiBwYXRoSm9pbihjbGllbnREaXIsIGl0ZW0uc291cmNlTWFwKSxcbiAgICAgICAgICAgIGNhY2hlYWJsZTogdHJ1ZVxuICAgICAgICAgIH07XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9KTtcblxuICAgIGNvbnN0IHsgUFVCTElDX1NFVFRJTkdTIH0gPSBfX21ldGVvcl9ydW50aW1lX2NvbmZpZ19fO1xuICAgIGNvbnN0IGNvbmZpZ092ZXJyaWRlcyA9IHtcbiAgICAgIFBVQkxJQ19TRVRUSU5HUyxcbiAgICB9O1xuXG4gICAgY29uc3Qgb2xkUHJvZ3JhbSA9IFdlYkFwcC5jbGllbnRQcm9ncmFtc1thcmNoXTtcbiAgICBjb25zdCBuZXdQcm9ncmFtID0gV2ViQXBwLmNsaWVudFByb2dyYW1zW2FyY2hdID0ge1xuICAgICAgZm9ybWF0OiBcIndlYi1wcm9ncmFtLXByZTFcIixcbiAgICAgIG1hbmlmZXN0OiBtYW5pZmVzdCxcbiAgICAgIC8vIFVzZSBhcnJvdyBmdW5jdGlvbnMgc28gdGhhdCB0aGVzZSB2ZXJzaW9ucyBjYW4gYmUgbGF6aWx5XG4gICAgICAvLyBjYWxjdWxhdGVkIGxhdGVyLCBhbmQgc28gdGhhdCB0aGV5IHdpbGwgbm90IGJlIGluY2x1ZGVkIGluIHRoZVxuICAgICAgLy8gc3RhdGljRmlsZXNbbWFuaWZlc3RVcmxdLmNvbnRlbnQgc3RyaW5nIGJlbG93LlxuICAgICAgLy9cbiAgICAgIC8vIE5vdGU6IHRoZXNlIHZlcnNpb24gY2FsY3VsYXRpb25zIG11c3QgYmUga2VwdCBpbiBhZ3JlZW1lbnQgd2l0aFxuICAgICAgLy8gQ29yZG92YUJ1aWxkZXIjYXBwZW5kVmVyc2lvbiBpbiB0b29scy9jb3Jkb3ZhL2J1aWxkZXIuanMsIG9yIGhvdFxuICAgICAgLy8gY29kZSBwdXNoIHdpbGwgcmVsb2FkIENvcmRvdmEgYXBwcyB1bm5lY2Vzc2FyaWx5LlxuICAgICAgdmVyc2lvbjogKCkgPT4gV2ViQXBwSGFzaGluZy5jYWxjdWxhdGVDbGllbnRIYXNoKFxuICAgICAgICBtYW5pZmVzdCwgbnVsbCwgY29uZmlnT3ZlcnJpZGVzKSxcbiAgICAgIHZlcnNpb25SZWZyZXNoYWJsZTogKCkgPT4gV2ViQXBwSGFzaGluZy5jYWxjdWxhdGVDbGllbnRIYXNoKFxuICAgICAgICBtYW5pZmVzdCwgdHlwZSA9PiB0eXBlID09PSBcImNzc1wiLCBjb25maWdPdmVycmlkZXMpLFxuICAgICAgdmVyc2lvbk5vblJlZnJlc2hhYmxlOiAoKSA9PiBXZWJBcHBIYXNoaW5nLmNhbGN1bGF0ZUNsaWVudEhhc2goXG4gICAgICAgIG1hbmlmZXN0LCB0eXBlID0+IHR5cGUgIT09IFwiY3NzXCIsIGNvbmZpZ092ZXJyaWRlcyksXG4gICAgICBjb3Jkb3ZhQ29tcGF0aWJpbGl0eVZlcnNpb25zOiBwcm9ncmFtSnNvbi5jb3Jkb3ZhQ29tcGF0aWJpbGl0eVZlcnNpb25zLFxuICAgICAgUFVCTElDX1NFVFRJTkdTLFxuICAgIH07XG5cbiAgICAvLyBFeHBvc2UgcHJvZ3JhbSBkZXRhaWxzIGFzIGEgc3RyaW5nIHJlYWNoYWJsZSB2aWEgdGhlIGZvbGxvd2luZyBVUkwuXG4gICAgY29uc3QgbWFuaWZlc3RVcmxQcmVmaXggPSBcIi9fX1wiICsgYXJjaC5yZXBsYWNlKC9ed2ViXFwuLywgXCJcIik7XG4gICAgY29uc3QgbWFuaWZlc3RVcmwgPSBtYW5pZmVzdFVybFByZWZpeCArIGdldEl0ZW1QYXRobmFtZShcIi9tYW5pZmVzdC5qc29uXCIpO1xuXG4gICAgc3RhdGljRmlsZXNbbWFuaWZlc3RVcmxdID0gKCkgPT4ge1xuICAgICAgaWYgKFBhY2thZ2UuYXV0b3VwZGF0ZSkge1xuICAgICAgICBjb25zdCB7XG4gICAgICAgICAgQVVUT1VQREFURV9WRVJTSU9OID1cbiAgICAgICAgICAgIFBhY2thZ2UuYXV0b3VwZGF0ZS5BdXRvdXBkYXRlLmF1dG91cGRhdGVWZXJzaW9uXG4gICAgICAgIH0gPSBwcm9jZXNzLmVudjtcblxuICAgICAgICBpZiAoQVVUT1VQREFURV9WRVJTSU9OKSB7XG4gICAgICAgICAgbmV3UHJvZ3JhbS52ZXJzaW9uID0gQVVUT1VQREFURV9WRVJTSU9OO1xuICAgICAgICB9XG4gICAgICB9XG5cbiAgICAgIGlmICh0eXBlb2YgbmV3UHJvZ3JhbS52ZXJzaW9uID09PSBcImZ1bmN0aW9uXCIpIHtcbiAgICAgICAgbmV3UHJvZ3JhbS52ZXJzaW9uID0gbmV3UHJvZ3JhbS52ZXJzaW9uKCk7XG4gICAgICB9XG5cbiAgICAgIHJldHVybiB7XG4gICAgICAgIGNvbnRlbnQ6IEpTT04uc3RyaW5naWZ5KG5ld1Byb2dyYW0pLFxuICAgICAgICBjYWNoZWFibGU6IGZhbHNlLFxuICAgICAgICBoYXNoOiBuZXdQcm9ncmFtLnZlcnNpb24sXG4gICAgICAgIHR5cGU6IFwianNvblwiXG4gICAgICB9O1xuICAgIH07XG5cbiAgICBnZW5lcmF0ZUJvaWxlcnBsYXRlRm9yQXJjaChhcmNoKTtcblxuICAgIC8vIElmIHRoZXJlIGFyZSBhbnkgcmVxdWVzdHMgd2FpdGluZyBvbiBvbGRQcm9ncmFtLnBhdXNlZCwgbGV0IHRoZW1cbiAgICAvLyBjb250aW51ZSBub3cgKHVzaW5nIHRoZSBuZXcgcHJvZ3JhbSkuXG4gICAgaWYgKG9sZFByb2dyYW0gJiZcbiAgICAgICAgb2xkUHJvZ3JhbS5wYXVzZWQpIHtcbiAgICAgIG9sZFByb2dyYW0udW5wYXVzZSgpO1xuICAgIH1cbiAgfTtcblxuICBjb25zdCBkZWZhdWx0T3B0aW9uc0ZvckFyY2ggPSB7XG4gICAgJ3dlYi5jb3Jkb3ZhJzoge1xuICAgICAgcnVudGltZUNvbmZpZ092ZXJyaWRlczoge1xuICAgICAgICAvLyBYWFggV2UgdXNlIGFic29sdXRlVXJsKCkgaGVyZSBzbyB0aGF0IHdlIHNlcnZlIGh0dHBzOi8vXG4gICAgICAgIC8vIFVSTHMgdG8gY29yZG92YSBjbGllbnRzIGlmIGZvcmNlLXNzbCBpcyBpbiB1c2UuIElmIHdlIHdlcmVcbiAgICAgICAgLy8gdG8gdXNlIF9fbWV0ZW9yX3J1bnRpbWVfY29uZmlnX18uUk9PVF9VUkwgaW5zdGVhZCBvZlxuICAgICAgICAvLyBhYnNvbHV0ZVVybCgpLCB0aGVuIENvcmRvdmEgY2xpZW50cyB3b3VsZCBpbW1lZGlhdGVseSBnZXQgYVxuICAgICAgICAvLyBIQ1Agc2V0dGluZyB0aGVpciBERFBfREVGQVVMVF9DT05ORUNUSU9OX1VSTCB0b1xuICAgICAgICAvLyBodHRwOi8vZXhhbXBsZS5tZXRlb3IuY29tLiBUaGlzIGJyZWFrcyB0aGUgYXBwLCBiZWNhdXNlXG4gICAgICAgIC8vIGZvcmNlLXNzbCBkb2Vzbid0IHNlcnZlIENPUlMgaGVhZGVycyBvbiAzMDJcbiAgICAgICAgLy8gcmVkaXJlY3RzLiAoUGx1cyBpdCdzIHVuZGVzaXJhYmxlIHRvIGhhdmUgY2xpZW50c1xuICAgICAgICAvLyBjb25uZWN0aW5nIHRvIGh0dHA6Ly9leGFtcGxlLm1ldGVvci5jb20gd2hlbiBmb3JjZS1zc2wgaXNcbiAgICAgICAgLy8gaW4gdXNlLilcbiAgICAgICAgRERQX0RFRkFVTFRfQ09OTkVDVElPTl9VUkw6IHByb2Nlc3MuZW52Lk1PQklMRV9ERFBfVVJMIHx8XG4gICAgICAgICAgTWV0ZW9yLmFic29sdXRlVXJsKCksXG4gICAgICAgIFJPT1RfVVJMOiBwcm9jZXNzLmVudi5NT0JJTEVfUk9PVF9VUkwgfHxcbiAgICAgICAgICBNZXRlb3IuYWJzb2x1dGVVcmwoKVxuICAgICAgfVxuICAgIH0sXG5cbiAgICBcIndlYi5icm93c2VyXCI6IHtcbiAgICAgIHJ1bnRpbWVDb25maWdPdmVycmlkZXM6IHtcbiAgICAgICAgaXNNb2Rlcm46IHRydWUsXG4gICAgICB9XG4gICAgfSxcblxuICAgIFwid2ViLmJyb3dzZXIubGVnYWN5XCI6IHtcbiAgICAgIHJ1bnRpbWVDb25maWdPdmVycmlkZXM6IHtcbiAgICAgICAgaXNNb2Rlcm46IGZhbHNlLFxuICAgICAgfVxuICAgIH0sXG4gIH07XG5cbiAgV2ViQXBwSW50ZXJuYWxzLmdlbmVyYXRlQm9pbGVycGxhdGUgPSBmdW5jdGlvbiAoKSB7XG4gICAgLy8gVGhpcyBib2lsZXJwbGF0ZSB3aWxsIGJlIHNlcnZlZCB0byB0aGUgbW9iaWxlIGRldmljZXMgd2hlbiB1c2VkIHdpdGhcbiAgICAvLyBNZXRlb3IvQ29yZG92YSBmb3IgdGhlIEhvdC1Db2RlIFB1c2ggYW5kIHNpbmNlIHRoZSBmaWxlIHdpbGwgYmUgc2VydmVkIGJ5XG4gICAgLy8gdGhlIGRldmljZSdzIHNlcnZlciwgaXQgaXMgaW1wb3J0YW50IHRvIHNldCB0aGUgRERQIHVybCB0byB0aGUgYWN0dWFsXG4gICAgLy8gTWV0ZW9yIHNlcnZlciBhY2NlcHRpbmcgRERQIGNvbm5lY3Rpb25zIGFuZCBub3QgdGhlIGRldmljZSdzIGZpbGUgc2VydmVyLlxuICAgIHN5bmNRdWV1ZS5ydW5UYXNrKGZ1bmN0aW9uKCkge1xuICAgICAgT2JqZWN0LmtleXMoV2ViQXBwLmNsaWVudFByb2dyYW1zKVxuICAgICAgICAuZm9yRWFjaChnZW5lcmF0ZUJvaWxlcnBsYXRlRm9yQXJjaCk7XG4gICAgfSk7XG4gIH07XG5cbiAgZnVuY3Rpb24gZ2VuZXJhdGVCb2lsZXJwbGF0ZUZvckFyY2goYXJjaCkge1xuICAgIGNvbnN0IHByb2dyYW0gPSBXZWJBcHAuY2xpZW50UHJvZ3JhbXNbYXJjaF07XG4gICAgY29uc3QgYWRkaXRpb25hbE9wdGlvbnMgPSBkZWZhdWx0T3B0aW9uc0ZvckFyY2hbYXJjaF0gfHwge307XG4gICAgY29uc3QgeyBiYXNlRGF0YSB9ID0gYm9pbGVycGxhdGVCeUFyY2hbYXJjaF0gPVxuICAgICAgV2ViQXBwSW50ZXJuYWxzLmdlbmVyYXRlQm9pbGVycGxhdGVJbnN0YW5jZShcbiAgICAgICAgYXJjaCxcbiAgICAgICAgcHJvZ3JhbS5tYW5pZmVzdCxcbiAgICAgICAgYWRkaXRpb25hbE9wdGlvbnMsXG4gICAgICApO1xuICAgIC8vIFdlIG5lZWQgdGhlIHJ1bnRpbWUgY29uZmlnIHdpdGggb3ZlcnJpZGVzIGZvciBtZXRlb3JfcnVudGltZV9jb25maWcuanM6XG4gICAgcHJvZ3JhbS5tZXRlb3JSdW50aW1lQ29uZmlnID0gSlNPTi5zdHJpbmdpZnkoe1xuICAgICAgLi4uX19tZXRlb3JfcnVudGltZV9jb25maWdfXyxcbiAgICAgIC4uLihhZGRpdGlvbmFsT3B0aW9ucy5ydW50aW1lQ29uZmlnT3ZlcnJpZGVzIHx8IG51bGwpLFxuICAgIH0pO1xuICAgIHByb2dyYW0ucmVmcmVzaGFibGVBc3NldHMgPSBiYXNlRGF0YS5jc3MubWFwKGZpbGUgPT4gKHtcbiAgICAgIHVybDogYnVuZGxlZEpzQ3NzVXJsUmV3cml0ZUhvb2soZmlsZS51cmwpLFxuICAgIH0pKTtcbiAgfVxuXG4gIFdlYkFwcEludGVybmFscy5yZWxvYWRDbGllbnRQcm9ncmFtcygpO1xuXG4gIC8vIHdlYnNlcnZlclxuICB2YXIgYXBwID0gY29ubmVjdCgpO1xuXG4gIC8vIFBhY2thZ2VzIGFuZCBhcHBzIGNhbiBhZGQgaGFuZGxlcnMgdGhhdCBydW4gYmVmb3JlIGFueSBvdGhlciBNZXRlb3JcbiAgLy8gaGFuZGxlcnMgdmlhIFdlYkFwcC5yYXdDb25uZWN0SGFuZGxlcnMuXG4gIHZhciByYXdDb25uZWN0SGFuZGxlcnMgPSBjb25uZWN0KCk7XG4gIGFwcC51c2UocmF3Q29ubmVjdEhhbmRsZXJzKTtcblxuICAvLyBBdXRvLWNvbXByZXNzIGFueSBqc29uLCBqYXZhc2NyaXB0LCBvciB0ZXh0LlxuICBhcHAudXNlKGNvbXByZXNzKHtmaWx0ZXI6IHNob3VsZENvbXByZXNzfSkpO1xuXG4gIC8vIHBhcnNlIGNvb2tpZXMgaW50byBhbiBvYmplY3RcbiAgYXBwLnVzZShjb29raWVQYXJzZXIoKSk7XG5cbiAgLy8gV2UncmUgbm90IGEgcHJveHk7IHJlamVjdCAod2l0aG91dCBjcmFzaGluZykgYXR0ZW1wdHMgdG8gdHJlYXQgdXMgbGlrZVxuICAvLyBvbmUuIChTZWUgIzEyMTIuKVxuICBhcHAudXNlKGZ1bmN0aW9uKHJlcSwgcmVzLCBuZXh0KSB7XG4gICAgaWYgKFJvdXRlUG9saWN5LmlzVmFsaWRVcmwocmVxLnVybCkpIHtcbiAgICAgIG5leHQoKTtcbiAgICAgIHJldHVybjtcbiAgICB9XG4gICAgcmVzLndyaXRlSGVhZCg0MDApO1xuICAgIHJlcy53cml0ZShcIk5vdCBhIHByb3h5XCIpO1xuICAgIHJlcy5lbmQoKTtcbiAgfSk7XG5cbiAgLy8gUGFyc2UgdGhlIHF1ZXJ5IHN0cmluZyBpbnRvIHJlcy5xdWVyeS4gVXNlZCBieSBvYXV0aF9zZXJ2ZXIsIGJ1dCBpdCdzXG4gIC8vIGdlbmVyYWxseSBwcmV0dHkgaGFuZHkuLlxuICAvL1xuICAvLyBEbyB0aGlzIGJlZm9yZSB0aGUgbmV4dCBtaWRkbGV3YXJlIGRlc3Ryb3lzIHJlcS51cmwgaWYgYSBwYXRoIHByZWZpeFxuICAvLyBpcyBzZXQgdG8gY2xvc2UgIzEwMTExLlxuICBhcHAudXNlKGZ1bmN0aW9uIChyZXF1ZXN0LCByZXNwb25zZSwgbmV4dCkge1xuICAgIHJlcXVlc3QucXVlcnkgPSBxcy5wYXJzZShwYXJzZVVybChyZXF1ZXN0LnVybCkucXVlcnkpO1xuICAgIG5leHQoKTtcbiAgfSk7XG5cbiAgZnVuY3Rpb24gZ2V0UGF0aFBhcnRzKHBhdGgpIHtcbiAgICBjb25zdCBwYXJ0cyA9IHBhdGguc3BsaXQoXCIvXCIpO1xuICAgIHdoaWxlIChwYXJ0c1swXSA9PT0gXCJcIikgcGFydHMuc2hpZnQoKTtcbiAgICByZXR1cm4gcGFydHM7XG4gIH1cblxuICBmdW5jdGlvbiBpc1ByZWZpeE9mKHByZWZpeCwgYXJyYXkpIHtcbiAgICByZXR1cm4gcHJlZml4Lmxlbmd0aCA8PSBhcnJheS5sZW5ndGggJiZcbiAgICAgIHByZWZpeC5ldmVyeSgocGFydCwgaSkgPT4gcGFydCA9PT0gYXJyYXlbaV0pO1xuICB9XG5cbiAgLy8gU3RyaXAgb2ZmIHRoZSBwYXRoIHByZWZpeCwgaWYgaXQgZXhpc3RzLlxuICBhcHAudXNlKGZ1bmN0aW9uIChyZXF1ZXN0LCByZXNwb25zZSwgbmV4dCkge1xuICAgIGNvbnN0IHBhdGhQcmVmaXggPSBfX21ldGVvcl9ydW50aW1lX2NvbmZpZ19fLlJPT1RfVVJMX1BBVEhfUFJFRklYO1xuICAgIGNvbnN0IHsgcGF0aG5hbWUsIHNlYXJjaCB9ID0gcGFyc2VVcmwocmVxdWVzdC51cmwpO1xuXG4gICAgLy8gY2hlY2sgaWYgdGhlIHBhdGggaW4gdGhlIHVybCBzdGFydHMgd2l0aCB0aGUgcGF0aCBwcmVmaXhcbiAgICBpZiAocGF0aFByZWZpeCkge1xuICAgICAgY29uc3QgcHJlZml4UGFydHMgPSBnZXRQYXRoUGFydHMocGF0aFByZWZpeCk7XG4gICAgICBjb25zdCBwYXRoUGFydHMgPSBnZXRQYXRoUGFydHMocGF0aG5hbWUpO1xuICAgICAgaWYgKGlzUHJlZml4T2YocHJlZml4UGFydHMsIHBhdGhQYXJ0cykpIHtcbiAgICAgICAgcmVxdWVzdC51cmwgPSBcIi9cIiArIHBhdGhQYXJ0cy5zbGljZShwcmVmaXhQYXJ0cy5sZW5ndGgpLmpvaW4oXCIvXCIpO1xuICAgICAgICBpZiAoc2VhcmNoKSB7XG4gICAgICAgICAgcmVxdWVzdC51cmwgKz0gc2VhcmNoO1xuICAgICAgICB9XG4gICAgICAgIHJldHVybiBuZXh0KCk7XG4gICAgICB9XG4gICAgfVxuXG4gICAgaWYgKHBhdGhuYW1lID09PSBcIi9mYXZpY29uLmljb1wiIHx8XG4gICAgICAgIHBhdGhuYW1lID09PSBcIi9yb2JvdHMudHh0XCIpIHtcbiAgICAgIHJldHVybiBuZXh0KCk7XG4gICAgfVxuXG4gICAgaWYgKHBhdGhQcmVmaXgpIHtcbiAgICAgIHJlc3BvbnNlLndyaXRlSGVhZCg0MDQpO1xuICAgICAgcmVzcG9uc2Uud3JpdGUoXCJVbmtub3duIHBhdGhcIik7XG4gICAgICByZXNwb25zZS5lbmQoKTtcbiAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICBuZXh0KCk7XG4gIH0pO1xuXG4gIC8vIFNlcnZlIHN0YXRpYyBmaWxlcyBmcm9tIHRoZSBtYW5pZmVzdC5cbiAgLy8gVGhpcyBpcyBpbnNwaXJlZCBieSB0aGUgJ3N0YXRpYycgbWlkZGxld2FyZS5cbiAgYXBwLnVzZShmdW5jdGlvbiAocmVxLCByZXMsIG5leHQpIHtcbiAgICBXZWJBcHBJbnRlcm5hbHMuc3RhdGljRmlsZXNNaWRkbGV3YXJlKFxuICAgICAgV2ViQXBwSW50ZXJuYWxzLnN0YXRpY0ZpbGVzQnlBcmNoLFxuICAgICAgcmVxLCByZXMsIG5leHRcbiAgICApO1xuICB9KTtcblxuICAvLyBDb3JlIE1ldGVvciBwYWNrYWdlcyBsaWtlIGR5bmFtaWMtaW1wb3J0IGNhbiBhZGQgaGFuZGxlcnMgYmVmb3JlXG4gIC8vIG90aGVyIGhhbmRsZXJzIGFkZGVkIGJ5IHBhY2thZ2UgYW5kIGFwcGxpY2F0aW9uIGNvZGUuXG4gIGFwcC51c2UoV2ViQXBwSW50ZXJuYWxzLm1ldGVvckludGVybmFsSGFuZGxlcnMgPSBjb25uZWN0KCkpO1xuXG4gIC8vIFBhY2thZ2VzIGFuZCBhcHBzIGNhbiBhZGQgaGFuZGxlcnMgdG8gdGhpcyB2aWEgV2ViQXBwLmNvbm5lY3RIYW5kbGVycy5cbiAgLy8gVGhleSBhcmUgaW5zZXJ0ZWQgYmVmb3JlIG91ciBkZWZhdWx0IGhhbmRsZXIuXG4gIHZhciBwYWNrYWdlQW5kQXBwSGFuZGxlcnMgPSBjb25uZWN0KCk7XG4gIGFwcC51c2UocGFja2FnZUFuZEFwcEhhbmRsZXJzKTtcblxuICB2YXIgc3VwcHJlc3NDb25uZWN0RXJyb3JzID0gZmFsc2U7XG4gIC8vIGNvbm5lY3Qga25vd3MgaXQgaXMgYW4gZXJyb3IgaGFuZGxlciBiZWNhdXNlIGl0IGhhcyA0IGFyZ3VtZW50cyBpbnN0ZWFkIG9mXG4gIC8vIDMuIGdvIGZpZ3VyZS4gIChJdCBpcyBub3Qgc21hcnQgZW5vdWdoIHRvIGZpbmQgc3VjaCBhIHRoaW5nIGlmIGl0J3MgaGlkZGVuXG4gIC8vIGluc2lkZSBwYWNrYWdlQW5kQXBwSGFuZGxlcnMuKVxuICBhcHAudXNlKGZ1bmN0aW9uIChlcnIsIHJlcSwgcmVzLCBuZXh0KSB7XG4gICAgaWYgKCFlcnIgfHwgIXN1cHByZXNzQ29ubmVjdEVycm9ycyB8fCAhcmVxLmhlYWRlcnNbJ3gtc3VwcHJlc3MtZXJyb3InXSkge1xuICAgICAgbmV4dChlcnIpO1xuICAgICAgcmV0dXJuO1xuICAgIH1cbiAgICByZXMud3JpdGVIZWFkKGVyci5zdGF0dXMsIHsgJ0NvbnRlbnQtVHlwZSc6ICd0ZXh0L3BsYWluJyB9KTtcbiAgICByZXMuZW5kKFwiQW4gZXJyb3IgbWVzc2FnZVwiKTtcbiAgfSk7XG5cbiAgYXBwLnVzZShhc3luYyBmdW5jdGlvbiAocmVxLCByZXMsIG5leHQpIHtcbiAgICBpZiAoISBhcHBVcmwocmVxLnVybCkpIHtcbiAgICAgIHJldHVybiBuZXh0KCk7XG5cbiAgICB9IGVsc2Uge1xuICAgICAgdmFyIGhlYWRlcnMgPSB7XG4gICAgICAgICdDb250ZW50LVR5cGUnOiAndGV4dC9odG1sOyBjaGFyc2V0PXV0Zi04J1xuICAgICAgfTtcblxuICAgICAgaWYgKHNodXR0aW5nRG93bikge1xuICAgICAgICBoZWFkZXJzWydDb25uZWN0aW9uJ10gPSAnQ2xvc2UnO1xuICAgICAgfVxuXG4gICAgICB2YXIgcmVxdWVzdCA9IFdlYkFwcC5jYXRlZ29yaXplUmVxdWVzdChyZXEpO1xuXG4gICAgICBpZiAocmVxdWVzdC51cmwucXVlcnkgJiYgcmVxdWVzdC51cmwucXVlcnlbJ21ldGVvcl9jc3NfcmVzb3VyY2UnXSkge1xuICAgICAgICAvLyBJbiB0aGlzIGNhc2UsIHdlJ3JlIHJlcXVlc3RpbmcgYSBDU1MgcmVzb3VyY2UgaW4gdGhlIG1ldGVvci1zcGVjaWZpY1xuICAgICAgICAvLyB3YXksIGJ1dCB3ZSBkb24ndCBoYXZlIGl0LiAgU2VydmUgYSBzdGF0aWMgY3NzIGZpbGUgdGhhdCBpbmRpY2F0ZXMgdGhhdFxuICAgICAgICAvLyB3ZSBkaWRuJ3QgaGF2ZSBpdCwgc28gd2UgY2FuIGRldGVjdCB0aGF0IGFuZCByZWZyZXNoLiAgTWFrZSBzdXJlXG4gICAgICAgIC8vIHRoYXQgYW55IHByb3hpZXMgb3IgQ0ROcyBkb24ndCBjYWNoZSB0aGlzIGVycm9yISAgKE5vcm1hbGx5IHByb3hpZXNcbiAgICAgICAgLy8gb3IgQ0ROcyBhcmUgc21hcnQgZW5vdWdoIG5vdCB0byBjYWNoZSBlcnJvciBwYWdlcywgYnV0IGluIG9yZGVyIHRvXG4gICAgICAgIC8vIG1ha2UgdGhpcyBoYWNrIHdvcmssIHdlIG5lZWQgdG8gcmV0dXJuIHRoZSBDU1MgZmlsZSBhcyBhIDIwMCwgd2hpY2hcbiAgICAgICAgLy8gd291bGQgb3RoZXJ3aXNlIGJlIGNhY2hlZC4pXG4gICAgICAgIGhlYWRlcnNbJ0NvbnRlbnQtVHlwZSddID0gJ3RleHQvY3NzOyBjaGFyc2V0PXV0Zi04JztcbiAgICAgICAgaGVhZGVyc1snQ2FjaGUtQ29udHJvbCddID0gJ25vLWNhY2hlJztcbiAgICAgICAgcmVzLndyaXRlSGVhZCgyMDAsIGhlYWRlcnMpO1xuICAgICAgICByZXMud3JpdGUoXCIubWV0ZW9yLWNzcy1ub3QtZm91bmQtZXJyb3IgeyB3aWR0aDogMHB4O31cIik7XG4gICAgICAgIHJlcy5lbmQoKTtcbiAgICAgICAgcmV0dXJuO1xuICAgICAgfVxuXG4gICAgICBpZiAocmVxdWVzdC51cmwucXVlcnkgJiYgcmVxdWVzdC51cmwucXVlcnlbJ21ldGVvcl9qc19yZXNvdXJjZSddKSB7XG4gICAgICAgIC8vIFNpbWlsYXJseSwgd2UncmUgcmVxdWVzdGluZyBhIEpTIHJlc291cmNlIHRoYXQgd2UgZG9uJ3QgaGF2ZS5cbiAgICAgICAgLy8gU2VydmUgYW4gdW5jYWNoZWQgNDA0LiAoV2UgY2FuJ3QgdXNlIHRoZSBzYW1lIGhhY2sgd2UgdXNlIGZvciBDU1MsXG4gICAgICAgIC8vIGJlY2F1c2UgYWN0dWFsbHkgYWN0aW5nIG9uIHRoYXQgaGFjayByZXF1aXJlcyB1cyB0byBoYXZlIHRoZSBKU1xuICAgICAgICAvLyBhbHJlYWR5ISlcbiAgICAgICAgaGVhZGVyc1snQ2FjaGUtQ29udHJvbCddID0gJ25vLWNhY2hlJztcbiAgICAgICAgcmVzLndyaXRlSGVhZCg0MDQsIGhlYWRlcnMpO1xuICAgICAgICByZXMuZW5kKFwiNDA0IE5vdCBGb3VuZFwiKTtcbiAgICAgICAgcmV0dXJuO1xuICAgICAgfVxuXG4gICAgICBpZiAocmVxdWVzdC51cmwucXVlcnkgJiYgcmVxdWVzdC51cmwucXVlcnlbJ21ldGVvcl9kb250X3NlcnZlX2luZGV4J10pIHtcbiAgICAgICAgLy8gV2hlbiBkb3dubG9hZGluZyBmaWxlcyBkdXJpbmcgYSBDb3Jkb3ZhIGhvdCBjb2RlIHB1c2gsIHdlIG5lZWRcbiAgICAgICAgLy8gdG8gZGV0ZWN0IGlmIGEgZmlsZSBpcyBub3QgYXZhaWxhYmxlIGluc3RlYWQgb2YgaW5hZHZlcnRlbnRseVxuICAgICAgICAvLyBkb3dubG9hZGluZyB0aGUgZGVmYXVsdCBpbmRleCBwYWdlLlxuICAgICAgICAvLyBTbyBzaW1pbGFyIHRvIHRoZSBzaXR1YXRpb24gYWJvdmUsIHdlIHNlcnZlIGFuIHVuY2FjaGVkIDQwNC5cbiAgICAgICAgaGVhZGVyc1snQ2FjaGUtQ29udHJvbCddID0gJ25vLWNhY2hlJztcbiAgICAgICAgcmVzLndyaXRlSGVhZCg0MDQsIGhlYWRlcnMpO1xuICAgICAgICByZXMuZW5kKFwiNDA0IE5vdCBGb3VuZFwiKTtcbiAgICAgICAgcmV0dXJuO1xuICAgICAgfVxuXG4gICAgICBjb25zdCB7IGFyY2ggfSA9IHJlcXVlc3Q7XG4gICAgICBhc3NlcnQuc3RyaWN0RXF1YWwodHlwZW9mIGFyY2gsIFwic3RyaW5nXCIsIHsgYXJjaCB9KTtcblxuICAgICAgaWYgKCEgaGFzT3duLmNhbGwoV2ViQXBwLmNsaWVudFByb2dyYW1zLCBhcmNoKSkge1xuICAgICAgICAvLyBXZSBjb3VsZCBjb21lIGhlcmUgaW4gY2FzZSB3ZSBydW4gd2l0aCBzb21lIGFyY2hpdGVjdHVyZXMgZXhjbHVkZWRcbiAgICAgICAgaGVhZGVyc1snQ2FjaGUtQ29udHJvbCddID0gJ25vLWNhY2hlJztcbiAgICAgICAgcmVzLndyaXRlSGVhZCg0MDQsIGhlYWRlcnMpO1xuICAgICAgICBpZiAoTWV0ZW9yLmlzRGV2ZWxvcG1lbnQpIHtcbiAgICAgICAgICByZXMuZW5kKGBObyBjbGllbnQgcHJvZ3JhbSBmb3VuZCBmb3IgdGhlICR7YXJjaH0gYXJjaGl0ZWN0dXJlLmApO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIC8vIFNhZmV0eSBuZXQsIGJ1dCB0aGlzIGJyYW5jaCBzaG91bGQgbm90IGJlIHBvc3NpYmxlLlxuICAgICAgICAgIHJlcy5lbmQoXCI0MDQgTm90IEZvdW5kXCIpO1xuICAgICAgICB9XG4gICAgICAgIHJldHVybjtcbiAgICAgIH1cblxuICAgICAgLy8gSWYgcGF1c2VDbGllbnQoYXJjaCkgaGFzIGJlZW4gY2FsbGVkLCBwcm9ncmFtLnBhdXNlZCB3aWxsIGJlIGFcbiAgICAgIC8vIFByb21pc2UgdGhhdCB3aWxsIGJlIHJlc29sdmVkIHdoZW4gdGhlIHByb2dyYW0gaXMgdW5wYXVzZWQuXG4gICAgICBhd2FpdCBXZWJBcHAuY2xpZW50UHJvZ3JhbXNbYXJjaF0ucGF1c2VkO1xuXG4gICAgICByZXR1cm4gZ2V0Qm9pbGVycGxhdGVBc3luYyhyZXF1ZXN0LCBhcmNoKS50aGVuKCh7XG4gICAgICAgIHN0cmVhbSxcbiAgICAgICAgc3RhdHVzQ29kZSxcbiAgICAgICAgaGVhZGVyczogbmV3SGVhZGVycyxcbiAgICAgIH0pID0+IHtcbiAgICAgICAgaWYgKCFzdGF0dXNDb2RlKSB7XG4gICAgICAgICAgc3RhdHVzQ29kZSA9IHJlcy5zdGF0dXNDb2RlID8gcmVzLnN0YXR1c0NvZGUgOiAyMDA7XG4gICAgICAgIH1cblxuICAgICAgICBpZiAobmV3SGVhZGVycykge1xuICAgICAgICAgIE9iamVjdC5hc3NpZ24oaGVhZGVycywgbmV3SGVhZGVycyk7XG4gICAgICAgIH1cblxuICAgICAgICByZXMud3JpdGVIZWFkKHN0YXR1c0NvZGUsIGhlYWRlcnMpO1xuXG4gICAgICAgIHN0cmVhbS5waXBlKHJlcywge1xuICAgICAgICAgIC8vIEVuZCB0aGUgcmVzcG9uc2Ugd2hlbiB0aGUgc3RyZWFtIGVuZHMuXG4gICAgICAgICAgZW5kOiB0cnVlLFxuICAgICAgICB9KTtcblxuICAgICAgfSkuY2F0Y2goZXJyb3IgPT4ge1xuICAgICAgICBMb2cuZXJyb3IoXCJFcnJvciBydW5uaW5nIHRlbXBsYXRlOiBcIiArIGVycm9yLnN0YWNrKTtcbiAgICAgICAgcmVzLndyaXRlSGVhZCg1MDAsIGhlYWRlcnMpO1xuICAgICAgICByZXMuZW5kKCk7XG4gICAgICB9KTtcbiAgICB9XG4gIH0pO1xuXG4gIC8vIFJldHVybiA0MDQgYnkgZGVmYXVsdCwgaWYgbm8gb3RoZXIgaGFuZGxlcnMgc2VydmUgdGhpcyBVUkwuXG4gIGFwcC51c2UoZnVuY3Rpb24gKHJlcSwgcmVzKSB7XG4gICAgcmVzLndyaXRlSGVhZCg0MDQpO1xuICAgIHJlcy5lbmQoKTtcbiAgfSk7XG5cblxuICB2YXIgaHR0cFNlcnZlciA9IGNyZWF0ZVNlcnZlcihhcHApO1xuICB2YXIgb25MaXN0ZW5pbmdDYWxsYmFja3MgPSBbXTtcblxuICAvLyBBZnRlciA1IHNlY29uZHMgdy9vIGRhdGEgb24gYSBzb2NrZXQsIGtpbGwgaXQuICBPbiB0aGUgb3RoZXIgaGFuZCwgaWZcbiAgLy8gdGhlcmUncyBhbiBvdXRzdGFuZGluZyByZXF1ZXN0LCBnaXZlIGl0IGEgaGlnaGVyIHRpbWVvdXQgaW5zdGVhZCAodG8gYXZvaWRcbiAgLy8ga2lsbGluZyBsb25nLXBvbGxpbmcgcmVxdWVzdHMpXG4gIGh0dHBTZXJ2ZXIuc2V0VGltZW91dChTSE9SVF9TT0NLRVRfVElNRU9VVCk7XG5cbiAgLy8gRG8gdGhpcyBoZXJlLCBhbmQgdGhlbiBhbHNvIGluIGxpdmVkYXRhL3N0cmVhbV9zZXJ2ZXIuanMsIGJlY2F1c2VcbiAgLy8gc3RyZWFtX3NlcnZlci5qcyBraWxscyBhbGwgdGhlIGN1cnJlbnQgcmVxdWVzdCBoYW5kbGVycyB3aGVuIGluc3RhbGxpbmcgaXRzXG4gIC8vIG93bi5cbiAgaHR0cFNlcnZlci5vbigncmVxdWVzdCcsIFdlYkFwcC5fdGltZW91dEFkanVzdG1lbnRSZXF1ZXN0Q2FsbGJhY2spO1xuXG4gIC8vIElmIHRoZSBjbGllbnQgZ2F2ZSB1cyBhIGJhZCByZXF1ZXN0LCB0ZWxsIGl0IGluc3RlYWQgb2YganVzdCBjbG9zaW5nIHRoZVxuICAvLyBzb2NrZXQuIFRoaXMgbGV0cyBsb2FkIGJhbGFuY2VycyBpbiBmcm9udCBvZiB1cyBkaWZmZXJlbnRpYXRlIGJldHdlZW4gXCJhXG4gIC8vIHNlcnZlciBpcyByYW5kb21seSBjbG9zaW5nIHNvY2tldHMgZm9yIG5vIHJlYXNvblwiIGFuZCBcImNsaWVudCBzZW50IGEgYmFkXG4gIC8vIHJlcXVlc3RcIi5cbiAgLy9cbiAgLy8gVGhpcyB3aWxsIG9ubHkgd29yayBvbiBOb2RlIDY7IE5vZGUgNCBkZXN0cm95cyB0aGUgc29ja2V0IGJlZm9yZSBjYWxsaW5nXG4gIC8vIHRoaXMgZXZlbnQuIFNlZSBodHRwczovL2dpdGh1Yi5jb20vbm9kZWpzL25vZGUvcHVsbC80NTU3LyBmb3IgZGV0YWlscy5cbiAgaHR0cFNlcnZlci5vbignY2xpZW50RXJyb3InLCAoZXJyLCBzb2NrZXQpID0+IHtcbiAgICAvLyBQcmUtTm9kZS02LCBkbyBub3RoaW5nLlxuICAgIGlmIChzb2NrZXQuZGVzdHJveWVkKSB7XG4gICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgaWYgKGVyci5tZXNzYWdlID09PSAnUGFyc2UgRXJyb3InKSB7XG4gICAgICBzb2NrZXQuZW5kKCdIVFRQLzEuMSA0MDAgQmFkIFJlcXVlc3RcXHJcXG5cXHJcXG4nKTtcbiAgICB9IGVsc2Uge1xuICAgICAgLy8gRm9yIG90aGVyIGVycm9ycywgdXNlIHRoZSBkZWZhdWx0IGJlaGF2aW9yIGFzIGlmIHdlIGhhZCBubyBjbGllbnRFcnJvclxuICAgICAgLy8gaGFuZGxlci5cbiAgICAgIHNvY2tldC5kZXN0cm95KGVycik7XG4gICAgfVxuICB9KTtcblxuICAvLyBzdGFydCB1cCBhcHBcbiAgXy5leHRlbmQoV2ViQXBwLCB7XG4gICAgY29ubmVjdEhhbmRsZXJzOiBwYWNrYWdlQW5kQXBwSGFuZGxlcnMsXG4gICAgcmF3Q29ubmVjdEhhbmRsZXJzOiByYXdDb25uZWN0SGFuZGxlcnMsXG4gICAgaHR0cFNlcnZlcjogaHR0cFNlcnZlcixcbiAgICBjb25uZWN0QXBwOiBhcHAsXG4gICAgLy8gRm9yIHRlc3RpbmcuXG4gICAgc3VwcHJlc3NDb25uZWN0RXJyb3JzOiBmdW5jdGlvbiAoKSB7XG4gICAgICBzdXBwcmVzc0Nvbm5lY3RFcnJvcnMgPSB0cnVlO1xuICAgIH0sXG4gICAgb25MaXN0ZW5pbmc6IGZ1bmN0aW9uIChmKSB7XG4gICAgICBpZiAob25MaXN0ZW5pbmdDYWxsYmFja3MpXG4gICAgICAgIG9uTGlzdGVuaW5nQ2FsbGJhY2tzLnB1c2goZik7XG4gICAgICBlbHNlXG4gICAgICAgIGYoKTtcbiAgICB9LFxuICAgIC8vIFRoaXMgY2FuIGJlIG92ZXJyaWRkZW4gYnkgdXNlcnMgd2hvIHdhbnQgdG8gbW9kaWZ5IGhvdyBsaXN0ZW5pbmcgd29ya3NcbiAgICAvLyAoZWcsIHRvIHJ1biBhIHByb3h5IGxpa2UgQXBvbGxvIEVuZ2luZSBQcm94eSBpbiBmcm9udCBvZiB0aGUgc2VydmVyKS5cbiAgICBzdGFydExpc3RlbmluZzogZnVuY3Rpb24gKGh0dHBTZXJ2ZXIsIGxpc3Rlbk9wdGlvbnMsIGNiKSB7XG4gICAgICBodHRwU2VydmVyLmxpc3RlbihsaXN0ZW5PcHRpb25zLCBjYik7XG4gICAgfSxcbiAgfSk7XG5cbiAgLy8gTGV0IHRoZSByZXN0IG9mIHRoZSBwYWNrYWdlcyAoYW5kIE1ldGVvci5zdGFydHVwIGhvb2tzKSBpbnNlcnQgY29ubmVjdFxuICAvLyBtaWRkbGV3YXJlcyBhbmQgdXBkYXRlIF9fbWV0ZW9yX3J1bnRpbWVfY29uZmlnX18sIHRoZW4ga2VlcCBnb2luZyB0byBzZXQgdXBcbiAgLy8gYWN0dWFsbHkgc2VydmluZyBIVE1MLlxuICBleHBvcnRzLm1haW4gPSBhcmd2ID0+IHtcbiAgICBXZWJBcHBJbnRlcm5hbHMuZ2VuZXJhdGVCb2lsZXJwbGF0ZSgpO1xuXG4gICAgY29uc3Qgc3RhcnRIdHRwU2VydmVyID0gbGlzdGVuT3B0aW9ucyA9PiB7XG4gICAgICBXZWJBcHAuc3RhcnRMaXN0ZW5pbmcoaHR0cFNlcnZlciwgbGlzdGVuT3B0aW9ucywgTWV0ZW9yLmJpbmRFbnZpcm9ubWVudCgoKSA9PiB7XG4gICAgICAgIGlmIChwcm9jZXNzLmVudi5NRVRFT1JfUFJJTlRfT05fTElTVEVOKSB7XG4gICAgICAgICAgY29uc29sZS5sb2coXCJMSVNURU5JTkdcIik7XG4gICAgICAgIH1cbiAgICAgICAgY29uc3QgY2FsbGJhY2tzID0gb25MaXN0ZW5pbmdDYWxsYmFja3M7XG4gICAgICAgIG9uTGlzdGVuaW5nQ2FsbGJhY2tzID0gbnVsbDtcbiAgICAgICAgY2FsbGJhY2tzLmZvckVhY2goY2FsbGJhY2sgPT4geyBjYWxsYmFjaygpOyB9KTtcbiAgICAgIH0sIGUgPT4ge1xuICAgICAgICBjb25zb2xlLmVycm9yKFwiRXJyb3IgbGlzdGVuaW5nOlwiLCBlKTtcbiAgICAgICAgY29uc29sZS5lcnJvcihlICYmIGUuc3RhY2spO1xuICAgICAgfSkpO1xuICAgIH07XG5cbiAgICBsZXQgbG9jYWxQb3J0ID0gcHJvY2Vzcy5lbnYuUE9SVCB8fCAwO1xuICAgIGNvbnN0IHVuaXhTb2NrZXRQYXRoID0gcHJvY2Vzcy5lbnYuVU5JWF9TT0NLRVRfUEFUSDtcblxuICAgIGlmICh1bml4U29ja2V0UGF0aCkge1xuICAgICAgLy8gU3RhcnQgdGhlIEhUVFAgc2VydmVyIHVzaW5nIGEgc29ja2V0IGZpbGUuXG4gICAgICByZW1vdmVFeGlzdGluZ1NvY2tldEZpbGUodW5peFNvY2tldFBhdGgpO1xuICAgICAgc3RhcnRIdHRwU2VydmVyKHsgcGF0aDogdW5peFNvY2tldFBhdGggfSk7XG4gICAgICByZWdpc3RlclNvY2tldEZpbGVDbGVhbnVwKHVuaXhTb2NrZXRQYXRoKTtcbiAgICB9IGVsc2Uge1xuICAgICAgbG9jYWxQb3J0ID0gaXNOYU4oTnVtYmVyKGxvY2FsUG9ydCkpID8gbG9jYWxQb3J0IDogTnVtYmVyKGxvY2FsUG9ydCk7XG4gICAgICBpZiAoL1xcXFxcXFxcPy4rXFxcXHBpcGVcXFxcPy4rLy50ZXN0KGxvY2FsUG9ydCkpIHtcbiAgICAgICAgLy8gU3RhcnQgdGhlIEhUVFAgc2VydmVyIHVzaW5nIFdpbmRvd3MgU2VydmVyIHN0eWxlIG5hbWVkIHBpcGUuXG4gICAgICAgIHN0YXJ0SHR0cFNlcnZlcih7IHBhdGg6IGxvY2FsUG9ydCB9KTtcbiAgICAgIH0gZWxzZSBpZiAodHlwZW9mIGxvY2FsUG9ydCA9PT0gXCJudW1iZXJcIikge1xuICAgICAgICAvLyBTdGFydCB0aGUgSFRUUCBzZXJ2ZXIgdXNpbmcgVENQLlxuICAgICAgICBzdGFydEh0dHBTZXJ2ZXIoe1xuICAgICAgICAgIHBvcnQ6IGxvY2FsUG9ydCxcbiAgICAgICAgICBob3N0OiBwcm9jZXNzLmVudi5CSU5EX0lQIHx8IFwiMC4wLjAuMFwiXG4gICAgICAgIH0pO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKFwiSW52YWxpZCBQT1JUIHNwZWNpZmllZFwiKTtcbiAgICAgIH1cbiAgICB9XG5cbiAgICByZXR1cm4gXCJEQUVNT05cIjtcbiAgfTtcbn1cblxudmFyIGlubGluZVNjcmlwdHNBbGxvd2VkID0gdHJ1ZTtcblxuV2ViQXBwSW50ZXJuYWxzLmlubGluZVNjcmlwdHNBbGxvd2VkID0gZnVuY3Rpb24gKCkge1xuICByZXR1cm4gaW5saW5lU2NyaXB0c0FsbG93ZWQ7XG59O1xuXG5XZWJBcHBJbnRlcm5hbHMuc2V0SW5saW5lU2NyaXB0c0FsbG93ZWQgPSBmdW5jdGlvbiAodmFsdWUpIHtcbiAgaW5saW5lU2NyaXB0c0FsbG93ZWQgPSB2YWx1ZTtcbiAgV2ViQXBwSW50ZXJuYWxzLmdlbmVyYXRlQm9pbGVycGxhdGUoKTtcbn07XG5cbnZhciBzcmlNb2RlO1xuXG5XZWJBcHBJbnRlcm5hbHMuZW5hYmxlU3VicmVzb3VyY2VJbnRlZ3JpdHkgPSBmdW5jdGlvbih1c2VfY3JlZGVudGlhbHMgPSBmYWxzZSkge1xuICBzcmlNb2RlID0gdXNlX2NyZWRlbnRpYWxzID8gJ3VzZS1jcmVkZW50aWFscycgOiAnYW5vbnltb3VzJztcbiAgV2ViQXBwSW50ZXJuYWxzLmdlbmVyYXRlQm9pbGVycGxhdGUoKTtcbn07XG5cbldlYkFwcEludGVybmFscy5zZXRCdW5kbGVkSnNDc3NVcmxSZXdyaXRlSG9vayA9IGZ1bmN0aW9uIChob29rRm4pIHtcbiAgYnVuZGxlZEpzQ3NzVXJsUmV3cml0ZUhvb2sgPSBob29rRm47XG4gIFdlYkFwcEludGVybmFscy5nZW5lcmF0ZUJvaWxlcnBsYXRlKCk7XG59O1xuXG5XZWJBcHBJbnRlcm5hbHMuc2V0QnVuZGxlZEpzQ3NzUHJlZml4ID0gZnVuY3Rpb24gKHByZWZpeCkge1xuICB2YXIgc2VsZiA9IHRoaXM7XG4gIHNlbGYuc2V0QnVuZGxlZEpzQ3NzVXJsUmV3cml0ZUhvb2soXG4gICAgZnVuY3Rpb24gKHVybCkge1xuICAgICAgcmV0dXJuIHByZWZpeCArIHVybDtcbiAgfSk7XG59O1xuXG4vLyBQYWNrYWdlcyBjYW4gY2FsbCBgV2ViQXBwSW50ZXJuYWxzLmFkZFN0YXRpY0pzYCB0byBzcGVjaWZ5IHN0YXRpY1xuLy8gSmF2YVNjcmlwdCB0byBiZSBpbmNsdWRlZCBpbiB0aGUgYXBwLiBUaGlzIHN0YXRpYyBKUyB3aWxsIGJlIGlubGluZWQsXG4vLyB1bmxlc3MgaW5saW5lIHNjcmlwdHMgaGF2ZSBiZWVuIGRpc2FibGVkLCBpbiB3aGljaCBjYXNlIGl0IHdpbGwgYmVcbi8vIHNlcnZlZCB1bmRlciBgLzxzaGExIG9mIGNvbnRlbnRzPmAuXG52YXIgYWRkaXRpb25hbFN0YXRpY0pzID0ge307XG5XZWJBcHBJbnRlcm5hbHMuYWRkU3RhdGljSnMgPSBmdW5jdGlvbiAoY29udGVudHMpIHtcbiAgYWRkaXRpb25hbFN0YXRpY0pzW1wiL1wiICsgc2hhMShjb250ZW50cykgKyBcIi5qc1wiXSA9IGNvbnRlbnRzO1xufTtcblxuLy8gRXhwb3J0ZWQgZm9yIHRlc3RzXG5XZWJBcHBJbnRlcm5hbHMuZ2V0Qm9pbGVycGxhdGUgPSBnZXRCb2lsZXJwbGF0ZTtcbldlYkFwcEludGVybmFscy5hZGRpdGlvbmFsU3RhdGljSnMgPSBhZGRpdGlvbmFsU3RhdGljSnM7XG5cbi8vIFN0YXJ0IHRoZSBzZXJ2ZXIhXG5ydW5XZWJBcHBTZXJ2ZXIoKTtcbiIsImltcG9ydCBucG1Db25uZWN0IGZyb20gXCJjb25uZWN0XCI7XG5cbmV4cG9ydCBmdW5jdGlvbiBjb25uZWN0KC4uLmNvbm5lY3RBcmdzKSB7XG4gIGNvbnN0IGhhbmRsZXJzID0gbnBtQ29ubmVjdC5hcHBseSh0aGlzLCBjb25uZWN0QXJncyk7XG4gIGNvbnN0IG9yaWdpbmFsVXNlID0gaGFuZGxlcnMudXNlO1xuXG4gIC8vIFdyYXAgdGhlIGhhbmRsZXJzLnVzZSBtZXRob2Qgc28gdGhhdCBhbnkgcHJvdmlkZWQgaGFuZGxlciBmdW5jdGlvbnNcbiAgLy8gYWx3YXkgcnVuIGluIGEgRmliZXIuXG4gIGhhbmRsZXJzLnVzZSA9IGZ1bmN0aW9uIHVzZSguLi51c2VBcmdzKSB7XG4gICAgY29uc3QgeyBzdGFjayB9ID0gdGhpcztcbiAgICBjb25zdCBvcmlnaW5hbExlbmd0aCA9IHN0YWNrLmxlbmd0aDtcbiAgICBjb25zdCByZXN1bHQgPSBvcmlnaW5hbFVzZS5hcHBseSh0aGlzLCB1c2VBcmdzKTtcblxuICAgIC8vIElmIHdlIGp1c3QgYWRkZWQgYW55dGhpbmcgdG8gdGhlIHN0YWNrLCB3cmFwIGVhY2ggbmV3IGVudHJ5LmhhbmRsZVxuICAgIC8vIHdpdGggYSBmdW5jdGlvbiB0aGF0IGNhbGxzIFByb21pc2UuYXN5bmNBcHBseSB0byBlbnN1cmUgdGhlXG4gICAgLy8gb3JpZ2luYWwgaGFuZGxlciBydW5zIGluIGEgRmliZXIuXG4gICAgZm9yIChsZXQgaSA9IG9yaWdpbmFsTGVuZ3RoOyBpIDwgc3RhY2subGVuZ3RoOyArK2kpIHtcbiAgICAgIGNvbnN0IGVudHJ5ID0gc3RhY2tbaV07XG4gICAgICBjb25zdCBvcmlnaW5hbEhhbmRsZSA9IGVudHJ5LmhhbmRsZTtcblxuICAgICAgaWYgKG9yaWdpbmFsSGFuZGxlLmxlbmd0aCA+PSA0KSB7XG4gICAgICAgIC8vIElmIHRoZSBvcmlnaW5hbCBoYW5kbGUgaGFkIGZvdXIgKG9yIG1vcmUpIHBhcmFtZXRlcnMsIHRoZVxuICAgICAgICAvLyB3cmFwcGVyIG11c3QgYWxzbyBoYXZlIGZvdXIgcGFyYW1ldGVycywgc2luY2UgY29ubmVjdCB1c2VzXG4gICAgICAgIC8vIGhhbmRsZS5sZW5ndGggdG8gZGVybWluZSB3aGV0aGVyIHRvIHBhc3MgdGhlIGVycm9yIGFzIHRoZSBmaXJzdFxuICAgICAgICAvLyBhcmd1bWVudCB0byB0aGUgaGFuZGxlIGZ1bmN0aW9uLlxuICAgICAgICBlbnRyeS5oYW5kbGUgPSBmdW5jdGlvbiBoYW5kbGUoZXJyLCByZXEsIHJlcywgbmV4dCkge1xuICAgICAgICAgIHJldHVybiBQcm9taXNlLmFzeW5jQXBwbHkob3JpZ2luYWxIYW5kbGUsIHRoaXMsIGFyZ3VtZW50cyk7XG4gICAgICAgIH07XG4gICAgICB9IGVsc2Uge1xuICAgICAgICBlbnRyeS5oYW5kbGUgPSBmdW5jdGlvbiBoYW5kbGUocmVxLCByZXMsIG5leHQpIHtcbiAgICAgICAgICByZXR1cm4gUHJvbWlzZS5hc3luY0FwcGx5KG9yaWdpbmFsSGFuZGxlLCB0aGlzLCBhcmd1bWVudHMpO1xuICAgICAgICB9O1xuICAgICAgfVxuICAgIH1cblxuICAgIHJldHVybiByZXN1bHQ7XG4gIH07XG5cbiAgcmV0dXJuIGhhbmRsZXJzO1xufVxuIiwiaW1wb3J0IHsgc3RhdFN5bmMsIHVubGlua1N5bmMsIGV4aXN0c1N5bmMgfSBmcm9tICdmcyc7XG5cbi8vIFNpbmNlIGEgbmV3IHNvY2tldCBmaWxlIHdpbGwgYmUgY3JlYXRlZCB3aGVuIHRoZSBIVFRQIHNlcnZlclxuLy8gc3RhcnRzIHVwLCBpZiBmb3VuZCByZW1vdmUgdGhlIGV4aXN0aW5nIGZpbGUuXG4vL1xuLy8gV0FSTklORzpcbi8vIFRoaXMgd2lsbCByZW1vdmUgdGhlIGNvbmZpZ3VyZWQgc29ja2V0IGZpbGUgd2l0aG91dCB3YXJuaW5nLiBJZlxuLy8gdGhlIGNvbmZpZ3VyZWQgc29ja2V0IGZpbGUgaXMgYWxyZWFkeSBpbiB1c2UgYnkgYW5vdGhlciBhcHBsaWNhdGlvbixcbi8vIGl0IHdpbGwgc3RpbGwgYmUgcmVtb3ZlZC4gTm9kZSBkb2VzIG5vdCBwcm92aWRlIGEgcmVsaWFibGUgd2F5IHRvXG4vLyBkaWZmZXJlbnRpYXRlIGJldHdlZW4gYSBzb2NrZXQgZmlsZSB0aGF0IGlzIGFscmVhZHkgaW4gdXNlIGJ5XG4vLyBhbm90aGVyIGFwcGxpY2F0aW9uIG9yIGEgc3RhbGUgc29ja2V0IGZpbGUgdGhhdCBoYXMgYmVlblxuLy8gbGVmdCBvdmVyIGFmdGVyIGEgU0lHS0lMTC4gU2luY2Ugd2UgaGF2ZSBubyByZWxpYWJsZSB3YXkgdG9cbi8vIGRpZmZlcmVudGlhdGUgYmV0d2VlbiB0aGVzZSB0d28gc2NlbmFyaW9zLCB0aGUgYmVzdCBjb3Vyc2Ugb2Zcbi8vIGFjdGlvbiBkdXJpbmcgc3RhcnR1cCBpcyB0byByZW1vdmUgYW55IGV4aXN0aW5nIHNvY2tldCBmaWxlLiBUaGlzXG4vLyBpcyBub3QgdGhlIHNhZmVzdCBjb3Vyc2Ugb2YgYWN0aW9uIGFzIHJlbW92aW5nIHRoZSBleGlzdGluZyBzb2NrZXRcbi8vIGZpbGUgY291bGQgaW1wYWN0IGFuIGFwcGxpY2F0aW9uIHVzaW5nIGl0LCBidXQgdGhpcyBhcHByb2FjaCBoZWxwc1xuLy8gZW5zdXJlIHRoZSBIVFRQIHNlcnZlciBjYW4gc3RhcnR1cCB3aXRob3V0IG1hbnVhbFxuLy8gaW50ZXJ2ZW50aW9uIChlLmcuIGFza2luZyBmb3IgdGhlIHZlcmlmaWNhdGlvbiBhbmQgY2xlYW51cCBvZiBzb2NrZXRcbi8vIGZpbGVzIGJlZm9yZSBhbGxvd2luZyB0aGUgSFRUUCBzZXJ2ZXIgdG8gYmUgc3RhcnRlZCkuXG4vL1xuLy8gVGhlIGFib3ZlIGJlaW5nIHNhaWQsIGFzIGxvbmcgYXMgdGhlIHNvY2tldCBmaWxlIHBhdGggaXNcbi8vIGNvbmZpZ3VyZWQgY2FyZWZ1bGx5IHdoZW4gdGhlIGFwcGxpY2F0aW9uIGlzIGRlcGxveWVkIChhbmQgZXh0cmFcbi8vIGNhcmUgaXMgdGFrZW4gdG8gbWFrZSBzdXJlIHRoZSBjb25maWd1cmVkIHBhdGggaXMgdW5pcXVlIGFuZCBkb2Vzbid0XG4vLyBjb25mbGljdCB3aXRoIGFub3RoZXIgc29ja2V0IGZpbGUgcGF0aCksIHRoZW4gdGhlcmUgc2hvdWxkIG5vdCBiZVxuLy8gYW55IGlzc3VlcyB3aXRoIHRoaXMgYXBwcm9hY2guXG5leHBvcnQgY29uc3QgcmVtb3ZlRXhpc3RpbmdTb2NrZXRGaWxlID0gKHNvY2tldFBhdGgpID0+IHtcbiAgdHJ5IHtcbiAgICBpZiAoc3RhdFN5bmMoc29ja2V0UGF0aCkuaXNTb2NrZXQoKSkge1xuICAgICAgLy8gU2luY2UgYSBuZXcgc29ja2V0IGZpbGUgd2lsbCBiZSBjcmVhdGVkLCByZW1vdmUgdGhlIGV4aXN0aW5nXG4gICAgICAvLyBmaWxlLlxuICAgICAgdW5saW5rU3luYyhzb2NrZXRQYXRoKTtcbiAgICB9IGVsc2Uge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKFxuICAgICAgICBgQW4gZXhpc3RpbmcgZmlsZSB3YXMgZm91bmQgYXQgXCIke3NvY2tldFBhdGh9XCIgYW5kIGl0IGlzIG5vdCBgICtcbiAgICAgICAgJ2Egc29ja2V0IGZpbGUuIFBsZWFzZSBjb25maXJtIFBPUlQgaXMgcG9pbnRpbmcgdG8gdmFsaWQgYW5kICcgK1xuICAgICAgICAndW4tdXNlZCBzb2NrZXQgZmlsZSBwYXRoLidcbiAgICAgICk7XG4gICAgfVxuICB9IGNhdGNoIChlcnJvcikge1xuICAgIC8vIElmIHRoZXJlIGlzIG5vIGV4aXN0aW5nIHNvY2tldCBmaWxlIHRvIGNsZWFudXAsIGdyZWF0LCB3ZSdsbFxuICAgIC8vIGNvbnRpbnVlIG5vcm1hbGx5LiBJZiB0aGUgY2F1Z2h0IGV4Y2VwdGlvbiByZXByZXNlbnRzIGFueSBvdGhlclxuICAgIC8vIGlzc3VlLCByZS10aHJvdy5cbiAgICBpZiAoZXJyb3IuY29kZSAhPT0gJ0VOT0VOVCcpIHtcbiAgICAgIHRocm93IGVycm9yO1xuICAgIH1cbiAgfVxufTtcblxuLy8gUmVtb3ZlIHRoZSBzb2NrZXQgZmlsZSB3aGVuIGRvbmUgdG8gYXZvaWQgbGVhdmluZyBiZWhpbmQgYSBzdGFsZSBvbmUuXG4vLyBOb3RlIC0gYSBzdGFsZSBzb2NrZXQgZmlsZSBpcyBzdGlsbCBsZWZ0IGJlaGluZCBpZiB0aGUgcnVubmluZyBub2RlXG4vLyBwcm9jZXNzIGlzIGtpbGxlZCB2aWEgc2lnbmFsIDkgLSBTSUdLSUxMLlxuZXhwb3J0IGNvbnN0IHJlZ2lzdGVyU29ja2V0RmlsZUNsZWFudXAgPVxuICAoc29ja2V0UGF0aCwgZXZlbnRFbWl0dGVyID0gcHJvY2VzcykgPT4ge1xuICAgIFsnZXhpdCcsICdTSUdJTlQnLCAnU0lHSFVQJywgJ1NJR1RFUk0nXS5mb3JFYWNoKHNpZ25hbCA9PiB7XG4gICAgICBldmVudEVtaXR0ZXIub24oc2lnbmFsLCBNZXRlb3IuYmluZEVudmlyb25tZW50KCgpID0+IHtcbiAgICAgICAgaWYgKGV4aXN0c1N5bmMoc29ja2V0UGF0aCkpIHtcbiAgICAgICAgICB1bmxpbmtTeW5jKHNvY2tldFBhdGgpO1xuICAgICAgICB9XG4gICAgICB9KSk7XG4gICAgfSk7XG4gIH07XG4iXX0=
