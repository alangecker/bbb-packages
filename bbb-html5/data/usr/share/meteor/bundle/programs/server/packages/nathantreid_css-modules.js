(function () {

/* Imports */
var Meteor = Package.meteor.Meteor;
var global = Package.meteor.global;
var meteorEnv = Package.meteor.meteorEnv;
var ECMAScript = Package.ecmascript.ECMAScript;
var meteorInstall = Package.modules.meteorInstall;
var Promise = Package.promise.Promise;

var require = meteorInstall({"node_modules":{"meteor":{"nathantreid:css-modules":{"package":{"main.js":function module(require,exports,module){

///////////////////////////////////////////////////////////////////////
//                                                                   //
// packages/nathantreid_css-modules/package/main.js                  //
//                                                                   //
///////////////////////////////////////////////////////////////////////
                                                                     //
module.exportDefault({
  onCssModuleMissingStyle: undefined
});
///////////////////////////////////////////////////////////////////////

}}}}}},{
  "extensions": [
    ".js",
    ".json"
  ]
});

var exports = require("/node_modules/meteor/nathantreid:css-modules/package/main.js");

/* Exports */
Package._define("nathantreid:css-modules", exports);

})();

//# sourceURL=meteor://💻app/packages/nathantreid_css-modules.js
//# sourceMappingURL=data:application/json;charset=utf8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIm1ldGVvcjovL/CfkrthcHAvcGFja2FnZXMvbmF0aGFudHJlaWQ6Y3NzLW1vZHVsZXMvcGFja2FnZS9tYWluLmpzIl0sIm5hbWVzIjpbIm1vZHVsZSIsImV4cG9ydERlZmF1bHQiLCJvbkNzc01vZHVsZU1pc3NpbmdTdHlsZSIsInVuZGVmaW5lZCJdLCJtYXBwaW5ncyI6Ijs7Ozs7Ozs7Ozs7Ozs7Ozs7O0FBQUFBLE1BQU0sQ0FBQ0MsYUFBUCxDQUFlO0FBQ2JDLHlCQUF1QixFQUFFQztBQURaLENBQWYsRSIsImZpbGUiOiIvcGFja2FnZXMvbmF0aGFudHJlaWRfY3NzLW1vZHVsZXMuanMiLCJzb3VyY2VzQ29udGVudCI6WyJleHBvcnQgZGVmYXVsdCB7XHJcbiAgb25Dc3NNb2R1bGVNaXNzaW5nU3R5bGU6IHVuZGVmaW5lZCxcclxufTtcclxuIl19
