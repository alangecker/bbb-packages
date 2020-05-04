(function () {

/* Imports */
var Meteor = Package.meteor.Meteor;
var global = Package.meteor.global;
var meteorEnv = Package.meteor.meteorEnv;
var Tracker = Package.tracker.Tracker;
var Deps = Package.tracker.Deps;

/* Package-scope variables */
var MicroQueue;

(function(){

//////////////////////////////////////////////////////////////////////////////////////////////////////////
//                                                                                                      //
// packages/cfs_micro-queue/packages/cfs_micro-queue.js                                                 //
//                                                                                                      //
//////////////////////////////////////////////////////////////////////////////////////////////////////////
                                                                                                        //
(function () {

///////////////////////////////////////////////////////////////////////////////////////////////////
//                                                                                               //
// packages/cfs:micro-queue/micro-queue.js                                                       //
//                                                                                               //
///////////////////////////////////////////////////////////////////////////////////////////////////
                                                                                                 //
/** A basic LIFO or FIFO queue                                                                   // 1
  * This is better than a simple array with pop/shift because shift is O(n)                      // 2
  * and can become slow with a large array.                                                      // 3
  * @method MicroQueue                                                                           // 4
  * @constructor                                                                                 // 5
  * @param {boolean} [lifo=false] Set true for `lifo`, default is `fifo`                         // 6
  * This queue was build as the spinal basis for the [`PowerQueue`](#PowerQueue)                 // 7
  * The interface is very basic and consists of:                                                 // 8
  * `add`, `get`, `reset` Making it possible to write a custom micro-queue for                   // 9
  * `PowerQueue`, such as a queue that is persisted into a database.                             // 10
  *                                                                                              // 11
  * Usage:                                                                                       // 12
```js                                                                                            // 13
  var foo = new MicroQueue(); // Basic FIFO queue                                                // 14
  foo.add(1);                                                                                    // 15
  foo.add(2);                                                                                    // 16
  foo.add(3);                                                                                    // 17
  for (var i = 0; i < foo.length(); i++) {                                                       // 18
    console.log(foo.get());                                                                      // 19
  }                                                                                              // 20
```                                                                                              // 21
  * The result should be: "1, 2, 3"                                                              // 22
  */                                                                                             // 23
MicroQueue = function(lifo) {                                                                    // 24
  var self = this, first = 0, last = -1, list = [];                                              // 25
                                                                                                 // 26
  // The private reactive length property                                                        // 27
  self._length = 0;                                                                              // 28
  var _lengthDeps = new Deps.Dependency();                                                       // 29
  var maxKey = 0;                                                                                // 30
  /** @method MicroQueue.length                                                                  // 31
    * @reactive                                                                                  // 32
    * @returns {number} Length / number of items in queue                                        // 33
    */                                                                                           // 34
  self.length = function() {                                                                     // 35
    _lengthDeps.depend();                                                                        // 36
    return self._length;                                                                         // 37
  };                                                                                             // 38
                                                                                                 // 39
  /** @method MicroQueue.insert Add item to the queue                                            // 40
    * @param {any} value The item to add to the queue                                            // 41
    */                                                                                           // 42
  self.insert = function(key, value) {                                                           // 43
    // Compare key with first/last depending on LIFO to determine if it should                   // 44
    // be added in reverse order. We track the greatest key entered - if we insert               // 45
    // a key lower than this we should add it the the opposite end of the queue                  // 46
    // We are compensating for the true use of keys in micro-queue its not truly                 // 47
    // ordered by keys but we do try to order just a bit without impacting performance too much. // 48
    // Tasks can be cut off from the power-queue typically unordered since tasks                 // 49
    // will often run async                                                                      // 50
    if (key > maxKey) maxKey = key;                                                              // 51
    // If the key is an older key then "reinsert" item into the queue                            // 52
    if (key < maxKey && first > 0) {                                                             // 53
      list[--first] = {key: key, value: value};                                                  // 54
    } else {                                                                                     // 55
      list[++last] = {key: key, value: value};                                                   // 56
    }                                                                                            // 57
    self._length++;                                                                              // 58
    _lengthDeps.changed();                                                                       // 59
  };                                                                                             // 60
                                                                                                 // 61
  /** @method MicroQueue.getFirstItem Get next item from queue                                   // 62
    * @return {any} The item that was next in line                                               // 63
    */                                                                                           // 64
  self.getFirstItem = function() {                                                               // 65
    var value;                                                                                   // 66
    if (first > last)                                                                            // 67
      return; // queue empty                                                                     // 68
    if (lifo) {                                                                                  // 69
      value = list[last].value;                                                                  // 70
      delete list[last]; // help garbage collector                                               // 71
      last--;                                                                                    // 72
    } else {                                                                                     // 73
      value = list[first].value;                                                                 // 74
      delete list[first]; // help garbage collector                                              // 75
      first++;                                                                                   // 76
    }                                                                                            // 77
    self._length--;                                                                              // 78
    _lengthDeps.changed();                                                                       // 79
    return value;                                                                                // 80
  };                                                                                             // 81
                                                                                                 // 82
  /** @method MicroQueue.reset Reset the queue                                                   // 83
    * This method will empty all data in the queue.                                              // 84
    */                                                                                           // 85
  self.reset = function() {                                                                      // 86
    first = 0;                                                                                   // 87
    last = -1;                                                                                   // 88
    self._length = 0;                                                                            // 89
    list = [];                                                                                   // 90
    _lengthDeps.changed();                                                                       // 91
  };                                                                                             // 92
                                                                                                 // 93
  self.forEach = function(f, noneReactive) {                                                     // 94
    if (!noneReactive) _lengthDeps.depend();                                                     // 95
    for (var i = first; i <= last; i++) {                                                        // 96
      f(list[i].value, list[i].key, i);                                                          // 97
    }                                                                                            // 98
  };                                                                                             // 99
                                                                                                 // 100
  self.forEachReverse = function(f, noneReactive) {                                              // 101
    if (!noneReactive) _lengthDeps.depend();                                                     // 102
                                                                                                 // 103
    for (var i = last; i >= first; i--) {                                                        // 104
      f(list[i].value, list[i].key, i);                                                          // 105
    }                                                                                            // 106
  };                                                                                             // 107
                                                                                                 // 108
  self.remove = function(id) {                                                                   // 109
    var newList = [];                                                                            // 110
    var removed = 0;                                                                             // 111
                                                                                                 // 112
    self.forEach(function(value, key, i) {                                                       // 113
      if (id === key) {                                                                          // 114
        removed++;                                                                               // 115
      } else {                                                                                   // 116
        newList[i - removed] = {key: key, value: value};                                         // 117
      }                                                                                          // 118
    });                                                                                          // 119
    last -= removed;                                                                             // 120
    self._length -= removed;                                                                     // 121
    list = newList;                                                                              // 122
    _lengthDeps.changed();                                                                       // 123
  };                                                                                             // 124
                                                                                                 // 125
  self.fetch = function(noneReactive) {                                                          // 126
    var result = [];                                                                             // 127
    self.forEach(function(value, key, i) {                                                       // 128
      return result.push(value);                                                                 // 129
    }, noneReactive);                                                                            // 130
    return result;                                                                               // 131
  };                                                                                             // 132
};                                                                                               // 133
                                                                                                 // 134
///////////////////////////////////////////////////////////////////////////////////////////////////

}).call(this);

//////////////////////////////////////////////////////////////////////////////////////////////////////////

}).call(this);


/* Exports */
Package._define("cfs:micro-queue", {
  MicroQueue: MicroQueue
});

})();
