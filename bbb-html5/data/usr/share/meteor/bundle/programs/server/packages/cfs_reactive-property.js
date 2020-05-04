(function () {

/* Imports */
var Meteor = Package.meteor.Meteor;
var global = Package.meteor.global;
var meteorEnv = Package.meteor.meteorEnv;
var Tracker = Package.tracker.Tracker;
var Deps = Package.tracker.Deps;

/* Package-scope variables */
var _noopCallback, _nonReactive, ReactiveProperty;

(function(){

////////////////////////////////////////////////////////////////////////////////////////////
//                                                                                        //
// packages/cfs_reactive-property/packages/cfs_reactive-property.js                       //
//                                                                                        //
////////////////////////////////////////////////////////////////////////////////////////////
                                                                                          //
(function () {

/////////////////////////////////////////////////////////////////////////////////////
//                                                                                 //
// packages/cfs:reactive-property/reactive-property.js                             //
//                                                                                 //
/////////////////////////////////////////////////////////////////////////////////////
                                                                                   //
// #ReactiveProperty                                                               // 1
// A simple class that provides an reactive property interface                     // 2
                                                                                   // 3
_noopCallback = function() {};                                                     // 4
                                                                                   // 5
_nonReactive = {                                                                   // 6
  changed: _noopCallback,                                                          // 7
  depend: _noopCallback                                                            // 8
};                                                                                 // 9
                                                                                   // 10
/**                                                                                // 11
  * @constructor                                                                   // 12
  * @param {any} defaultValue Set the default value for the reactive property      // 13
  * @param {boolean} [reactive = true] Allow the user to disable reactivity        // 14
  *                                                                                // 15
  * This api should only be in the internal.api.md                                 // 16
  */                                                                               // 17
ReactiveProperty = function(defaultValue, reactive) {                              // 18
  var self = this;                                                                 // 19
  var _deps = (reactive === false)? _nonReactive : new Deps.Dependency();          // 20
                                                                                   // 21
  /** @property ReactiveProperty.value                                             // 22
    * @private                                                                     // 23
    * This contains the non reactive value, should only be used as a getter for    // 24
    * internal use                                                                 // 25
    */                                                                             // 26
  self.value = defaultValue;                                                       // 27
                                                                                   // 28
  self.onChange = function() {};                                                   // 29
                                                                                   // 30
  self.changed = function() {                                                      // 31
    _deps.changed();                                                               // 32
    self.onChange(self.value);                                                     // 33
  };                                                                               // 34
                                                                                   // 35
  /**                                                                              // 36
    * @method ReactiveProperty.get                                                 // 37
    * Usage:                                                                       // 38
    * ```js                                                                        // 39
    *   var foo = new ReactiveProperty('bar');                                     // 40
    *   foo.get(); // equals "bar"                                                 // 41
    * ```                                                                          // 42
    */                                                                             // 43
  self.get = function() {                                                          // 44
    _deps.depend();                                                                // 45
    return self.value;                                                             // 46
  };                                                                               // 47
                                                                                   // 48
  /**                                                                              // 49
    * @method ReactiveProperty.set Set property to value                           // 50
    * @param {any} value                                                           // 51
    * Usage:                                                                       // 52
    * ```js                                                                        // 53
    *   var foo = new ReactiveProperty('bar');                                     // 54
    *   foo.set('bar');                                                            // 55
    * ```                                                                          // 56
    */                                                                             // 57
  self.set = function(value) {                                                     // 58
    if (self.value !== value) {                                                    // 59
      self.value = value;                                                          // 60
      self.changed();                                                              // 61
    }                                                                              // 62
  };                                                                               // 63
                                                                                   // 64
  /**                                                                              // 65
    * @method ReactiveProperty.dec Decrease numeric property                       // 66
    * @param {number} [by=1] Value to decrease by                                  // 67
    * Usage:                                                                       // 68
    * ```js                                                                        // 69
    *   var foo = new ReactiveProperty('bar');                                     // 70
    *   foo.set(0);                                                                // 71
    *   foo.dec(5); // -5                                                          // 72
    * ```                                                                          // 73
    */                                                                             // 74
  self.dec = function(by) {                                                        // 75
    self.value -= by || 1;                                                         // 76
    self.changed();                                                                // 77
  };                                                                               // 78
                                                                                   // 79
  /**                                                                              // 80
    * @method ReactiveProperty.inc increase numeric property                       // 81
    * @param {number} [by=1] Value to increase by                                  // 82
    * Usage:                                                                       // 83
    * ```js                                                                        // 84
    *   var foo = new ReactiveProperty('bar');                                     // 85
    *   foo.set(0);                                                                // 86
    *   foo.inc(5); // 5                                                           // 87
    * ```                                                                          // 88
    */                                                                             // 89
  self.inc = function(by) {                                                        // 90
    self.value += by || 1;                                                         // 91
    self.changed();                                                                // 92
  };                                                                               // 93
                                                                                   // 94
  /**                                                                              // 95
    * @method ReactiveProperty.getset increase numeric property                    // 96
    * @param {any} [value] Value to set property - if undefined the act like `get` // 97
    * @returns {any} Returns value if no arguments are passed to the function      // 98
    * Usage:                                                                       // 99
    * ```js                                                                        // 100
    *   var foo = new ReactiveProperty('bar');                                     // 101
    *   foo.getset(5);                                                             // 102
    *   foo.getset(); // returns 5                                                 // 103
    * ```                                                                          // 104
    */                                                                             // 105
  self.getset = function(value) {                                                  // 106
    if (typeof value !== 'undefined') {                                            // 107
      self.set(value);                                                             // 108
    } else {                                                                       // 109
      return self.get();                                                           // 110
    }                                                                              // 111
  };                                                                               // 112
                                                                                   // 113
  /**                                                                              // 114
    * @method ReactiveProperty.toString                                            // 115
    * Usage:                                                                       // 116
    * ```js                                                                        // 117
    *   var foo = new ReactiveProperty('bar');                                     // 118
    *   foo.toString(); // returns 'bar'                                           // 119
    * ```                                                                          // 120
    */                                                                             // 121
  self.toString = function() {                                                     // 122
    var val = self.get();                                                          // 123
    return val ? val.toString() : '';                                              // 124
  };                                                                               // 125
                                                                                   // 126
  /**                                                                              // 127
    * @method ReactiveProperty.toText                                              // 128
    * Usage:                                                                       // 129
    * ```js                                                                        // 130
    *   var foo = new ReactiveProperty('bar');                                     // 131
    *   foo.toText(); // returns 'bar'                                             // 132
    * ```                                                                          // 133
    */                                                                             // 134
  self.toText = self.toString;                                                     // 135
                                                                                   // 136
};                                                                                 // 137
                                                                                   // 138
/////////////////////////////////////////////////////////////////////////////////////

}).call(this);

////////////////////////////////////////////////////////////////////////////////////////////

}).call(this);


/* Exports */
Package._define("cfs:reactive-property", {
  ReactiveProperty: ReactiveProperty
});

})();
