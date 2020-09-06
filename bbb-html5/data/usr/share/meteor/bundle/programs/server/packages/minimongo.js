(function () {

/* Imports */
var Meteor = Package.meteor.Meteor;
var global = Package.meteor.global;
var meteorEnv = Package.meteor.meteorEnv;
var DiffSequence = Package['diff-sequence'].DiffSequence;
var ECMAScript = Package.ecmascript.ECMAScript;
var EJSON = Package.ejson.EJSON;
var GeoJSON = Package['geojson-utils'].GeoJSON;
var IdMap = Package['id-map'].IdMap;
var MongoID = Package['mongo-id'].MongoID;
var OrderedDict = Package['ordered-dict'].OrderedDict;
var Random = Package.random.Random;
var Tracker = Package.tracker.Tracker;
var Deps = Package.tracker.Deps;
var Decimal = Package['mongo-decimal'].Decimal;
var meteorInstall = Package.modules.meteorInstall;
var Promise = Package.promise.Promise;

/* Package-scope variables */
var operand, selectorValue, MinimongoTest, MinimongoError, selector, doc, callback, options, oldResults, a, b, LocalCollection, Minimongo;

var require = meteorInstall({"node_modules":{"meteor":{"minimongo":{"minimongo_server.js":function module(require,exports,module){

/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
//                                                                                                                     //
// packages/minimongo/minimongo_server.js                                                                              //
//                                                                                                                     //
/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
                                                                                                                       //
module.link("./minimongo_common.js");
let hasOwn, isNumericKey, isOperatorObject, pathsToTree, projectionDetails;
module.link("./common.js", {
  hasOwn(v) {
    hasOwn = v;
  },

  isNumericKey(v) {
    isNumericKey = v;
  },

  isOperatorObject(v) {
    isOperatorObject = v;
  },

  pathsToTree(v) {
    pathsToTree = v;
  },

  projectionDetails(v) {
    projectionDetails = v;
  }

}, 0);

Minimongo._pathsElidingNumericKeys = paths => paths.map(path => path.split('.').filter(part => !isNumericKey(part)).join('.')); // Returns true if the modifier applied to some document may change the result
// of matching the document by selector
// The modifier is always in a form of Object:
//  - $set
//    - 'a.b.22.z': value
//    - 'foo.bar': 42
//  - $unset
//    - 'abc.d': 1


Minimongo.Matcher.prototype.affectedByModifier = function (modifier) {
  // safe check for $set/$unset being objects
  modifier = Object.assign({
    $set: {},
    $unset: {}
  }, modifier);

  const meaningfulPaths = this._getPaths();

  const modifiedPaths = [].concat(Object.keys(modifier.$set), Object.keys(modifier.$unset));
  return modifiedPaths.some(path => {
    const mod = path.split('.');
    return meaningfulPaths.some(meaningfulPath => {
      const sel = meaningfulPath.split('.');
      let i = 0,
          j = 0;

      while (i < sel.length && j < mod.length) {
        if (isNumericKey(sel[i]) && isNumericKey(mod[j])) {
          // foo.4.bar selector affected by foo.4 modifier
          // foo.3.bar selector unaffected by foo.4 modifier
          if (sel[i] === mod[j]) {
            i++;
            j++;
          } else {
            return false;
          }
        } else if (isNumericKey(sel[i])) {
          // foo.4.bar selector unaffected by foo.bar modifier
          return false;
        } else if (isNumericKey(mod[j])) {
          j++;
        } else if (sel[i] === mod[j]) {
          i++;
          j++;
        } else {
          return false;
        }
      } // One is a prefix of another, taking numeric fields into account


      return true;
    });
  });
}; // @param modifier - Object: MongoDB-styled modifier with `$set`s and `$unsets`
//                           only. (assumed to come from oplog)
// @returns - Boolean: if after applying the modifier, selector can start
//                     accepting the modified value.
// NOTE: assumes that document affected by modifier didn't match this Matcher
// before, so if modifier can't convince selector in a positive change it would
// stay 'false'.
// Currently doesn't support $-operators and numeric indices precisely.


Minimongo.Matcher.prototype.canBecomeTrueByModifier = function (modifier) {
  if (!this.affectedByModifier(modifier)) {
    return false;
  }

  if (!this.isSimple()) {
    return true;
  }

  modifier = Object.assign({
    $set: {},
    $unset: {}
  }, modifier);
  const modifierPaths = [].concat(Object.keys(modifier.$set), Object.keys(modifier.$unset));

  if (this._getPaths().some(pathHasNumericKeys) || modifierPaths.some(pathHasNumericKeys)) {
    return true;
  } // check if there is a $set or $unset that indicates something is an
  // object rather than a scalar in the actual object where we saw $-operator
  // NOTE: it is correct since we allow only scalars in $-operators
  // Example: for selector {'a.b': {$gt: 5}} the modifier {'a.b.c':7} would
  // definitely set the result to false as 'a.b' appears to be an object.


  const expectedScalarIsObject = Object.keys(this._selector).some(path => {
    if (!isOperatorObject(this._selector[path])) {
      return false;
    }

    return modifierPaths.some(modifierPath => modifierPath.startsWith("".concat(path, ".")));
  });

  if (expectedScalarIsObject) {
    return false;
  } // See if we can apply the modifier on the ideally matching object. If it
  // still matches the selector, then the modifier could have turned the real
  // object in the database into something matching.


  const matchingDocument = EJSON.clone(this.matchingDocument()); // The selector is too complex, anything can happen.

  if (matchingDocument === null) {
    return true;
  }

  try {
    LocalCollection._modify(matchingDocument, modifier);
  } catch (error) {
    // Couldn't set a property on a field which is a scalar or null in the
    // selector.
    // Example:
    // real document: { 'a.b': 3 }
    // selector: { 'a': 12 }
    // converted selector (ideal document): { 'a': 12 }
    // modifier: { $set: { 'a.b': 4 } }
    // We don't know what real document was like but from the error raised by
    // $set on a scalar field we can reason that the structure of real document
    // is completely different.
    if (error.name === 'MinimongoError' && error.setPropertyError) {
      return false;
    }

    throw error;
  }

  return this.documentMatches(matchingDocument).result;
}; // Knows how to combine a mongo selector and a fields projection to a new fields
// projection taking into account active fields from the passed selector.
// @returns Object - projection object (same as fields option of mongo cursor)


Minimongo.Matcher.prototype.combineIntoProjection = function (projection) {
  const selectorPaths = Minimongo._pathsElidingNumericKeys(this._getPaths()); // Special case for $where operator in the selector - projection should depend
  // on all fields of the document. getSelectorPaths returns a list of paths
  // selector depends on. If one of the paths is '' (empty string) representing
  // the root or the whole document, complete projection should be returned.


  if (selectorPaths.includes('')) {
    return {};
  }

  return combineImportantPathsIntoProjection(selectorPaths, projection);
}; // Returns an object that would match the selector if possible or null if the
// selector is too complex for us to analyze
// { 'a.b': { ans: 42 }, 'foo.bar': null, 'foo.baz': "something" }
// => { a: { b: { ans: 42 } }, foo: { bar: null, baz: "something" } }


Minimongo.Matcher.prototype.matchingDocument = function () {
  // check if it was computed before
  if (this._matchingDocument !== undefined) {
    return this._matchingDocument;
  } // If the analysis of this selector is too hard for our implementation
  // fallback to "YES"


  let fallback = false;
  this._matchingDocument = pathsToTree(this._getPaths(), path => {
    const valueSelector = this._selector[path];

    if (isOperatorObject(valueSelector)) {
      // if there is a strict equality, there is a good
      // chance we can use one of those as "matching"
      // dummy value
      if (valueSelector.$eq) {
        return valueSelector.$eq;
      }

      if (valueSelector.$in) {
        const matcher = new Minimongo.Matcher({
          placeholder: valueSelector
        }); // Return anything from $in that matches the whole selector for this
        // path. If nothing matches, returns `undefined` as nothing can make
        // this selector into `true`.

        return valueSelector.$in.find(placeholder => matcher.documentMatches({
          placeholder
        }).result);
      }

      if (onlyContainsKeys(valueSelector, ['$gt', '$gte', '$lt', '$lte'])) {
        let lowerBound = -Infinity;
        let upperBound = Infinity;
        ['$lte', '$lt'].forEach(op => {
          if (hasOwn.call(valueSelector, op) && valueSelector[op] < upperBound) {
            upperBound = valueSelector[op];
          }
        });
        ['$gte', '$gt'].forEach(op => {
          if (hasOwn.call(valueSelector, op) && valueSelector[op] > lowerBound) {
            lowerBound = valueSelector[op];
          }
        });
        const middle = (lowerBound + upperBound) / 2;
        const matcher = new Minimongo.Matcher({
          placeholder: valueSelector
        });

        if (!matcher.documentMatches({
          placeholder: middle
        }).result && (middle === lowerBound || middle === upperBound)) {
          fallback = true;
        }

        return middle;
      }

      if (onlyContainsKeys(valueSelector, ['$nin', '$ne'])) {
        // Since this._isSimple makes sure $nin and $ne are not combined with
        // objects or arrays, we can confidently return an empty object as it
        // never matches any scalar.
        return {};
      }

      fallback = true;
    }

    return this._selector[path];
  }, x => x);

  if (fallback) {
    this._matchingDocument = null;
  }

  return this._matchingDocument;
}; // Minimongo.Sorter gets a similar method, which delegates to a Matcher it made
// for this exact purpose.


Minimongo.Sorter.prototype.affectedByModifier = function (modifier) {
  return this._selectorForAffectedByModifier.affectedByModifier(modifier);
};

Minimongo.Sorter.prototype.combineIntoProjection = function (projection) {
  return combineImportantPathsIntoProjection(Minimongo._pathsElidingNumericKeys(this._getPaths()), projection);
};

function combineImportantPathsIntoProjection(paths, projection) {
  const details = projectionDetails(projection); // merge the paths to include

  const tree = pathsToTree(paths, path => true, (node, path, fullPath) => true, details.tree);
  const mergedProjection = treeToPaths(tree);

  if (details.including) {
    // both selector and projection are pointing on fields to include
    // so we can just return the merged tree
    return mergedProjection;
  } // selector is pointing at fields to include
  // projection is pointing at fields to exclude
  // make sure we don't exclude important paths


  const mergedExclProjection = {};
  Object.keys(mergedProjection).forEach(path => {
    if (!mergedProjection[path]) {
      mergedExclProjection[path] = false;
    }
  });
  return mergedExclProjection;
}

function getPaths(selector) {
  return Object.keys(new Minimongo.Matcher(selector)._paths); // XXX remove it?
  // return Object.keys(selector).map(k => {
  //   // we don't know how to handle $where because it can be anything
  //   if (k === '$where') {
  //     return ''; // matches everything
  //   }
  //   // we branch from $or/$and/$nor operator
  //   if (['$or', '$and', '$nor'].includes(k)) {
  //     return selector[k].map(getPaths);
  //   }
  //   // the value is a literal or some comparison operator
  //   return k;
  // })
  //   .reduce((a, b) => a.concat(b), [])
  //   .filter((a, b, c) => c.indexOf(a) === b);
} // A helper to ensure object has only certain keys


function onlyContainsKeys(obj, keys) {
  return Object.keys(obj).every(k => keys.includes(k));
}

function pathHasNumericKeys(path) {
  return path.split('.').some(isNumericKey);
} // Returns a set of key paths similar to
// { 'foo.bar': 1, 'a.b.c': 1 }


function treeToPaths(tree) {
  let prefix = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : '';
  const result = {};
  Object.keys(tree).forEach(key => {
    const value = tree[key];

    if (value === Object(value)) {
      Object.assign(result, treeToPaths(value, "".concat(prefix + key, ".")));
    } else {
      result[prefix + key] = value;
    }
  });
  return result;
}
/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

},"common.js":function module(require,exports,module){

/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
//                                                                                                                     //
// packages/minimongo/common.js                                                                                        //
//                                                                                                                     //
/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
                                                                                                                       //
module.export({
  hasOwn: () => hasOwn,
  ELEMENT_OPERATORS: () => ELEMENT_OPERATORS,
  compileDocumentSelector: () => compileDocumentSelector,
  equalityElementMatcher: () => equalityElementMatcher,
  expandArraysInBranches: () => expandArraysInBranches,
  isIndexable: () => isIndexable,
  isNumericKey: () => isNumericKey,
  isOperatorObject: () => isOperatorObject,
  makeLookupFunction: () => makeLookupFunction,
  nothingMatcher: () => nothingMatcher,
  pathsToTree: () => pathsToTree,
  populateDocumentWithQueryFields: () => populateDocumentWithQueryFields,
  projectionDetails: () => projectionDetails,
  regexpElementMatcher: () => regexpElementMatcher
});
let LocalCollection;
module.link("./local_collection.js", {
  default(v) {
    LocalCollection = v;
  }

}, 0);
const hasOwn = Object.prototype.hasOwnProperty;
const ELEMENT_OPERATORS = {
  $lt: makeInequality(cmpValue => cmpValue < 0),
  $gt: makeInequality(cmpValue => cmpValue > 0),
  $lte: makeInequality(cmpValue => cmpValue <= 0),
  $gte: makeInequality(cmpValue => cmpValue >= 0),
  $mod: {
    compileElementSelector(operand) {
      if (!(Array.isArray(operand) && operand.length === 2 && typeof operand[0] === 'number' && typeof operand[1] === 'number')) {
        throw Error('argument to $mod must be an array of two numbers');
      } // XXX could require to be ints or round or something


      const divisor = operand[0];
      const remainder = operand[1];
      return value => typeof value === 'number' && value % divisor === remainder;
    }

  },
  $in: {
    compileElementSelector(operand) {
      if (!Array.isArray(operand)) {
        throw Error('$in needs an array');
      }

      const elementMatchers = operand.map(option => {
        if (option instanceof RegExp) {
          return regexpElementMatcher(option);
        }

        if (isOperatorObject(option)) {
          throw Error('cannot nest $ under $in');
        }

        return equalityElementMatcher(option);
      });
      return value => {
        // Allow {a: {$in: [null]}} to match when 'a' does not exist.
        if (value === undefined) {
          value = null;
        }

        return elementMatchers.some(matcher => matcher(value));
      };
    }

  },
  $size: {
    // {a: [[5, 5]]} must match {a: {$size: 1}} but not {a: {$size: 2}}, so we
    // don't want to consider the element [5,5] in the leaf array [[5,5]] as a
    // possible value.
    dontExpandLeafArrays: true,

    compileElementSelector(operand) {
      if (typeof operand === 'string') {
        // Don't ask me why, but by experimentation, this seems to be what Mongo
        // does.
        operand = 0;
      } else if (typeof operand !== 'number') {
        throw Error('$size needs a number');
      }

      return value => Array.isArray(value) && value.length === operand;
    }

  },
  $type: {
    // {a: [5]} must not match {a: {$type: 4}} (4 means array), but it should
    // match {a: {$type: 1}} (1 means number), and {a: [[5]]} must match {$a:
    // {$type: 4}}. Thus, when we see a leaf array, we *should* expand it but
    // should *not* include it itself.
    dontIncludeLeafArrays: true,

    compileElementSelector(operand) {
      if (typeof operand === 'string') {
        const operandAliasMap = {
          'double': 1,
          'string': 2,
          'object': 3,
          'array': 4,
          'binData': 5,
          'undefined': 6,
          'objectId': 7,
          'bool': 8,
          'date': 9,
          'null': 10,
          'regex': 11,
          'dbPointer': 12,
          'javascript': 13,
          'symbol': 14,
          'javascriptWithScope': 15,
          'int': 16,
          'timestamp': 17,
          'long': 18,
          'decimal': 19,
          'minKey': -1,
          'maxKey': 127
        };

        if (!hasOwn.call(operandAliasMap, operand)) {
          throw Error("unknown string alias for $type: ".concat(operand));
        }

        operand = operandAliasMap[operand];
      } else if (typeof operand === 'number') {
        if (operand === 0 || operand < -1 || operand > 19 && operand !== 127) {
          throw Error("Invalid numerical $type code: ".concat(operand));
        }
      } else {
        throw Error('argument to $type is not a number or a string');
      }

      return value => value !== undefined && LocalCollection._f._type(value) === operand;
    }

  },
  $bitsAllSet: {
    compileElementSelector(operand) {
      const mask = getOperandBitmask(operand, '$bitsAllSet');
      return value => {
        const bitmask = getValueBitmask(value, mask.length);
        return bitmask && mask.every((byte, i) => (bitmask[i] & byte) === byte);
      };
    }

  },
  $bitsAnySet: {
    compileElementSelector(operand) {
      const mask = getOperandBitmask(operand, '$bitsAnySet');
      return value => {
        const bitmask = getValueBitmask(value, mask.length);
        return bitmask && mask.some((byte, i) => (~bitmask[i] & byte) !== byte);
      };
    }

  },
  $bitsAllClear: {
    compileElementSelector(operand) {
      const mask = getOperandBitmask(operand, '$bitsAllClear');
      return value => {
        const bitmask = getValueBitmask(value, mask.length);
        return bitmask && mask.every((byte, i) => !(bitmask[i] & byte));
      };
    }

  },
  $bitsAnyClear: {
    compileElementSelector(operand) {
      const mask = getOperandBitmask(operand, '$bitsAnyClear');
      return value => {
        const bitmask = getValueBitmask(value, mask.length);
        return bitmask && mask.some((byte, i) => (bitmask[i] & byte) !== byte);
      };
    }

  },
  $regex: {
    compileElementSelector(operand, valueSelector) {
      if (!(typeof operand === 'string' || operand instanceof RegExp)) {
        throw Error('$regex has to be a string or RegExp');
      }

      let regexp;

      if (valueSelector.$options !== undefined) {
        // Options passed in $options (even the empty string) always overrides
        // options in the RegExp object itself.
        // Be clear that we only support the JS-supported options, not extended
        // ones (eg, Mongo supports x and s). Ideally we would implement x and s
        // by transforming the regexp, but not today...
        if (/[^gim]/.test(valueSelector.$options)) {
          throw new Error('Only the i, m, and g regexp options are supported');
        }

        const source = operand instanceof RegExp ? operand.source : operand;
        regexp = new RegExp(source, valueSelector.$options);
      } else if (operand instanceof RegExp) {
        regexp = operand;
      } else {
        regexp = new RegExp(operand);
      }

      return regexpElementMatcher(regexp);
    }

  },
  $elemMatch: {
    dontExpandLeafArrays: true,

    compileElementSelector(operand, valueSelector, matcher) {
      if (!LocalCollection._isPlainObject(operand)) {
        throw Error('$elemMatch need an object');
      }

      const isDocMatcher = !isOperatorObject(Object.keys(operand).filter(key => !hasOwn.call(LOGICAL_OPERATORS, key)).reduce((a, b) => Object.assign(a, {
        [b]: operand[b]
      }), {}), true);
      let subMatcher;

      if (isDocMatcher) {
        // This is NOT the same as compileValueSelector(operand), and not just
        // because of the slightly different calling convention.
        // {$elemMatch: {x: 3}} means "an element has a field x:3", not
        // "consists only of a field x:3". Also, regexps and sub-$ are allowed.
        subMatcher = compileDocumentSelector(operand, matcher, {
          inElemMatch: true
        });
      } else {
        subMatcher = compileValueSelector(operand, matcher);
      }

      return value => {
        if (!Array.isArray(value)) {
          return false;
        }

        for (let i = 0; i < value.length; ++i) {
          const arrayElement = value[i];
          let arg;

          if (isDocMatcher) {
            // We can only match {$elemMatch: {b: 3}} against objects.
            // (We can also match against arrays, if there's numeric indices,
            // eg {$elemMatch: {'0.b': 3}} or {$elemMatch: {0: 3}}.)
            if (!isIndexable(arrayElement)) {
              return false;
            }

            arg = arrayElement;
          } else {
            // dontIterate ensures that {a: {$elemMatch: {$gt: 5}}} matches
            // {a: [8]} but not {a: [[8]]}
            arg = [{
              value: arrayElement,
              dontIterate: true
            }];
          } // XXX support $near in $elemMatch by propagating $distance?


          if (subMatcher(arg).result) {
            return i; // specially understood to mean "use as arrayIndices"
          }
        }

        return false;
      };
    }

  }
};
// Operators that appear at the top level of a document selector.
const LOGICAL_OPERATORS = {
  $and(subSelector, matcher, inElemMatch) {
    return andDocumentMatchers(compileArrayOfDocumentSelectors(subSelector, matcher, inElemMatch));
  },

  $or(subSelector, matcher, inElemMatch) {
    const matchers = compileArrayOfDocumentSelectors(subSelector, matcher, inElemMatch); // Special case: if there is only one matcher, use it directly, *preserving*
    // any arrayIndices it returns.

    if (matchers.length === 1) {
      return matchers[0];
    }

    return doc => {
      const result = matchers.some(fn => fn(doc).result); // $or does NOT set arrayIndices when it has multiple
      // sub-expressions. (Tested against MongoDB.)

      return {
        result
      };
    };
  },

  $nor(subSelector, matcher, inElemMatch) {
    const matchers = compileArrayOfDocumentSelectors(subSelector, matcher, inElemMatch);
    return doc => {
      const result = matchers.every(fn => !fn(doc).result); // Never set arrayIndices, because we only match if nothing in particular
      // 'matched' (and because this is consistent with MongoDB).

      return {
        result
      };
    };
  },

  $where(selectorValue, matcher) {
    // Record that *any* path may be used.
    matcher._recordPathUsed('');

    matcher._hasWhere = true;

    if (!(selectorValue instanceof Function)) {
      // XXX MongoDB seems to have more complex logic to decide where or or not
      // to add 'return'; not sure exactly what it is.
      selectorValue = Function('obj', "return ".concat(selectorValue));
    } // We make the document available as both `this` and `obj`.
    // // XXX not sure what we should do if this throws


    return doc => ({
      result: selectorValue.call(doc, doc)
    });
  },

  // This is just used as a comment in the query (in MongoDB, it also ends up in
  // query logs); it has no effect on the actual selection.
  $comment() {
    return () => ({
      result: true
    });
  }

}; // Operators that (unlike LOGICAL_OPERATORS) pertain to individual paths in a
// document, but (unlike ELEMENT_OPERATORS) do not have a simple definition as
// "match each branched value independently and combine with
// convertElementMatcherToBranchedMatcher".

const VALUE_OPERATORS = {
  $eq(operand) {
    return convertElementMatcherToBranchedMatcher(equalityElementMatcher(operand));
  },

  $not(operand, valueSelector, matcher) {
    return invertBranchedMatcher(compileValueSelector(operand, matcher));
  },

  $ne(operand) {
    return invertBranchedMatcher(convertElementMatcherToBranchedMatcher(equalityElementMatcher(operand)));
  },

  $nin(operand) {
    return invertBranchedMatcher(convertElementMatcherToBranchedMatcher(ELEMENT_OPERATORS.$in.compileElementSelector(operand)));
  },

  $exists(operand) {
    const exists = convertElementMatcherToBranchedMatcher(value => value !== undefined);
    return operand ? exists : invertBranchedMatcher(exists);
  },

  // $options just provides options for $regex; its logic is inside $regex
  $options(operand, valueSelector) {
    if (!hasOwn.call(valueSelector, '$regex')) {
      throw Error('$options needs a $regex');
    }

    return everythingMatcher;
  },

  // $maxDistance is basically an argument to $near
  $maxDistance(operand, valueSelector) {
    if (!valueSelector.$near) {
      throw Error('$maxDistance needs a $near');
    }

    return everythingMatcher;
  },

  $all(operand, valueSelector, matcher) {
    if (!Array.isArray(operand)) {
      throw Error('$all requires array');
    } // Not sure why, but this seems to be what MongoDB does.


    if (operand.length === 0) {
      return nothingMatcher;
    }

    const branchedMatchers = operand.map(criterion => {
      // XXX handle $all/$elemMatch combination
      if (isOperatorObject(criterion)) {
        throw Error('no $ expressions in $all');
      } // This is always a regexp or equality selector.


      return compileValueSelector(criterion, matcher);
    }); // andBranchedMatchers does NOT require all selectors to return true on the
    // SAME branch.

    return andBranchedMatchers(branchedMatchers);
  },

  $near(operand, valueSelector, matcher, isRoot) {
    if (!isRoot) {
      throw Error('$near can\'t be inside another $ operator');
    }

    matcher._hasGeoQuery = true; // There are two kinds of geodata in MongoDB: legacy coordinate pairs and
    // GeoJSON. They use different distance metrics, too. GeoJSON queries are
    // marked with a $geometry property, though legacy coordinates can be
    // matched using $geometry.

    let maxDistance, point, distance;

    if (LocalCollection._isPlainObject(operand) && hasOwn.call(operand, '$geometry')) {
      // GeoJSON "2dsphere" mode.
      maxDistance = operand.$maxDistance;
      point = operand.$geometry;

      distance = value => {
        // XXX: for now, we don't calculate the actual distance between, say,
        // polygon and circle. If people care about this use-case it will get
        // a priority.
        if (!value) {
          return null;
        }

        if (!value.type) {
          return GeoJSON.pointDistance(point, {
            type: 'Point',
            coordinates: pointToArray(value)
          });
        }

        if (value.type === 'Point') {
          return GeoJSON.pointDistance(point, value);
        }

        return GeoJSON.geometryWithinRadius(value, point, maxDistance) ? 0 : maxDistance + 1;
      };
    } else {
      maxDistance = valueSelector.$maxDistance;

      if (!isIndexable(operand)) {
        throw Error('$near argument must be coordinate pair or GeoJSON');
      }

      point = pointToArray(operand);

      distance = value => {
        if (!isIndexable(value)) {
          return null;
        }

        return distanceCoordinatePairs(point, value);
      };
    }

    return branchedValues => {
      // There might be multiple points in the document that match the given
      // field. Only one of them needs to be within $maxDistance, but we need to
      // evaluate all of them and use the nearest one for the implicit sort
      // specifier. (That's why we can't just use ELEMENT_OPERATORS here.)
      //
      // Note: This differs from MongoDB's implementation, where a document will
      // actually show up *multiple times* in the result set, with one entry for
      // each within-$maxDistance branching point.
      const result = {
        result: false
      };
      expandArraysInBranches(branchedValues).every(branch => {
        // if operation is an update, don't skip branches, just return the first
        // one (#3599)
        let curDistance;

        if (!matcher._isUpdate) {
          if (!(typeof branch.value === 'object')) {
            return true;
          }

          curDistance = distance(branch.value); // Skip branches that aren't real points or are too far away.

          if (curDistance === null || curDistance > maxDistance) {
            return true;
          } // Skip anything that's a tie.


          if (result.distance !== undefined && result.distance <= curDistance) {
            return true;
          }
        }

        result.result = true;
        result.distance = curDistance;

        if (branch.arrayIndices) {
          result.arrayIndices = branch.arrayIndices;
        } else {
          delete result.arrayIndices;
        }

        return !matcher._isUpdate;
      });
      return result;
    };
  }

}; // NB: We are cheating and using this function to implement 'AND' for both
// 'document matchers' and 'branched matchers'. They both return result objects
// but the argument is different: for the former it's a whole doc, whereas for
// the latter it's an array of 'branched values'.

function andSomeMatchers(subMatchers) {
  if (subMatchers.length === 0) {
    return everythingMatcher;
  }

  if (subMatchers.length === 1) {
    return subMatchers[0];
  }

  return docOrBranches => {
    const match = {};
    match.result = subMatchers.every(fn => {
      const subResult = fn(docOrBranches); // Copy a 'distance' number out of the first sub-matcher that has
      // one. Yes, this means that if there are multiple $near fields in a
      // query, something arbitrary happens; this appears to be consistent with
      // Mongo.

      if (subResult.result && subResult.distance !== undefined && match.distance === undefined) {
        match.distance = subResult.distance;
      } // Similarly, propagate arrayIndices from sub-matchers... but to match
      // MongoDB behavior, this time the *last* sub-matcher with arrayIndices
      // wins.


      if (subResult.result && subResult.arrayIndices) {
        match.arrayIndices = subResult.arrayIndices;
      }

      return subResult.result;
    }); // If we didn't actually match, forget any extra metadata we came up with.

    if (!match.result) {
      delete match.distance;
      delete match.arrayIndices;
    }

    return match;
  };
}

const andDocumentMatchers = andSomeMatchers;
const andBranchedMatchers = andSomeMatchers;

function compileArrayOfDocumentSelectors(selectors, matcher, inElemMatch) {
  if (!Array.isArray(selectors) || selectors.length === 0) {
    throw Error('$and/$or/$nor must be nonempty array');
  }

  return selectors.map(subSelector => {
    if (!LocalCollection._isPlainObject(subSelector)) {
      throw Error('$or/$and/$nor entries need to be full objects');
    }

    return compileDocumentSelector(subSelector, matcher, {
      inElemMatch
    });
  });
} // Takes in a selector that could match a full document (eg, the original
// selector). Returns a function mapping document->result object.
//
// matcher is the Matcher object we are compiling.
//
// If this is the root document selector (ie, not wrapped in $and or the like),
// then isRoot is true. (This is used by $near.)


function compileDocumentSelector(docSelector, matcher) {
  let options = arguments.length > 2 && arguments[2] !== undefined ? arguments[2] : {};
  const docMatchers = Object.keys(docSelector).map(key => {
    const subSelector = docSelector[key];

    if (key.substr(0, 1) === '$') {
      // Outer operators are either logical operators (they recurse back into
      // this function), or $where.
      if (!hasOwn.call(LOGICAL_OPERATORS, key)) {
        throw new Error("Unrecognized logical operator: ".concat(key));
      }

      matcher._isSimple = false;
      return LOGICAL_OPERATORS[key](subSelector, matcher, options.inElemMatch);
    } // Record this path, but only if we aren't in an elemMatcher, since in an
    // elemMatch this is a path inside an object in an array, not in the doc
    // root.


    if (!options.inElemMatch) {
      matcher._recordPathUsed(key);
    } // Don't add a matcher if subSelector is a function -- this is to match
    // the behavior of Meteor on the server (inherited from the node mongodb
    // driver), which is to ignore any part of a selector which is a function.


    if (typeof subSelector === 'function') {
      return undefined;
    }

    const lookUpByIndex = makeLookupFunction(key);
    const valueMatcher = compileValueSelector(subSelector, matcher, options.isRoot);
    return doc => valueMatcher(lookUpByIndex(doc));
  }).filter(Boolean);
  return andDocumentMatchers(docMatchers);
}

// Takes in a selector that could match a key-indexed value in a document; eg,
// {$gt: 5, $lt: 9}, or a regular expression, or any non-expression object (to
// indicate equality).  Returns a branched matcher: a function mapping
// [branched value]->result object.
function compileValueSelector(valueSelector, matcher, isRoot) {
  if (valueSelector instanceof RegExp) {
    matcher._isSimple = false;
    return convertElementMatcherToBranchedMatcher(regexpElementMatcher(valueSelector));
  }

  if (isOperatorObject(valueSelector)) {
    return operatorBranchedMatcher(valueSelector, matcher, isRoot);
  }

  return convertElementMatcherToBranchedMatcher(equalityElementMatcher(valueSelector));
} // Given an element matcher (which evaluates a single value), returns a branched
// value (which evaluates the element matcher on all the branches and returns a
// more structured return value possibly including arrayIndices).


function convertElementMatcherToBranchedMatcher(elementMatcher) {
  let options = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : {};
  return branches => {
    const expanded = options.dontExpandLeafArrays ? branches : expandArraysInBranches(branches, options.dontIncludeLeafArrays);
    const match = {};
    match.result = expanded.some(element => {
      let matched = elementMatcher(element.value); // Special case for $elemMatch: it means "true, and use this as an array
      // index if I didn't already have one".

      if (typeof matched === 'number') {
        // XXX This code dates from when we only stored a single array index
        // (for the outermost array). Should we be also including deeper array
        // indices from the $elemMatch match?
        if (!element.arrayIndices) {
          element.arrayIndices = [matched];
        }

        matched = true;
      } // If some element matched, and it's tagged with array indices, include
      // those indices in our result object.


      if (matched && element.arrayIndices) {
        match.arrayIndices = element.arrayIndices;
      }

      return matched;
    });
    return match;
  };
} // Helpers for $near.


function distanceCoordinatePairs(a, b) {
  const pointA = pointToArray(a);
  const pointB = pointToArray(b);
  return Math.hypot(pointA[0] - pointB[0], pointA[1] - pointB[1]);
} // Takes something that is not an operator object and returns an element matcher
// for equality with that thing.


function equalityElementMatcher(elementSelector) {
  if (isOperatorObject(elementSelector)) {
    throw Error('Can\'t create equalityValueSelector for operator object');
  } // Special-case: null and undefined are equal (if you got undefined in there
  // somewhere, or if you got it due to some branch being non-existent in the
  // weird special case), even though they aren't with EJSON.equals.
  // undefined or null


  if (elementSelector == null) {
    return value => value == null;
  }

  return value => LocalCollection._f._equal(elementSelector, value);
}

function everythingMatcher(docOrBranchedValues) {
  return {
    result: true
  };
}

function expandArraysInBranches(branches, skipTheArrays) {
  const branchesOut = [];
  branches.forEach(branch => {
    const thisIsArray = Array.isArray(branch.value); // We include the branch itself, *UNLESS* we it's an array that we're going
    // to iterate and we're told to skip arrays.  (That's right, we include some
    // arrays even skipTheArrays is true: these are arrays that were found via
    // explicit numerical indices.)

    if (!(skipTheArrays && thisIsArray && !branch.dontIterate)) {
      branchesOut.push({
        arrayIndices: branch.arrayIndices,
        value: branch.value
      });
    }

    if (thisIsArray && !branch.dontIterate) {
      branch.value.forEach((value, i) => {
        branchesOut.push({
          arrayIndices: (branch.arrayIndices || []).concat(i),
          value
        });
      });
    }
  });
  return branchesOut;
}

// Helpers for $bitsAllSet/$bitsAnySet/$bitsAllClear/$bitsAnyClear.
function getOperandBitmask(operand, selector) {
  // numeric bitmask
  // You can provide a numeric bitmask to be matched against the operand field.
  // It must be representable as a non-negative 32-bit signed integer.
  // Otherwise, $bitsAllSet will return an error.
  if (Number.isInteger(operand) && operand >= 0) {
    return new Uint8Array(new Int32Array([operand]).buffer);
  } // bindata bitmask
  // You can also use an arbitrarily large BinData instance as a bitmask.


  if (EJSON.isBinary(operand)) {
    return new Uint8Array(operand.buffer);
  } // position list
  // If querying a list of bit positions, each <position> must be a non-negative
  // integer. Bit positions start at 0 from the least significant bit.


  if (Array.isArray(operand) && operand.every(x => Number.isInteger(x) && x >= 0)) {
    const buffer = new ArrayBuffer((Math.max(...operand) >> 3) + 1);
    const view = new Uint8Array(buffer);
    operand.forEach(x => {
      view[x >> 3] |= 1 << (x & 0x7);
    });
    return view;
  } // bad operand


  throw Error("operand to ".concat(selector, " must be a numeric bitmask (representable as a ") + 'non-negative 32-bit signed integer), a bindata bitmask or an array with ' + 'bit positions (non-negative integers)');
}

function getValueBitmask(value, length) {
  // The field value must be either numerical or a BinData instance. Otherwise,
  // $bits... will not match the current document.
  // numerical
  if (Number.isSafeInteger(value)) {
    // $bits... will not match numerical values that cannot be represented as a
    // signed 64-bit integer. This can be the case if a value is either too
    // large or small to fit in a signed 64-bit integer, or if it has a
    // fractional component.
    const buffer = new ArrayBuffer(Math.max(length, 2 * Uint32Array.BYTES_PER_ELEMENT));
    let view = new Uint32Array(buffer, 0, 2);
    view[0] = value % ((1 << 16) * (1 << 16)) | 0;
    view[1] = value / ((1 << 16) * (1 << 16)) | 0; // sign extension

    if (value < 0) {
      view = new Uint8Array(buffer, 2);
      view.forEach((byte, i) => {
        view[i] = 0xff;
      });
    }

    return new Uint8Array(buffer);
  } // bindata


  if (EJSON.isBinary(value)) {
    return new Uint8Array(value.buffer);
  } // no match


  return false;
} // Actually inserts a key value into the selector document
// However, this checks there is no ambiguity in setting
// the value for the given key, throws otherwise


function insertIntoDocument(document, key, value) {
  Object.keys(document).forEach(existingKey => {
    if (existingKey.length > key.length && existingKey.indexOf("".concat(key, ".")) === 0 || key.length > existingKey.length && key.indexOf("".concat(existingKey, ".")) === 0) {
      throw new Error("cannot infer query fields to set, both paths '".concat(existingKey, "' and ") + "'".concat(key, "' are matched"));
    } else if (existingKey === key) {
      throw new Error("cannot infer query fields to set, path '".concat(key, "' is matched twice"));
    }
  });
  document[key] = value;
} // Returns a branched matcher that matches iff the given matcher does not.
// Note that this implicitly "deMorganizes" the wrapped function.  ie, it
// means that ALL branch values need to fail to match innerBranchedMatcher.


function invertBranchedMatcher(branchedMatcher) {
  return branchValues => {
    // We explicitly choose to strip arrayIndices here: it doesn't make sense to
    // say "update the array element that does not match something", at least
    // in mongo-land.
    return {
      result: !branchedMatcher(branchValues).result
    };
  };
}

function isIndexable(obj) {
  return Array.isArray(obj) || LocalCollection._isPlainObject(obj);
}

function isNumericKey(s) {
  return /^[0-9]+$/.test(s);
}

function isOperatorObject(valueSelector, inconsistentOK) {
  if (!LocalCollection._isPlainObject(valueSelector)) {
    return false;
  }

  let theseAreOperators = undefined;
  Object.keys(valueSelector).forEach(selKey => {
    const thisIsOperator = selKey.substr(0, 1) === '$';

    if (theseAreOperators === undefined) {
      theseAreOperators = thisIsOperator;
    } else if (theseAreOperators !== thisIsOperator) {
      if (!inconsistentOK) {
        throw new Error("Inconsistent operator: ".concat(JSON.stringify(valueSelector)));
      }

      theseAreOperators = false;
    }
  });
  return !!theseAreOperators; // {} has no operators
}

// Helper for $lt/$gt/$lte/$gte.
function makeInequality(cmpValueComparator) {
  return {
    compileElementSelector(operand) {
      // Arrays never compare false with non-arrays for any inequality.
      // XXX This was behavior we observed in pre-release MongoDB 2.5, but
      //     it seems to have been reverted.
      //     See https://jira.mongodb.org/browse/SERVER-11444
      if (Array.isArray(operand)) {
        return () => false;
      } // Special case: consider undefined and null the same (so true with
      // $gte/$lte).


      if (operand === undefined) {
        operand = null;
      }

      const operandType = LocalCollection._f._type(operand);

      return value => {
        if (value === undefined) {
          value = null;
        } // Comparisons are never true among things of different type (except
        // null vs undefined).


        if (LocalCollection._f._type(value) !== operandType) {
          return false;
        }

        return cmpValueComparator(LocalCollection._f._cmp(value, operand));
      };
    }

  };
} // makeLookupFunction(key) returns a lookup function.
//
// A lookup function takes in a document and returns an array of matching
// branches.  If no arrays are found while looking up the key, this array will
// have exactly one branches (possibly 'undefined', if some segment of the key
// was not found).
//
// If arrays are found in the middle, this can have more than one element, since
// we 'branch'. When we 'branch', if there are more key segments to look up,
// then we only pursue branches that are plain objects (not arrays or scalars).
// This means we can actually end up with no branches!
//
// We do *NOT* branch on arrays that are found at the end (ie, at the last
// dotted member of the key). We just return that array; if you want to
// effectively 'branch' over the array's values, post-process the lookup
// function with expandArraysInBranches.
//
// Each branch is an object with keys:
//  - value: the value at the branch
//  - dontIterate: an optional bool; if true, it means that 'value' is an array
//    that expandArraysInBranches should NOT expand. This specifically happens
//    when there is a numeric index in the key, and ensures the
//    perhaps-surprising MongoDB behavior where {'a.0': 5} does NOT
//    match {a: [[5]]}.
//  - arrayIndices: if any array indexing was done during lookup (either due to
//    explicit numeric indices or implicit branching), this will be an array of
//    the array indices used, from outermost to innermost; it is falsey or
//    absent if no array index is used. If an explicit numeric index is used,
//    the index will be followed in arrayIndices by the string 'x'.
//
//    Note: arrayIndices is used for two purposes. First, it is used to
//    implement the '$' modifier feature, which only ever looks at its first
//    element.
//
//    Second, it is used for sort key generation, which needs to be able to tell
//    the difference between different paths. Moreover, it needs to
//    differentiate between explicit and implicit branching, which is why
//    there's the somewhat hacky 'x' entry: this means that explicit and
//    implicit array lookups will have different full arrayIndices paths. (That
//    code only requires that different paths have different arrayIndices; it
//    doesn't actually 'parse' arrayIndices. As an alternative, arrayIndices
//    could contain objects with flags like 'implicit', but I think that only
//    makes the code surrounding them more complex.)
//
//    (By the way, this field ends up getting passed around a lot without
//    cloning, so never mutate any arrayIndices field/var in this package!)
//
//
// At the top level, you may only pass in a plain object or array.
//
// See the test 'minimongo - lookup' for some examples of what lookup functions
// return.


function makeLookupFunction(key) {
  let options = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : {};
  const parts = key.split('.');
  const firstPart = parts.length ? parts[0] : '';
  const lookupRest = parts.length > 1 && makeLookupFunction(parts.slice(1).join('.'), options);

  const omitUnnecessaryFields = result => {
    if (!result.dontIterate) {
      delete result.dontIterate;
    }

    if (result.arrayIndices && !result.arrayIndices.length) {
      delete result.arrayIndices;
    }

    return result;
  }; // Doc will always be a plain object or an array.
  // apply an explicit numeric index, an array.


  return function (doc) {
    let arrayIndices = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : [];

    if (Array.isArray(doc)) {
      // If we're being asked to do an invalid lookup into an array (non-integer
      // or out-of-bounds), return no results (which is different from returning
      // a single undefined result, in that `null` equality checks won't match).
      if (!(isNumericKey(firstPart) && firstPart < doc.length)) {
        return [];
      } // Remember that we used this array index. Include an 'x' to indicate that
      // the previous index came from being considered as an explicit array
      // index (not branching).


      arrayIndices = arrayIndices.concat(+firstPart, 'x');
    } // Do our first lookup.


    const firstLevel = doc[firstPart]; // If there is no deeper to dig, return what we found.
    //
    // If what we found is an array, most value selectors will choose to treat
    // the elements of the array as matchable values in their own right, but
    // that's done outside of the lookup function. (Exceptions to this are $size
    // and stuff relating to $elemMatch.  eg, {a: {$size: 2}} does not match {a:
    // [[1, 2]]}.)
    //
    // That said, if we just did an *explicit* array lookup (on doc) to find
    // firstLevel, and firstLevel is an array too, we do NOT want value
    // selectors to iterate over it.  eg, {'a.0': 5} does not match {a: [[5]]}.
    // So in that case, we mark the return value as 'don't iterate'.

    if (!lookupRest) {
      return [omitUnnecessaryFields({
        arrayIndices,
        dontIterate: Array.isArray(doc) && Array.isArray(firstLevel),
        value: firstLevel
      })];
    } // We need to dig deeper.  But if we can't, because what we've found is not
    // an array or plain object, we're done. If we just did a numeric index into
    // an array, we return nothing here (this is a change in Mongo 2.5 from
    // Mongo 2.4, where {'a.0.b': null} stopped matching {a: [5]}). Otherwise,
    // return a single `undefined` (which can, for example, match via equality
    // with `null`).


    if (!isIndexable(firstLevel)) {
      if (Array.isArray(doc)) {
        return [];
      }

      return [omitUnnecessaryFields({
        arrayIndices,
        value: undefined
      })];
    }

    const result = [];

    const appendToResult = more => {
      result.push(...more);
    }; // Dig deeper: look up the rest of the parts on whatever we've found.
    // (lookupRest is smart enough to not try to do invalid lookups into
    // firstLevel if it's an array.)


    appendToResult(lookupRest(firstLevel, arrayIndices)); // If we found an array, then in *addition* to potentially treating the next
    // part as a literal integer lookup, we should also 'branch': try to look up
    // the rest of the parts on each array element in parallel.
    //
    // In this case, we *only* dig deeper into array elements that are plain
    // objects. (Recall that we only got this far if we have further to dig.)
    // This makes sense: we certainly don't dig deeper into non-indexable
    // objects. And it would be weird to dig into an array: it's simpler to have
    // a rule that explicit integer indexes only apply to an outer array, not to
    // an array you find after a branching search.
    //
    // In the special case of a numeric part in a *sort selector* (not a query
    // selector), we skip the branching: we ONLY allow the numeric part to mean
    // 'look up this index' in that case, not 'also look up this index in all
    // the elements of the array'.

    if (Array.isArray(firstLevel) && !(isNumericKey(parts[1]) && options.forSort)) {
      firstLevel.forEach((branch, arrayIndex) => {
        if (LocalCollection._isPlainObject(branch)) {
          appendToResult(lookupRest(branch, arrayIndices.concat(arrayIndex)));
        }
      });
    }

    return result;
  };
}

// Object exported only for unit testing.
// Use it to export private functions to test in Tinytest.
MinimongoTest = {
  makeLookupFunction
};

MinimongoError = function (message) {
  let options = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : {};

  if (typeof message === 'string' && options.field) {
    message += " for field '".concat(options.field, "'");
  }

  const error = new Error(message);
  error.name = 'MinimongoError';
  return error;
};

function nothingMatcher(docOrBranchedValues) {
  return {
    result: false
  };
}

// Takes an operator object (an object with $ keys) and returns a branched
// matcher for it.
function operatorBranchedMatcher(valueSelector, matcher, isRoot) {
  // Each valueSelector works separately on the various branches.  So one
  // operator can match one branch and another can match another branch.  This
  // is OK.
  const operatorMatchers = Object.keys(valueSelector).map(operator => {
    const operand = valueSelector[operator];
    const simpleRange = ['$lt', '$lte', '$gt', '$gte'].includes(operator) && typeof operand === 'number';
    const simpleEquality = ['$ne', '$eq'].includes(operator) && operand !== Object(operand);
    const simpleInclusion = ['$in', '$nin'].includes(operator) && Array.isArray(operand) && !operand.some(x => x === Object(x));

    if (!(simpleRange || simpleInclusion || simpleEquality)) {
      matcher._isSimple = false;
    }

    if (hasOwn.call(VALUE_OPERATORS, operator)) {
      return VALUE_OPERATORS[operator](operand, valueSelector, matcher, isRoot);
    }

    if (hasOwn.call(ELEMENT_OPERATORS, operator)) {
      const options = ELEMENT_OPERATORS[operator];
      return convertElementMatcherToBranchedMatcher(options.compileElementSelector(operand, valueSelector, matcher), options);
    }

    throw new Error("Unrecognized operator: ".concat(operator));
  });
  return andBranchedMatchers(operatorMatchers);
} // paths - Array: list of mongo style paths
// newLeafFn - Function: of form function(path) should return a scalar value to
//                       put into list created for that path
// conflictFn - Function: of form function(node, path, fullPath) is called
//                        when building a tree path for 'fullPath' node on
//                        'path' was already a leaf with a value. Must return a
//                        conflict resolution.
// initial tree - Optional Object: starting tree.
// @returns - Object: tree represented as a set of nested objects


function pathsToTree(paths, newLeafFn, conflictFn) {
  let root = arguments.length > 3 && arguments[3] !== undefined ? arguments[3] : {};
  paths.forEach(path => {
    const pathArray = path.split('.');
    let tree = root; // use .every just for iteration with break

    const success = pathArray.slice(0, -1).every((key, i) => {
      if (!hasOwn.call(tree, key)) {
        tree[key] = {};
      } else if (tree[key] !== Object(tree[key])) {
        tree[key] = conflictFn(tree[key], pathArray.slice(0, i + 1).join('.'), path); // break out of loop if we are failing for this path

        if (tree[key] !== Object(tree[key])) {
          return false;
        }
      }

      tree = tree[key];
      return true;
    });

    if (success) {
      const lastKey = pathArray[pathArray.length - 1];

      if (hasOwn.call(tree, lastKey)) {
        tree[lastKey] = conflictFn(tree[lastKey], path, path);
      } else {
        tree[lastKey] = newLeafFn(path);
      }
    }
  });
  return root;
}

// Makes sure we get 2 elements array and assume the first one to be x and
// the second one to y no matter what user passes.
// In case user passes { lon: x, lat: y } returns [x, y]
function pointToArray(point) {
  return Array.isArray(point) ? point.slice() : [point.x, point.y];
} // Creating a document from an upsert is quite tricky.
// E.g. this selector: {"$or": [{"b.foo": {"$all": ["bar"]}}]}, should result
// in: {"b.foo": "bar"}
// But this selector: {"$or": [{"b": {"foo": {"$all": ["bar"]}}}]} should throw
// an error
// Some rules (found mainly with trial & error, so there might be more):
// - handle all childs of $and (or implicit $and)
// - handle $or nodes with exactly 1 child
// - ignore $or nodes with more than 1 child
// - ignore $nor and $not nodes
// - throw when a value can not be set unambiguously
// - every value for $all should be dealt with as separate $eq-s
// - threat all children of $all as $eq setters (=> set if $all.length === 1,
//   otherwise throw error)
// - you can not mix '$'-prefixed keys and non-'$'-prefixed keys
// - you can only have dotted keys on a root-level
// - you can not have '$'-prefixed keys more than one-level deep in an object
// Handles one key/value pair to put in the selector document


function populateDocumentWithKeyValue(document, key, value) {
  if (value && Object.getPrototypeOf(value) === Object.prototype) {
    populateDocumentWithObject(document, key, value);
  } else if (!(value instanceof RegExp)) {
    insertIntoDocument(document, key, value);
  }
} // Handles a key, value pair to put in the selector document
// if the value is an object


function populateDocumentWithObject(document, key, value) {
  const keys = Object.keys(value);
  const unprefixedKeys = keys.filter(op => op[0] !== '$');

  if (unprefixedKeys.length > 0 || !keys.length) {
    // Literal (possibly empty) object ( or empty object )
    // Don't allow mixing '$'-prefixed with non-'$'-prefixed fields
    if (keys.length !== unprefixedKeys.length) {
      throw new Error("unknown operator: ".concat(unprefixedKeys[0]));
    }

    validateObject(value, key);
    insertIntoDocument(document, key, value);
  } else {
    Object.keys(value).forEach(op => {
      const object = value[op];

      if (op === '$eq') {
        populateDocumentWithKeyValue(document, key, object);
      } else if (op === '$all') {
        // every value for $all should be dealt with as separate $eq-s
        object.forEach(element => populateDocumentWithKeyValue(document, key, element));
      }
    });
  }
} // Fills a document with certain fields from an upsert selector


function populateDocumentWithQueryFields(query) {
  let document = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : {};

  if (Object.getPrototypeOf(query) === Object.prototype) {
    // handle implicit $and
    Object.keys(query).forEach(key => {
      const value = query[key];

      if (key === '$and') {
        // handle explicit $and
        value.forEach(element => populateDocumentWithQueryFields(element, document));
      } else if (key === '$or') {
        // handle $or nodes with exactly 1 child
        if (value.length === 1) {
          populateDocumentWithQueryFields(value[0], document);
        }
      } else if (key[0] !== '$') {
        // Ignore other '$'-prefixed logical selectors
        populateDocumentWithKeyValue(document, key, value);
      }
    });
  } else {
    // Handle meteor-specific shortcut for selecting _id
    if (LocalCollection._selectorIsId(query)) {
      insertIntoDocument(document, '_id', query);
    }
  }

  return document;
}

function projectionDetails(fields) {
  // Find the non-_id keys (_id is handled specially because it is included
  // unless explicitly excluded). Sort the keys, so that our code to detect
  // overlaps like 'foo' and 'foo.bar' can assume that 'foo' comes first.
  let fieldsKeys = Object.keys(fields).sort(); // If _id is the only field in the projection, do not remove it, since it is
  // required to determine if this is an exclusion or exclusion. Also keep an
  // inclusive _id, since inclusive _id follows the normal rules about mixing
  // inclusive and exclusive fields. If _id is not the only field in the
  // projection and is exclusive, remove it so it can be handled later by a
  // special case, since exclusive _id is always allowed.

  if (!(fieldsKeys.length === 1 && fieldsKeys[0] === '_id') && !(fieldsKeys.includes('_id') && fields._id)) {
    fieldsKeys = fieldsKeys.filter(key => key !== '_id');
  }

  let including = null; // Unknown

  fieldsKeys.forEach(keyPath => {
    const rule = !!fields[keyPath];

    if (including === null) {
      including = rule;
    } // This error message is copied from MongoDB shell


    if (including !== rule) {
      throw MinimongoError('You cannot currently mix including and excluding fields.');
    }
  });
  const projectionRulesTree = pathsToTree(fieldsKeys, path => including, (node, path, fullPath) => {
    // Check passed projection fields' keys: If you have two rules such as
    // 'foo.bar' and 'foo.bar.baz', then the result becomes ambiguous. If
    // that happens, there is a probability you are doing something wrong,
    // framework should notify you about such mistake earlier on cursor
    // compilation step than later during runtime.  Note, that real mongo
    // doesn't do anything about it and the later rule appears in projection
    // project, more priority it takes.
    //
    // Example, assume following in mongo shell:
    // > db.coll.insert({ a: { b: 23, c: 44 } })
    // > db.coll.find({}, { 'a': 1, 'a.b': 1 })
    // {"_id": ObjectId("520bfe456024608e8ef24af3"), "a": {"b": 23}}
    // > db.coll.find({}, { 'a.b': 1, 'a': 1 })
    // {"_id": ObjectId("520bfe456024608e8ef24af3"), "a": {"b": 23, "c": 44}}
    //
    // Note, how second time the return set of keys is different.
    const currentPath = fullPath;
    const anotherPath = path;
    throw MinimongoError("both ".concat(currentPath, " and ").concat(anotherPath, " found in fields option, ") + 'using both of them may trigger unexpected behavior. Did you mean to ' + 'use only one of them?');
  });
  return {
    including,
    tree: projectionRulesTree
  };
}

function regexpElementMatcher(regexp) {
  return value => {
    if (value instanceof RegExp) {
      return value.toString() === regexp.toString();
    } // Regexps only work against strings.


    if (typeof value !== 'string') {
      return false;
    } // Reset regexp's state to avoid inconsistent matching for objects with the
    // same value on consecutive calls of regexp.test. This happens only if the
    // regexp has the 'g' flag. Also note that ES6 introduces a new flag 'y' for
    // which we should *not* change the lastIndex but MongoDB doesn't support
    // either of these flags.


    regexp.lastIndex = 0;
    return regexp.test(value);
  };
}

// Validates the key in a path.
// Objects that are nested more then 1 level cannot have dotted fields
// or fields starting with '$'
function validateKeyInPath(key, path) {
  if (key.includes('.')) {
    throw new Error("The dotted field '".concat(key, "' in '").concat(path, ".").concat(key, " is not valid for storage."));
  }

  if (key[0] === '$') {
    throw new Error("The dollar ($) prefixed field  '".concat(path, ".").concat(key, " is not valid for storage."));
  }
} // Recursively validates an object that is nested more than one level deep


function validateObject(object, path) {
  if (object && Object.getPrototypeOf(object) === Object.prototype) {
    Object.keys(object).forEach(key => {
      validateKeyInPath(key, path);
      validateObject(object[key], path + '.' + key);
    });
  }
}
/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

},"cursor.js":function module(require,exports,module){

/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
//                                                                                                                     //
// packages/minimongo/cursor.js                                                                                        //
//                                                                                                                     //
/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
                                                                                                                       //
module.export({
  default: () => Cursor
});
let LocalCollection;
module.link("./local_collection.js", {
  default(v) {
    LocalCollection = v;
  }

}, 0);
let hasOwn;
module.link("./common.js", {
  hasOwn(v) {
    hasOwn = v;
  }

}, 1);

class Cursor {
  // don't call this ctor directly.  use LocalCollection.find().
  constructor(collection, selector) {
    let options = arguments.length > 2 && arguments[2] !== undefined ? arguments[2] : {};
    this.collection = collection;
    this.sorter = null;
    this.matcher = new Minimongo.Matcher(selector);

    if (LocalCollection._selectorIsIdPerhapsAsObject(selector)) {
      // stash for fast _id and { _id }
      this._selectorId = hasOwn.call(selector, '_id') ? selector._id : selector;
    } else {
      this._selectorId = undefined;

      if (this.matcher.hasGeoQuery() || options.sort) {
        this.sorter = new Minimongo.Sorter(options.sort || []);
      }
    }

    this.skip = options.skip || 0;
    this.limit = options.limit;
    this.fields = options.fields;
    this._projectionFn = LocalCollection._compileProjection(this.fields || {});
    this._transform = LocalCollection.wrapTransform(options.transform); // by default, queries register w/ Tracker when it is available.

    if (typeof Tracker !== 'undefined') {
      this.reactive = options.reactive === undefined ? true : options.reactive;
    }
  }
  /**
   * @summary Returns the number of documents that match a query.
   * @memberOf Mongo.Cursor
   * @method  count
   * @param {boolean} [applySkipLimit=true] If set to `false`, the value
   *                                         returned will reflect the total
   *                                         number of matching documents,
   *                                         ignoring any value supplied for
   *                                         limit
   * @instance
   * @locus Anywhere
   * @returns {Number}
   */


  count() {
    let applySkipLimit = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : true;

    if (this.reactive) {
      // allow the observe to be unordered
      this._depend({
        added: true,
        removed: true
      }, true);
    }

    return this._getRawObjects({
      ordered: true,
      applySkipLimit
    }).length;
  }
  /**
   * @summary Return all matching documents as an Array.
   * @memberOf Mongo.Cursor
   * @method  fetch
   * @instance
   * @locus Anywhere
   * @returns {Object[]}
   */


  fetch() {
    const result = [];
    this.forEach(doc => {
      result.push(doc);
    });
    return result;
  }

  [Symbol.iterator]() {
    if (this.reactive) {
      this._depend({
        addedBefore: true,
        removed: true,
        changed: true,
        movedBefore: true
      });
    }

    let index = 0;

    const objects = this._getRawObjects({
      ordered: true
    });

    return {
      next: () => {
        if (index < objects.length) {
          // This doubles as a clone operation.
          let element = this._projectionFn(objects[index++]);

          if (this._transform) element = this._transform(element);
          return {
            value: element
          };
        }

        return {
          done: true
        };
      }
    };
  }
  /**
   * @callback IterationCallback
   * @param {Object} doc
   * @param {Number} index
   */

  /**
   * @summary Call `callback` once for each matching document, sequentially and
   *          synchronously.
   * @locus Anywhere
   * @method  forEach
   * @instance
   * @memberOf Mongo.Cursor
   * @param {IterationCallback} callback Function to call. It will be called
   *                                     with three arguments: the document, a
   *                                     0-based index, and <em>cursor</em>
   *                                     itself.
   * @param {Any} [thisArg] An object which will be the value of `this` inside
   *                        `callback`.
   */


  forEach(callback, thisArg) {
    if (this.reactive) {
      this._depend({
        addedBefore: true,
        removed: true,
        changed: true,
        movedBefore: true
      });
    }

    this._getRawObjects({
      ordered: true
    }).forEach((element, i) => {
      // This doubles as a clone operation.
      element = this._projectionFn(element);

      if (this._transform) {
        element = this._transform(element);
      }

      callback.call(thisArg, element, i, this);
    });
  }

  getTransform() {
    return this._transform;
  }
  /**
   * @summary Map callback over all matching documents.  Returns an Array.
   * @locus Anywhere
   * @method map
   * @instance
   * @memberOf Mongo.Cursor
   * @param {IterationCallback} callback Function to call. It will be called
   *                                     with three arguments: the document, a
   *                                     0-based index, and <em>cursor</em>
   *                                     itself.
   * @param {Any} [thisArg] An object which will be the value of `this` inside
   *                        `callback`.
   */


  map(callback, thisArg) {
    const result = [];
    this.forEach((doc, i) => {
      result.push(callback.call(thisArg, doc, i, this));
    });
    return result;
  } // options to contain:
  //  * callbacks for observe():
  //    - addedAt (document, atIndex)
  //    - added (document)
  //    - changedAt (newDocument, oldDocument, atIndex)
  //    - changed (newDocument, oldDocument)
  //    - removedAt (document, atIndex)
  //    - removed (document)
  //    - movedTo (document, oldIndex, newIndex)
  //
  // attributes available on returned query handle:
  //  * stop(): end updates
  //  * collection: the collection this query is querying
  //
  // iff x is a returned query handle, (x instanceof
  // LocalCollection.ObserveHandle) is true
  //
  // initial results delivered through added callback
  // XXX maybe callbacks should take a list of objects, to expose transactions?
  // XXX maybe support field limiting (to limit what you're notified on)

  /**
   * @summary Watch a query.  Receive callbacks as the result set changes.
   * @locus Anywhere
   * @memberOf Mongo.Cursor
   * @instance
   * @param {Object} callbacks Functions to call to deliver the result set as it
   *                           changes
   */


  observe(options) {
    return LocalCollection._observeFromObserveChanges(this, options);
  }
  /**
   * @summary Watch a query. Receive callbacks as the result set changes. Only
   *          the differences between the old and new documents are passed to
   *          the callbacks.
   * @locus Anywhere
   * @memberOf Mongo.Cursor
   * @instance
   * @param {Object} callbacks Functions to call to deliver the result set as it
   *                           changes
   */


  observeChanges(options) {
    const ordered = LocalCollection._observeChangesCallbacksAreOrdered(options); // there are several places that assume you aren't combining skip/limit with
    // unordered observe.  eg, update's EJSON.clone, and the "there are several"
    // comment in _modifyAndNotify
    // XXX allow skip/limit with unordered observe


    if (!options._allow_unordered && !ordered && (this.skip || this.limit)) {
      throw new Error("Must use an ordered observe with skip or limit (i.e. 'addedBefore' " + "for observeChanges or 'addedAt' for observe, instead of 'added').");
    }

    if (this.fields && (this.fields._id === 0 || this.fields._id === false)) {
      throw Error('You may not observe a cursor with {fields: {_id: 0}}');
    }

    const distances = this.matcher.hasGeoQuery() && ordered && new LocalCollection._IdMap();
    const query = {
      cursor: this,
      dirty: false,
      distances,
      matcher: this.matcher,
      // not fast pathed
      ordered,
      projectionFn: this._projectionFn,
      resultsSnapshot: null,
      sorter: ordered && this.sorter
    };
    let qid; // Non-reactive queries call added[Before] and then never call anything
    // else.

    if (this.reactive) {
      qid = this.collection.next_qid++;
      this.collection.queries[qid] = query;
    }

    query.results = this._getRawObjects({
      ordered,
      distances: query.distances
    });

    if (this.collection.paused) {
      query.resultsSnapshot = ordered ? [] : new LocalCollection._IdMap();
    } // wrap callbacks we were passed. callbacks only fire when not paused and
    // are never undefined
    // Filters out blacklisted fields according to cursor's projection.
    // XXX wrong place for this?
    // furthermore, callbacks enqueue until the operation we're working on is
    // done.


    const wrapCallback = fn => {
      if (!fn) {
        return () => {};
      }

      const self = this;
      return function ()
      /* args*/
      {
        if (self.collection.paused) {
          return;
        }

        const args = arguments;

        self.collection._observeQueue.queueTask(() => {
          fn.apply(this, args);
        });
      };
    };

    query.added = wrapCallback(options.added);
    query.changed = wrapCallback(options.changed);
    query.removed = wrapCallback(options.removed);

    if (ordered) {
      query.addedBefore = wrapCallback(options.addedBefore);
      query.movedBefore = wrapCallback(options.movedBefore);
    }

    if (!options._suppress_initial && !this.collection.paused) {
      query.results.forEach(doc => {
        const fields = EJSON.clone(doc);
        delete fields._id;

        if (ordered) {
          query.addedBefore(doc._id, this._projectionFn(fields), null);
        }

        query.added(doc._id, this._projectionFn(fields));
      });
    }

    const handle = Object.assign(new LocalCollection.ObserveHandle(), {
      collection: this.collection,
      stop: () => {
        if (this.reactive) {
          delete this.collection.queries[qid];
        }
      }
    });

    if (this.reactive && Tracker.active) {
      // XXX in many cases, the same observe will be recreated when
      // the current autorun is rerun.  we could save work by
      // letting it linger across rerun and potentially get
      // repurposed if the same observe is performed, using logic
      // similar to that of Meteor.subscribe.
      Tracker.onInvalidate(() => {
        handle.stop();
      });
    } // run the observe callbacks resulting from the initial contents
    // before we leave the observe.


    this.collection._observeQueue.drain();

    return handle;
  } // Since we don't actually have a "nextObject" interface, there's really no
  // reason to have a "rewind" interface.  All it did was make multiple calls
  // to fetch/map/forEach return nothing the second time.
  // XXX COMPAT WITH 0.8.1


  rewind() {} // XXX Maybe we need a version of observe that just calls a callback if
  // anything changed.


  _depend(changers, _allow_unordered) {
    if (Tracker.active) {
      const dependency = new Tracker.Dependency();
      const notify = dependency.changed.bind(dependency);
      dependency.depend();
      const options = {
        _allow_unordered,
        _suppress_initial: true
      };
      ['added', 'addedBefore', 'changed', 'movedBefore', 'removed'].forEach(fn => {
        if (changers[fn]) {
          options[fn] = notify;
        }
      }); // observeChanges will stop() when this computation is invalidated

      this.observeChanges(options);
    }
  }

  _getCollectionName() {
    return this.collection.name;
  } // Returns a collection of matching objects, but doesn't deep copy them.
  //
  // If ordered is set, returns a sorted array, respecting sorter, skip, and
  // limit properties of the query provided that options.applySkipLimit is
  // not set to false (#1201). If sorter is falsey, no sort -- you get the
  // natural order.
  //
  // If ordered is not set, returns an object mapping from ID to doc (sorter,
  // skip and limit should not be set).
  //
  // If ordered is set and this cursor is a $near geoquery, then this function
  // will use an _IdMap to track each distance from the $near argument point in
  // order to use it as a sort key. If an _IdMap is passed in the 'distances'
  // argument, this function will clear it and use it for this purpose
  // (otherwise it will just create its own _IdMap). The observeChanges
  // implementation uses this to remember the distances after this function
  // returns.


  _getRawObjects() {
    let options = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : {};
    // By default this method will respect skip and limit because .fetch(),
    // .forEach() etc... expect this behaviour. It can be forced to ignore
    // skip and limit by setting applySkipLimit to false (.count() does this,
    // for example)
    const applySkipLimit = options.applySkipLimit !== false; // XXX use OrderedDict instead of array, and make IdMap and OrderedDict
    // compatible

    const results = options.ordered ? [] : new LocalCollection._IdMap(); // fast path for single ID value

    if (this._selectorId !== undefined) {
      // If you have non-zero skip and ask for a single id, you get nothing.
      // This is so it matches the behavior of the '{_id: foo}' path.
      if (applySkipLimit && this.skip) {
        return results;
      }

      const selectedDoc = this.collection._docs.get(this._selectorId);

      if (selectedDoc) {
        if (options.ordered) {
          results.push(selectedDoc);
        } else {
          results.set(this._selectorId, selectedDoc);
        }
      }

      return results;
    } // slow path for arbitrary selector, sort, skip, limit
    // in the observeChanges case, distances is actually part of the "query"
    // (ie, live results set) object.  in other cases, distances is only used
    // inside this function.


    let distances;

    if (this.matcher.hasGeoQuery() && options.ordered) {
      if (options.distances) {
        distances = options.distances;
        distances.clear();
      } else {
        distances = new LocalCollection._IdMap();
      }
    }

    this.collection._docs.forEach((doc, id) => {
      const matchResult = this.matcher.documentMatches(doc);

      if (matchResult.result) {
        if (options.ordered) {
          results.push(doc);

          if (distances && matchResult.distance !== undefined) {
            distances.set(id, matchResult.distance);
          }
        } else {
          results.set(id, doc);
        }
      } // Override to ensure all docs are matched if ignoring skip & limit


      if (!applySkipLimit) {
        return true;
      } // Fast path for limited unsorted queries.
      // XXX 'length' check here seems wrong for ordered


      return !this.limit || this.skip || this.sorter || results.length !== this.limit;
    });

    if (!options.ordered) {
      return results;
    }

    if (this.sorter) {
      results.sort(this.sorter.getComparator({
        distances
      }));
    } // Return the full set of results if there is no skip or limit or if we're
    // ignoring them


    if (!applySkipLimit || !this.limit && !this.skip) {
      return results;
    }

    return results.slice(this.skip, this.limit ? this.limit + this.skip : results.length);
  }

  _publishCursor(subscription) {
    // XXX minimongo should not depend on mongo-livedata!
    if (!Package.mongo) {
      throw new Error('Can\'t publish from Minimongo without the `mongo` package.');
    }

    if (!this.collection.name) {
      throw new Error('Can\'t publish a cursor from a collection without a name.');
    }

    return Package.mongo.Mongo.Collection._publishCursor(this, subscription, this.collection.name);
  }

}
/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

},"local_collection.js":function module(require,exports,module){

/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
//                                                                                                                     //
// packages/minimongo/local_collection.js                                                                              //
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
  default: () => LocalCollection
});
let Cursor;
module.link("./cursor.js", {
  default(v) {
    Cursor = v;
  }

}, 0);
let ObserveHandle;
module.link("./observe_handle.js", {
  default(v) {
    ObserveHandle = v;
  }

}, 1);
let hasOwn, isIndexable, isNumericKey, isOperatorObject, populateDocumentWithQueryFields, projectionDetails;
module.link("./common.js", {
  hasOwn(v) {
    hasOwn = v;
  },

  isIndexable(v) {
    isIndexable = v;
  },

  isNumericKey(v) {
    isNumericKey = v;
  },

  isOperatorObject(v) {
    isOperatorObject = v;
  },

  populateDocumentWithQueryFields(v) {
    populateDocumentWithQueryFields = v;
  },

  projectionDetails(v) {
    projectionDetails = v;
  }

}, 2);

class LocalCollection {
  constructor(name) {
    this.name = name; // _id -> document (also containing id)

    this._docs = new LocalCollection._IdMap();
    this._observeQueue = new Meteor._SynchronousQueue();
    this.next_qid = 1; // live query id generator
    // qid -> live query object. keys:
    //  ordered: bool. ordered queries have addedBefore/movedBefore callbacks.
    //  results: array (ordered) or object (unordered) of current results
    //    (aliased with this._docs!)
    //  resultsSnapshot: snapshot of results. null if not paused.
    //  cursor: Cursor object for the query.
    //  selector, sorter, (callbacks): functions

    this.queries = Object.create(null); // null if not saving originals; an IdMap from id to original document value
    // if saving originals. See comments before saveOriginals().

    this._savedOriginals = null; // True when observers are paused and we should not send callbacks.

    this.paused = false;
  } // options may include sort, skip, limit, reactive
  // sort may be any of these forms:
  //     {a: 1, b: -1}
  //     [["a", "asc"], ["b", "desc"]]
  //     ["a", ["b", "desc"]]
  //   (in the first form you're beholden to key enumeration order in
  //   your javascript VM)
  //
  // reactive: if given, and false, don't register with Tracker (default
  // is true)
  //
  // XXX possibly should support retrieving a subset of fields? and
  // have it be a hint (ignored on the client, when not copying the
  // doc?)
  //
  // XXX sort does not yet support subkeys ('a.b') .. fix that!
  // XXX add one more sort form: "key"
  // XXX tests


  find(selector, options) {
    // default syntax for everything is to omit the selector argument.
    // but if selector is explicitly passed in as false or undefined, we
    // want a selector that matches nothing.
    if (arguments.length === 0) {
      selector = {};
    }

    return new LocalCollection.Cursor(this, selector, options);
  }

  findOne(selector) {
    let options = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : {};

    if (arguments.length === 0) {
      selector = {};
    } // NOTE: by setting limit 1 here, we end up using very inefficient
    // code that recomputes the whole query on each update. The upside is
    // that when you reactively depend on a findOne you only get
    // invalidated when the found object changes, not any object in the
    // collection. Most findOne will be by id, which has a fast path, so
    // this might not be a big deal. In most cases, invalidation causes
    // the called to re-query anyway, so this should be a net performance
    // improvement.


    options.limit = 1;
    return this.find(selector, options).fetch()[0];
  } // XXX possibly enforce that 'undefined' does not appear (we assume
  // this in our handling of null and $exists)


  insert(doc, callback) {
    doc = EJSON.clone(doc);
    assertHasValidFieldNames(doc); // if you really want to use ObjectIDs, set this global.
    // Mongo.Collection specifies its own ids and does not use this code.

    if (!hasOwn.call(doc, '_id')) {
      doc._id = LocalCollection._useOID ? new MongoID.ObjectID() : Random.id();
    }

    const id = doc._id;

    if (this._docs.has(id)) {
      throw MinimongoError("Duplicate _id '".concat(id, "'"));
    }

    this._saveOriginal(id, undefined);

    this._docs.set(id, doc);

    const queriesToRecompute = []; // trigger live queries that match

    Object.keys(this.queries).forEach(qid => {
      const query = this.queries[qid];

      if (query.dirty) {
        return;
      }

      const matchResult = query.matcher.documentMatches(doc);

      if (matchResult.result) {
        if (query.distances && matchResult.distance !== undefined) {
          query.distances.set(id, matchResult.distance);
        }

        if (query.cursor.skip || query.cursor.limit) {
          queriesToRecompute.push(qid);
        } else {
          LocalCollection._insertInResults(query, doc);
        }
      }
    });
    queriesToRecompute.forEach(qid => {
      if (this.queries[qid]) {
        this._recomputeResults(this.queries[qid]);
      }
    });

    this._observeQueue.drain(); // Defer because the caller likely doesn't expect the callback to be run
    // immediately.


    if (callback) {
      Meteor.defer(() => {
        callback(null, id);
      });
    }

    return id;
  } // Pause the observers. No callbacks from observers will fire until
  // 'resumeObservers' is called.


  pauseObservers() {
    // No-op if already paused.
    if (this.paused) {
      return;
    } // Set the 'paused' flag such that new observer messages don't fire.


    this.paused = true; // Take a snapshot of the query results for each query.

    Object.keys(this.queries).forEach(qid => {
      const query = this.queries[qid];
      query.resultsSnapshot = EJSON.clone(query.results);
    });
  }

  remove(selector, callback) {
    // Easy special case: if we're not calling observeChanges callbacks and
    // we're not saving originals and we got asked to remove everything, then
    // just empty everything directly.
    if (this.paused && !this._savedOriginals && EJSON.equals(selector, {})) {
      const result = this._docs.size();

      this._docs.clear();

      Object.keys(this.queries).forEach(qid => {
        const query = this.queries[qid];

        if (query.ordered) {
          query.results = [];
        } else {
          query.results.clear();
        }
      });

      if (callback) {
        Meteor.defer(() => {
          callback(null, result);
        });
      }

      return result;
    }

    const matcher = new Minimongo.Matcher(selector);
    const remove = [];

    this._eachPossiblyMatchingDoc(selector, (doc, id) => {
      if (matcher.documentMatches(doc).result) {
        remove.push(id);
      }
    });

    const queriesToRecompute = [];
    const queryRemove = [];

    for (let i = 0; i < remove.length; i++) {
      const removeId = remove[i];

      const removeDoc = this._docs.get(removeId);

      Object.keys(this.queries).forEach(qid => {
        const query = this.queries[qid];

        if (query.dirty) {
          return;
        }

        if (query.matcher.documentMatches(removeDoc).result) {
          if (query.cursor.skip || query.cursor.limit) {
            queriesToRecompute.push(qid);
          } else {
            queryRemove.push({
              qid,
              doc: removeDoc
            });
          }
        }
      });

      this._saveOriginal(removeId, removeDoc);

      this._docs.remove(removeId);
    } // run live query callbacks _after_ we've removed the documents.


    queryRemove.forEach(remove => {
      const query = this.queries[remove.qid];

      if (query) {
        query.distances && query.distances.remove(remove.doc._id);

        LocalCollection._removeFromResults(query, remove.doc);
      }
    });
    queriesToRecompute.forEach(qid => {
      const query = this.queries[qid];

      if (query) {
        this._recomputeResults(query);
      }
    });

    this._observeQueue.drain();

    const result = remove.length;

    if (callback) {
      Meteor.defer(() => {
        callback(null, result);
      });
    }

    return result;
  } // Resume the observers. Observers immediately receive change
  // notifications to bring them to the current state of the
  // database. Note that this is not just replaying all the changes that
  // happened during the pause, it is a smarter 'coalesced' diff.


  resumeObservers() {
    // No-op if not paused.
    if (!this.paused) {
      return;
    } // Unset the 'paused' flag. Make sure to do this first, otherwise
    // observer methods won't actually fire when we trigger them.


    this.paused = false;
    Object.keys(this.queries).forEach(qid => {
      const query = this.queries[qid];

      if (query.dirty) {
        query.dirty = false; // re-compute results will perform `LocalCollection._diffQueryChanges`
        // automatically.

        this._recomputeResults(query, query.resultsSnapshot);
      } else {
        // Diff the current results against the snapshot and send to observers.
        // pass the query object for its observer callbacks.
        LocalCollection._diffQueryChanges(query.ordered, query.resultsSnapshot, query.results, query, {
          projectionFn: query.projectionFn
        });
      }

      query.resultsSnapshot = null;
    });

    this._observeQueue.drain();
  }

  retrieveOriginals() {
    if (!this._savedOriginals) {
      throw new Error('Called retrieveOriginals without saveOriginals');
    }

    const originals = this._savedOriginals;
    this._savedOriginals = null;
    return originals;
  } // To track what documents are affected by a piece of code, call
  // saveOriginals() before it and retrieveOriginals() after it.
  // retrieveOriginals returns an object whose keys are the ids of the documents
  // that were affected since the call to saveOriginals(), and the values are
  // equal to the document's contents at the time of saveOriginals. (In the case
  // of an inserted document, undefined is the value.) You must alternate
  // between calls to saveOriginals() and retrieveOriginals().


  saveOriginals() {
    if (this._savedOriginals) {
      throw new Error('Called saveOriginals twice without retrieveOriginals');
    }

    this._savedOriginals = new LocalCollection._IdMap();
  } // XXX atomicity: if multi is true, and one modification fails, do
  // we rollback the whole operation, or what?


  update(selector, mod, options, callback) {
    if (!callback && options instanceof Function) {
      callback = options;
      options = null;
    }

    if (!options) {
      options = {};
    }

    const matcher = new Minimongo.Matcher(selector, true); // Save the original results of any query that we might need to
    // _recomputeResults on, because _modifyAndNotify will mutate the objects in
    // it. (We don't need to save the original results of paused queries because
    // they already have a resultsSnapshot and we won't be diffing in
    // _recomputeResults.)

    const qidToOriginalResults = {}; // We should only clone each document once, even if it appears in multiple
    // queries

    const docMap = new LocalCollection._IdMap();

    const idsMatched = LocalCollection._idsMatchedBySelector(selector);

    Object.keys(this.queries).forEach(qid => {
      const query = this.queries[qid];

      if ((query.cursor.skip || query.cursor.limit) && !this.paused) {
        // Catch the case of a reactive `count()` on a cursor with skip
        // or limit, which registers an unordered observe. This is a
        // pretty rare case, so we just clone the entire result set with
        // no optimizations for documents that appear in these result
        // sets and other queries.
        if (query.results instanceof LocalCollection._IdMap) {
          qidToOriginalResults[qid] = query.results.clone();
          return;
        }

        if (!(query.results instanceof Array)) {
          throw new Error('Assertion failed: query.results not an array');
        } // Clones a document to be stored in `qidToOriginalResults`
        // because it may be modified before the new and old result sets
        // are diffed. But if we know exactly which document IDs we're
        // going to modify, then we only need to clone those.


        const memoizedCloneIfNeeded = doc => {
          if (docMap.has(doc._id)) {
            return docMap.get(doc._id);
          }

          const docToMemoize = idsMatched && !idsMatched.some(id => EJSON.equals(id, doc._id)) ? doc : EJSON.clone(doc);
          docMap.set(doc._id, docToMemoize);
          return docToMemoize;
        };

        qidToOriginalResults[qid] = query.results.map(memoizedCloneIfNeeded);
      }
    });
    const recomputeQids = {};
    let updateCount = 0;

    this._eachPossiblyMatchingDoc(selector, (doc, id) => {
      const queryResult = matcher.documentMatches(doc);

      if (queryResult.result) {
        // XXX Should we save the original even if mod ends up being a no-op?
        this._saveOriginal(id, doc);

        this._modifyAndNotify(doc, mod, recomputeQids, queryResult.arrayIndices);

        ++updateCount;

        if (!options.multi) {
          return false; // break
        }
      }

      return true;
    });

    Object.keys(recomputeQids).forEach(qid => {
      const query = this.queries[qid];

      if (query) {
        this._recomputeResults(query, qidToOriginalResults[qid]);
      }
    });

    this._observeQueue.drain(); // If we are doing an upsert, and we didn't modify any documents yet, then
    // it's time to do an insert. Figure out what document we are inserting, and
    // generate an id for it.


    let insertedId;

    if (updateCount === 0 && options.upsert) {
      const doc = LocalCollection._createUpsertDocument(selector, mod);

      if (!doc._id && options.insertedId) {
        doc._id = options.insertedId;
      }

      insertedId = this.insert(doc);
      updateCount = 1;
    } // Return the number of affected documents, or in the upsert case, an object
    // containing the number of affected docs and the id of the doc that was
    // inserted, if any.


    let result;

    if (options._returnObject) {
      result = {
        numberAffected: updateCount
      };

      if (insertedId !== undefined) {
        result.insertedId = insertedId;
      }
    } else {
      result = updateCount;
    }

    if (callback) {
      Meteor.defer(() => {
        callback(null, result);
      });
    }

    return result;
  } // A convenience wrapper on update. LocalCollection.upsert(sel, mod) is
  // equivalent to LocalCollection.update(sel, mod, {upsert: true,
  // _returnObject: true}).


  upsert(selector, mod, options, callback) {
    if (!callback && typeof options === 'function') {
      callback = options;
      options = {};
    }

    return this.update(selector, mod, Object.assign({}, options, {
      upsert: true,
      _returnObject: true
    }), callback);
  } // Iterates over a subset of documents that could match selector; calls
  // fn(doc, id) on each of them.  Specifically, if selector specifies
  // specific _id's, it only looks at those.  doc is *not* cloned: it is the
  // same object that is in _docs.


  _eachPossiblyMatchingDoc(selector, fn) {
    const specificIds = LocalCollection._idsMatchedBySelector(selector);

    if (specificIds) {
      specificIds.some(id => {
        const doc = this._docs.get(id);

        if (doc) {
          return fn(doc, id) === false;
        }
      });
    } else {
      this._docs.forEach(fn);
    }
  }

  _modifyAndNotify(doc, mod, recomputeQids, arrayIndices) {
    const matched_before = {};
    Object.keys(this.queries).forEach(qid => {
      const query = this.queries[qid];

      if (query.dirty) {
        return;
      }

      if (query.ordered) {
        matched_before[qid] = query.matcher.documentMatches(doc).result;
      } else {
        // Because we don't support skip or limit (yet) in unordered queries, we
        // can just do a direct lookup.
        matched_before[qid] = query.results.has(doc._id);
      }
    });
    const old_doc = EJSON.clone(doc);

    LocalCollection._modify(doc, mod, {
      arrayIndices
    });

    Object.keys(this.queries).forEach(qid => {
      const query = this.queries[qid];

      if (query.dirty) {
        return;
      }

      const afterMatch = query.matcher.documentMatches(doc);
      const after = afterMatch.result;
      const before = matched_before[qid];

      if (after && query.distances && afterMatch.distance !== undefined) {
        query.distances.set(doc._id, afterMatch.distance);
      }

      if (query.cursor.skip || query.cursor.limit) {
        // We need to recompute any query where the doc may have been in the
        // cursor's window either before or after the update. (Note that if skip
        // or limit is set, "before" and "after" being true do not necessarily
        // mean that the document is in the cursor's output after skip/limit is
        // applied... but if they are false, then the document definitely is NOT
        // in the output. So it's safe to skip recompute if neither before or
        // after are true.)
        if (before || after) {
          recomputeQids[qid] = true;
        }
      } else if (before && !after) {
        LocalCollection._removeFromResults(query, doc);
      } else if (!before && after) {
        LocalCollection._insertInResults(query, doc);
      } else if (before && after) {
        LocalCollection._updateInResults(query, doc, old_doc);
      }
    });
  } // Recomputes the results of a query and runs observe callbacks for the
  // difference between the previous results and the current results (unless
  // paused). Used for skip/limit queries.
  //
  // When this is used by insert or remove, it can just use query.results for
  // the old results (and there's no need to pass in oldResults), because these
  // operations don't mutate the documents in the collection. Update needs to
  // pass in an oldResults which was deep-copied before the modifier was
  // applied.
  //
  // oldResults is guaranteed to be ignored if the query is not paused.


  _recomputeResults(query, oldResults) {
    if (this.paused) {
      // There's no reason to recompute the results now as we're still paused.
      // By flagging the query as "dirty", the recompute will be performed
      // when resumeObservers is called.
      query.dirty = true;
      return;
    }

    if (!this.paused && !oldResults) {
      oldResults = query.results;
    }

    if (query.distances) {
      query.distances.clear();
    }

    query.results = query.cursor._getRawObjects({
      distances: query.distances,
      ordered: query.ordered
    });

    if (!this.paused) {
      LocalCollection._diffQueryChanges(query.ordered, oldResults, query.results, query, {
        projectionFn: query.projectionFn
      });
    }
  }

  _saveOriginal(id, doc) {
    // Are we even trying to save originals?
    if (!this._savedOriginals) {
      return;
    } // Have we previously mutated the original (and so 'doc' is not actually
    // original)?  (Note the 'has' check rather than truth: we store undefined
    // here for inserted docs!)


    if (this._savedOriginals.has(id)) {
      return;
    }

    this._savedOriginals.set(id, EJSON.clone(doc));
  }

}

LocalCollection.Cursor = Cursor;
LocalCollection.ObserveHandle = ObserveHandle; // XXX maybe move these into another ObserveHelpers package or something
// _CachingChangeObserver is an object which receives observeChanges callbacks
// and keeps a cache of the current cursor state up to date in this.docs. Users
// of this class should read the docs field but not modify it. You should pass
// the "applyChange" field as the callbacks to the underlying observeChanges
// call. Optionally, you can specify your own observeChanges callbacks which are
// invoked immediately before the docs field is updated; this object is made
// available as `this` to those callbacks.

LocalCollection._CachingChangeObserver = class _CachingChangeObserver {
  constructor() {
    let options = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : {};

    const orderedFromCallbacks = options.callbacks && LocalCollection._observeChangesCallbacksAreOrdered(options.callbacks);

    if (hasOwn.call(options, 'ordered')) {
      this.ordered = options.ordered;

      if (options.callbacks && options.ordered !== orderedFromCallbacks) {
        throw Error('ordered option doesn\'t match callbacks');
      }
    } else if (options.callbacks) {
      this.ordered = orderedFromCallbacks;
    } else {
      throw Error('must provide ordered or callbacks');
    }

    const callbacks = options.callbacks || {};

    if (this.ordered) {
      this.docs = new OrderedDict(MongoID.idStringify);
      this.applyChange = {
        addedBefore: (id, fields, before) => {
          // Take a shallow copy since the top-level properties can be changed
          const doc = _objectSpread({}, fields);

          doc._id = id;

          if (callbacks.addedBefore) {
            callbacks.addedBefore.call(this, id, EJSON.clone(fields), before);
          } // This line triggers if we provide added with movedBefore.


          if (callbacks.added) {
            callbacks.added.call(this, id, EJSON.clone(fields));
          } // XXX could `before` be a falsy ID?  Technically
          // idStringify seems to allow for them -- though
          // OrderedDict won't call stringify on a falsy arg.


          this.docs.putBefore(id, doc, before || null);
        },
        movedBefore: (id, before) => {
          const doc = this.docs.get(id);

          if (callbacks.movedBefore) {
            callbacks.movedBefore.call(this, id, before);
          }

          this.docs.moveBefore(id, before || null);
        }
      };
    } else {
      this.docs = new LocalCollection._IdMap();
      this.applyChange = {
        added: (id, fields) => {
          // Take a shallow copy since the top-level properties can be changed
          const doc = _objectSpread({}, fields);

          if (callbacks.added) {
            callbacks.added.call(this, id, EJSON.clone(fields));
          }

          doc._id = id;
          this.docs.set(id, doc);
        }
      };
    } // The methods in _IdMap and OrderedDict used by these callbacks are
    // identical.


    this.applyChange.changed = (id, fields) => {
      const doc = this.docs.get(id);

      if (!doc) {
        throw new Error("Unknown id for changed: ".concat(id));
      }

      if (callbacks.changed) {
        callbacks.changed.call(this, id, EJSON.clone(fields));
      }

      DiffSequence.applyChanges(doc, fields);
    };

    this.applyChange.removed = id => {
      if (callbacks.removed) {
        callbacks.removed.call(this, id);
      }

      this.docs.remove(id);
    };
  }

};
LocalCollection._IdMap = class _IdMap extends IdMap {
  constructor() {
    super(MongoID.idStringify, MongoID.idParse);
  }

}; // Wrap a transform function to return objects that have the _id field
// of the untransformed document. This ensures that subsystems such as
// the observe-sequence package that call `observe` can keep track of
// the documents identities.
//
// - Require that it returns objects
// - If the return value has an _id field, verify that it matches the
//   original _id field
// - If the return value doesn't have an _id field, add it back.

LocalCollection.wrapTransform = transform => {
  if (!transform) {
    return null;
  } // No need to doubly-wrap transforms.


  if (transform.__wrappedTransform__) {
    return transform;
  }

  const wrapped = doc => {
    if (!hasOwn.call(doc, '_id')) {
      // XXX do we ever have a transform on the oplog's collection? because that
      // collection has no _id.
      throw new Error('can only transform documents with _id');
    }

    const id = doc._id; // XXX consider making tracker a weak dependency and checking
    // Package.tracker here

    const transformed = Tracker.nonreactive(() => transform(doc));

    if (!LocalCollection._isPlainObject(transformed)) {
      throw new Error('transform must return object');
    }

    if (hasOwn.call(transformed, '_id')) {
      if (!EJSON.equals(transformed._id, id)) {
        throw new Error('transformed document can\'t have different _id');
      }
    } else {
      transformed._id = id;
    }

    return transformed;
  };

  wrapped.__wrappedTransform__ = true;
  return wrapped;
}; // XXX the sorted-query logic below is laughably inefficient. we'll
// need to come up with a better datastructure for this.
//
// XXX the logic for observing with a skip or a limit is even more
// laughably inefficient. we recompute the whole results every time!
// This binary search puts a value between any equal values, and the first
// lesser value.


LocalCollection._binarySearch = (cmp, array, value) => {
  let first = 0;
  let range = array.length;

  while (range > 0) {
    const halfRange = Math.floor(range / 2);

    if (cmp(value, array[first + halfRange]) >= 0) {
      first += halfRange + 1;
      range -= halfRange + 1;
    } else {
      range = halfRange;
    }
  }

  return first;
};

LocalCollection._checkSupportedProjection = fields => {
  if (fields !== Object(fields) || Array.isArray(fields)) {
    throw MinimongoError('fields option must be an object');
  }

  Object.keys(fields).forEach(keyPath => {
    if (keyPath.split('.').includes('$')) {
      throw MinimongoError('Minimongo doesn\'t support $ operator in projections yet.');
    }

    const value = fields[keyPath];

    if (typeof value === 'object' && ['$elemMatch', '$meta', '$slice'].some(key => hasOwn.call(value, key))) {
      throw MinimongoError('Minimongo doesn\'t support operators in projections yet.');
    }

    if (![1, 0, true, false].includes(value)) {
      throw MinimongoError('Projection values should be one of 1, 0, true, or false');
    }
  });
}; // Knows how to compile a fields projection to a predicate function.
// @returns - Function: a closure that filters out an object according to the
//            fields projection rules:
//            @param obj - Object: MongoDB-styled document
//            @returns - Object: a document with the fields filtered out
//                       according to projection rules. Doesn't retain subfields
//                       of passed argument.


LocalCollection._compileProjection = fields => {
  LocalCollection._checkSupportedProjection(fields);

  const _idProjection = fields._id === undefined ? true : fields._id;

  const details = projectionDetails(fields); // returns transformed doc according to ruleTree

  const transform = (doc, ruleTree) => {
    // Special case for "sets"
    if (Array.isArray(doc)) {
      return doc.map(subdoc => transform(subdoc, ruleTree));
    }

    const result = details.including ? {} : EJSON.clone(doc);
    Object.keys(ruleTree).forEach(key => {
      if (!hasOwn.call(doc, key)) {
        return;
      }

      const rule = ruleTree[key];

      if (rule === Object(rule)) {
        // For sub-objects/subsets we branch
        if (doc[key] === Object(doc[key])) {
          result[key] = transform(doc[key], rule);
        }
      } else if (details.including) {
        // Otherwise we don't even touch this subfield
        result[key] = EJSON.clone(doc[key]);
      } else {
        delete result[key];
      }
    });
    return result;
  };

  return doc => {
    const result = transform(doc, details.tree);

    if (_idProjection && hasOwn.call(doc, '_id')) {
      result._id = doc._id;
    }

    if (!_idProjection && hasOwn.call(result, '_id')) {
      delete result._id;
    }

    return result;
  };
}; // Calculates the document to insert in case we're doing an upsert and the
// selector does not match any elements


LocalCollection._createUpsertDocument = (selector, modifier) => {
  const selectorDocument = populateDocumentWithQueryFields(selector);

  const isModify = LocalCollection._isModificationMod(modifier);

  const newDoc = {};

  if (selectorDocument._id) {
    newDoc._id = selectorDocument._id;
    delete selectorDocument._id;
  } // This double _modify call is made to help with nested properties (see issue
  // #8631). We do this even if it's a replacement for validation purposes (e.g.
  // ambiguous id's)


  LocalCollection._modify(newDoc, {
    $set: selectorDocument
  });

  LocalCollection._modify(newDoc, modifier, {
    isInsert: true
  });

  if (isModify) {
    return newDoc;
  } // Replacement can take _id from query document


  const replacement = Object.assign({}, modifier);

  if (newDoc._id) {
    replacement._id = newDoc._id;
  }

  return replacement;
};

LocalCollection._diffObjects = (left, right, callbacks) => {
  return DiffSequence.diffObjects(left, right, callbacks);
}; // ordered: bool.
// old_results and new_results: collections of documents.
//    if ordered, they are arrays.
//    if unordered, they are IdMaps


LocalCollection._diffQueryChanges = (ordered, oldResults, newResults, observer, options) => DiffSequence.diffQueryChanges(ordered, oldResults, newResults, observer, options);

LocalCollection._diffQueryOrderedChanges = (oldResults, newResults, observer, options) => DiffSequence.diffQueryOrderedChanges(oldResults, newResults, observer, options);

LocalCollection._diffQueryUnorderedChanges = (oldResults, newResults, observer, options) => DiffSequence.diffQueryUnorderedChanges(oldResults, newResults, observer, options);

LocalCollection._findInOrderedResults = (query, doc) => {
  if (!query.ordered) {
    throw new Error('Can\'t call _findInOrderedResults on unordered query');
  }

  for (let i = 0; i < query.results.length; i++) {
    if (query.results[i] === doc) {
      return i;
    }
  }

  throw Error('object missing from query');
}; // If this is a selector which explicitly constrains the match by ID to a finite
// number of documents, returns a list of their IDs.  Otherwise returns
// null. Note that the selector may have other restrictions so it may not even
// match those document!  We care about $in and $and since those are generated
// access-controlled update and remove.


LocalCollection._idsMatchedBySelector = selector => {
  // Is the selector just an ID?
  if (LocalCollection._selectorIsId(selector)) {
    return [selector];
  }

  if (!selector) {
    return null;
  } // Do we have an _id clause?


  if (hasOwn.call(selector, '_id')) {
    // Is the _id clause just an ID?
    if (LocalCollection._selectorIsId(selector._id)) {
      return [selector._id];
    } // Is the _id clause {_id: {$in: ["x", "y", "z"]}}?


    if (selector._id && Array.isArray(selector._id.$in) && selector._id.$in.length && selector._id.$in.every(LocalCollection._selectorIsId)) {
      return selector._id.$in;
    }

    return null;
  } // If this is a top-level $and, and any of the clauses constrain their
  // documents, then the whole selector is constrained by any one clause's
  // constraint. (Well, by their intersection, but that seems unlikely.)


  if (Array.isArray(selector.$and)) {
    for (let i = 0; i < selector.$and.length; ++i) {
      const subIds = LocalCollection._idsMatchedBySelector(selector.$and[i]);

      if (subIds) {
        return subIds;
      }
    }
  }

  return null;
};

LocalCollection._insertInResults = (query, doc) => {
  const fields = EJSON.clone(doc);
  delete fields._id;

  if (query.ordered) {
    if (!query.sorter) {
      query.addedBefore(doc._id, query.projectionFn(fields), null);
      query.results.push(doc);
    } else {
      const i = LocalCollection._insertInSortedList(query.sorter.getComparator({
        distances: query.distances
      }), query.results, doc);

      let next = query.results[i + 1];

      if (next) {
        next = next._id;
      } else {
        next = null;
      }

      query.addedBefore(doc._id, query.projectionFn(fields), next);
    }

    query.added(doc._id, query.projectionFn(fields));
  } else {
    query.added(doc._id, query.projectionFn(fields));
    query.results.set(doc._id, doc);
  }
};

LocalCollection._insertInSortedList = (cmp, array, value) => {
  if (array.length === 0) {
    array.push(value);
    return 0;
  }

  const i = LocalCollection._binarySearch(cmp, array, value);

  array.splice(i, 0, value);
  return i;
};

LocalCollection._isModificationMod = mod => {
  let isModify = false;
  let isReplace = false;
  Object.keys(mod).forEach(key => {
    if (key.substr(0, 1) === '$') {
      isModify = true;
    } else {
      isReplace = true;
    }
  });

  if (isModify && isReplace) {
    throw new Error('Update parameter cannot have both modifier and non-modifier fields.');
  }

  return isModify;
}; // XXX maybe this should be EJSON.isObject, though EJSON doesn't know about
// RegExp
// XXX note that _type(undefined) === 3!!!!


LocalCollection._isPlainObject = x => {
  return x && LocalCollection._f._type(x) === 3;
}; // XXX need a strategy for passing the binding of $ into this
// function, from the compiled selector
//
// maybe just {key.up.to.just.before.dollarsign: array_index}
//
// XXX atomicity: if one modification fails, do we roll back the whole
// change?
//
// options:
//   - isInsert is set when _modify is being called to compute the document to
//     insert as part of an upsert operation. We use this primarily to figure
//     out when to set the fields in $setOnInsert, if present.


LocalCollection._modify = function (doc, modifier) {
  let options = arguments.length > 2 && arguments[2] !== undefined ? arguments[2] : {};

  if (!LocalCollection._isPlainObject(modifier)) {
    throw MinimongoError('Modifier must be an object');
  } // Make sure the caller can't mutate our data structures.


  modifier = EJSON.clone(modifier);
  const isModifier = isOperatorObject(modifier);
  const newDoc = isModifier ? EJSON.clone(doc) : modifier;

  if (isModifier) {
    // apply modifiers to the doc.
    Object.keys(modifier).forEach(operator => {
      // Treat $setOnInsert as $set if this is an insert.
      const setOnInsert = options.isInsert && operator === '$setOnInsert';
      const modFunc = MODIFIERS[setOnInsert ? '$set' : operator];
      const operand = modifier[operator];

      if (!modFunc) {
        throw MinimongoError("Invalid modifier specified ".concat(operator));
      }

      Object.keys(operand).forEach(keypath => {
        const arg = operand[keypath];

        if (keypath === '') {
          throw MinimongoError('An empty update path is not valid.');
        }

        const keyparts = keypath.split('.');

        if (!keyparts.every(Boolean)) {
          throw MinimongoError("The update path '".concat(keypath, "' contains an empty field name, ") + 'which is not allowed.');
        }

        const target = findModTarget(newDoc, keyparts, {
          arrayIndices: options.arrayIndices,
          forbidArray: operator === '$rename',
          noCreate: NO_CREATE_MODIFIERS[operator]
        });
        modFunc(target, keyparts.pop(), arg, keypath, newDoc);
      });
    });

    if (doc._id && !EJSON.equals(doc._id, newDoc._id)) {
      throw MinimongoError("After applying the update to the document {_id: \"".concat(doc._id, "\", ...},") + ' the (immutable) field \'_id\' was found to have been altered to ' + "_id: \"".concat(newDoc._id, "\""));
    }
  } else {
    if (doc._id && modifier._id && !EJSON.equals(doc._id, modifier._id)) {
      throw MinimongoError("The _id field cannot be changed from {_id: \"".concat(doc._id, "\"} to ") + "{_id: \"".concat(modifier._id, "\"}"));
    } // replace the whole document


    assertHasValidFieldNames(modifier);
  } // move new document into place.


  Object.keys(doc).forEach(key => {
    // Note: this used to be for (var key in doc) however, this does not
    // work right in Opera. Deleting from a doc while iterating over it
    // would sometimes cause opera to skip some keys.
    if (key !== '_id') {
      delete doc[key];
    }
  });
  Object.keys(newDoc).forEach(key => {
    doc[key] = newDoc[key];
  });
};

LocalCollection._observeFromObserveChanges = (cursor, observeCallbacks) => {
  const transform = cursor.getTransform() || (doc => doc);

  let suppressed = !!observeCallbacks._suppress_initial;
  let observeChangesCallbacks;

  if (LocalCollection._observeCallbacksAreOrdered(observeCallbacks)) {
    // The "_no_indices" option sets all index arguments to -1 and skips the
    // linear scans required to generate them.  This lets observers that don't
    // need absolute indices benefit from the other features of this API --
    // relative order, transforms, and applyChanges -- without the speed hit.
    const indices = !observeCallbacks._no_indices;
    observeChangesCallbacks = {
      addedBefore(id, fields, before) {
        if (suppressed || !(observeCallbacks.addedAt || observeCallbacks.added)) {
          return;
        }

        const doc = transform(Object.assign(fields, {
          _id: id
        }));

        if (observeCallbacks.addedAt) {
          observeCallbacks.addedAt(doc, indices ? before ? this.docs.indexOf(before) : this.docs.size() : -1, before);
        } else {
          observeCallbacks.added(doc);
        }
      },

      changed(id, fields) {
        if (!(observeCallbacks.changedAt || observeCallbacks.changed)) {
          return;
        }

        let doc = EJSON.clone(this.docs.get(id));

        if (!doc) {
          throw new Error("Unknown id for changed: ".concat(id));
        }

        const oldDoc = transform(EJSON.clone(doc));
        DiffSequence.applyChanges(doc, fields);

        if (observeCallbacks.changedAt) {
          observeCallbacks.changedAt(transform(doc), oldDoc, indices ? this.docs.indexOf(id) : -1);
        } else {
          observeCallbacks.changed(transform(doc), oldDoc);
        }
      },

      movedBefore(id, before) {
        if (!observeCallbacks.movedTo) {
          return;
        }

        const from = indices ? this.docs.indexOf(id) : -1;
        let to = indices ? before ? this.docs.indexOf(before) : this.docs.size() : -1; // When not moving backwards, adjust for the fact that removing the
        // document slides everything back one slot.

        if (to > from) {
          --to;
        }

        observeCallbacks.movedTo(transform(EJSON.clone(this.docs.get(id))), from, to, before || null);
      },

      removed(id) {
        if (!(observeCallbacks.removedAt || observeCallbacks.removed)) {
          return;
        } // technically maybe there should be an EJSON.clone here, but it's about
        // to be removed from this.docs!


        const doc = transform(this.docs.get(id));

        if (observeCallbacks.removedAt) {
          observeCallbacks.removedAt(doc, indices ? this.docs.indexOf(id) : -1);
        } else {
          observeCallbacks.removed(doc);
        }
      }

    };
  } else {
    observeChangesCallbacks = {
      added(id, fields) {
        if (!suppressed && observeCallbacks.added) {
          observeCallbacks.added(transform(Object.assign(fields, {
            _id: id
          })));
        }
      },

      changed(id, fields) {
        if (observeCallbacks.changed) {
          const oldDoc = this.docs.get(id);
          const doc = EJSON.clone(oldDoc);
          DiffSequence.applyChanges(doc, fields);
          observeCallbacks.changed(transform(doc), transform(EJSON.clone(oldDoc)));
        }
      },

      removed(id) {
        if (observeCallbacks.removed) {
          observeCallbacks.removed(transform(this.docs.get(id)));
        }
      }

    };
  }

  const changeObserver = new LocalCollection._CachingChangeObserver({
    callbacks: observeChangesCallbacks
  }); // CachingChangeObserver clones all received input on its callbacks
  // So we can mark it as safe to reduce the ejson clones.
  // This is tested by the `mongo-livedata - (extended) scribbling` tests

  changeObserver.applyChange._fromObserve = true;
  const handle = cursor.observeChanges(changeObserver.applyChange, {
    nonMutatingCallbacks: true
  });
  suppressed = false;
  return handle;
};

LocalCollection._observeCallbacksAreOrdered = callbacks => {
  if (callbacks.added && callbacks.addedAt) {
    throw new Error('Please specify only one of added() and addedAt()');
  }

  if (callbacks.changed && callbacks.changedAt) {
    throw new Error('Please specify only one of changed() and changedAt()');
  }

  if (callbacks.removed && callbacks.removedAt) {
    throw new Error('Please specify only one of removed() and removedAt()');
  }

  return !!(callbacks.addedAt || callbacks.changedAt || callbacks.movedTo || callbacks.removedAt);
};

LocalCollection._observeChangesCallbacksAreOrdered = callbacks => {
  if (callbacks.added && callbacks.addedBefore) {
    throw new Error('Please specify only one of added() and addedBefore()');
  }

  return !!(callbacks.addedBefore || callbacks.movedBefore);
};

LocalCollection._removeFromResults = (query, doc) => {
  if (query.ordered) {
    const i = LocalCollection._findInOrderedResults(query, doc);

    query.removed(doc._id);
    query.results.splice(i, 1);
  } else {
    const id = doc._id; // in case callback mutates doc

    query.removed(doc._id);
    query.results.remove(id);
  }
}; // Is this selector just shorthand for lookup by _id?


LocalCollection._selectorIsId = selector => typeof selector === 'number' || typeof selector === 'string' || selector instanceof MongoID.ObjectID; // Is the selector just lookup by _id (shorthand or not)?


LocalCollection._selectorIsIdPerhapsAsObject = selector => LocalCollection._selectorIsId(selector) || LocalCollection._selectorIsId(selector && selector._id) && Object.keys(selector).length === 1;

LocalCollection._updateInResults = (query, doc, old_doc) => {
  if (!EJSON.equals(doc._id, old_doc._id)) {
    throw new Error('Can\'t change a doc\'s _id while updating');
  }

  const projectionFn = query.projectionFn;
  const changedFields = DiffSequence.makeChangedFields(projectionFn(doc), projectionFn(old_doc));

  if (!query.ordered) {
    if (Object.keys(changedFields).length) {
      query.changed(doc._id, changedFields);
      query.results.set(doc._id, doc);
    }

    return;
  }

  const old_idx = LocalCollection._findInOrderedResults(query, doc);

  if (Object.keys(changedFields).length) {
    query.changed(doc._id, changedFields);
  }

  if (!query.sorter) {
    return;
  } // just take it out and put it back in again, and see if the index changes


  query.results.splice(old_idx, 1);

  const new_idx = LocalCollection._insertInSortedList(query.sorter.getComparator({
    distances: query.distances
  }), query.results, doc);

  if (old_idx !== new_idx) {
    let next = query.results[new_idx + 1];

    if (next) {
      next = next._id;
    } else {
      next = null;
    }

    query.movedBefore && query.movedBefore(doc._id, next);
  }
};

const MODIFIERS = {
  $currentDate(target, field, arg) {
    if (typeof arg === 'object' && hasOwn.call(arg, '$type')) {
      if (arg.$type !== 'date') {
        throw MinimongoError('Minimongo does currently only support the date type in ' + '$currentDate modifiers', {
          field
        });
      }
    } else if (arg !== true) {
      throw MinimongoError('Invalid $currentDate modifier', {
        field
      });
    }

    target[field] = new Date();
  },

  $min(target, field, arg) {
    if (typeof arg !== 'number') {
      throw MinimongoError('Modifier $min allowed for numbers only', {
        field
      });
    }

    if (field in target) {
      if (typeof target[field] !== 'number') {
        throw MinimongoError('Cannot apply $min modifier to non-number', {
          field
        });
      }

      if (target[field] > arg) {
        target[field] = arg;
      }
    } else {
      target[field] = arg;
    }
  },

  $max(target, field, arg) {
    if (typeof arg !== 'number') {
      throw MinimongoError('Modifier $max allowed for numbers only', {
        field
      });
    }

    if (field in target) {
      if (typeof target[field] !== 'number') {
        throw MinimongoError('Cannot apply $max modifier to non-number', {
          field
        });
      }

      if (target[field] < arg) {
        target[field] = arg;
      }
    } else {
      target[field] = arg;
    }
  },

  $inc(target, field, arg) {
    if (typeof arg !== 'number') {
      throw MinimongoError('Modifier $inc allowed for numbers only', {
        field
      });
    }

    if (field in target) {
      if (typeof target[field] !== 'number') {
        throw MinimongoError('Cannot apply $inc modifier to non-number', {
          field
        });
      }

      target[field] += arg;
    } else {
      target[field] = arg;
    }
  },

  $set(target, field, arg) {
    if (target !== Object(target)) {
      // not an array or an object
      const error = MinimongoError('Cannot set property on non-object field', {
        field
      });
      error.setPropertyError = true;
      throw error;
    }

    if (target === null) {
      const error = MinimongoError('Cannot set property on null', {
        field
      });
      error.setPropertyError = true;
      throw error;
    }

    assertHasValidFieldNames(arg);
    target[field] = arg;
  },

  $setOnInsert(target, field, arg) {// converted to `$set` in `_modify`
  },

  $unset(target, field, arg) {
    if (target !== undefined) {
      if (target instanceof Array) {
        if (field in target) {
          target[field] = null;
        }
      } else {
        delete target[field];
      }
    }
  },

  $push(target, field, arg) {
    if (target[field] === undefined) {
      target[field] = [];
    }

    if (!(target[field] instanceof Array)) {
      throw MinimongoError('Cannot apply $push modifier to non-array', {
        field
      });
    }

    if (!(arg && arg.$each)) {
      // Simple mode: not $each
      assertHasValidFieldNames(arg);
      target[field].push(arg);
      return;
    } // Fancy mode: $each (and maybe $slice and $sort and $position)


    const toPush = arg.$each;

    if (!(toPush instanceof Array)) {
      throw MinimongoError('$each must be an array', {
        field
      });
    }

    assertHasValidFieldNames(toPush); // Parse $position

    let position = undefined;

    if ('$position' in arg) {
      if (typeof arg.$position !== 'number') {
        throw MinimongoError('$position must be a numeric value', {
          field
        });
      } // XXX should check to make sure integer


      if (arg.$position < 0) {
        throw MinimongoError('$position in $push must be zero or positive', {
          field
        });
      }

      position = arg.$position;
    } // Parse $slice.


    let slice = undefined;

    if ('$slice' in arg) {
      if (typeof arg.$slice !== 'number') {
        throw MinimongoError('$slice must be a numeric value', {
          field
        });
      } // XXX should check to make sure integer


      slice = arg.$slice;
    } // Parse $sort.


    let sortFunction = undefined;

    if (arg.$sort) {
      if (slice === undefined) {
        throw MinimongoError('$sort requires $slice to be present', {
          field
        });
      } // XXX this allows us to use a $sort whose value is an array, but that's
      // actually an extension of the Node driver, so it won't work
      // server-side. Could be confusing!
      // XXX is it correct that we don't do geo-stuff here?


      sortFunction = new Minimongo.Sorter(arg.$sort).getComparator();
      toPush.forEach(element => {
        if (LocalCollection._f._type(element) !== 3) {
          throw MinimongoError('$push like modifiers using $sort require all elements to be ' + 'objects', {
            field
          });
        }
      });
    } // Actually push.


    if (position === undefined) {
      toPush.forEach(element => {
        target[field].push(element);
      });
    } else {
      const spliceArguments = [position, 0];
      toPush.forEach(element => {
        spliceArguments.push(element);
      });
      target[field].splice(...spliceArguments);
    } // Actually sort.


    if (sortFunction) {
      target[field].sort(sortFunction);
    } // Actually slice.


    if (slice !== undefined) {
      if (slice === 0) {
        target[field] = []; // differs from Array.slice!
      } else if (slice < 0) {
        target[field] = target[field].slice(slice);
      } else {
        target[field] = target[field].slice(0, slice);
      }
    }
  },

  $pushAll(target, field, arg) {
    if (!(typeof arg === 'object' && arg instanceof Array)) {
      throw MinimongoError('Modifier $pushAll/pullAll allowed for arrays only');
    }

    assertHasValidFieldNames(arg);
    const toPush = target[field];

    if (toPush === undefined) {
      target[field] = arg;
    } else if (!(toPush instanceof Array)) {
      throw MinimongoError('Cannot apply $pushAll modifier to non-array', {
        field
      });
    } else {
      toPush.push(...arg);
    }
  },

  $addToSet(target, field, arg) {
    let isEach = false;

    if (typeof arg === 'object') {
      // check if first key is '$each'
      const keys = Object.keys(arg);

      if (keys[0] === '$each') {
        isEach = true;
      }
    }

    const values = isEach ? arg.$each : [arg];
    assertHasValidFieldNames(values);
    const toAdd = target[field];

    if (toAdd === undefined) {
      target[field] = values;
    } else if (!(toAdd instanceof Array)) {
      throw MinimongoError('Cannot apply $addToSet modifier to non-array', {
        field
      });
    } else {
      values.forEach(value => {
        if (toAdd.some(element => LocalCollection._f._equal(value, element))) {
          return;
        }

        toAdd.push(value);
      });
    }
  },

  $pop(target, field, arg) {
    if (target === undefined) {
      return;
    }

    const toPop = target[field];

    if (toPop === undefined) {
      return;
    }

    if (!(toPop instanceof Array)) {
      throw MinimongoError('Cannot apply $pop modifier to non-array', {
        field
      });
    }

    if (typeof arg === 'number' && arg < 0) {
      toPop.splice(0, 1);
    } else {
      toPop.pop();
    }
  },

  $pull(target, field, arg) {
    if (target === undefined) {
      return;
    }

    const toPull = target[field];

    if (toPull === undefined) {
      return;
    }

    if (!(toPull instanceof Array)) {
      throw MinimongoError('Cannot apply $pull/pullAll modifier to non-array', {
        field
      });
    }

    let out;

    if (arg != null && typeof arg === 'object' && !(arg instanceof Array)) {
      // XXX would be much nicer to compile this once, rather than
      // for each document we modify.. but usually we're not
      // modifying that many documents, so we'll let it slide for
      // now
      // XXX Minimongo.Matcher isn't up for the job, because we need
      // to permit stuff like {$pull: {a: {$gt: 4}}}.. something
      // like {$gt: 4} is not normally a complete selector.
      // same issue as $elemMatch possibly?
      const matcher = new Minimongo.Matcher(arg);
      out = toPull.filter(element => !matcher.documentMatches(element).result);
    } else {
      out = toPull.filter(element => !LocalCollection._f._equal(element, arg));
    }

    target[field] = out;
  },

  $pullAll(target, field, arg) {
    if (!(typeof arg === 'object' && arg instanceof Array)) {
      throw MinimongoError('Modifier $pushAll/pullAll allowed for arrays only', {
        field
      });
    }

    if (target === undefined) {
      return;
    }

    const toPull = target[field];

    if (toPull === undefined) {
      return;
    }

    if (!(toPull instanceof Array)) {
      throw MinimongoError('Cannot apply $pull/pullAll modifier to non-array', {
        field
      });
    }

    target[field] = toPull.filter(object => !arg.some(element => LocalCollection._f._equal(object, element)));
  },

  $rename(target, field, arg, keypath, doc) {
    // no idea why mongo has this restriction..
    if (keypath === arg) {
      throw MinimongoError('$rename source must differ from target', {
        field
      });
    }

    if (target === null) {
      throw MinimongoError('$rename source field invalid', {
        field
      });
    }

    if (typeof arg !== 'string') {
      throw MinimongoError('$rename target must be a string', {
        field
      });
    }

    if (arg.includes('\0')) {
      // Null bytes are not allowed in Mongo field names
      // https://docs.mongodb.com/manual/reference/limits/#Restrictions-on-Field-Names
      throw MinimongoError('The \'to\' field for $rename cannot contain an embedded null byte', {
        field
      });
    }

    if (target === undefined) {
      return;
    }

    const object = target[field];
    delete target[field];
    const keyparts = arg.split('.');
    const target2 = findModTarget(doc, keyparts, {
      forbidArray: true
    });

    if (target2 === null) {
      throw MinimongoError('$rename target field invalid', {
        field
      });
    }

    target2[keyparts.pop()] = object;
  },

  $bit(target, field, arg) {
    // XXX mongo only supports $bit on integers, and we only support
    // native javascript numbers (doubles) so far, so we can't support $bit
    throw MinimongoError('$bit is not supported', {
      field
    });
  },

  $v() {// As discussed in https://github.com/meteor/meteor/issues/9623,
    // the `$v` operator is not needed by Meteor, but problems can occur if
    // it's not at least callable (as of Mongo >= 3.6). It's defined here as
    // a no-op to work around these problems.
  }

};
const NO_CREATE_MODIFIERS = {
  $pop: true,
  $pull: true,
  $pullAll: true,
  $rename: true,
  $unset: true
}; // Make sure field names do not contain Mongo restricted
// characters ('.', '$', '\0').
// https://docs.mongodb.com/manual/reference/limits/#Restrictions-on-Field-Names

const invalidCharMsg = {
  $: 'start with \'$\'',
  '.': 'contain \'.\'',
  '\0': 'contain null bytes'
}; // checks if all field names in an object are valid

function assertHasValidFieldNames(doc) {
  if (doc && typeof doc === 'object') {
    JSON.stringify(doc, (key, value) => {
      assertIsValidFieldName(key);
      return value;
    });
  }
}

function assertIsValidFieldName(key) {
  let match;

  if (typeof key === 'string' && (match = key.match(/^\$|\.|\0/))) {
    throw MinimongoError("Key ".concat(key, " must not ").concat(invalidCharMsg[match[0]]));
  }
} // for a.b.c.2.d.e, keyparts should be ['a', 'b', 'c', '2', 'd', 'e'],
// and then you would operate on the 'e' property of the returned
// object.
//
// if options.noCreate is falsey, creates intermediate levels of
// structure as necessary, like mkdir -p (and raises an exception if
// that would mean giving a non-numeric property to an array.) if
// options.noCreate is true, return undefined instead.
//
// may modify the last element of keyparts to signal to the caller that it needs
// to use a different value to index into the returned object (for example,
// ['a', '01'] -> ['a', 1]).
//
// if forbidArray is true, return null if the keypath goes through an array.
//
// if options.arrayIndices is set, use its first element for the (first) '$' in
// the path.


function findModTarget(doc, keyparts) {
  let options = arguments.length > 2 && arguments[2] !== undefined ? arguments[2] : {};
  let usedArrayIndex = false;

  for (let i = 0; i < keyparts.length; i++) {
    const last = i === keyparts.length - 1;
    let keypart = keyparts[i];

    if (!isIndexable(doc)) {
      if (options.noCreate) {
        return undefined;
      }

      const error = MinimongoError("cannot use the part '".concat(keypart, "' to traverse ").concat(doc));
      error.setPropertyError = true;
      throw error;
    }

    if (doc instanceof Array) {
      if (options.forbidArray) {
        return null;
      }

      if (keypart === '$') {
        if (usedArrayIndex) {
          throw MinimongoError('Too many positional (i.e. \'$\') elements');
        }

        if (!options.arrayIndices || !options.arrayIndices.length) {
          throw MinimongoError('The positional operator did not find the match needed from the ' + 'query');
        }

        keypart = options.arrayIndices[0];
        usedArrayIndex = true;
      } else if (isNumericKey(keypart)) {
        keypart = parseInt(keypart);
      } else {
        if (options.noCreate) {
          return undefined;
        }

        throw MinimongoError("can't append to array using string field name [".concat(keypart, "]"));
      }

      if (last) {
        keyparts[i] = keypart; // handle 'a.01'
      }

      if (options.noCreate && keypart >= doc.length) {
        return undefined;
      }

      while (doc.length < keypart) {
        doc.push(null);
      }

      if (!last) {
        if (doc.length === keypart) {
          doc.push({});
        } else if (typeof doc[keypart] !== 'object') {
          throw MinimongoError("can't modify field '".concat(keyparts[i + 1], "' of list value ") + JSON.stringify(doc[keypart]));
        }
      }
    } else {
      assertIsValidFieldName(keypart);

      if (!(keypart in doc)) {
        if (options.noCreate) {
          return undefined;
        }

        if (!last) {
          doc[keypart] = {};
        }
      }
    }

    if (last) {
      return doc;
    }

    doc = doc[keypart];
  } // notreached

}
/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

},"matcher.js":function module(require,exports,module){

/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
//                                                                                                                     //
// packages/minimongo/matcher.js                                                                                       //
//                                                                                                                     //
/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
                                                                                                                       //
var _Package$mongoDecima;

module.export({
  default: () => Matcher
});
let LocalCollection;
module.link("./local_collection.js", {
  default(v) {
    LocalCollection = v;
  }

}, 0);
let compileDocumentSelector, hasOwn, nothingMatcher;
module.link("./common.js", {
  compileDocumentSelector(v) {
    compileDocumentSelector = v;
  },

  hasOwn(v) {
    hasOwn = v;
  },

  nothingMatcher(v) {
    nothingMatcher = v;
  }

}, 1);
const Decimal = ((_Package$mongoDecima = Package['mongo-decimal']) === null || _Package$mongoDecima === void 0 ? void 0 : _Package$mongoDecima.Decimal) || class DecimalStub {}; // The minimongo selector compiler!
// Terminology:
//  - a 'selector' is the EJSON object representing a selector
//  - a 'matcher' is its compiled form (whether a full Minimongo.Matcher
//    object or one of the component lambdas that matches parts of it)
//  - a 'result object' is an object with a 'result' field and maybe
//    distance and arrayIndices.
//  - a 'branched value' is an object with a 'value' field and maybe
//    'dontIterate' and 'arrayIndices'.
//  - a 'document' is a top-level object that can be stored in a collection.
//  - a 'lookup function' is a function that takes in a document and returns
//    an array of 'branched values'.
//  - a 'branched matcher' maps from an array of branched values to a result
//    object.
//  - an 'element matcher' maps from a single value to a bool.
// Main entry point.
//   var matcher = new Minimongo.Matcher({a: {$gt: 5}});
//   if (matcher.documentMatches({a: 7})) ...

class Matcher {
  constructor(selector, isUpdate) {
    // A set (object mapping string -> *) of all of the document paths looked
    // at by the selector. Also includes the empty string if it may look at any
    // path (eg, $where).
    this._paths = {}; // Set to true if compilation finds a $near.

    this._hasGeoQuery = false; // Set to true if compilation finds a $where.

    this._hasWhere = false; // Set to false if compilation finds anything other than a simple equality
    // or one or more of '$gt', '$gte', '$lt', '$lte', '$ne', '$in', '$nin' used
    // with scalars as operands.

    this._isSimple = true; // Set to a dummy document which always matches this Matcher. Or set to null
    // if such document is too hard to find.

    this._matchingDocument = undefined; // A clone of the original selector. It may just be a function if the user
    // passed in a function; otherwise is definitely an object (eg, IDs are
    // translated into {_id: ID} first. Used by canBecomeTrueByModifier and
    // Sorter._useWithMatcher.

    this._selector = null;
    this._docMatcher = this._compileSelector(selector); // Set to true if selection is done for an update operation
    // Default is false
    // Used for $near array update (issue #3599)

    this._isUpdate = isUpdate;
  }

  documentMatches(doc) {
    if (doc !== Object(doc)) {
      throw Error('documentMatches needs a document');
    }

    return this._docMatcher(doc);
  }

  hasGeoQuery() {
    return this._hasGeoQuery;
  }

  hasWhere() {
    return this._hasWhere;
  }

  isSimple() {
    return this._isSimple;
  } // Given a selector, return a function that takes one argument, a
  // document. It returns a result object.


  _compileSelector(selector) {
    // you can pass a literal function instead of a selector
    if (selector instanceof Function) {
      this._isSimple = false;
      this._selector = selector;

      this._recordPathUsed('');

      return doc => ({
        result: !!selector.call(doc)
      });
    } // shorthand -- scalar _id


    if (LocalCollection._selectorIsId(selector)) {
      this._selector = {
        _id: selector
      };

      this._recordPathUsed('_id');

      return doc => ({
        result: EJSON.equals(doc._id, selector)
      });
    } // protect against dangerous selectors.  falsey and {_id: falsey} are both
    // likely programmer error, and not what you want, particularly for
    // destructive operations.


    if (!selector || hasOwn.call(selector, '_id') && !selector._id) {
      this._isSimple = false;
      return nothingMatcher;
    } // Top level can't be an array or true or binary.


    if (Array.isArray(selector) || EJSON.isBinary(selector) || typeof selector === 'boolean') {
      throw new Error("Invalid selector: ".concat(selector));
    }

    this._selector = EJSON.clone(selector);
    return compileDocumentSelector(selector, this, {
      isRoot: true
    });
  } // Returns a list of key paths the given selector is looking for. It includes
  // the empty string if there is a $where.


  _getPaths() {
    return Object.keys(this._paths);
  }

  _recordPathUsed(path) {
    this._paths[path] = true;
  }

}

// helpers used by compiled selector code
LocalCollection._f = {
  // XXX for _all and _in, consider building 'inquery' at compile time..
  _type(v) {
    if (typeof v === 'number') {
      return 1;
    }

    if (typeof v === 'string') {
      return 2;
    }

    if (typeof v === 'boolean') {
      return 8;
    }

    if (Array.isArray(v)) {
      return 4;
    }

    if (v === null) {
      return 10;
    } // note that typeof(/x/) === "object"


    if (v instanceof RegExp) {
      return 11;
    }

    if (typeof v === 'function') {
      return 13;
    }

    if (v instanceof Date) {
      return 9;
    }

    if (EJSON.isBinary(v)) {
      return 5;
    }

    if (v instanceof MongoID.ObjectID) {
      return 7;
    }

    if (v instanceof Decimal) {
      return 1;
    } // object


    return 3; // XXX support some/all of these:
    // 14, symbol
    // 15, javascript code with scope
    // 16, 18: 32-bit/64-bit integer
    // 17, timestamp
    // 255, minkey
    // 127, maxkey
  },

  // deep equality test: use for literal document and array matches
  _equal(a, b) {
    return EJSON.equals(a, b, {
      keyOrderSensitive: true
    });
  },

  // maps a type code to a value that can be used to sort values of different
  // types
  _typeorder(t) {
    // http://www.mongodb.org/display/DOCS/What+is+the+Compare+Order+for+BSON+Types
    // XXX what is the correct sort position for Javascript code?
    // ('100' in the matrix below)
    // XXX minkey/maxkey
    return [-1, // (not a type)
    1, // number
    2, // string
    3, // object
    4, // array
    5, // binary
    -1, // deprecated
    6, // ObjectID
    7, // bool
    8, // Date
    0, // null
    9, // RegExp
    -1, // deprecated
    100, // JS code
    2, // deprecated (symbol)
    100, // JS code
    1, // 32-bit int
    8, // Mongo timestamp
    1 // 64-bit int
    ][t];
  },

  // compare two values of unknown type according to BSON ordering
  // semantics. (as an extension, consider 'undefined' to be less than
  // any other value.) return negative if a is less, positive if b is
  // less, or 0 if equal
  _cmp(a, b) {
    if (a === undefined) {
      return b === undefined ? 0 : -1;
    }

    if (b === undefined) {
      return 1;
    }

    let ta = LocalCollection._f._type(a);

    let tb = LocalCollection._f._type(b);

    const oa = LocalCollection._f._typeorder(ta);

    const ob = LocalCollection._f._typeorder(tb);

    if (oa !== ob) {
      return oa < ob ? -1 : 1;
    } // XXX need to implement this if we implement Symbol or integers, or
    // Timestamp


    if (ta !== tb) {
      throw Error('Missing type coercion logic in _cmp');
    }

    if (ta === 7) {
      // ObjectID
      // Convert to string.
      ta = tb = 2;
      a = a.toHexString();
      b = b.toHexString();
    }

    if (ta === 9) {
      // Date
      // Convert to millis.
      ta = tb = 1;
      a = a.getTime();
      b = b.getTime();
    }

    if (ta === 1) {
      // double
      if (a instanceof Decimal) {
        return a.minus(b).toNumber();
      } else {
        return a - b;
      }
    }

    if (tb === 2) // string
      return a < b ? -1 : a === b ? 0 : 1;

    if (ta === 3) {
      // Object
      // this could be much more efficient in the expected case ...
      const toArray = object => {
        const result = [];
        Object.keys(object).forEach(key => {
          result.push(key, object[key]);
        });
        return result;
      };

      return LocalCollection._f._cmp(toArray(a), toArray(b));
    }

    if (ta === 4) {
      // Array
      for (let i = 0;; i++) {
        if (i === a.length) {
          return i === b.length ? 0 : -1;
        }

        if (i === b.length) {
          return 1;
        }

        const s = LocalCollection._f._cmp(a[i], b[i]);

        if (s !== 0) {
          return s;
        }
      }
    }

    if (ta === 5) {
      // binary
      // Surprisingly, a small binary blob is always less than a large one in
      // Mongo.
      if (a.length !== b.length) {
        return a.length - b.length;
      }

      for (let i = 0; i < a.length; i++) {
        if (a[i] < b[i]) {
          return -1;
        }

        if (a[i] > b[i]) {
          return 1;
        }
      }

      return 0;
    }

    if (ta === 8) {
      // boolean
      if (a) {
        return b ? 0 : 1;
      }

      return b ? -1 : 0;
    }

    if (ta === 10) // null
      return 0;
    if (ta === 11) // regexp
      throw Error('Sorting not supported on regular expression'); // XXX
    // 13: javascript code
    // 14: symbol
    // 15: javascript code with scope
    // 16: 32-bit integer
    // 17: timestamp
    // 18: 64-bit integer
    // 255: minkey
    // 127: maxkey

    if (ta === 13) // javascript code
      throw Error('Sorting not supported on Javascript code'); // XXX

    throw Error('Unknown type to sort');
  }

};
/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

},"minimongo_common.js":function module(require,exports,module){

/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
//                                                                                                                     //
// packages/minimongo/minimongo_common.js                                                                              //
//                                                                                                                     //
/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
                                                                                                                       //
let LocalCollection_;
module.link("./local_collection.js", {
  default(v) {
    LocalCollection_ = v;
  }

}, 0);
let Matcher;
module.link("./matcher.js", {
  default(v) {
    Matcher = v;
  }

}, 1);
let Sorter;
module.link("./sorter.js", {
  default(v) {
    Sorter = v;
  }

}, 2);
LocalCollection = LocalCollection_;
Minimongo = {
  LocalCollection: LocalCollection_,
  Matcher,
  Sorter
};
/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

},"observe_handle.js":function module(require,exports,module){

/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
//                                                                                                                     //
// packages/minimongo/observe_handle.js                                                                                //
//                                                                                                                     //
/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
                                                                                                                       //
module.export({
  default: () => ObserveHandle
});

class ObserveHandle {}
/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

},"sorter.js":function module(require,exports,module){

/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
//                                                                                                                     //
// packages/minimongo/sorter.js                                                                                        //
//                                                                                                                     //
/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
                                                                                                                       //
module.export({
  default: () => Sorter
});
let ELEMENT_OPERATORS, equalityElementMatcher, expandArraysInBranches, hasOwn, isOperatorObject, makeLookupFunction, regexpElementMatcher;
module.link("./common.js", {
  ELEMENT_OPERATORS(v) {
    ELEMENT_OPERATORS = v;
  },

  equalityElementMatcher(v) {
    equalityElementMatcher = v;
  },

  expandArraysInBranches(v) {
    expandArraysInBranches = v;
  },

  hasOwn(v) {
    hasOwn = v;
  },

  isOperatorObject(v) {
    isOperatorObject = v;
  },

  makeLookupFunction(v) {
    makeLookupFunction = v;
  },

  regexpElementMatcher(v) {
    regexpElementMatcher = v;
  }

}, 0);

class Sorter {
  constructor(spec) {
    this._sortSpecParts = [];
    this._sortFunction = null;

    const addSpecPart = (path, ascending) => {
      if (!path) {
        throw Error('sort keys must be non-empty');
      }

      if (path.charAt(0) === '$') {
        throw Error("unsupported sort key: ".concat(path));
      }

      this._sortSpecParts.push({
        ascending,
        lookup: makeLookupFunction(path, {
          forSort: true
        }),
        path
      });
    };

    if (spec instanceof Array) {
      spec.forEach(element => {
        if (typeof element === 'string') {
          addSpecPart(element, true);
        } else {
          addSpecPart(element[0], element[1] !== 'desc');
        }
      });
    } else if (typeof spec === 'object') {
      Object.keys(spec).forEach(key => {
        addSpecPart(key, spec[key] >= 0);
      });
    } else if (typeof spec === 'function') {
      this._sortFunction = spec;
    } else {
      throw Error("Bad sort specification: ".concat(JSON.stringify(spec)));
    } // If a function is specified for sorting, we skip the rest.


    if (this._sortFunction) {
      return;
    } // To implement affectedByModifier, we piggy-back on top of Matcher's
    // affectedByModifier code; we create a selector that is affected by the
    // same modifiers as this sort order. This is only implemented on the
    // server.


    if (this.affectedByModifier) {
      const selector = {};

      this._sortSpecParts.forEach(spec => {
        selector[spec.path] = 1;
      });

      this._selectorForAffectedByModifier = new Minimongo.Matcher(selector);
    }

    this._keyComparator = composeComparators(this._sortSpecParts.map((spec, i) => this._keyFieldComparator(i)));
  }

  getComparator(options) {
    // If sort is specified or have no distances, just use the comparator from
    // the source specification (which defaults to "everything is equal".
    // issue #3599
    // https://docs.mongodb.com/manual/reference/operator/query/near/#sort-operation
    // sort effectively overrides $near
    if (this._sortSpecParts.length || !options || !options.distances) {
      return this._getBaseComparator();
    }

    const distances = options.distances; // Return a comparator which compares using $near distances.

    return (a, b) => {
      if (!distances.has(a._id)) {
        throw Error("Missing distance for ".concat(a._id));
      }

      if (!distances.has(b._id)) {
        throw Error("Missing distance for ".concat(b._id));
      }

      return distances.get(a._id) - distances.get(b._id);
    };
  } // Takes in two keys: arrays whose lengths match the number of spec
  // parts. Returns negative, 0, or positive based on using the sort spec to
  // compare fields.


  _compareKeys(key1, key2) {
    if (key1.length !== this._sortSpecParts.length || key2.length !== this._sortSpecParts.length) {
      throw Error('Key has wrong length');
    }

    return this._keyComparator(key1, key2);
  } // Iterates over each possible "key" from doc (ie, over each branch), calling
  // 'cb' with the key.


  _generateKeysFromDoc(doc, cb) {
    if (this._sortSpecParts.length === 0) {
      throw new Error('can\'t generate keys without a spec');
    }

    const pathFromIndices = indices => "".concat(indices.join(','), ",");

    let knownPaths = null; // maps index -> ({'' -> value} or {path -> value})

    const valuesByIndexAndPath = this._sortSpecParts.map(spec => {
      // Expand any leaf arrays that we find, and ignore those arrays
      // themselves.  (We never sort based on an array itself.)
      let branches = expandArraysInBranches(spec.lookup(doc), true); // If there are no values for a key (eg, key goes to an empty array),
      // pretend we found one undefined value.

      if (!branches.length) {
        branches = [{
          value: void 0
        }];
      }

      const element = Object.create(null);
      let usedPaths = false;
      branches.forEach(branch => {
        if (!branch.arrayIndices) {
          // If there are no array indices for a branch, then it must be the
          // only branch, because the only thing that produces multiple branches
          // is the use of arrays.
          if (branches.length > 1) {
            throw Error('multiple branches but no array used?');
          }

          element[''] = branch.value;
          return;
        }

        usedPaths = true;
        const path = pathFromIndices(branch.arrayIndices);

        if (hasOwn.call(element, path)) {
          throw Error("duplicate path: ".concat(path));
        }

        element[path] = branch.value; // If two sort fields both go into arrays, they have to go into the
        // exact same arrays and we have to find the same paths.  This is
        // roughly the same condition that makes MongoDB throw this strange
        // error message.  eg, the main thing is that if sort spec is {a: 1,
        // b:1} then a and b cannot both be arrays.
        //
        // (In MongoDB it seems to be OK to have {a: 1, 'a.x.y': 1} where 'a'
        // and 'a.x.y' are both arrays, but we don't allow this for now.
        // #NestedArraySort
        // XXX achieve full compatibility here

        if (knownPaths && !hasOwn.call(knownPaths, path)) {
          throw Error('cannot index parallel arrays');
        }
      });

      if (knownPaths) {
        // Similarly to above, paths must match everywhere, unless this is a
        // non-array field.
        if (!hasOwn.call(element, '') && Object.keys(knownPaths).length !== Object.keys(element).length) {
          throw Error('cannot index parallel arrays!');
        }
      } else if (usedPaths) {
        knownPaths = {};
        Object.keys(element).forEach(path => {
          knownPaths[path] = true;
        });
      }

      return element;
    });

    if (!knownPaths) {
      // Easy case: no use of arrays.
      const soleKey = valuesByIndexAndPath.map(values => {
        if (!hasOwn.call(values, '')) {
          throw Error('no value in sole key case?');
        }

        return values[''];
      });
      cb(soleKey);
      return;
    }

    Object.keys(knownPaths).forEach(path => {
      const key = valuesByIndexAndPath.map(values => {
        if (hasOwn.call(values, '')) {
          return values[''];
        }

        if (!hasOwn.call(values, path)) {
          throw Error('missing path?');
        }

        return values[path];
      });
      cb(key);
    });
  } // Returns a comparator that represents the sort specification (but not
  // including a possible geoquery distance tie-breaker).


  _getBaseComparator() {
    if (this._sortFunction) {
      return this._sortFunction;
    } // If we're only sorting on geoquery distance and no specs, just say
    // everything is equal.


    if (!this._sortSpecParts.length) {
      return (doc1, doc2) => 0;
    }

    return (doc1, doc2) => {
      const key1 = this._getMinKeyFromDoc(doc1);

      const key2 = this._getMinKeyFromDoc(doc2);

      return this._compareKeys(key1, key2);
    };
  } // Finds the minimum key from the doc, according to the sort specs.  (We say
  // "minimum" here but this is with respect to the sort spec, so "descending"
  // sort fields mean we're finding the max for that field.)
  //
  // Note that this is NOT "find the minimum value of the first field, the
  // minimum value of the second field, etc"... it's "choose the
  // lexicographically minimum value of the key vector, allowing only keys which
  // you can find along the same paths".  ie, for a doc {a: [{x: 0, y: 5}, {x:
  // 1, y: 3}]} with sort spec {'a.x': 1, 'a.y': 1}, the only keys are [0,5] and
  // [1,3], and the minimum key is [0,5]; notably, [0,3] is NOT a key.


  _getMinKeyFromDoc(doc) {
    let minKey = null;

    this._generateKeysFromDoc(doc, key => {
      if (minKey === null) {
        minKey = key;
        return;
      }

      if (this._compareKeys(key, minKey) < 0) {
        minKey = key;
      }
    });

    return minKey;
  }

  _getPaths() {
    return this._sortSpecParts.map(part => part.path);
  } // Given an index 'i', returns a comparator that compares two key arrays based
  // on field 'i'.


  _keyFieldComparator(i) {
    const invert = !this._sortSpecParts[i].ascending;
    return (key1, key2) => {
      const compare = LocalCollection._f._cmp(key1[i], key2[i]);

      return invert ? -compare : compare;
    };
  }

}

// Given an array of comparators
// (functions (a,b)->(negative or positive or zero)), returns a single
// comparator which uses each comparator in order and returns the first
// non-zero value.
function composeComparators(comparatorArray) {
  return (a, b) => {
    for (let i = 0; i < comparatorArray.length; ++i) {
      const compare = comparatorArray[i](a, b);

      if (compare !== 0) {
        return compare;
      }
    }

    return 0;
  };
}
/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

}}}}},{
  "extensions": [
    ".js",
    ".json"
  ]
});

var exports = require("/node_modules/meteor/minimongo/minimongo_server.js");

/* Exports */
Package._define("minimongo", exports, {
  LocalCollection: LocalCollection,
  Minimongo: Minimongo,
  MinimongoTest: MinimongoTest,
  MinimongoError: MinimongoError
});

})();

//# sourceURL=meteor://💻app/packages/minimongo.js
//# sourceMappingURL=data:application/json;charset=utf8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIm1ldGVvcjovL/CfkrthcHAvcGFja2FnZXMvbWluaW1vbmdvL21pbmltb25nb19zZXJ2ZXIuanMiLCJtZXRlb3I6Ly/wn5K7YXBwL3BhY2thZ2VzL21pbmltb25nby9jb21tb24uanMiLCJtZXRlb3I6Ly/wn5K7YXBwL3BhY2thZ2VzL21pbmltb25nby9jdXJzb3IuanMiLCJtZXRlb3I6Ly/wn5K7YXBwL3BhY2thZ2VzL21pbmltb25nby9sb2NhbF9jb2xsZWN0aW9uLmpzIiwibWV0ZW9yOi8v8J+Su2FwcC9wYWNrYWdlcy9taW5pbW9uZ28vbWF0Y2hlci5qcyIsIm1ldGVvcjovL/CfkrthcHAvcGFja2FnZXMvbWluaW1vbmdvL21pbmltb25nb19jb21tb24uanMiLCJtZXRlb3I6Ly/wn5K7YXBwL3BhY2thZ2VzL21pbmltb25nby9vYnNlcnZlX2hhbmRsZS5qcyIsIm1ldGVvcjovL/CfkrthcHAvcGFja2FnZXMvbWluaW1vbmdvL3NvcnRlci5qcyJdLCJuYW1lcyI6WyJtb2R1bGUiLCJsaW5rIiwiaGFzT3duIiwiaXNOdW1lcmljS2V5IiwiaXNPcGVyYXRvck9iamVjdCIsInBhdGhzVG9UcmVlIiwicHJvamVjdGlvbkRldGFpbHMiLCJ2IiwiTWluaW1vbmdvIiwiX3BhdGhzRWxpZGluZ051bWVyaWNLZXlzIiwicGF0aHMiLCJtYXAiLCJwYXRoIiwic3BsaXQiLCJmaWx0ZXIiLCJwYXJ0Iiwiam9pbiIsIk1hdGNoZXIiLCJwcm90b3R5cGUiLCJhZmZlY3RlZEJ5TW9kaWZpZXIiLCJtb2RpZmllciIsIk9iamVjdCIsImFzc2lnbiIsIiRzZXQiLCIkdW5zZXQiLCJtZWFuaW5nZnVsUGF0aHMiLCJfZ2V0UGF0aHMiLCJtb2RpZmllZFBhdGhzIiwiY29uY2F0Iiwia2V5cyIsInNvbWUiLCJtb2QiLCJtZWFuaW5nZnVsUGF0aCIsInNlbCIsImkiLCJqIiwibGVuZ3RoIiwiY2FuQmVjb21lVHJ1ZUJ5TW9kaWZpZXIiLCJpc1NpbXBsZSIsIm1vZGlmaWVyUGF0aHMiLCJwYXRoSGFzTnVtZXJpY0tleXMiLCJleHBlY3RlZFNjYWxhcklzT2JqZWN0IiwiX3NlbGVjdG9yIiwibW9kaWZpZXJQYXRoIiwic3RhcnRzV2l0aCIsIm1hdGNoaW5nRG9jdW1lbnQiLCJFSlNPTiIsImNsb25lIiwiTG9jYWxDb2xsZWN0aW9uIiwiX21vZGlmeSIsImVycm9yIiwibmFtZSIsInNldFByb3BlcnR5RXJyb3IiLCJkb2N1bWVudE1hdGNoZXMiLCJyZXN1bHQiLCJjb21iaW5lSW50b1Byb2plY3Rpb24iLCJwcm9qZWN0aW9uIiwic2VsZWN0b3JQYXRocyIsImluY2x1ZGVzIiwiY29tYmluZUltcG9ydGFudFBhdGhzSW50b1Byb2plY3Rpb24iLCJfbWF0Y2hpbmdEb2N1bWVudCIsInVuZGVmaW5lZCIsImZhbGxiYWNrIiwidmFsdWVTZWxlY3RvciIsIiRlcSIsIiRpbiIsIm1hdGNoZXIiLCJwbGFjZWhvbGRlciIsImZpbmQiLCJvbmx5Q29udGFpbnNLZXlzIiwibG93ZXJCb3VuZCIsIkluZmluaXR5IiwidXBwZXJCb3VuZCIsImZvckVhY2giLCJvcCIsImNhbGwiLCJtaWRkbGUiLCJ4IiwiU29ydGVyIiwiX3NlbGVjdG9yRm9yQWZmZWN0ZWRCeU1vZGlmaWVyIiwiZGV0YWlscyIsInRyZWUiLCJub2RlIiwiZnVsbFBhdGgiLCJtZXJnZWRQcm9qZWN0aW9uIiwidHJlZVRvUGF0aHMiLCJpbmNsdWRpbmciLCJtZXJnZWRFeGNsUHJvamVjdGlvbiIsImdldFBhdGhzIiwic2VsZWN0b3IiLCJfcGF0aHMiLCJvYmoiLCJldmVyeSIsImsiLCJwcmVmaXgiLCJrZXkiLCJ2YWx1ZSIsImV4cG9ydCIsIkVMRU1FTlRfT1BFUkFUT1JTIiwiY29tcGlsZURvY3VtZW50U2VsZWN0b3IiLCJlcXVhbGl0eUVsZW1lbnRNYXRjaGVyIiwiZXhwYW5kQXJyYXlzSW5CcmFuY2hlcyIsImlzSW5kZXhhYmxlIiwibWFrZUxvb2t1cEZ1bmN0aW9uIiwibm90aGluZ01hdGNoZXIiLCJwb3B1bGF0ZURvY3VtZW50V2l0aFF1ZXJ5RmllbGRzIiwicmVnZXhwRWxlbWVudE1hdGNoZXIiLCJkZWZhdWx0IiwiaGFzT3duUHJvcGVydHkiLCIkbHQiLCJtYWtlSW5lcXVhbGl0eSIsImNtcFZhbHVlIiwiJGd0IiwiJGx0ZSIsIiRndGUiLCIkbW9kIiwiY29tcGlsZUVsZW1lbnRTZWxlY3RvciIsIm9wZXJhbmQiLCJBcnJheSIsImlzQXJyYXkiLCJFcnJvciIsImRpdmlzb3IiLCJyZW1haW5kZXIiLCJlbGVtZW50TWF0Y2hlcnMiLCJvcHRpb24iLCJSZWdFeHAiLCIkc2l6ZSIsImRvbnRFeHBhbmRMZWFmQXJyYXlzIiwiJHR5cGUiLCJkb250SW5jbHVkZUxlYWZBcnJheXMiLCJvcGVyYW5kQWxpYXNNYXAiLCJfZiIsIl90eXBlIiwiJGJpdHNBbGxTZXQiLCJtYXNrIiwiZ2V0T3BlcmFuZEJpdG1hc2siLCJiaXRtYXNrIiwiZ2V0VmFsdWVCaXRtYXNrIiwiYnl0ZSIsIiRiaXRzQW55U2V0IiwiJGJpdHNBbGxDbGVhciIsIiRiaXRzQW55Q2xlYXIiLCIkcmVnZXgiLCJyZWdleHAiLCIkb3B0aW9ucyIsInRlc3QiLCJzb3VyY2UiLCIkZWxlbU1hdGNoIiwiX2lzUGxhaW5PYmplY3QiLCJpc0RvY01hdGNoZXIiLCJMT0dJQ0FMX09QRVJBVE9SUyIsInJlZHVjZSIsImEiLCJiIiwic3ViTWF0Y2hlciIsImluRWxlbU1hdGNoIiwiY29tcGlsZVZhbHVlU2VsZWN0b3IiLCJhcnJheUVsZW1lbnQiLCJhcmciLCJkb250SXRlcmF0ZSIsIiRhbmQiLCJzdWJTZWxlY3RvciIsImFuZERvY3VtZW50TWF0Y2hlcnMiLCJjb21waWxlQXJyYXlPZkRvY3VtZW50U2VsZWN0b3JzIiwiJG9yIiwibWF0Y2hlcnMiLCJkb2MiLCJmbiIsIiRub3IiLCIkd2hlcmUiLCJzZWxlY3RvclZhbHVlIiwiX3JlY29yZFBhdGhVc2VkIiwiX2hhc1doZXJlIiwiRnVuY3Rpb24iLCIkY29tbWVudCIsIlZBTFVFX09QRVJBVE9SUyIsImNvbnZlcnRFbGVtZW50TWF0Y2hlclRvQnJhbmNoZWRNYXRjaGVyIiwiJG5vdCIsImludmVydEJyYW5jaGVkTWF0Y2hlciIsIiRuZSIsIiRuaW4iLCIkZXhpc3RzIiwiZXhpc3RzIiwiZXZlcnl0aGluZ01hdGNoZXIiLCIkbWF4RGlzdGFuY2UiLCIkbmVhciIsIiRhbGwiLCJicmFuY2hlZE1hdGNoZXJzIiwiY3JpdGVyaW9uIiwiYW5kQnJhbmNoZWRNYXRjaGVycyIsImlzUm9vdCIsIl9oYXNHZW9RdWVyeSIsIm1heERpc3RhbmNlIiwicG9pbnQiLCJkaXN0YW5jZSIsIiRnZW9tZXRyeSIsInR5cGUiLCJHZW9KU09OIiwicG9pbnREaXN0YW5jZSIsImNvb3JkaW5hdGVzIiwicG9pbnRUb0FycmF5IiwiZ2VvbWV0cnlXaXRoaW5SYWRpdXMiLCJkaXN0YW5jZUNvb3JkaW5hdGVQYWlycyIsImJyYW5jaGVkVmFsdWVzIiwiYnJhbmNoIiwiY3VyRGlzdGFuY2UiLCJfaXNVcGRhdGUiLCJhcnJheUluZGljZXMiLCJhbmRTb21lTWF0Y2hlcnMiLCJzdWJNYXRjaGVycyIsImRvY09yQnJhbmNoZXMiLCJtYXRjaCIsInN1YlJlc3VsdCIsInNlbGVjdG9ycyIsImRvY1NlbGVjdG9yIiwib3B0aW9ucyIsImRvY01hdGNoZXJzIiwic3Vic3RyIiwiX2lzU2ltcGxlIiwibG9va1VwQnlJbmRleCIsInZhbHVlTWF0Y2hlciIsIkJvb2xlYW4iLCJvcGVyYXRvckJyYW5jaGVkTWF0Y2hlciIsImVsZW1lbnRNYXRjaGVyIiwiYnJhbmNoZXMiLCJleHBhbmRlZCIsImVsZW1lbnQiLCJtYXRjaGVkIiwicG9pbnRBIiwicG9pbnRCIiwiTWF0aCIsImh5cG90IiwiZWxlbWVudFNlbGVjdG9yIiwiX2VxdWFsIiwiZG9jT3JCcmFuY2hlZFZhbHVlcyIsInNraXBUaGVBcnJheXMiLCJicmFuY2hlc091dCIsInRoaXNJc0FycmF5IiwicHVzaCIsIk51bWJlciIsImlzSW50ZWdlciIsIlVpbnQ4QXJyYXkiLCJJbnQzMkFycmF5IiwiYnVmZmVyIiwiaXNCaW5hcnkiLCJBcnJheUJ1ZmZlciIsIm1heCIsInZpZXciLCJpc1NhZmVJbnRlZ2VyIiwiVWludDMyQXJyYXkiLCJCWVRFU19QRVJfRUxFTUVOVCIsImluc2VydEludG9Eb2N1bWVudCIsImRvY3VtZW50IiwiZXhpc3RpbmdLZXkiLCJpbmRleE9mIiwiYnJhbmNoZWRNYXRjaGVyIiwiYnJhbmNoVmFsdWVzIiwicyIsImluY29uc2lzdGVudE9LIiwidGhlc2VBcmVPcGVyYXRvcnMiLCJzZWxLZXkiLCJ0aGlzSXNPcGVyYXRvciIsIkpTT04iLCJzdHJpbmdpZnkiLCJjbXBWYWx1ZUNvbXBhcmF0b3IiLCJvcGVyYW5kVHlwZSIsIl9jbXAiLCJwYXJ0cyIsImZpcnN0UGFydCIsImxvb2t1cFJlc3QiLCJzbGljZSIsIm9taXRVbm5lY2Vzc2FyeUZpZWxkcyIsImZpcnN0TGV2ZWwiLCJhcHBlbmRUb1Jlc3VsdCIsIm1vcmUiLCJmb3JTb3J0IiwiYXJyYXlJbmRleCIsIk1pbmltb25nb1Rlc3QiLCJNaW5pbW9uZ29FcnJvciIsIm1lc3NhZ2UiLCJmaWVsZCIsIm9wZXJhdG9yTWF0Y2hlcnMiLCJvcGVyYXRvciIsInNpbXBsZVJhbmdlIiwic2ltcGxlRXF1YWxpdHkiLCJzaW1wbGVJbmNsdXNpb24iLCJuZXdMZWFmRm4iLCJjb25mbGljdEZuIiwicm9vdCIsInBhdGhBcnJheSIsInN1Y2Nlc3MiLCJsYXN0S2V5IiwieSIsInBvcHVsYXRlRG9jdW1lbnRXaXRoS2V5VmFsdWUiLCJnZXRQcm90b3R5cGVPZiIsInBvcHVsYXRlRG9jdW1lbnRXaXRoT2JqZWN0IiwidW5wcmVmaXhlZEtleXMiLCJ2YWxpZGF0ZU9iamVjdCIsIm9iamVjdCIsInF1ZXJ5IiwiX3NlbGVjdG9ySXNJZCIsImZpZWxkcyIsImZpZWxkc0tleXMiLCJzb3J0IiwiX2lkIiwia2V5UGF0aCIsInJ1bGUiLCJwcm9qZWN0aW9uUnVsZXNUcmVlIiwiY3VycmVudFBhdGgiLCJhbm90aGVyUGF0aCIsInRvU3RyaW5nIiwibGFzdEluZGV4IiwidmFsaWRhdGVLZXlJblBhdGgiLCJDdXJzb3IiLCJjb25zdHJ1Y3RvciIsImNvbGxlY3Rpb24iLCJzb3J0ZXIiLCJfc2VsZWN0b3JJc0lkUGVyaGFwc0FzT2JqZWN0IiwiX3NlbGVjdG9ySWQiLCJoYXNHZW9RdWVyeSIsInNraXAiLCJsaW1pdCIsIl9wcm9qZWN0aW9uRm4iLCJfY29tcGlsZVByb2plY3Rpb24iLCJfdHJhbnNmb3JtIiwid3JhcFRyYW5zZm9ybSIsInRyYW5zZm9ybSIsIlRyYWNrZXIiLCJyZWFjdGl2ZSIsImNvdW50IiwiYXBwbHlTa2lwTGltaXQiLCJfZGVwZW5kIiwiYWRkZWQiLCJyZW1vdmVkIiwiX2dldFJhd09iamVjdHMiLCJvcmRlcmVkIiwiZmV0Y2giLCJTeW1ib2wiLCJpdGVyYXRvciIsImFkZGVkQmVmb3JlIiwiY2hhbmdlZCIsIm1vdmVkQmVmb3JlIiwiaW5kZXgiLCJvYmplY3RzIiwibmV4dCIsImRvbmUiLCJjYWxsYmFjayIsInRoaXNBcmciLCJnZXRUcmFuc2Zvcm0iLCJvYnNlcnZlIiwiX29ic2VydmVGcm9tT2JzZXJ2ZUNoYW5nZXMiLCJvYnNlcnZlQ2hhbmdlcyIsIl9vYnNlcnZlQ2hhbmdlc0NhbGxiYWNrc0FyZU9yZGVyZWQiLCJfYWxsb3dfdW5vcmRlcmVkIiwiZGlzdGFuY2VzIiwiX0lkTWFwIiwiY3Vyc29yIiwiZGlydHkiLCJwcm9qZWN0aW9uRm4iLCJyZXN1bHRzU25hcHNob3QiLCJxaWQiLCJuZXh0X3FpZCIsInF1ZXJpZXMiLCJyZXN1bHRzIiwicGF1c2VkIiwid3JhcENhbGxiYWNrIiwic2VsZiIsImFyZ3MiLCJhcmd1bWVudHMiLCJfb2JzZXJ2ZVF1ZXVlIiwicXVldWVUYXNrIiwiYXBwbHkiLCJfc3VwcHJlc3NfaW5pdGlhbCIsImhhbmRsZSIsIk9ic2VydmVIYW5kbGUiLCJzdG9wIiwiYWN0aXZlIiwib25JbnZhbGlkYXRlIiwiZHJhaW4iLCJyZXdpbmQiLCJjaGFuZ2VycyIsImRlcGVuZGVuY3kiLCJEZXBlbmRlbmN5Iiwibm90aWZ5IiwiYmluZCIsImRlcGVuZCIsIl9nZXRDb2xsZWN0aW9uTmFtZSIsInNlbGVjdGVkRG9jIiwiX2RvY3MiLCJnZXQiLCJzZXQiLCJjbGVhciIsImlkIiwibWF0Y2hSZXN1bHQiLCJnZXRDb21wYXJhdG9yIiwiX3B1Ymxpc2hDdXJzb3IiLCJzdWJzY3JpcHRpb24iLCJQYWNrYWdlIiwibW9uZ28iLCJNb25nbyIsIkNvbGxlY3Rpb24iLCJfb2JqZWN0U3ByZWFkIiwiTWV0ZW9yIiwiX1N5bmNocm9ub3VzUXVldWUiLCJjcmVhdGUiLCJfc2F2ZWRPcmlnaW5hbHMiLCJmaW5kT25lIiwiaW5zZXJ0IiwiYXNzZXJ0SGFzVmFsaWRGaWVsZE5hbWVzIiwiX3VzZU9JRCIsIk1vbmdvSUQiLCJPYmplY3RJRCIsIlJhbmRvbSIsImhhcyIsIl9zYXZlT3JpZ2luYWwiLCJxdWVyaWVzVG9SZWNvbXB1dGUiLCJfaW5zZXJ0SW5SZXN1bHRzIiwiX3JlY29tcHV0ZVJlc3VsdHMiLCJkZWZlciIsInBhdXNlT2JzZXJ2ZXJzIiwicmVtb3ZlIiwiZXF1YWxzIiwic2l6ZSIsIl9lYWNoUG9zc2libHlNYXRjaGluZ0RvYyIsInF1ZXJ5UmVtb3ZlIiwicmVtb3ZlSWQiLCJyZW1vdmVEb2MiLCJfcmVtb3ZlRnJvbVJlc3VsdHMiLCJyZXN1bWVPYnNlcnZlcnMiLCJfZGlmZlF1ZXJ5Q2hhbmdlcyIsInJldHJpZXZlT3JpZ2luYWxzIiwib3JpZ2luYWxzIiwic2F2ZU9yaWdpbmFscyIsInVwZGF0ZSIsInFpZFRvT3JpZ2luYWxSZXN1bHRzIiwiZG9jTWFwIiwiaWRzTWF0Y2hlZCIsIl9pZHNNYXRjaGVkQnlTZWxlY3RvciIsIm1lbW9pemVkQ2xvbmVJZk5lZWRlZCIsImRvY1RvTWVtb2l6ZSIsInJlY29tcHV0ZVFpZHMiLCJ1cGRhdGVDb3VudCIsInF1ZXJ5UmVzdWx0IiwiX21vZGlmeUFuZE5vdGlmeSIsIm11bHRpIiwiaW5zZXJ0ZWRJZCIsInVwc2VydCIsIl9jcmVhdGVVcHNlcnREb2N1bWVudCIsIl9yZXR1cm5PYmplY3QiLCJudW1iZXJBZmZlY3RlZCIsInNwZWNpZmljSWRzIiwibWF0Y2hlZF9iZWZvcmUiLCJvbGRfZG9jIiwiYWZ0ZXJNYXRjaCIsImFmdGVyIiwiYmVmb3JlIiwiX3VwZGF0ZUluUmVzdWx0cyIsIm9sZFJlc3VsdHMiLCJfQ2FjaGluZ0NoYW5nZU9ic2VydmVyIiwib3JkZXJlZEZyb21DYWxsYmFja3MiLCJjYWxsYmFja3MiLCJkb2NzIiwiT3JkZXJlZERpY3QiLCJpZFN0cmluZ2lmeSIsImFwcGx5Q2hhbmdlIiwicHV0QmVmb3JlIiwibW92ZUJlZm9yZSIsIkRpZmZTZXF1ZW5jZSIsImFwcGx5Q2hhbmdlcyIsIklkTWFwIiwiaWRQYXJzZSIsIl9fd3JhcHBlZFRyYW5zZm9ybV9fIiwid3JhcHBlZCIsInRyYW5zZm9ybWVkIiwibm9ucmVhY3RpdmUiLCJfYmluYXJ5U2VhcmNoIiwiY21wIiwiYXJyYXkiLCJmaXJzdCIsInJhbmdlIiwiaGFsZlJhbmdlIiwiZmxvb3IiLCJfY2hlY2tTdXBwb3J0ZWRQcm9qZWN0aW9uIiwiX2lkUHJvamVjdGlvbiIsInJ1bGVUcmVlIiwic3ViZG9jIiwic2VsZWN0b3JEb2N1bWVudCIsImlzTW9kaWZ5IiwiX2lzTW9kaWZpY2F0aW9uTW9kIiwibmV3RG9jIiwiaXNJbnNlcnQiLCJyZXBsYWNlbWVudCIsIl9kaWZmT2JqZWN0cyIsImxlZnQiLCJyaWdodCIsImRpZmZPYmplY3RzIiwibmV3UmVzdWx0cyIsIm9ic2VydmVyIiwiZGlmZlF1ZXJ5Q2hhbmdlcyIsIl9kaWZmUXVlcnlPcmRlcmVkQ2hhbmdlcyIsImRpZmZRdWVyeU9yZGVyZWRDaGFuZ2VzIiwiX2RpZmZRdWVyeVVub3JkZXJlZENoYW5nZXMiLCJkaWZmUXVlcnlVbm9yZGVyZWRDaGFuZ2VzIiwiX2ZpbmRJbk9yZGVyZWRSZXN1bHRzIiwic3ViSWRzIiwiX2luc2VydEluU29ydGVkTGlzdCIsInNwbGljZSIsImlzUmVwbGFjZSIsImlzTW9kaWZpZXIiLCJzZXRPbkluc2VydCIsIm1vZEZ1bmMiLCJNT0RJRklFUlMiLCJrZXlwYXRoIiwia2V5cGFydHMiLCJ0YXJnZXQiLCJmaW5kTW9kVGFyZ2V0IiwiZm9yYmlkQXJyYXkiLCJub0NyZWF0ZSIsIk5PX0NSRUFURV9NT0RJRklFUlMiLCJwb3AiLCJvYnNlcnZlQ2FsbGJhY2tzIiwic3VwcHJlc3NlZCIsIm9ic2VydmVDaGFuZ2VzQ2FsbGJhY2tzIiwiX29ic2VydmVDYWxsYmFja3NBcmVPcmRlcmVkIiwiaW5kaWNlcyIsIl9ub19pbmRpY2VzIiwiYWRkZWRBdCIsImNoYW5nZWRBdCIsIm9sZERvYyIsIm1vdmVkVG8iLCJmcm9tIiwidG8iLCJyZW1vdmVkQXQiLCJjaGFuZ2VPYnNlcnZlciIsIl9mcm9tT2JzZXJ2ZSIsIm5vbk11dGF0aW5nQ2FsbGJhY2tzIiwiY2hhbmdlZEZpZWxkcyIsIm1ha2VDaGFuZ2VkRmllbGRzIiwib2xkX2lkeCIsIm5ld19pZHgiLCIkY3VycmVudERhdGUiLCJEYXRlIiwiJG1pbiIsIiRtYXgiLCIkaW5jIiwiJHNldE9uSW5zZXJ0IiwiJHB1c2giLCIkZWFjaCIsInRvUHVzaCIsInBvc2l0aW9uIiwiJHBvc2l0aW9uIiwiJHNsaWNlIiwic29ydEZ1bmN0aW9uIiwiJHNvcnQiLCJzcGxpY2VBcmd1bWVudHMiLCIkcHVzaEFsbCIsIiRhZGRUb1NldCIsImlzRWFjaCIsInZhbHVlcyIsInRvQWRkIiwiJHBvcCIsInRvUG9wIiwiJHB1bGwiLCJ0b1B1bGwiLCJvdXQiLCIkcHVsbEFsbCIsIiRyZW5hbWUiLCJ0YXJnZXQyIiwiJGJpdCIsIiR2IiwiaW52YWxpZENoYXJNc2ciLCIkIiwiYXNzZXJ0SXNWYWxpZEZpZWxkTmFtZSIsInVzZWRBcnJheUluZGV4IiwibGFzdCIsImtleXBhcnQiLCJwYXJzZUludCIsIkRlY2ltYWwiLCJEZWNpbWFsU3R1YiIsImlzVXBkYXRlIiwiX2RvY01hdGNoZXIiLCJfY29tcGlsZVNlbGVjdG9yIiwiaGFzV2hlcmUiLCJrZXlPcmRlclNlbnNpdGl2ZSIsIl90eXBlb3JkZXIiLCJ0IiwidGEiLCJ0YiIsIm9hIiwib2IiLCJ0b0hleFN0cmluZyIsImdldFRpbWUiLCJtaW51cyIsInRvTnVtYmVyIiwidG9BcnJheSIsIkxvY2FsQ29sbGVjdGlvbl8iLCJzcGVjIiwiX3NvcnRTcGVjUGFydHMiLCJfc29ydEZ1bmN0aW9uIiwiYWRkU3BlY1BhcnQiLCJhc2NlbmRpbmciLCJjaGFyQXQiLCJsb29rdXAiLCJfa2V5Q29tcGFyYXRvciIsImNvbXBvc2VDb21wYXJhdG9ycyIsIl9rZXlGaWVsZENvbXBhcmF0b3IiLCJfZ2V0QmFzZUNvbXBhcmF0b3IiLCJfY29tcGFyZUtleXMiLCJrZXkxIiwia2V5MiIsIl9nZW5lcmF0ZUtleXNGcm9tRG9jIiwiY2IiLCJwYXRoRnJvbUluZGljZXMiLCJrbm93blBhdGhzIiwidmFsdWVzQnlJbmRleEFuZFBhdGgiLCJ1c2VkUGF0aHMiLCJzb2xlS2V5IiwiZG9jMSIsImRvYzIiLCJfZ2V0TWluS2V5RnJvbURvYyIsIm1pbktleSIsImludmVydCIsImNvbXBhcmUiLCJjb21wYXJhdG9yQXJyYXkiXSwibWFwcGluZ3MiOiI7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7QUFBQUEsTUFBTSxDQUFDQyxJQUFQLENBQVksdUJBQVo7QUFBcUMsSUFBSUMsTUFBSixFQUFXQyxZQUFYLEVBQXdCQyxnQkFBeEIsRUFBeUNDLFdBQXpDLEVBQXFEQyxpQkFBckQ7QUFBdUVOLE1BQU0sQ0FBQ0MsSUFBUCxDQUFZLGFBQVosRUFBMEI7QUFBQ0MsUUFBTSxDQUFDSyxDQUFELEVBQUc7QUFBQ0wsVUFBTSxHQUFDSyxDQUFQO0FBQVMsR0FBcEI7O0FBQXFCSixjQUFZLENBQUNJLENBQUQsRUFBRztBQUFDSixnQkFBWSxHQUFDSSxDQUFiO0FBQWUsR0FBcEQ7O0FBQXFESCxrQkFBZ0IsQ0FBQ0csQ0FBRCxFQUFHO0FBQUNILG9CQUFnQixHQUFDRyxDQUFqQjtBQUFtQixHQUE1Rjs7QUFBNkZGLGFBQVcsQ0FBQ0UsQ0FBRCxFQUFHO0FBQUNGLGVBQVcsR0FBQ0UsQ0FBWjtBQUFjLEdBQTFIOztBQUEySEQsbUJBQWlCLENBQUNDLENBQUQsRUFBRztBQUFD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QyxHQUFHLENBQWIsRUFBZ0JBLENBQUMsR0FBRzZrQixlQUFlLENBQUMza0IsTUFBcEMsRUFBNEMsRUFBRUYsQ0FBOUMsRUFBaUQ7QUFDL0MsWUFBTTRrQixPQUFPLEdBQUdDLGVBQWUsQ0FBQzdrQixDQUFELENBQWYsQ0FBbUJzSCxDQUFuQixFQUFzQkMsQ0FBdEIsQ0FBaEI7O0FBQ0EsVUFBSXFkLE9BQU8sS0FBSyxDQUFoQixFQUFtQjtBQUNqQixlQUFPQSxPQUFQO0FBQ0Q7QUFDRjs7QUFFRCxXQUFPLENBQVA7QUFDRCxHQVREO0FBVUQsQyIsImZpbGUiOiIvcGFja2FnZXMvbWluaW1vbmdvLmpzIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0ICcuL21pbmltb25nb19jb21tb24uanMnO1xuaW1wb3J0IHtcbiAgaGFzT3duLFxuICBpc051bWVyaWNLZXksXG4gIGlzT3BlcmF0b3JPYmplY3QsXG4gIHBhdGhzVG9UcmVlLFxuICBwcm9qZWN0aW9uRGV0YWlscyxcbn0gZnJvbSAnLi9jb21tb24uanMnO1xuXG5NaW5pbW9uZ28uX3BhdGhzRWxpZGluZ051bWVyaWNLZXlzID0gcGF0aHMgPT4gcGF0aHMubWFwKHBhdGggPT5cbiAgcGF0aC5zcGxpdCgnLicpLmZpbHRlcihwYXJ0ID0+ICFpc051bWVyaWNLZXkocGFydCkpLmpvaW4oJy4nKVxuKTtcblxuLy8gUmV0dXJucyB0cnVlIGlmIHRoZSBtb2RpZmllciBhcHBsaWVkIHRvIHNvbWUgZG9jdW1lbnQgbWF5IGNoYW5nZSB0aGUgcmVzdWx0XG4vLyBvZiBtYXRjaGluZyB0aGUgZG9jdW1lbnQgYnkgc2VsZWN0b3Jcbi8vIFRoZSBtb2RpZmllciBpcyBhbHdheXMgaW4gYSBmb3JtIG9mIE9iamVjdDpcbi8vICAtICRzZXRcbi8vICAgIC0gJ2EuYi4yMi56JzogdmFsdWVcbi8vICAgIC0gJ2Zvby5iYXInOiA0MlxuLy8gIC0gJHVuc2V0XG4vLyAgICAtICdhYmMuZCc6IDFcbk1pbmltb25nby5NYXRjaGVyLnByb3RvdHlwZS5hZmZlY3RlZEJ5TW9kaWZpZXIgPSBmdW5jdGlvbihtb2RpZmllcikge1xuICAvLyBzYWZlIGNoZWNrIGZvciAkc2V0LyR1bnNldCBiZWluZyBvYmplY3RzXG4gIG1vZGlmaWVyID0gT2JqZWN0LmFzc2lnbih7JHNldDoge30sICR1bnNldDoge319LCBtb2RpZmllcik7XG5cbiAgY29uc3QgbWVhbmluZ2Z1bFBhdGhzID0gdGhpcy5fZ2V0UGF0aHMoKTtcbiAgY29uc3QgbW9kaWZpZWRQYXRocyA9IFtdLmNvbmNhdChcbiAgICBPYmplY3Qua2V5cyhtb2RpZmllci4kc2V0KSxcbiAgICBPYmplY3Qua2V5cyhtb2RpZmllci4kdW5zZXQpXG4gICk7XG5cbiAgcmV0dXJuIG1vZGlmaWVkUGF0aHMuc29tZShwYXRoID0+IHtcbiAgICBjb25zdCBtb2QgPSBwYXRoLnNwbGl0KCcuJyk7XG5cbiAgICByZXR1cm4gbWVhbmluZ2Z1bFBhdGhzLnNvbWUobWVhbmluZ2Z1bFBhdGggPT4ge1xuICAgICAgY29uc3Qgc2VsID0gbWVhbmluZ2Z1bFBhdGguc3BsaXQoJy4nKTtcblxuICAgICAgbGV0IGkgPSAwLCBqID0gMDtcblxuICAgICAgd2hpbGUgKGkgPCBzZWwubGVuZ3RoICYmIGogPCBtb2QubGVuZ3RoKSB7XG4gICAgICAgIGlmIChpc051bWVyaWNLZXkoc2VsW2ldKSAmJiBpc051bWVyaWNLZXkobW9kW2pdKSkge1xuICAgICAgICAgIC8vIGZvby40LmJhciBzZWxlY3RvciBhZmZlY3RlZCBieSBmb28uNCBtb2RpZmllclxuICAgICAgICAgIC8vIGZvby4zLmJhciBzZWxlY3RvciB1bmFmZmVjdGVkIGJ5IGZvby40IG1vZGlmaWVyXG4gICAgICAgICAgaWYgKHNlbFtpXSA9PT0gbW9kW2pdKSB7XG4gICAgICAgICAgICBpKys7XG4gICAgICAgICAgICBqKys7XG4gICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIHJldHVybiBmYWxzZTtcbiAgICAgICAgICB9XG4gICAgICAgIH0gZWxzZSBpZiAoaXNOdW1lcmljS2V5KHNlbFtpXSkpIHtcbiAgICAgICAgICAvLyBmb28uNC5iYXIgc2VsZWN0b3IgdW5hZmZlY3RlZCBieSBmb28uYmFyIG1vZGlmaWVyXG4gICAgICAgICAgcmV0dXJuIGZhbHNlO1xuICAgICAgICB9IGVsc2UgaWYgKGlzTnVtZXJpY0tleShtb2Rbal0pKSB7XG4gICAgICAgICAgaisrO1xuICAgICAgICB9IGVsc2UgaWYgKHNlbFtpXSA9PT0gbW9kW2pdKSB7XG4gICAgICAgICAgaSsrO1xuICAgICAgICAgIGorKztcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICByZXR1cm4gZmFsc2U7XG4gICAgICAgIH1cbiAgICAgIH1cblxuICAgICAgLy8gT25lIGlzIGEgcHJlZml4IG9mIGFub3RoZXIsIHRha2luZyBudW1lcmljIGZpZWxkcyBpbnRvIGFjY291bnRcbiAgICAgIHJldHVybiB0cnVlO1xuICAgIH0pO1xuICB9KTtcbn07XG5cbi8vIEBwYXJhbSBtb2RpZmllciAtIE9iamVjdDogTW9uZ29EQi1zdHlsZWQgbW9kaWZpZXIgd2l0aCBgJHNldGBzIGFuZCBgJHVuc2V0c2Bcbi8vICAgICAgICAgICAgICAgICAgICAgICAgICAgb25seS4gKGFzc3VtZWQgdG8gY29tZSBmcm9tIG9wbG9nKVxuLy8gQHJldHVybnMgLSBCb29sZWFuOiBpZiBhZnRlciBhcHBseWluZyB0aGUgbW9kaWZpZXIsIHNlbGVjdG9yIGNhbiBzdGFydFxuLy8gICAgICAgICAgICAgICAgICAgICBhY2NlcHRpbmcgdGhlIG1vZGlmaWVkIHZhbHVlLlxuLy8gTk9URTogYXNzdW1lcyB0aGF0IGRvY3VtZW50IGFmZmVjdGVkIGJ5IG1vZGlmaWVyIGRpZG4ndCBtYXRjaCB0aGlzIE1hdGNoZXJcbi8vIGJlZm9yZSwgc28gaWYgbW9kaWZpZXIgY2FuJ3QgY29udmluY2Ugc2VsZWN0b3IgaW4gYSBwb3NpdGl2ZSBjaGFuZ2UgaXQgd291bGRcbi8vIHN0YXkgJ2ZhbHNlJy5cbi8vIEN1cnJlbnRseSBkb2Vzbid0IHN1cHBvcnQgJC1vcGVyYXRvcnMgYW5kIG51bWVyaWMgaW5kaWNlcyBwcmVjaXNlbHkuXG5NaW5pbW9uZ28uTWF0Y2hlci5wcm90b3R5cGUuY2FuQmVjb21lVHJ1ZUJ5TW9kaWZpZXIgPSBmdW5jdGlvbihtb2RpZmllcikge1xuICBpZiAoIXRoaXMuYWZmZWN0ZWRCeU1vZGlmaWVyKG1vZGlmaWVyKSkge1xuICAgIHJldHVybiBmYWxzZTtcbiAgfVxuXG4gIGlmICghdGhpcy5pc1NpbXBsZSgpKSB7XG4gICAgcmV0dXJuIHRydWU7XG4gIH1cblxuICBtb2RpZmllciA9IE9iamVjdC5hc3NpZ24oeyRzZXQ6IHt9LCAkdW5zZXQ6IHt9fSwgbW9kaWZpZXIpO1xuXG4gIGNvbnN0IG1vZGlmaWVyUGF0aHMgPSBbXS5jb25jYXQoXG4gICAgT2JqZWN0LmtleXMobW9kaWZpZXIuJHNldCksXG4gICAgT2JqZWN0LmtleXMobW9kaWZpZXIuJHVuc2V0KVxuICApO1xuXG4gIGlmICh0aGlzLl9nZXRQYXRocygpLnNvbWUocGF0aEhhc051bWVyaWNLZXlzKSB8fFxuICAgICAgbW9kaWZpZXJQYXRocy5zb21lKHBhdGhIYXNOdW1lcmljS2V5cykpIHtcbiAgICByZXR1cm4gdHJ1ZTtcbiAgfVxuXG4gIC8vIGNoZWNrIGlmIHRoZXJlIGlzIGEgJHNldCBvciAkdW5zZXQgdGhhdCBpbmRpY2F0ZXMgc29tZXRoaW5nIGlzIGFuXG4gIC8vIG9iamVjdCByYXRoZXIgdGhhbiBhIHNjYWxhciBpbiB0aGUgYWN0dWFsIG9iamVjdCB3aGVyZSB3ZSBzYXcgJC1vcGVyYXRvclxuICAvLyBOT1RFOiBpdCBpcyBjb3JyZWN0IHNpbmNlIHdlIGFsbG93IG9ubHkgc2NhbGFycyBpbiAkLW9wZXJhdG9yc1xuICAvLyBFeGFtcGxlOiBmb3Igc2VsZWN0b3IgeydhLmInOiB7JGd0OiA1fX0gdGhlIG1vZGlmaWVyIHsnYS5iLmMnOjd9IHdvdWxkXG4gIC8vIGRlZmluaXRlbHkgc2V0IHRoZSByZXN1bHQgdG8gZmFsc2UgYXMgJ2EuYicgYXBwZWFycyB0byBiZSBhbiBvYmplY3QuXG4gIGNvbnN0IGV4cGVjdGVkU2NhbGFySXNPYmplY3QgPSBPYmplY3Qua2V5cyh0aGlzLl9zZWxlY3Rvcikuc29tZShwYXRoID0+IHtcbiAgICBpZiAoIWlzT3BlcmF0b3JPYmplY3QodGhpcy5fc2VsZWN0b3JbcGF0aF0pKSB7XG4gICAgICByZXR1cm4gZmFsc2U7XG4gICAgfVxuXG4gICAgcmV0dXJuIG1vZGlmaWVyUGF0aHMuc29tZShtb2RpZmllclBhdGggPT5cbiAgICAgIG1vZGlmaWVyUGF0aC5zdGFydHNXaXRoKGAke3BhdGh9LmApXG4gICAgKTtcbiAgfSk7XG5cbiAgaWYgKGV4cGVjdGVkU2NhbGFySXNPYmplY3QpIHtcbiAgICByZXR1cm4gZmFsc2U7XG4gIH1cblxuICAvLyBTZWUgaWYgd2UgY2FuIGFwcGx5IHRoZSBtb2RpZmllciBvbiB0aGUgaWRlYWxseSBtYXRjaGluZyBvYmplY3QuIElmIGl0XG4gIC8vIHN0aWxsIG1hdGNoZXMgdGhlIHNlbGVjdG9yLCB0aGVuIHRoZSBtb2RpZmllciBjb3VsZCBoYXZlIHR1cm5lZCB0aGUgcmVhbFxuICAvLyBvYmplY3QgaW4gdGhlIGRhdGFiYXNlIGludG8gc29tZXRoaW5nIG1hdGNoaW5nLlxuICBjb25zdCBtYXRjaGluZ0RvY3VtZW50ID0gRUpTT04uY2xvbmUodGhpcy5tYXRjaGluZ0RvY3VtZW50KCkpO1xuXG4gIC8vIFRoZSBzZWxlY3RvciBpcyB0b28gY29tcGxleCwgYW55dGhpbmcgY2FuIGhhcHBlbi5cbiAgaWYgKG1hdGNoaW5nRG9jdW1lbnQgPT09IG51bGwpIHtcbiAgICByZXR1cm4gdHJ1ZTtcbiAgfVxuXG4gIHRyeSB7XG4gICAgTG9jYWxDb2xsZWN0aW9uLl9tb2RpZnkobWF0Y2hpbmdEb2N1bWVudCwgbW9kaWZpZXIpO1xuICB9IGNhdGNoIChlcnJvcikge1xuICAgIC8vIENvdWxkbid0IHNldCBhIHByb3BlcnR5IG9uIGEgZmllbGQgd2hpY2ggaXMgYSBzY2FsYXIgb3IgbnVsbCBpbiB0aGVcbiAgICAvLyBzZWxlY3Rvci5cbiAgICAvLyBFeGFtcGxlOlxuICAgIC8vIHJlYWwgZG9jdW1lbnQ6IHsgJ2EuYic6IDMgfVxuICAgIC8vIHNlbGVjdG9yOiB7ICdhJzogMTIgfVxuICAgIC8vIGNvbnZlcnRlZCBzZWxlY3RvciAoaWRlYWwgZG9jdW1lbnQpOiB7ICdhJzogMTIgfVxuICAgIC8vIG1vZGlmaWVyOiB7ICRzZXQ6IHsgJ2EuYic6IDQgfSB9XG4gICAgLy8gV2UgZG9uJ3Qga25vdyB3aGF0IHJlYWwgZG9jdW1lbnQgd2FzIGxpa2UgYnV0IGZyb20gdGhlIGVycm9yIHJhaXNlZCBieVxuICAgIC8vICRzZXQgb24gYSBzY2FsYXIgZmllbGQgd2UgY2FuIHJlYXNvbiB0aGF0IHRoZSBzdHJ1Y3R1cmUgb2YgcmVhbCBkb2N1bWVudFxuICAgIC8vIGlzIGNvbXBsZXRlbHkgZGlmZmVyZW50LlxuICAgIGlmIChlcnJvci5uYW1lID09PSAnTWluaW1vbmdvRXJyb3InICYmIGVycm9yLnNldFByb3BlcnR5RXJyb3IpIHtcbiAgICAgIHJldHVybiBmYWxzZTtcbiAgICB9XG5cbiAgICB0aHJvdyBlcnJvcjtcbiAgfVxuXG4gIHJldHVybiB0aGlzLmRvY3VtZW50TWF0Y2hlcyhtYXRjaGluZ0RvY3VtZW50KS5yZXN1bHQ7XG59O1xuXG4vLyBLbm93cyBob3cgdG8gY29tYmluZSBhIG1vbmdvIHNlbGVjdG9yIGFuZCBhIGZpZWxkcyBwcm9qZWN0aW9uIHRvIGEgbmV3IGZpZWxkc1xuLy8gcHJvamVjdGlvbiB0YWtpbmcgaW50byBhY2NvdW50IGFjdGl2ZSBmaWVsZHMgZnJvbSB0aGUgcGFzc2VkIHNlbGVjdG9yLlxuLy8gQHJldHVybnMgT2JqZWN0IC0gcHJvamVjdGlvbiBvYmplY3QgKHNhbWUgYXMgZmllbGRzIG9wdGlvbiBvZiBtb25nbyBjdXJzb3IpXG5NaW5pbW9uZ28uTWF0Y2hlci5wcm90b3R5cGUuY29tYmluZUludG9Qcm9qZWN0aW9uID0gZnVuY3Rpb24ocHJvamVjdGlvbikge1xuICBjb25zdCBzZWxlY3RvclBhdGhzID0gTWluaW1vbmdvLl9wYXRoc0VsaWRpbmdOdW1lcmljS2V5cyh0aGlzLl9nZXRQYXRocygpKTtcblxuICAvLyBTcGVjaWFsIGNhc2UgZm9yICR3aGVyZSBvcGVyYXRvciBpbiB0aGUgc2VsZWN0b3IgLSBwcm9qZWN0aW9uIHNob3VsZCBkZXBlbmRcbiAgLy8gb24gYWxsIGZpZWxkcyBvZiB0aGUgZG9jdW1lbnQuIGdldFNlbGVjdG9yUGF0aHMgcmV0dXJucyBhIGxpc3Qgb2YgcGF0aHNcbiAgLy8gc2VsZWN0b3IgZGVwZW5kcyBvbi4gSWYgb25lIG9mIHRoZSBwYXRocyBpcyAnJyAoZW1wdHkgc3RyaW5nKSByZXByZXNlbnRpbmdcbiAgLy8gdGhlIHJvb3Qgb3IgdGhlIHdob2xlIGRvY3VtZW50LCBjb21wbGV0ZSBwcm9qZWN0aW9uIHNob3VsZCBiZSByZXR1cm5lZC5cbiAgaWYgKHNlbGVjdG9yUGF0aHMuaW5jbHVkZXMoJycpKSB7XG4gICAgcmV0dXJuIHt9O1xuICB9XG5cbiAgcmV0dXJuIGNvbWJpbmVJbXBvcnRhbnRQYXRoc0ludG9Qcm9qZWN0aW9uKHNlbGVjdG9yUGF0aHMsIHByb2plY3Rpb24pO1xufTtcblxuLy8gUmV0dXJucyBhbiBvYmplY3QgdGhhdCB3b3VsZCBtYXRjaCB0aGUgc2VsZWN0b3IgaWYgcG9zc2libGUgb3IgbnVsbCBpZiB0aGVcbi8vIHNlbGVjdG9yIGlzIHRvbyBjb21wbGV4IGZvciB1cyB0byBhbmFseXplXG4vLyB7ICdhLmInOiB7IGFuczogNDIgfSwgJ2Zvby5iYXInOiBudWxsLCAnZm9vLmJheic6IFwic29tZXRoaW5nXCIgfVxuLy8gPT4geyBhOiB7IGI6IHsgYW5zOiA0MiB9IH0sIGZvbzogeyBiYXI6IG51bGwsIGJhejogXCJzb21ldGhpbmdcIiB9IH1cbk1pbmltb25nby5NYXRjaGVyLnByb3RvdHlwZS5tYXRjaGluZ0RvY3VtZW50ID0gZnVuY3Rpb24oKSB7XG4gIC8vIGNoZWNrIGlmIGl0IHdhcyBjb21wdXRlZCBiZWZvcmVcbiAgaWYgKHRoaXMuX21hdGNoaW5nRG9jdW1lbnQgIT09IHVuZGVmaW5lZCkge1xuICAgIHJldHVybiB0aGlzLl9tYXRjaGluZ0RvY3VtZW50O1xuICB9XG5cbiAgLy8gSWYgdGhlIGFuYWx5c2lzIG9mIHRoaXMgc2VsZWN0b3IgaXMgdG9vIGhhcmQgZm9yIG91ciBpbXBsZW1lbnRhdGlvblxuICAvLyBmYWxsYmFjayB0byBcIllFU1wiXG4gIGxldCBmYWxsYmFjayA9IGZhbHNlO1xuXG4gIHRoaXMuX21hdGNoaW5nRG9jdW1lbnQgPSBwYXRoc1RvVHJlZShcbiAgICB0aGlzLl9nZXRQYXRocygpLFxuICAgIHBhdGggPT4ge1xuICAgICAgY29uc3QgdmFsdWVTZWxlY3RvciA9IHRoaXMuX3NlbGVjdG9yW3BhdGhdO1xuXG4gICAgICBpZiAoaXNPcGVyYXRvck9iamVjdCh2YWx1ZVNlbGVjdG9yKSkge1xuICAgICAgICAvLyBpZiB0aGVyZSBpcyBhIHN0cmljdCBlcXVhbGl0eSwgdGhlcmUgaXMgYSBnb29kXG4gICAgICAgIC8vIGNoYW5jZSB3ZSBjYW4gdXNlIG9uZSBvZiB0aG9zZSBhcyBcIm1hdGNoaW5nXCJcbiAgICAgICAgLy8gZHVtbXkgdmFsdWVcbiAgICAgICAgaWYgKHZhbHVlU2VsZWN0b3IuJGVxKSB7XG4gICAgICAgICAgcmV0dXJuIHZhbHVlU2VsZWN0b3IuJGVxO1xuICAgICAgICB9XG5cbiAgICAgICAgaWYgKHZhbHVlU2VsZWN0b3IuJGluKSB7XG4gICAgICAgICAgY29uc3QgbWF0Y2hlciA9IG5ldyBNaW5pbW9uZ28uTWF0Y2hlcih7cGxhY2Vob2xkZXI6IHZhbHVlU2VsZWN0b3J9KTtcblxuICAgICAgICAgIC8vIFJldHVybiBhbnl0aGluZyBmcm9tICRpbiB0aGF0IG1hdGNoZXMgdGhlIHdob2xlIHNlbGVjdG9yIGZvciB0aGlzXG4gICAgICAgICAgLy8gcGF0aC4gSWYgbm90aGluZyBtYXRjaGVzLCByZXR1cm5zIGB1bmRlZmluZWRgIGFzIG5vdGhpbmcgY2FuIG1ha2VcbiAgICAgICAgICAvLyB0aGlzIHNlbGVjdG9yIGludG8gYHRydWVgLlxuICAgICAgICAgIHJldHVybiB2YWx1ZVNlbGVjdG9yLiRpbi5maW5kKHBsYWNlaG9sZGVyID0+XG4gICAgICAgICAgICBtYXRjaGVyLmRvY3VtZW50TWF0Y2hlcyh7cGxhY2Vob2xkZXJ9KS5yZXN1bHRcbiAgICAgICAgICApO1xuICAgICAgICB9XG5cbiAgICAgICAgaWYgKG9ubHlDb250YWluc0tleXModmFsdWVTZWxlY3RvciwgWyckZ3QnLCAnJGd0ZScsICckbHQnLCAnJGx0ZSddKSkge1xuICAgICAgICAgIGxldCBsb3dlckJvdW5kID0gLUluZmluaXR5O1xuICAgICAgICAgIGxldCB1cHBlckJvdW5kID0gSW5maW5pdHk7XG5cbiAgICAgICAgICBbJyRsdGUnLCAnJGx0J10uZm9yRWFjaChvcCA9PiB7XG4gICAgICAgICAgICBpZiAoaGFzT3duLmNhbGwodmFsdWVTZWxlY3Rvciwgb3ApICYmXG4gICAgICAgICAgICAgICAgdmFsdWVTZWxlY3RvcltvcF0gPCB1cHBlckJvdW5kKSB7XG4gICAgICAgICAgICAgIHVwcGVyQm91bmQgPSB2YWx1ZVNlbGVjdG9yW29wXTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICB9KTtcblxuICAgICAgICAgIFsnJGd0ZScsICckZ3QnXS5mb3JFYWNoKG9wID0+IHtcbiAgICAgICAgICAgIGlmIChoYXNPd24uY2FsbCh2YWx1ZVNlbGVjdG9yLCBvcCkgJiZcbiAgICAgICAgICAgICAgICB2YWx1ZVNlbGVjdG9yW29wXSA+IGxvd2VyQm91bmQpIHtcbiAgICAgICAgICAgICAgbG93ZXJCb3VuZCA9IHZhbHVlU2VsZWN0b3Jbb3BdO1xuICAgICAgICAgICAgfVxuICAgICAgICAgIH0pO1xuXG4gICAgICAgICAgY29uc3QgbWlkZGxlID0gKGxvd2VyQm91bmQgKyB1cHBlckJvdW5kKSAvIDI7XG4gICAgICAgICAgY29uc3QgbWF0Y2hlciA9IG5ldyBNaW5pbW9uZ28uTWF0Y2hlcih7cGxhY2Vob2xkZXI6IHZhbHVlU2VsZWN0b3J9KTtcblxuICAgICAgICAgIGlmICghbWF0Y2hlci5kb2N1bWVudE1hdGNoZXMoe3BsYWNlaG9sZGVyOiBtaWRkbGV9KS5yZXN1bHQgJiZcbiAgICAgICAgICAgICAgKG1pZGRsZSA9PT0gbG93ZXJCb3VuZCB8fCBtaWRkbGUgPT09IHVwcGVyQm91bmQpKSB7XG4gICAgICAgICAgICBmYWxsYmFjayA9IHRydWU7XG4gICAgICAgICAgfVxuXG4gICAgICAgICAgcmV0dXJuIG1pZGRsZTtcbiAgICAgICAgfVxuXG4gICAgICAgIGlmIChvbmx5Q29udGFpbnNLZXlzKHZhbHVlU2VsZWN0b3IsIFsnJG5pbicsICckbmUnXSkpIHtcbiAgICAgICAgICAvLyBTaW5jZSB0aGlzLl9pc1NpbXBsZSBtYWtlcyBzdXJlICRuaW4gYW5kICRuZSBhcmUgbm90IGNvbWJpbmVkIHdpdGhcbiAgICAgICAgICAvLyBvYmplY3RzIG9yIGFycmF5cywgd2UgY2FuIGNvbmZpZGVudGx5IHJldHVybiBhbiBlbXB0eSBvYmplY3QgYXMgaXRcbiAgICAgICAgICAvLyBuZXZlciBtYXRjaGVzIGFueSBzY2FsYXIuXG4gICAgICAgICAgcmV0dXJuIHt9O1xuICAgICAgICB9XG5cbiAgICAgICAgZmFsbGJhY2sgPSB0cnVlO1xuICAgICAgfVxuXG4gICAgICByZXR1cm4gdGhpcy5fc2VsZWN0b3JbcGF0aF07XG4gICAgfSxcbiAgICB4ID0+IHgpO1xuXG4gIGlmIChmYWxsYmFjaykge1xuICAgIHRoaXMuX21hdGNoaW5nRG9jdW1lbnQgPSBudWxsO1xuICB9XG5cbiAgcmV0dXJuIHRoaXMuX21hdGNoaW5nRG9jdW1lbnQ7XG59O1xuXG4vLyBNaW5pbW9uZ28uU29ydGVyIGdldHMgYSBzaW1pbGFyIG1ldGhvZCwgd2hpY2ggZGVsZWdhdGVzIHRvIGEgTWF0Y2hlciBpdCBtYWRlXG4vLyBmb3IgdGhpcyBleGFjdCBwdXJwb3NlLlxuTWluaW1vbmdvLlNvcnRlci5wcm90b3R5cGUuYWZmZWN0ZWRCeU1vZGlmaWVyID0gZnVuY3Rpb24obW9kaWZpZXIpIHtcbiAgcmV0dXJuIHRoaXMuX3NlbGVjdG9yRm9yQWZmZWN0ZWRCeU1vZGlmaWVyLmFmZmVjdGVkQnlNb2RpZmllcihtb2RpZmllcik7XG59O1xuXG5NaW5pbW9uZ28uU29ydGVyLnByb3RvdHlwZS5jb21iaW5lSW50b1Byb2plY3Rpb24gPSBmdW5jdGlvbihwcm9qZWN0aW9uKSB7XG4gIHJldHVybiBjb21iaW5lSW1wb3J0YW50UGF0aHNJbnRvUHJvamVjdGlvbihcbiAgICBNaW5pbW9uZ28uX3BhdGhzRWxpZGluZ051bWVyaWNLZXlzKHRoaXMuX2dldFBhdGhzKCkpLFxuICAgIHByb2plY3Rpb25cbiAgKTtcbn07XG5cbmZ1bmN0aW9uIGNvbWJpbmVJbXBvcnRhbnRQYXRoc0ludG9Qcm9qZWN0aW9uKHBhdGhzLCBwcm9qZWN0aW9uKSB7XG4gIGNvbnN0IGRldGFpbHMgPSBwcm9qZWN0aW9uRGV0YWlscyhwcm9qZWN0aW9uKTtcblxuICAvLyBtZXJnZSB0aGUgcGF0aHMgdG8gaW5jbHVkZVxuICBjb25zdCB0cmVlID0gcGF0aHNUb1RyZWUoXG4gICAgcGF0aHMsXG4gICAgcGF0aCA9PiB0cnVlLFxuICAgIChub2RlLCBwYXRoLCBmdWxsUGF0aCkgPT4gdHJ1ZSxcbiAgICBkZXRhaWxzLnRyZWVcbiAgKTtcbiAgY29uc3QgbWVyZ2VkUHJvamVjdGlvbiA9IHRyZWVUb1BhdGhzKHRyZWUpO1xuXG4gIGlmIChkZXRhaWxzLmluY2x1ZGluZykge1xuICAgIC8vIGJvdGggc2VsZWN0b3IgYW5kIHByb2plY3Rpb24gYXJlIHBvaW50aW5nIG9uIGZpZWxkcyB0byBpbmNsdWRlXG4gICAgLy8gc28gd2UgY2FuIGp1c3QgcmV0dXJuIHRoZSBtZXJnZWQgdHJlZVxuICAgIHJldHVybiBtZXJnZWRQcm9qZWN0aW9uO1xuICB9XG5cbiAgLy8gc2VsZWN0b3IgaXMgcG9pbnRpbmcgYXQgZmllbGRzIHRvIGluY2x1ZGVcbiAgLy8gcHJvamVjdGlvbiBpcyBwb2ludGluZyBhdCBmaWVsZHMgdG8gZXhjbHVkZVxuICAvLyBtYWtlIHN1cmUgd2UgZG9uJ3QgZXhjbHVkZSBpbXBvcnRhbnQgcGF0aHNcbiAgY29uc3QgbWVyZ2VkRXhjbFByb2plY3Rpb24gPSB7fTtcblxuICBPYmplY3Qua2V5cyhtZXJnZWRQcm9qZWN0aW9uKS5mb3JFYWNoKHBhdGggPT4ge1xuICAgIGlmICghbWVyZ2VkUHJvamVjdGlvbltwYXRoXSkge1xuICAgICAgbWVyZ2VkRXhjbFByb2plY3Rpb25bcGF0aF0gPSBmYWxzZTtcbiAgICB9XG4gIH0pO1xuXG4gIHJldHVybiBtZXJnZWRFeGNsUHJvamVjdGlvbjtcbn1cblxuZnVuY3Rpb24gZ2V0UGF0aHMoc2VsZWN0b3IpIHtcbiAgcmV0dXJuIE9iamVjdC5rZXlzKG5ldyBNaW5pbW9uZ28uTWF0Y2hlcihzZWxlY3RvcikuX3BhdGhzKTtcblxuICAvLyBYWFggcmVtb3ZlIGl0P1xuICAvLyByZXR1cm4gT2JqZWN0LmtleXMoc2VsZWN0b3IpLm1hcChrID0+IHtcbiAgLy8gICAvLyB3ZSBkb24ndCBrbm93IGhvdyB0byBoYW5kbGUgJHdoZXJlIGJlY2F1c2UgaXQgY2FuIGJlIGFueXRoaW5nXG4gIC8vICAgaWYgKGsgPT09ICckd2hlcmUnKSB7XG4gIC8vICAgICByZXR1cm4gJyc7IC8vIG1hdGNoZXMgZXZlcnl0aGluZ1xuICAvLyAgIH1cblxuICAvLyAgIC8vIHdlIGJyYW5jaCBmcm9tICRvci8kYW5kLyRub3Igb3BlcmF0b3JcbiAgLy8gICBpZiAoWyckb3InLCAnJGFuZCcsICckbm9yJ10uaW5jbHVkZXMoaykpIHtcbiAgLy8gICAgIHJldHVybiBzZWxlY3RvcltrXS5tYXAoZ2V0UGF0aHMpO1xuICAvLyAgIH1cblxuICAvLyAgIC8vIHRoZSB2YWx1ZSBpcyBhIGxpdGVyYWwgb3Igc29tZSBjb21wYXJpc29uIG9wZXJhdG9yXG4gIC8vICAgcmV0dXJuIGs7XG4gIC8vIH0pXG4gIC8vICAgLnJlZHVjZSgoYSwgYikgPT4gYS5jb25jYXQoYiksIFtdKVxuICAvLyAgIC5maWx0ZXIoKGEsIGIsIGMpID0+IGMuaW5kZXhPZihhKSA9PT0gYik7XG59XG5cbi8vIEEgaGVscGVyIHRvIGVuc3VyZSBvYmplY3QgaGFzIG9ubHkgY2VydGFpbiBrZXlzXG5mdW5jdGlvbiBvbmx5Q29udGFpbnNLZXlzKG9iaiwga2V5cykge1xuICByZXR1cm4gT2JqZWN0LmtleXMob2JqKS5ldmVyeShrID0+IGtleXMuaW5jbHVkZXMoaykpO1xufVxuXG5mdW5jdGlvbiBwYXRoSGFzTnVtZXJpY0tleXMocGF0aCkge1xuICByZXR1cm4gcGF0aC5zcGxpdCgnLicpLnNvbWUoaXNOdW1lcmljS2V5KTtcbn1cblxuLy8gUmV0dXJucyBhIHNldCBvZiBrZXkgcGF0aHMgc2ltaWxhciB0b1xuLy8geyAnZm9vLmJhcic6IDEsICdhLmIuYyc6IDEgfVxuZnVuY3Rpb24gdHJlZVRvUGF0aHModHJlZSwgcHJlZml4ID0gJycpIHtcbiAgY29uc3QgcmVzdWx0ID0ge307XG5cbiAgT2JqZWN0LmtleXModHJlZSkuZm9yRWFjaChrZXkgPT4ge1xuICAgIGNvbnN0IHZhbHVlID0gdHJlZVtrZXldO1xuICAgIGlmICh2YWx1ZSA9PT0gT2JqZWN0KHZhbHVlKSkge1xuICAgICAgT2JqZWN0LmFzc2lnbihyZXN1bHQsIHRyZWVUb1BhdGhzKHZhbHVlLCBgJHtwcmVmaXggKyBrZXl9LmApKTtcbiAgICB9IGVsc2Uge1xuICAgICAgcmVzdWx0W3ByZWZpeCArIGtleV0gPSB2YWx1ZTtcbiAgICB9XG4gIH0pO1xuXG4gIHJldHVybiByZXN1bHQ7XG59XG4iLCJpbXBvcnQgTG9jYWxDb2xsZWN0aW9uIGZyb20gJy4vbG9jYWxfY29sbGVjdGlvbi5qcyc7XG5cbmV4cG9ydCBjb25zdCBoYXNPd24gPSBPYmplY3QucHJvdG90eXBlLmhhc093blByb3BlcnR5O1xuXG4vLyBFYWNoIGVsZW1lbnQgc2VsZWN0b3IgY29udGFpbnM6XG4vLyAgLSBjb21waWxlRWxlbWVudFNlbGVjdG9yLCBhIGZ1bmN0aW9uIHdpdGggYXJnczpcbi8vICAgIC0gb3BlcmFuZCAtIHRoZSBcInJpZ2h0IGhhbmQgc2lkZVwiIG9mIHRoZSBvcGVyYXRvclxuLy8gICAgLSB2YWx1ZVNlbGVjdG9yIC0gdGhlIFwiY29udGV4dFwiIGZvciB0aGUgb3BlcmF0b3IgKHNvIHRoYXQgJHJlZ2V4IGNhbiBmaW5kXG4vLyAgICAgICRvcHRpb25zKVxuLy8gICAgLSBtYXRjaGVyIC0gdGhlIE1hdGNoZXIgdGhpcyBpcyBnb2luZyBpbnRvIChzbyB0aGF0ICRlbGVtTWF0Y2ggY2FuIGNvbXBpbGVcbi8vICAgICAgbW9yZSB0aGluZ3MpXG4vLyAgICByZXR1cm5pbmcgYSBmdW5jdGlvbiBtYXBwaW5nIGEgc2luZ2xlIHZhbHVlIHRvIGJvb2wuXG4vLyAgLSBkb250RXhwYW5kTGVhZkFycmF5cywgYSBib29sIHdoaWNoIHByZXZlbnRzIGV4cGFuZEFycmF5c0luQnJhbmNoZXMgZnJvbVxuLy8gICAgYmVpbmcgY2FsbGVkXG4vLyAgLSBkb250SW5jbHVkZUxlYWZBcnJheXMsIGEgYm9vbCB3aGljaCBjYXVzZXMgYW4gYXJndW1lbnQgdG8gYmUgcGFzc2VkIHRvXG4vLyAgICBleHBhbmRBcnJheXNJbkJyYW5jaGVzIGlmIGl0IGlzIGNhbGxlZFxuZXhwb3J0IGNvbnN0IEVMRU1FTlRfT1BFUkFUT1JTID0ge1xuICAkbHQ6IG1ha2VJbmVxdWFsaXR5KGNtcFZhbHVlID0+IGNtcFZhbHVlIDwgMCksXG4gICRndDogbWFrZUluZXF1YWxpdHkoY21wVmFsdWUgPT4gY21wVmFsdWUgPiAwKSxcbiAgJGx0ZTogbWFrZUluZXF1YWxpdHkoY21wVmFsdWUgPT4gY21wVmFsdWUgPD0gMCksXG4gICRndGU6IG1ha2VJbmVxdWFsaXR5KGNtcFZhbHVlID0+IGNtcFZhbHVlID49IDApLFxuICAkbW9kOiB7XG4gICAgY29tcGlsZUVsZW1lbnRTZWxlY3RvcihvcGVyYW5kKSB7XG4gICAgICBpZiAoIShBcnJheS5pc0FycmF5KG9wZXJhbmQpICYmIG9wZXJhbmQubGVuZ3RoID09PSAyXG4gICAgICAgICAgICAmJiB0eXBlb2Ygb3BlcmFuZFswXSA9PT0gJ251bWJlcidcbiAgICAgICAgICAgICYmIHR5cGVvZiBvcGVyYW5kWzFdID09PSAnbnVtYmVyJykpIHtcbiAgICAgICAgdGhyb3cgRXJyb3IoJ2FyZ3VtZW50IHRvICRtb2QgbXVzdCBiZSBhbiBhcnJheSBvZiB0d28gbnVtYmVycycpO1xuICAgICAgfVxuXG4gICAgICAvLyBYWFggY291bGQgcmVxdWlyZSB0byBiZSBpbnRzIG9yIHJvdW5kIG9yIHNvbWV0aGluZ1xuICAgICAgY29uc3QgZGl2aXNvciA9IG9wZXJhbmRbMF07XG4gICAgICBjb25zdCByZW1haW5kZXIgPSBvcGVyYW5kWzFdO1xuICAgICAgcmV0dXJuIHZhbHVlID0+IChcbiAgICAgICAgdHlwZW9mIHZhbHVlID09PSAnbnVtYmVyJyAmJiB2YWx1ZSAlIGRpdmlzb3IgPT09IHJlbWFpbmRlclxuICAgICAgKTtcbiAgICB9LFxuICB9LFxuICAkaW46IHtcbiAgICBjb21waWxlRWxlbWVudFNlbGVjdG9yKG9wZXJhbmQpIHtcbiAgICAgIGlmICghQXJyYXkuaXNBcnJheShvcGVyYW5kKSkge1xuICAgICAgICB0aHJvdyBFcnJvcignJGluIG5lZWRzIGFuIGFycmF5Jyk7XG4gICAgICB9XG5cbiAgICAgIGNvbnN0IGVsZW1lbnRNYXRjaGVycyA9IG9wZXJhbmQubWFwKG9wdGlvbiA9PiB7XG4gICAgICAgIGlmIChvcHRpb24gaW5zdGFuY2VvZiBSZWdFeHApIHtcbiAgICAgICAgICByZXR1cm4gcmVnZXhwRWxlbWVudE1hdGNoZXIob3B0aW9uKTtcbiAgICAgICAgfVxuXG4gICAgICAgIGlmIChpc09wZXJhdG9yT2JqZWN0KG9wdGlvbikpIHtcbiAgICAgICAgICB0aHJvdyBFcnJvcignY2Fubm90IG5lc3QgJCB1bmRlciAkaW4nKTtcbiAgICAgICAgfVxuXG4gICAgICAgIHJldHVybiBlcXVhbGl0eUVsZW1lbnRNYXRjaGVyKG9wdGlvbik7XG4gICAgICB9KTtcblxuICAgICAgcmV0dXJuIHZhbHVlID0+IHtcbiAgICAgICAgLy8gQWxsb3cge2E6IHskaW46IFtudWxsXX19IHRvIG1hdGNoIHdoZW4gJ2EnIGRvZXMgbm90IGV4aXN0LlxuICAgICAgICBpZiAodmFsdWUgPT09IHVuZGVmaW5lZCkge1xuICAgICAgICAgIHZhbHVlID0gbnVsbDtcbiAgICAgICAgfVxuXG4gICAgICAgIHJldHVybiBlbGVtZW50TWF0Y2hlcnMuc29tZShtYXRjaGVyID0+IG1hdGNoZXIodmFsdWUpKTtcbiAgICAgIH07XG4gICAgfSxcbiAgfSxcbiAgJHNpemU6IHtcbiAgICAvLyB7YTogW1s1LCA1XV19IG11c3QgbWF0Y2gge2E6IHskc2l6ZTogMX19IGJ1dCBub3Qge2E6IHskc2l6ZTogMn19LCBzbyB3ZVxuICAgIC8vIGRvbid0IHdhbnQgdG8gY29uc2lkZXIgdGhlIGVsZW1lbnQgWzUsNV0gaW4gdGhlIGxlYWYgYXJyYXkgW1s1LDVdXSBhcyBhXG4gICAgLy8gcG9zc2libGUgdmFsdWUuXG4gICAgZG9udEV4cGFuZExlYWZBcnJheXM6IHRydWUsXG4gICAgY29tcGlsZUVsZW1lbnRTZWxlY3RvcihvcGVyYW5kKSB7XG4gICAgICBpZiAodHlwZW9mIG9wZXJhbmQgPT09ICdzdHJpbmcnKSB7XG4gICAgICAgIC8vIERvbid0IGFzayBtZSB3aHksIGJ1dCBieSBleHBlcmltZW50YXRpb24sIHRoaXMgc2VlbXMgdG8gYmUgd2hhdCBNb25nb1xuICAgICAgICAvLyBkb2VzLlxuICAgICAgICBvcGVyYW5kID0gMDtcbiAgICAgIH0gZWxzZSBpZiAodHlwZW9mIG9wZXJhbmQgIT09ICdudW1iZXInKSB7XG4gICAgICAgIHRocm93IEVycm9yKCckc2l6ZSBuZWVkcyBhIG51bWJlcicpO1xuICAgICAgfVxuXG4gICAgICByZXR1cm4gdmFsdWUgPT4gQXJyYXkuaXNBcnJheSh2YWx1ZSkgJiYgdmFsdWUubGVuZ3RoID09PSBvcGVyYW5kO1xuICAgIH0sXG4gIH0sXG4gICR0eXBlOiB7XG4gICAgLy8ge2E6IFs1XX0gbXVzdCBub3QgbWF0Y2gge2E6IHskdHlwZTogNH19ICg0IG1lYW5zIGFycmF5KSwgYnV0IGl0IHNob3VsZFxuICAgIC8vIG1hdGNoIHthOiB7JHR5cGU6IDF9fSAoMSBtZWFucyBudW1iZXIpLCBhbmQge2E6IFtbNV1dfSBtdXN0IG1hdGNoIHskYTpcbiAgICAvLyB7JHR5cGU6IDR9fS4gVGh1cywgd2hlbiB3ZSBzZWUgYSBsZWFmIGFycmF5LCB3ZSAqc2hvdWxkKiBleHBhbmQgaXQgYnV0XG4gICAgLy8gc2hvdWxkICpub3QqIGluY2x1ZGUgaXQgaXRzZWxmLlxuICAgIGRvbnRJbmNsdWRlTGVhZkFycmF5czogdHJ1ZSxcbiAgICBjb21waWxlRWxlbWVudFNlbGVjdG9yKG9wZXJhbmQpIHtcbiAgICAgIGlmICh0eXBlb2Ygb3BlcmFuZCA9PT0gJ3N0cmluZycpIHtcbiAgICAgICAgY29uc3Qgb3BlcmFuZEFsaWFzTWFwID0ge1xuICAgICAgICAgICdkb3VibGUnOiAxLFxuICAgICAgICAgICdzdHJpbmcnOiAyLFxuICAgICAgICAgICdvYmplY3QnOiAzLFxuICAgICAgICAgICdhcnJheSc6IDQsXG4gICAgICAgICAgJ2JpbkRhdGEnOiA1LFxuICAgICAgICAgICd1bmRlZmluZWQnOiA2LFxuICAgICAgICAgICdvYmplY3RJZCc6IDcsXG4gICAgICAgICAgJ2Jvb2wnOiA4LFxuICAgICAgICAgICdkYXRlJzogOSxcbiAgICAgICAgICAnbnVsbCc6IDEwLFxuICAgICAgICAgICdyZWdleCc6IDExLFxuICAgICAgICAgICdkYlBvaW50ZXInOiAxMixcbiAgICAgICAgICAnamF2YXNjcmlwdCc6IDEzLFxuICAgICAgICAgICdzeW1ib2wnOiAxNCxcbiAgICAgICAgICAnamF2YXNjcmlwdFdpdGhTY29wZSc6IDE1LFxuICAgICAgICAgICdpbnQnOiAxNixcbiAgICAgICAgICAndGltZXN0YW1wJzogMTcsXG4gICAgICAgICAgJ2xvbmcnOiAxOCxcbiAgICAgICAgICAnZGVjaW1hbCc6IDE5LFxuICAgICAgICAgICdtaW5LZXknOiAtMSxcbiAgICAgICAgICAnbWF4S2V5JzogMTI3LFxuICAgICAgICB9O1xuICAgICAgICBpZiAoIWhhc093bi5jYWxsKG9wZXJhbmRBbGlhc01hcCwgb3BlcmFuZCkpIHtcbiAgICAgICAgICB0aHJvdyBFcnJvcihgdW5rbm93biBzdHJpbmcgYWxpYXMgZm9yICR0eXBlOiAke29wZXJhbmR9YCk7XG4gICAgICAgIH1cbiAgICAgICAgb3BlcmFuZCA9IG9wZXJhbmRBbGlhc01hcFtvcGVyYW5kXTtcbiAgICAgIH0gZWxzZSBpZiAodHlwZW9mIG9wZXJhbmQgPT09ICdudW1iZXInKSB7XG4gICAgICAgIGlmIChvcGVyYW5kID09PSAwIHx8IG9wZXJhbmQgPCAtMVxuICAgICAgICAgIHx8IChvcGVyYW5kID4gMTkgJiYgb3BlcmFuZCAhPT0gMTI3KSkge1xuICAgICAgICAgIHRocm93IEVycm9yKGBJbnZhbGlkIG51bWVyaWNhbCAkdHlwZSBjb2RlOiAke29wZXJhbmR9YCk7XG4gICAgICAgIH1cbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIHRocm93IEVycm9yKCdhcmd1bWVudCB0byAkdHlwZSBpcyBub3QgYSBudW1iZXIgb3IgYSBzdHJpbmcnKTtcbiAgICAgIH1cblxuICAgICAgcmV0dXJuIHZhbHVlID0+IChcbiAgICAgICAgdmFsdWUgIT09IHVuZGVmaW5lZCAmJiBMb2NhbENvbGxlY3Rpb24uX2YuX3R5cGUodmFsdWUpID09PSBvcGVyYW5kXG4gICAgICApO1xuICAgIH0sXG4gIH0sXG4gICRiaXRzQWxsU2V0OiB7XG4gICAgY29tcGlsZUVsZW1lbnRTZWxlY3RvcihvcGVyYW5kKSB7XG4gICAgICBjb25zdCBtYXNrID0gZ2V0T3BlcmFuZEJpdG1hc2sob3BlcmFuZCwgJyRiaXRzQWxsU2V0Jyk7XG4gICAgICByZXR1cm4gdmFsdWUgPT4ge1xuICAgICAgICBjb25zdCBiaXRtYXNrID0gZ2V0VmFsdWVCaXRtYXNrKHZhbHVlLCBtYXNrLmxlbmd0aCk7XG4gICAgICAgIHJldHVybiBiaXRtYXNrICYmIG1hc2suZXZlcnkoKGJ5dGUsIGkpID0+IChiaXRtYXNrW2ldICYgYnl0ZSkgPT09IGJ5dGUpO1xuICAgICAgfTtcbiAgICB9LFxuICB9LFxuICAkYml0c0FueVNldDoge1xuICAgIGNvbXBpbGVFbGVtZW50U2VsZWN0b3Iob3BlcmFuZCkge1xuICAgICAgY29uc3QgbWFzayA9IGdldE9wZXJhbmRCaXRtYXNrKG9wZXJhbmQsICckYml0c0FueVNldCcpO1xuICAgICAgcmV0dXJuIHZhbHVlID0+IHtcbiAgICAgICAgY29uc3QgYml0bWFzayA9IGdldFZhbHVlQml0bWFzayh2YWx1ZSwgbWFzay5sZW5ndGgpO1xuICAgICAgICByZXR1cm4gYml0bWFzayAmJiBtYXNrLnNvbWUoKGJ5dGUsIGkpID0+ICh+Yml0bWFza1tpXSAmIGJ5dGUpICE9PSBieXRlKTtcbiAgICAgIH07XG4gICAgfSxcbiAgfSxcbiAgJGJpdHNBbGxDbGVhcjoge1xuICAgIGNvbXBpbGVFbGVtZW50U2VsZWN0b3Iob3BlcmFuZCkge1xuICAgICAgY29uc3QgbWFzayA9IGdldE9wZXJhbmRCaXRtYXNrKG9wZXJhbmQsICckYml0c0FsbENsZWFyJyk7XG4gICAgICByZXR1cm4gdmFsdWUgPT4ge1xuICAgICAgICBjb25zdCBiaXRtYXNrID0gZ2V0VmFsdWVCaXRtYXNrKHZhbHVlLCBtYXNrLmxlbmd0aCk7XG4gICAgICAgIHJldHVybiBiaXRtYXNrICYmIG1hc2suZXZlcnkoKGJ5dGUsIGkpID0+ICEoYml0bWFza1tpXSAmIGJ5dGUpKTtcbiAgICAgIH07XG4gICAgfSxcbiAgfSxcbiAgJGJpdHNBbnlDbGVhcjoge1xuICAgIGNvbXBpbGVFbGVtZW50U2VsZWN0b3Iob3BlcmFuZCkge1xuICAgICAgY29uc3QgbWFzayA9IGdldE9wZXJhbmRCaXRtYXNrKG9wZXJhbmQsICckYml0c0FueUNsZWFyJyk7XG4gICAgICByZXR1cm4gdmFsdWUgPT4ge1xuICAgICAgICBjb25zdCBiaXRtYXNrID0gZ2V0VmFsdWVCaXRtYXNrKHZhbHVlLCBtYXNrLmxlbmd0aCk7XG4gICAgICAgIHJldHVybiBiaXRtYXNrICYmIG1hc2suc29tZSgoYnl0ZSwgaSkgPT4gKGJpdG1hc2tbaV0gJiBieXRlKSAhPT0gYnl0ZSk7XG4gICAgICB9O1xuICAgIH0sXG4gIH0sXG4gICRyZWdleDoge1xuICAgIGNvbXBpbGVFbGVtZW50U2VsZWN0b3Iob3BlcmFuZCwgdmFsdWVTZWxlY3Rvcikge1xuICAgICAgaWYgKCEodHlwZW9mIG9wZXJhbmQgPT09ICdzdHJpbmcnIHx8IG9wZXJhbmQgaW5zdGFuY2VvZiBSZWdFeHApKSB7XG4gICAgICAgIHRocm93IEVycm9yKCckcmVnZXggaGFzIHRvIGJlIGEgc3RyaW5nIG9yIFJlZ0V4cCcpO1xuICAgICAgfVxuXG4gICAgICBsZXQgcmVnZXhwO1xuICAgICAgaWYgKHZhbHVlU2VsZWN0b3IuJG9wdGlvbnMgIT09IHVuZGVmaW5lZCkge1xuICAgICAgICAvLyBPcHRpb25zIHBhc3NlZCBpbiAkb3B0aW9ucyAoZXZlbiB0aGUgZW1wdHkgc3RyaW5nKSBhbHdheXMgb3ZlcnJpZGVzXG4gICAgICAgIC8vIG9wdGlvbnMgaW4gdGhlIFJlZ0V4cCBvYmplY3QgaXRzZWxmLlxuXG4gICAgICAgIC8vIEJlIGNsZWFyIHRoYXQgd2Ugb25seSBzdXBwb3J0IHRoZSBKUy1zdXBwb3J0ZWQgb3B0aW9ucywgbm90IGV4dGVuZGVkXG4gICAgICAgIC8vIG9uZXMgKGVnLCBNb25nbyBzdXBwb3J0cyB4IGFuZCBzKS4gSWRlYWxseSB3ZSB3b3VsZCBpbXBsZW1lbnQgeCBhbmQgc1xuICAgICAgICAvLyBieSB0cmFuc2Zvcm1pbmcgdGhlIHJlZ2V4cCwgYnV0IG5vdCB0b2RheS4uLlxuICAgICAgICBpZiAoL1teZ2ltXS8udGVzdCh2YWx1ZVNlbGVjdG9yLiRvcHRpb25zKSkge1xuICAgICAgICAgIHRocm93IG5ldyBFcnJvcignT25seSB0aGUgaSwgbSwgYW5kIGcgcmVnZXhwIG9wdGlvbnMgYXJlIHN1cHBvcnRlZCcpO1xuICAgICAgICB9XG5cbiAgICAgICAgY29uc3Qgc291cmNlID0gb3BlcmFuZCBpbnN0YW5jZW9mIFJlZ0V4cCA/IG9wZXJhbmQuc291cmNlIDogb3BlcmFuZDtcbiAgICAgICAgcmVnZXhwID0gbmV3IFJlZ0V4cChzb3VyY2UsIHZhbHVlU2VsZWN0b3IuJG9wdGlvbnMpO1xuICAgICAgfSBlbHNlIGlmIChvcGVyYW5kIGluc3RhbmNlb2YgUmVnRXhwKSB7XG4gICAgICAgIHJlZ2V4cCA9IG9wZXJhbmQ7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICByZWdleHAgPSBuZXcgUmVnRXhwKG9wZXJhbmQpO1xuICAgICAgfVxuXG4gICAgICByZXR1cm4gcmVnZXhwRWxlbWVudE1hdGNoZXIocmVnZXhwKTtcbiAgICB9LFxuICB9LFxuICAkZWxlbU1hdGNoOiB7XG4gICAgZG9udEV4cGFuZExlYWZBcnJheXM6IHRydWUsXG4gICAgY29tcGlsZUVsZW1lbnRTZWxlY3RvcihvcGVyYW5kLCB2YWx1ZVNlbGVjdG9yLCBtYXRjaGVyKSB7XG4gICAgICBpZiAoIUxvY2FsQ29sbGVjdGlvbi5faXNQbGFpbk9iamVjdChvcGVyYW5kKSkge1xuICAgICAgICB0aHJvdyBFcnJvcignJGVsZW1NYXRjaCBuZWVkIGFuIG9iamVjdCcpO1xuICAgICAgfVxuXG4gICAgICBjb25zdCBpc0RvY01hdGNoZXIgPSAhaXNPcGVyYXRvck9iamVjdChcbiAgICAgICAgT2JqZWN0LmtleXMob3BlcmFuZClcbiAgICAgICAgICAuZmlsdGVyKGtleSA9PiAhaGFzT3duLmNhbGwoTE9HSUNBTF9PUEVSQVRPUlMsIGtleSkpXG4gICAgICAgICAgLnJlZHVjZSgoYSwgYikgPT4gT2JqZWN0LmFzc2lnbihhLCB7W2JdOiBvcGVyYW5kW2JdfSksIHt9KSxcbiAgICAgICAgdHJ1ZSk7XG5cbiAgICAgIGxldCBzdWJNYXRjaGVyO1xuICAgICAgaWYgKGlzRG9jTWF0Y2hlcikge1xuICAgICAgICAvLyBUaGlzIGlzIE5PVCB0aGUgc2FtZSBhcyBjb21waWxlVmFsdWVTZWxlY3RvcihvcGVyYW5kKSwgYW5kIG5vdCBqdXN0XG4gICAgICAgIC8vIGJlY2F1c2Ugb2YgdGhlIHNsaWdodGx5IGRpZmZlcmVudCBjYWxsaW5nIGNvbnZlbnRpb24uXG4gICAgICAgIC8vIHskZWxlbU1hdGNoOiB7eDogM319IG1lYW5zIFwiYW4gZWxlbWVudCBoYXMgYSBmaWVsZCB4OjNcIiwgbm90XG4gICAgICAgIC8vIFwiY29uc2lzdHMgb25seSBvZiBhIGZpZWxkIHg6M1wiLiBBbHNvLCByZWdleHBzIGFuZCBzdWItJCBhcmUgYWxsb3dlZC5cbiAgICAgICAgc3ViTWF0Y2hlciA9XG4gICAgICAgICAgY29tcGlsZURvY3VtZW50U2VsZWN0b3Iob3BlcmFuZCwgbWF0Y2hlciwge2luRWxlbU1hdGNoOiB0cnVlfSk7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICBzdWJNYXRjaGVyID0gY29tcGlsZVZhbHVlU2VsZWN0b3Iob3BlcmFuZCwgbWF0Y2hlcik7XG4gICAgICB9XG5cbiAgICAgIHJldHVybiB2YWx1ZSA9PiB7XG4gICAgICAgIGlmICghQXJyYXkuaXNBcnJheSh2YWx1ZSkpIHtcbiAgICAgICAgICByZXR1cm4gZmFsc2U7XG4gICAgICAgIH1cblxuICAgICAgICBmb3IgKGxldCBpID0gMDsgaSA8IHZhbHVlLmxlbmd0aDsgKytpKSB7XG4gICAgICAgICAgY29uc3QgYXJyYXlFbGVtZW50ID0gdmFsdWVbaV07XG4gICAgICAgICAgbGV0IGFyZztcbiAgICAgICAgICBpZiAoaXNEb2NNYXRjaGVyKSB7XG4gICAgICAgICAgICAvLyBXZSBjYW4gb25seSBtYXRjaCB7JGVsZW1NYXRjaDoge2I6IDN9fSBhZ2FpbnN0IG9iamVjdHMuXG4gICAgICAgICAgICAvLyAoV2UgY2FuIGFsc28gbWF0Y2ggYWdhaW5zdCBhcnJheXMsIGlmIHRoZXJlJ3MgbnVtZXJpYyBpbmRpY2VzLFxuICAgICAgICAgICAgLy8gZWcgeyRlbGVtTWF0Y2g6IHsnMC5iJzogM319IG9yIHskZWxlbU1hdGNoOiB7MDogM319LilcbiAgICAgICAgICAgIGlmICghaXNJbmRleGFibGUoYXJyYXlFbGVtZW50KSkge1xuICAgICAgICAgICAgICByZXR1cm4gZmFsc2U7XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIGFyZyA9IGFycmF5RWxlbWVudDtcbiAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgLy8gZG9udEl0ZXJhdGUgZW5zdXJlcyB0aGF0IHthOiB7JGVsZW1NYXRjaDogeyRndDogNX19fSBtYXRjaGVzXG4gICAgICAgICAgICAvLyB7YTogWzhdfSBidXQgbm90IHthOiBbWzhdXX1cbiAgICAgICAgICAgIGFyZyA9IFt7dmFsdWU6IGFycmF5RWxlbWVudCwgZG9udEl0ZXJhdGU6IHRydWV9XTtcbiAgICAgICAgICB9XG4gICAgICAgICAgLy8gWFhYIHN1cHBvcnQgJG5lYXIgaW4gJGVsZW1NYXRjaCBieSBwcm9wYWdhdGluZyAkZGlzdGFuY2U/XG4gICAgICAgICAgaWYgKHN1Yk1hdGNoZXIoYXJnKS5yZXN1bHQpIHtcbiAgICAgICAgICAgIHJldHVybiBpOyAvLyBzcGVjaWFsbHkgdW5kZXJzdG9vZCB0byBtZWFuIFwidXNlIGFzIGFycmF5SW5kaWNlc1wiXG4gICAgICAgICAgfVxuICAgICAgICB9XG5cbiAgICAgICAgcmV0dXJuIGZhbHNlO1xuICAgICAgfTtcbiAgICB9LFxuICB9LFxufTtcblxuLy8gT3BlcmF0b3JzIHRoYXQgYXBwZWFyIGF0IHRoZSB0b3AgbGV2ZWwgb2YgYSBkb2N1bWVudCBzZWxlY3Rvci5cbmNvbnN0IExPR0lDQUxfT1BFUkFUT1JTID0ge1xuICAkYW5kKHN1YlNlbGVjdG9yLCBtYXRjaGVyLCBpbkVsZW1NYXRjaCkge1xuICAgIHJldHVybiBhbmREb2N1bWVudE1hdGNoZXJzKFxuICAgICAgY29tcGlsZUFycmF5T2ZEb2N1bWVudFNlbGVjdG9ycyhzdWJTZWxlY3RvciwgbWF0Y2hlciwgaW5FbGVtTWF0Y2gpXG4gICAgKTtcbiAgfSxcblxuICAkb3Ioc3ViU2VsZWN0b3IsIG1hdGNoZXIsIGluRWxlbU1hdGNoKSB7XG4gICAgY29uc3QgbWF0Y2hlcnMgPSBjb21waWxlQXJyYXlPZkRvY3VtZW50U2VsZWN0b3JzKFxuICAgICAgc3ViU2VsZWN0b3IsXG4gICAgICBtYXRjaGVyLFxuICAgICAgaW5FbGVtTWF0Y2hcbiAgICApO1xuXG4gICAgLy8gU3BlY2lhbCBjYXNlOiBpZiB0aGVyZSBpcyBvbmx5IG9uZSBtYXRjaGVyLCB1c2UgaXQgZGlyZWN0bHksICpwcmVzZXJ2aW5nKlxuICAgIC8vIGFueSBhcnJheUluZGljZXMgaXQgcmV0dXJucy5cbiAgICBpZiAobWF0Y2hlcnMubGVuZ3RoID09PSAxKSB7XG4gICAgICByZXR1cm4gbWF0Y2hlcnNbMF07XG4gICAgfVxuXG4gICAgcmV0dXJuIGRvYyA9PiB7XG4gICAgICBjb25zdCByZXN1bHQgPSBtYXRjaGVycy5zb21lKGZuID0+IGZuKGRvYykucmVzdWx0KTtcbiAgICAgIC8vICRvciBkb2VzIE5PVCBzZXQgYXJyYXlJbmRpY2VzIHdoZW4gaXQgaGFzIG11bHRpcGxlXG4gICAgICAvLyBzdWItZXhwcmVzc2lvbnMuIChUZXN0ZWQgYWdhaW5zdCBNb25nb0RCLilcbiAgICAgIHJldHVybiB7cmVzdWx0fTtcbiAgICB9O1xuICB9LFxuXG4gICRub3Ioc3ViU2VsZWN0b3IsIG1hdGNoZXIsIGluRWxlbU1hdGNoKSB7XG4gICAgY29uc3QgbWF0Y2hlcnMgPSBjb21waWxlQXJyYXlPZkRvY3VtZW50U2VsZWN0b3JzKFxuICAgICAgc3ViU2VsZWN0b3IsXG4gICAgICBtYXRjaGVyLFxuICAgICAgaW5FbGVtTWF0Y2hcbiAgICApO1xuICAgIHJldHVybiBkb2MgPT4ge1xuICAgICAgY29uc3QgcmVzdWx0ID0gbWF0Y2hlcnMuZXZlcnkoZm4gPT4gIWZuKGRvYykucmVzdWx0KTtcbiAgICAgIC8vIE5ldmVyIHNldCBhcnJheUluZGljZXMsIGJlY2F1c2Ugd2Ugb25seSBtYXRjaCBpZiBub3RoaW5nIGluIHBhcnRpY3VsYXJcbiAgICAgIC8vICdtYXRjaGVkJyAoYW5kIGJlY2F1c2UgdGhpcyBpcyBjb25zaXN0ZW50IHdpdGggTW9uZ29EQikuXG4gICAgICByZXR1cm4ge3Jlc3VsdH07XG4gICAgfTtcbiAgfSxcblxuICAkd2hlcmUoc2VsZWN0b3JWYWx1ZSwgbWF0Y2hlcikge1xuICAgIC8vIFJlY29yZCB0aGF0ICphbnkqIHBhdGggbWF5IGJlIHVzZWQuXG4gICAgbWF0Y2hlci5fcmVjb3JkUGF0aFVzZWQoJycpO1xuICAgIG1hdGNoZXIuX2hhc1doZXJlID0gdHJ1ZTtcblxuICAgIGlmICghKHNlbGVjdG9yVmFsdWUgaW5zdGFuY2VvZiBGdW5jdGlvbikpIHtcbiAgICAgIC8vIFhYWCBNb25nb0RCIHNlZW1zIHRvIGhhdmUgbW9yZSBjb21wbGV4IGxvZ2ljIHRvIGRlY2lkZSB3aGVyZSBvciBvciBub3RcbiAgICAgIC8vIHRvIGFkZCAncmV0dXJuJzsgbm90IHN1cmUgZXhhY3RseSB3aGF0IGl0IGlzLlxuICAgICAgc2VsZWN0b3JWYWx1ZSA9IEZ1bmN0aW9uKCdvYmonLCBgcmV0dXJuICR7c2VsZWN0b3JWYWx1ZX1gKTtcbiAgICB9XG5cbiAgICAvLyBXZSBtYWtlIHRoZSBkb2N1bWVudCBhdmFpbGFibGUgYXMgYm90aCBgdGhpc2AgYW5kIGBvYmpgLlxuICAgIC8vIC8vIFhYWCBub3Qgc3VyZSB3aGF0IHdlIHNob3VsZCBkbyBpZiB0aGlzIHRocm93c1xuICAgIHJldHVybiBkb2MgPT4gKHtyZXN1bHQ6IHNlbGVjdG9yVmFsdWUuY2FsbChkb2MsIGRvYyl9KTtcbiAgfSxcblxuICAvLyBUaGlzIGlzIGp1c3QgdXNlZCBhcyBhIGNvbW1lbnQgaW4gdGhlIHF1ZXJ5IChpbiBNb25nb0RCLCBpdCBhbHNvIGVuZHMgdXAgaW5cbiAgLy8gcXVlcnkgbG9ncyk7IGl0IGhhcyBubyBlZmZlY3Qgb24gdGhlIGFjdHVhbCBzZWxlY3Rpb24uXG4gICRjb21tZW50KCkge1xuICAgIHJldHVybiAoKSA9PiAoe3Jlc3VsdDogdHJ1ZX0pO1xuICB9LFxufTtcblxuLy8gT3BlcmF0b3JzIHRoYXQgKHVubGlrZSBMT0dJQ0FMX09QRVJBVE9SUykgcGVydGFpbiB0byBpbmRpdmlkdWFsIHBhdGhzIGluIGFcbi8vIGRvY3VtZW50LCBidXQgKHVubGlrZSBFTEVNRU5UX09QRVJBVE9SUykgZG8gbm90IGhhdmUgYSBzaW1wbGUgZGVmaW5pdGlvbiBhc1xuLy8gXCJtYXRjaCBlYWNoIGJyYW5jaGVkIHZhbHVlIGluZGVwZW5kZW50bHkgYW5kIGNvbWJpbmUgd2l0aFxuLy8gY29udmVydEVsZW1lbnRNYXRjaGVyVG9CcmFuY2hlZE1hdGNoZXJcIi5cbmNvbnN0IFZBTFVFX09QRVJBVE9SUyA9IHtcbiAgJGVxKG9wZXJhbmQpIHtcbiAgICByZXR1cm4gY29udmVydEVsZW1lbnRNYXRjaGVyVG9CcmFuY2hlZE1hdGNoZXIoXG4gICAgICBlcXVhbGl0eUVsZW1lbnRNYXRjaGVyKG9wZXJhbmQpXG4gICAgKTtcbiAgfSxcbiAgJG5vdChvcGVyYW5kLCB2YWx1ZVNlbGVjdG9yLCBtYXRjaGVyKSB7XG4gICAgcmV0dXJuIGludmVydEJyYW5jaGVkTWF0Y2hlcihjb21waWxlVmFsdWVTZWxlY3RvcihvcGVyYW5kLCBtYXRjaGVyKSk7XG4gIH0sXG4gICRuZShvcGVyYW5kKSB7XG4gICAgcmV0dXJuIGludmVydEJyYW5jaGVkTWF0Y2hlcihcbiAgICAgIGNvbnZlcnRFbGVtZW50TWF0Y2hlclRvQnJhbmNoZWRNYXRjaGVyKGVxdWFsaXR5RWxlbWVudE1hdGNoZXIob3BlcmFuZCkpXG4gICAgKTtcbiAgfSxcbiAgJG5pbihvcGVyYW5kKSB7XG4gICAgcmV0dXJuIGludmVydEJyYW5jaGVkTWF0Y2hlcihcbiAgICAgIGNvbnZlcnRFbGVtZW50TWF0Y2hlclRvQnJhbmNoZWRNYXRjaGVyKFxuICAgICAgICBFTEVNRU5UX09QRVJBVE9SUy4kaW4uY29tcGlsZUVsZW1lbnRTZWxlY3RvcihvcGVyYW5kKVxuICAgICAgKVxuICAgICk7XG4gIH0sXG4gICRleGlzdHMob3BlcmFuZCkge1xuICAgIGNvbnN0IGV4aXN0cyA9IGNvbnZlcnRFbGVtZW50TWF0Y2hlclRvQnJhbmNoZWRNYXRjaGVyKFxuICAgICAgdmFsdWUgPT4gdmFsdWUgIT09IHVuZGVmaW5lZFxuICAgICk7XG4gICAgcmV0dXJuIG9wZXJhbmQgPyBleGlzdHMgOiBpbnZlcnRCcmFuY2hlZE1hdGNoZXIoZXhpc3RzKTtcbiAgfSxcbiAgLy8gJG9wdGlvbnMganVzdCBwcm92aWRlcyBvcHRpb25zIGZvciAkcmVnZXg7IGl0cyBsb2dpYyBpcyBpbnNpZGUgJHJlZ2V4XG4gICRvcHRpb25zKG9wZXJhbmQsIHZhbHVlU2VsZWN0b3IpIHtcbiAgICBpZiAoIWhhc093bi5jYWxsKHZhbHVlU2VsZWN0b3IsICckcmVnZXgnKSkge1xuICAgICAgdGhyb3cgRXJyb3IoJyRvcHRpb25zIG5lZWRzIGEgJHJlZ2V4Jyk7XG4gICAgfVxuXG4gICAgcmV0dXJuIGV2ZXJ5dGhpbmdNYXRjaGVyO1xuICB9LFxuICAvLyAkbWF4RGlzdGFuY2UgaXMgYmFzaWNhbGx5IGFuIGFyZ3VtZW50IHRvICRuZWFyXG4gICRtYXhEaXN0YW5jZShvcGVyYW5kLCB2YWx1ZVNlbGVjdG9yKSB7XG4gICAgaWYgKCF2YWx1ZVNlbGVjdG9yLiRuZWFyKSB7XG4gICAgICB0aHJvdyBFcnJvcignJG1heERpc3RhbmNlIG5lZWRzIGEgJG5lYXInKTtcbiAgICB9XG5cbiAgICByZXR1cm4gZXZlcnl0aGluZ01hdGNoZXI7XG4gIH0sXG4gICRhbGwob3BlcmFuZCwgdmFsdWVTZWxlY3RvciwgbWF0Y2hlcikge1xuICAgIGlmICghQXJyYXkuaXNBcnJheShvcGVyYW5kKSkge1xuICAgICAgdGhyb3cgRXJyb3IoJyRhbGwgcmVxdWlyZXMgYXJyYXknKTtcbiAgICB9XG5cbiAgICAvLyBOb3Qgc3VyZSB3aHksIGJ1dCB0aGlzIHNlZW1zIHRvIGJlIHdoYXQgTW9uZ29EQiBkb2VzLlxuICAgIGlmIChvcGVyYW5kLmxlbmd0aCA9PT0gMCkge1xuICAgICAgcmV0dXJuIG5vdGhpbmdNYXRjaGVyO1xuICAgIH1cblxuICAgIGNvbnN0IGJyYW5jaGVkTWF0Y2hlcnMgPSBvcGVyYW5kLm1hcChjcml0ZXJpb24gPT4ge1xuICAgICAgLy8gWFhYIGhhbmRsZSAkYWxsLyRlbGVtTWF0Y2ggY29tYmluYXRpb25cbiAgICAgIGlmIChpc09wZXJhdG9yT2JqZWN0KGNyaXRlcmlvbikpIHtcbiAgICAgICAgdGhyb3cgRXJyb3IoJ25vICQgZXhwcmVzc2lvbnMgaW4gJGFsbCcpO1xuICAgICAgfVxuXG4gICAgICAvLyBUaGlzIGlzIGFsd2F5cyBhIHJlZ2V4cCBvciBlcXVhbGl0eSBzZWxlY3Rvci5cbiAgICAgIHJldHVybiBjb21waWxlVmFsdWVTZWxlY3Rvcihjcml0ZXJpb24sIG1hdGNoZXIpO1xuICAgIH0pO1xuXG4gICAgLy8gYW5kQnJhbmNoZWRNYXRjaGVycyBkb2VzIE5PVCByZXF1aXJlIGFsbCBzZWxlY3RvcnMgdG8gcmV0dXJuIHRydWUgb24gdGhlXG4gICAgLy8gU0FNRSBicmFuY2guXG4gICAgcmV0dXJuIGFuZEJyYW5jaGVkTWF0Y2hlcnMoYnJhbmNoZWRNYXRjaGVycyk7XG4gIH0sXG4gICRuZWFyKG9wZXJhbmQsIHZhbHVlU2VsZWN0b3IsIG1hdGNoZXIsIGlzUm9vdCkge1xuICAgIGlmICghaXNSb290KSB7XG4gICAgICB0aHJvdyBFcnJvcignJG5lYXIgY2FuXFwndCBiZSBpbnNpZGUgYW5vdGhlciAkIG9wZXJhdG9yJyk7XG4gICAgfVxuXG4gICAgbWF0Y2hlci5faGFzR2VvUXVlcnkgPSB0cnVlO1xuXG4gICAgLy8gVGhlcmUgYXJlIHR3byBraW5kcyBvZiBnZW9kYXRhIGluIE1vbmdvREI6IGxlZ2FjeSBjb29yZGluYXRlIHBhaXJzIGFuZFxuICAgIC8vIEdlb0pTT04uIFRoZXkgdXNlIGRpZmZlcmVudCBkaXN0YW5jZSBtZXRyaWNzLCB0b28uIEdlb0pTT04gcXVlcmllcyBhcmVcbiAgICAvLyBtYXJrZWQgd2l0aCBhICRnZW9tZXRyeSBwcm9wZXJ0eSwgdGhvdWdoIGxlZ2FjeSBjb29yZGluYXRlcyBjYW4gYmVcbiAgICAvLyBtYXRjaGVkIHVzaW5nICRnZW9tZXRyeS5cbiAgICBsZXQgbWF4RGlzdGFuY2UsIHBvaW50LCBkaXN0YW5jZTtcbiAgICBpZiAoTG9jYWxDb2xsZWN0aW9uLl9pc1BsYWluT2JqZWN0KG9wZXJhbmQpICYmIGhhc093bi5jYWxsKG9wZXJhbmQsICckZ2VvbWV0cnknKSkge1xuICAgICAgLy8gR2VvSlNPTiBcIjJkc3BoZXJlXCIgbW9kZS5cbiAgICAgIG1heERpc3RhbmNlID0gb3BlcmFuZC4kbWF4RGlzdGFuY2U7XG4gICAgICBwb2ludCA9IG9wZXJhbmQuJGdlb21ldHJ5O1xuICAgICAgZGlzdGFuY2UgPSB2YWx1ZSA9PiB7XG4gICAgICAgIC8vIFhYWDogZm9yIG5vdywgd2UgZG9uJ3QgY2FsY3VsYXRlIHRoZSBhY3R1YWwgZGlzdGFuY2UgYmV0d2Vlbiwgc2F5LFxuICAgICAgICAvLyBwb2x5Z29uIGFuZCBjaXJjbGUuIElmIHBlb3BsZSBjYXJlIGFib3V0IHRoaXMgdXNlLWNhc2UgaXQgd2lsbCBnZXRcbiAgICAgICAgLy8gYSBwcmlvcml0eS5cbiAgICAgICAgaWYgKCF2YWx1ZSkge1xuICAgICAgICAgIHJldHVybiBudWxsO1xuICAgICAgICB9XG5cbiAgICAgICAgaWYgKCF2YWx1ZS50eXBlKSB7XG4gICAgICAgICAgcmV0dXJuIEdlb0pTT04ucG9pbnREaXN0YW5jZShcbiAgICAgICAgICAgIHBvaW50LFxuICAgICAgICAgICAge3R5cGU6ICdQb2ludCcsIGNvb3JkaW5hdGVzOiBwb2ludFRvQXJyYXkodmFsdWUpfVxuICAgICAgICAgICk7XG4gICAgICAgIH1cblxuICAgICAgICBpZiAodmFsdWUudHlwZSA9PT0gJ1BvaW50Jykge1xuICAgICAgICAgIHJldHVybiBHZW9KU09OLnBvaW50RGlzdGFuY2UocG9pbnQsIHZhbHVlKTtcbiAgICAgICAgfVxuXG4gICAgICAgIHJldHVybiBHZW9KU09OLmdlb21ldHJ5V2l0aGluUmFkaXVzKHZhbHVlLCBwb2ludCwgbWF4RGlzdGFuY2UpXG4gICAgICAgICAgPyAwXG4gICAgICAgICAgOiBtYXhEaXN0YW5jZSArIDE7XG4gICAgICB9O1xuICAgIH0gZWxzZSB7XG4gICAgICBtYXhEaXN0YW5jZSA9IHZhbHVlU2VsZWN0b3IuJG1heERpc3RhbmNlO1xuXG4gICAgICBpZiAoIWlzSW5kZXhhYmxlKG9wZXJhbmQpKSB7XG4gICAgICAgIHRocm93IEVycm9yKCckbmVhciBhcmd1bWVudCBtdXN0IGJlIGNvb3JkaW5hdGUgcGFpciBvciBHZW9KU09OJyk7XG4gICAgICB9XG5cbiAgICAgIHBvaW50ID0gcG9pbnRUb0FycmF5KG9wZXJhbmQpO1xuXG4gICAgICBkaXN0YW5jZSA9IHZhbHVlID0+IHtcbiAgICAgICAgaWYgKCFpc0luZGV4YWJsZSh2YWx1ZSkpIHtcbiAgICAgICAgICByZXR1cm4gbnVsbDtcbiAgICAgICAgfVxuXG4gICAgICAgIHJldHVybiBkaXN0YW5jZUNvb3JkaW5hdGVQYWlycyhwb2ludCwgdmFsdWUpO1xuICAgICAgfTtcbiAgICB9XG5cbiAgICByZXR1cm4gYnJhbmNoZWRWYWx1ZXMgPT4ge1xuICAgICAgLy8gVGhlcmUgbWlnaHQgYmUgbXVsdGlwbGUgcG9pbnRzIGluIHRoZSBkb2N1bWVudCB0aGF0IG1hdGNoIHRoZSBnaXZlblxuICAgICAgLy8gZmllbGQuIE9ubHkgb25lIG9mIHRoZW0gbmVlZHMgdG8gYmUgd2l0aGluICRtYXhEaXN0YW5jZSwgYnV0IHdlIG5lZWQgdG9cbiAgICAgIC8vIGV2YWx1YXRlIGFsbCBvZiB0aGVtIGFuZCB1c2UgdGhlIG5lYXJlc3Qgb25lIGZvciB0aGUgaW1wbGljaXQgc29ydFxuICAgICAgLy8gc3BlY2lmaWVyLiAoVGhhdCdzIHdoeSB3ZSBjYW4ndCBqdXN0IHVzZSBFTEVNRU5UX09QRVJBVE9SUyBoZXJlLilcbiAgICAgIC8vXG4gICAgICAvLyBOb3RlOiBUaGlzIGRpZmZlcnMgZnJvbSBNb25nb0RCJ3MgaW1wbGVtZW50YXRpb24sIHdoZXJlIGEgZG9jdW1lbnQgd2lsbFxuICAgICAgLy8gYWN0dWFsbHkgc2hvdyB1cCAqbXVsdGlwbGUgdGltZXMqIGluIHRoZSByZXN1bHQgc2V0LCB3aXRoIG9uZSBlbnRyeSBmb3JcbiAgICAgIC8vIGVhY2ggd2l0aGluLSRtYXhEaXN0YW5jZSBicmFuY2hpbmcgcG9pbnQuXG4gICAgICBjb25zdCByZXN1bHQgPSB7cmVzdWx0OiBmYWxzZX07XG4gICAgICBleHBhbmRBcnJheXNJbkJyYW5jaGVzKGJyYW5jaGVkVmFsdWVzKS5ldmVyeShicmFuY2ggPT4ge1xuICAgICAgICAvLyBpZiBvcGVyYXRpb24gaXMgYW4gdXBkYXRlLCBkb24ndCBza2lwIGJyYW5jaGVzLCBqdXN0IHJldHVybiB0aGUgZmlyc3RcbiAgICAgICAgLy8gb25lICgjMzU5OSlcbiAgICAgICAgbGV0IGN1ckRpc3RhbmNlO1xuICAgICAgICBpZiAoIW1hdGNoZXIuX2lzVXBkYXRlKSB7XG4gICAgICAgICAgaWYgKCEodHlwZW9mIGJyYW5jaC52YWx1ZSA9PT0gJ29iamVjdCcpKSB7XG4gICAgICAgICAgICByZXR1cm4gdHJ1ZTtcbiAgICAgICAgICB9XG5cbiAgICAgICAgICBjdXJEaXN0YW5jZSA9IGRpc3RhbmNlKGJyYW5jaC52YWx1ZSk7XG5cbiAgICAgICAgICAvLyBTa2lwIGJyYW5jaGVzIHRoYXQgYXJlbid0IHJlYWwgcG9pbnRzIG9yIGFyZSB0b28gZmFyIGF3YXkuXG4gICAgICAgICAgaWYgKGN1ckRpc3RhbmNlID09PSBudWxsIHx8IGN1ckRpc3RhbmNlID4gbWF4RGlzdGFuY2UpIHtcbiAgICAgICAgICAgIHJldHVybiB0cnVlO1xuICAgICAgICAgIH1cblxuICAgICAgICAgIC8vIFNraXAgYW55dGhpbmcgdGhhdCdzIGEgdGllLlxuICAgICAgICAgIGlmIChyZXN1bHQuZGlzdGFuY2UgIT09IHVuZGVmaW5lZCAmJiByZXN1bHQuZGlzdGFuY2UgPD0gY3VyRGlzdGFuY2UpIHtcbiAgICAgICAgICAgIHJldHVybiB0cnVlO1xuICAgICAgICAgIH1cbiAgICAgICAgfVxuXG4gICAgICAgIHJlc3VsdC5yZXN1bHQgPSB0cnVlO1xuICAgICAgICByZXN1bHQuZGlzdGFuY2UgPSBjdXJEaXN0YW5jZTtcblxuICAgICAgICBpZiAoYnJhbmNoLmFycmF5SW5kaWNlcykge1xuICAgICAgICAgIHJlc3VsdC5hcnJheUluZGljZXMgPSBicmFuY2guYXJyYXlJbmRpY2VzO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIGRlbGV0ZSByZXN1bHQuYXJyYXlJbmRpY2VzO1xuICAgICAgICB9XG5cbiAgICAgICAgcmV0dXJuICFtYXRjaGVyLl9pc1VwZGF0ZTtcbiAgICAgIH0pO1xuXG4gICAgICByZXR1cm4gcmVzdWx0O1xuICAgIH07XG4gIH0sXG59O1xuXG4vLyBOQjogV2UgYXJlIGNoZWF0aW5nIGFuZCB1c2luZyB0aGlzIGZ1bmN0aW9uIHRvIGltcGxlbWVudCAnQU5EJyBmb3IgYm90aFxuLy8gJ2RvY3VtZW50IG1hdGNoZXJzJyBhbmQgJ2JyYW5jaGVkIG1hdGNoZXJzJy4gVGhleSBib3RoIHJldHVybiByZXN1bHQgb2JqZWN0c1xuLy8gYnV0IHRoZSBhcmd1bWVudCBpcyBkaWZmZXJlbnQ6IGZvciB0aGUgZm9ybWVyIGl0J3MgYSB3aG9sZSBkb2MsIHdoZXJlYXMgZm9yXG4vLyB0aGUgbGF0dGVyIGl0J3MgYW4gYXJyYXkgb2YgJ2JyYW5jaGVkIHZhbHVlcycuXG5mdW5jdGlvbiBhbmRTb21lTWF0Y2hlcnMoc3ViTWF0Y2hlcnMpIHtcbiAgaWYgKHN1Yk1hdGNoZXJzLmxlbmd0aCA9PT0gMCkge1xuICAgIHJldHVybiBldmVyeXRoaW5nTWF0Y2hlcjtcbiAgfVxuXG4gIGlmIChzdWJNYXRjaGVycy5sZW5ndGggPT09IDEpIHtcbiAgICByZXR1cm4gc3ViTWF0Y2hlcnNbMF07XG4gIH1cblxuICByZXR1cm4gZG9jT3JCcmFuY2hlcyA9PiB7XG4gICAgY29uc3QgbWF0Y2ggPSB7fTtcbiAgICBtYXRjaC5yZXN1bHQgPSBzdWJNYXRjaGVycy5ldmVyeShmbiA9PiB7XG4gICAgICBjb25zdCBzdWJSZXN1bHQgPSBmbihkb2NPckJyYW5jaGVzKTtcblxuICAgICAgLy8gQ29weSBhICdkaXN0YW5jZScgbnVtYmVyIG91dCBvZiB0aGUgZmlyc3Qgc3ViLW1hdGNoZXIgdGhhdCBoYXNcbiAgICAgIC8vIG9uZS4gWWVzLCB0aGlzIG1lYW5zIHRoYXQgaWYgdGhlcmUgYXJlIG11bHRpcGxlICRuZWFyIGZpZWxkcyBpbiBhXG4gICAgICAvLyBxdWVyeSwgc29tZXRoaW5nIGFyYml0cmFyeSBoYXBwZW5zOyB0aGlzIGFwcGVhcnMgdG8gYmUgY29uc2lzdGVudCB3aXRoXG4gICAgICAvLyBNb25nby5cbiAgICAgIGlmIChzdWJSZXN1bHQucmVzdWx0ICYmXG4gICAgICAgICAgc3ViUmVzdWx0LmRpc3RhbmNlICE9PSB1bmRlZmluZWQgJiZcbiAgICAgICAgICBtYXRjaC5kaXN0YW5jZSA9PT0gdW5kZWZpbmVkKSB7XG4gICAgICAgIG1hdGNoLmRpc3RhbmNlID0gc3ViUmVzdWx0LmRpc3RhbmNlO1xuICAgICAgfVxuXG4gICAgICAvLyBTaW1pbGFybHksIHByb3BhZ2F0ZSBhcnJheUluZGljZXMgZnJvbSBzdWItbWF0Y2hlcnMuLi4gYnV0IHRvIG1hdGNoXG4gICAgICAvLyBNb25nb0RCIGJlaGF2aW9yLCB0aGlzIHRpbWUgdGhlICpsYXN0KiBzdWItbWF0Y2hlciB3aXRoIGFycmF5SW5kaWNlc1xuICAgICAgLy8gd2lucy5cbiAgICAgIGlmIChzdWJSZXN1bHQucmVzdWx0ICYmIHN1YlJlc3VsdC5hcnJheUluZGljZXMpIHtcbiAgICAgICAgbWF0Y2guYXJyYXlJbmRpY2VzID0gc3ViUmVzdWx0LmFycmF5SW5kaWNlcztcbiAgICAgIH1cblxuICAgICAgcmV0dXJuIHN1YlJlc3VsdC5yZXN1bHQ7XG4gICAgfSk7XG5cbiAgICAvLyBJZiB3ZSBkaWRuJ3QgYWN0dWFsbHkgbWF0Y2gsIGZvcmdldCBhbnkgZXh0cmEgbWV0YWRhdGEgd2UgY2FtZSB1cCB3aXRoLlxuICAgIGlmICghbWF0Y2gucmVzdWx0KSB7XG4gICAgICBkZWxldGUgbWF0Y2guZGlzdGFuY2U7XG4gICAgICBkZWxldGUgbWF0Y2guYXJyYXlJbmRpY2VzO1xuICAgIH1cblxuICAgIHJldHVybiBtYXRjaDtcbiAgfTtcbn1cblxuY29uc3QgYW5kRG9jdW1lbnRNYXRjaGVycyA9IGFuZFNvbWVNYXRjaGVycztcbmNvbnN0IGFuZEJyYW5jaGVkTWF0Y2hlcnMgPSBhbmRTb21lTWF0Y2hlcnM7XG5cbmZ1bmN0aW9uIGNvbXBpbGVBcnJheU9mRG9jdW1lbnRTZWxlY3RvcnMoc2VsZWN0b3JzLCBtYXRjaGVyLCBpbkVsZW1NYXRjaCkge1xuICBpZiAoIUFycmF5LmlzQXJyYXkoc2VsZWN0b3JzKSB8fCBzZWxlY3RvcnMubGVuZ3RoID09PSAwKSB7XG4gICAgdGhyb3cgRXJyb3IoJyRhbmQvJG9yLyRub3IgbXVzdCBiZSBub25lbXB0eSBhcnJheScpO1xuICB9XG5cbiAgcmV0dXJuIHNlbGVjdG9ycy5tYXAoc3ViU2VsZWN0b3IgPT4ge1xuICAgIGlmICghTG9jYWxDb2xsZWN0aW9uLl9pc1BsYWluT2JqZWN0KHN1YlNlbGVjdG9yKSkge1xuICAgICAgdGhyb3cgRXJyb3IoJyRvci8kYW5kLyRub3IgZW50cmllcyBuZWVkIHRvIGJlIGZ1bGwgb2JqZWN0cycpO1xuICAgIH1cblxuICAgIHJldHVybiBjb21waWxlRG9jdW1lbnRTZWxlY3RvcihzdWJTZWxlY3RvciwgbWF0Y2hlciwge2luRWxlbU1hdGNofSk7XG4gIH0pO1xufVxuXG4vLyBUYWtlcyBpbiBhIHNlbGVjdG9yIHRoYXQgY291bGQgbWF0Y2ggYSBmdWxsIGRvY3VtZW50IChlZywgdGhlIG9yaWdpbmFsXG4vLyBzZWxlY3RvcikuIFJldHVybnMgYSBmdW5jdGlvbiBtYXBwaW5nIGRvY3VtZW50LT5yZXN1bHQgb2JqZWN0LlxuLy9cbi8vIG1hdGNoZXIgaXMgdGhlIE1hdGNoZXIgb2JqZWN0IHdlIGFyZSBjb21waWxpbmcuXG4vL1xuLy8gSWYgdGhpcyBpcyB0aGUgcm9vdCBkb2N1bWVudCBzZWxlY3RvciAoaWUsIG5vdCB3cmFwcGVkIGluICRhbmQgb3IgdGhlIGxpa2UpLFxuLy8gdGhlbiBpc1Jvb3QgaXMgdHJ1ZS4gKFRoaXMgaXMgdXNlZCBieSAkbmVhci4pXG5leHBvcnQgZnVuY3Rpb24gY29tcGlsZURvY3VtZW50U2VsZWN0b3IoZG9jU2VsZWN0b3IsIG1hdGNoZXIsIG9wdGlvbnMgPSB7fSkge1xuICBjb25zdCBkb2NNYXRjaGVycyA9IE9iamVjdC5rZXlzKGRvY1NlbGVjdG9yKS5tYXAoa2V5ID0+IHtcbiAgICBjb25zdCBzdWJTZWxlY3RvciA9IGRvY1NlbGVjdG9yW2tleV07XG5cbiAgICBpZiAoa2V5LnN1YnN0cigwLCAxKSA9PT0gJyQnKSB7XG4gICAgICAvLyBPdXRlciBvcGVyYXRvcnMgYXJlIGVpdGhlciBsb2dpY2FsIG9wZXJhdG9ycyAodGhleSByZWN1cnNlIGJhY2sgaW50b1xuICAgICAgLy8gdGhpcyBmdW5jdGlvbiksIG9yICR3aGVyZS5cbiAgICAgIGlmICghaGFzT3duLmNhbGwoTE9HSUNBTF9PUEVSQVRPUlMsIGtleSkpIHtcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBVbnJlY29nbml6ZWQgbG9naWNhbCBvcGVyYXRvcjogJHtrZXl9YCk7XG4gICAgICB9XG5cbiAgICAgIG1hdGNoZXIuX2lzU2ltcGxlID0gZmFsc2U7XG4gICAgICByZXR1cm4gTE9HSUNBTF9PUEVSQVRPUlNba2V5XShzdWJTZWxlY3RvciwgbWF0Y2hlciwgb3B0aW9ucy5pbkVsZW1NYXRjaCk7XG4gICAgfVxuXG4gICAgLy8gUmVjb3JkIHRoaXMgcGF0aCwgYnV0IG9ubHkgaWYgd2UgYXJlbid0IGluIGFuIGVsZW1NYXRjaGVyLCBzaW5jZSBpbiBhblxuICAgIC8vIGVsZW1NYXRjaCB0aGlzIGlzIGEgcGF0aCBpbnNpZGUgYW4gb2JqZWN0IGluIGFuIGFycmF5LCBub3QgaW4gdGhlIGRvY1xuICAgIC8vIHJvb3QuXG4gICAgaWYgKCFvcHRpb25zLmluRWxlbU1hdGNoKSB7XG4gICAgICBtYXRjaGVyLl9yZWNvcmRQYXRoVXNlZChrZXkpO1xuICAgIH1cblxuICAgIC8vIERvbid0IGFkZCBhIG1hdGNoZXIgaWYgc3ViU2VsZWN0b3IgaXMgYSBmdW5jdGlvbiAtLSB0aGlzIGlzIHRvIG1hdGNoXG4gICAgLy8gdGhlIGJlaGF2aW9yIG9mIE1ldGVvciBvbiB0aGUgc2VydmVyIChpbmhlcml0ZWQgZnJvbSB0aGUgbm9kZSBtb25nb2RiXG4gICAgLy8gZHJpdmVyKSwgd2hpY2ggaXMgdG8gaWdub3JlIGFueSBwYXJ0IG9mIGEgc2VsZWN0b3Igd2hpY2ggaXMgYSBmdW5jdGlvbi5cbiAgICBpZiAodHlwZW9mIHN1YlNlbGVjdG9yID09PSAnZnVuY3Rpb24nKSB7XG4gICAgICByZXR1cm4gdW5kZWZpbmVkO1xuICAgIH1cblxuICAgIGNvbnN0IGxvb2tVcEJ5SW5kZXggPSBtYWtlTG9va3VwRnVuY3Rpb24oa2V5KTtcbiAgICBjb25zdCB2YWx1ZU1hdGNoZXIgPSBjb21waWxlVmFsdWVTZWxlY3RvcihcbiAgICAgIHN1YlNlbGVjdG9yLFxuICAgICAgbWF0Y2hlcixcbiAgICAgIG9wdGlvbnMuaXNSb290XG4gICAgKTtcblxuICAgIHJldHVybiBkb2MgPT4gdmFsdWVNYXRjaGVyKGxvb2tVcEJ5SW5kZXgoZG9jKSk7XG4gIH0pLmZpbHRlcihCb29sZWFuKTtcblxuICByZXR1cm4gYW5kRG9jdW1lbnRNYXRjaGVycyhkb2NNYXRjaGVycyk7XG59XG5cbi8vIFRha2VzIGluIGEgc2VsZWN0b3IgdGhhdCBjb3VsZCBtYXRjaCBhIGtleS1pbmRleGVkIHZhbHVlIGluIGEgZG9jdW1lbnQ7IGVnLFxuLy8geyRndDogNSwgJGx0OiA5fSwgb3IgYSByZWd1bGFyIGV4cHJlc3Npb24sIG9yIGFueSBub24tZXhwcmVzc2lvbiBvYmplY3QgKHRvXG4vLyBpbmRpY2F0ZSBlcXVhbGl0eSkuICBSZXR1cm5zIGEgYnJhbmNoZWQgbWF0Y2hlcjogYSBmdW5jdGlvbiBtYXBwaW5nXG4vLyBbYnJhbmNoZWQgdmFsdWVdLT5yZXN1bHQgb2JqZWN0LlxuZnVuY3Rpb24gY29tcGlsZVZhbHVlU2VsZWN0b3IodmFsdWVTZWxlY3RvciwgbWF0Y2hlciwgaXNSb290KSB7XG4gIGlmICh2YWx1ZVNlbGVjdG9yIGluc3RhbmNlb2YgUmVnRXhwKSB7XG4gICAgbWF0Y2hlci5faXNTaW1wbGUgPSBmYWxzZTtcbiAgICByZXR1cm4gY29udmVydEVsZW1lbnRNYXRjaGVyVG9CcmFuY2hlZE1hdGNoZXIoXG4gICAgICByZWdleHBFbGVtZW50TWF0Y2hlcih2YWx1ZVNlbGVjdG9yKVxuICAgICk7XG4gIH1cblxuICBpZiAoaXNPcGVyYXRvck9iamVjdCh2YWx1ZVNlbGVjdG9yKSkge1xuICAgIHJldHVybiBvcGVyYXRvckJyYW5jaGVkTWF0Y2hlcih2YWx1ZVNlbGVjdG9yLCBtYXRjaGVyLCBpc1Jvb3QpO1xuICB9XG5cbiAgcmV0dXJuIGNvbnZlcnRFbGVtZW50TWF0Y2hlclRvQnJhbmNoZWRNYXRjaGVyKFxuICAgIGVxdWFsaXR5RWxlbWVudE1hdGNoZXIodmFsdWVTZWxlY3RvcilcbiAgKTtcbn1cblxuLy8gR2l2ZW4gYW4gZWxlbWVudCBtYXRjaGVyICh3aGljaCBldmFsdWF0ZXMgYSBzaW5nbGUgdmFsdWUpLCByZXR1cm5zIGEgYnJhbmNoZWRcbi8vIHZhbHVlICh3aGljaCBldmFsdWF0ZXMgdGhlIGVsZW1lbnQgbWF0Y2hlciBvbiBhbGwgdGhlIGJyYW5jaGVzIGFuZCByZXR1cm5zIGFcbi8vIG1vcmUgc3RydWN0dXJlZCByZXR1cm4gdmFsdWUgcG9zc2libHkgaW5jbHVkaW5nIGFycmF5SW5kaWNlcykuXG5mdW5jdGlvbiBjb252ZXJ0RWxlbWVudE1hdGNoZXJUb0JyYW5jaGVkTWF0Y2hlcihlbGVtZW50TWF0Y2hlciwgb3B0aW9ucyA9IHt9KSB7XG4gIHJldHVybiBicmFuY2hlcyA9PiB7XG4gICAgY29uc3QgZXhwYW5kZWQgPSBvcHRpb25zLmRvbnRFeHBhbmRMZWFmQXJyYXlzXG4gICAgICA/IGJyYW5jaGVzXG4gICAgICA6IGV4cGFuZEFycmF5c0luQnJhbmNoZXMoYnJhbmNoZXMsIG9wdGlvbnMuZG9udEluY2x1ZGVMZWFmQXJyYXlzKTtcblxuICAgIGNvbnN0IG1hdGNoID0ge307XG4gICAgbWF0Y2gucmVzdWx0ID0gZXhwYW5kZWQuc29tZShlbGVtZW50ID0+IHtcbiAgICAgIGxldCBtYXRjaGVkID0gZWxlbWVudE1hdGNoZXIoZWxlbWVudC52YWx1ZSk7XG5cbiAgICAgIC8vIFNwZWNpYWwgY2FzZSBmb3IgJGVsZW1NYXRjaDogaXQgbWVhbnMgXCJ0cnVlLCBhbmQgdXNlIHRoaXMgYXMgYW4gYXJyYXlcbiAgICAgIC8vIGluZGV4IGlmIEkgZGlkbid0IGFscmVhZHkgaGF2ZSBvbmVcIi5cbiAgICAgIGlmICh0eXBlb2YgbWF0Y2hlZCA9PT0gJ251bWJlcicpIHtcbiAgICAgICAgLy8gWFhYIFRoaXMgY29kZSBkYXRlcyBmcm9tIHdoZW4gd2Ugb25seSBzdG9yZWQgYSBzaW5nbGUgYXJyYXkgaW5kZXhcbiAgICAgICAgLy8gKGZvciB0aGUgb3V0ZXJtb3N0IGFycmF5KS4gU2hvdWxkIHdlIGJlIGFsc28gaW5jbHVkaW5nIGRlZXBlciBhcnJheVxuICAgICAgICAvLyBpbmRpY2VzIGZyb20gdGhlICRlbGVtTWF0Y2ggbWF0Y2g/XG4gICAgICAgIGlmICghZWxlbWVudC5hcnJheUluZGljZXMpIHtcbiAgICAgICAgICBlbGVtZW50LmFycmF5SW5kaWNlcyA9IFttYXRjaGVkXTtcbiAgICAgICAgfVxuXG4gICAgICAgIG1hdGNoZWQgPSB0cnVlO1xuICAgICAgfVxuXG4gICAgICAvLyBJZiBzb21lIGVsZW1lbnQgbWF0Y2hlZCwgYW5kIGl0J3MgdGFnZ2VkIHdpdGggYXJyYXkgaW5kaWNlcywgaW5jbHVkZVxuICAgICAgLy8gdGhvc2UgaW5kaWNlcyBpbiBvdXIgcmVzdWx0IG9iamVjdC5cbiAgICAgIGlmIChtYXRjaGVkICYmIGVsZW1lbnQuYXJyYXlJbmRpY2VzKSB7XG4gICAgICAgIG1hdGNoLmFycmF5SW5kaWNlcyA9IGVsZW1lbnQuYXJyYXlJbmRpY2VzO1xuICAgICAgfVxuXG4gICAgICByZXR1cm4gbWF0Y2hlZDtcbiAgICB9KTtcblxuICAgIHJldHVybiBtYXRjaDtcbiAgfTtcbn1cblxuLy8gSGVscGVycyBmb3IgJG5lYXIuXG5mdW5jdGlvbiBkaXN0YW5jZUNvb3JkaW5hdGVQYWlycyhhLCBiKSB7XG4gIGNvbnN0IHBvaW50QSA9IHBvaW50VG9BcnJheShhKTtcbiAgY29uc3QgcG9pbnRCID0gcG9pbnRUb0FycmF5KGIpO1xuXG4gIHJldHVybiBNYXRoLmh5cG90KHBvaW50QVswXSAtIHBvaW50QlswXSwgcG9pbnRBWzFdIC0gcG9pbnRCWzFdKTtcbn1cblxuLy8gVGFrZXMgc29tZXRoaW5nIHRoYXQgaXMgbm90IGFuIG9wZXJhdG9yIG9iamVjdCBhbmQgcmV0dXJucyBhbiBlbGVtZW50IG1hdGNoZXJcbi8vIGZvciBlcXVhbGl0eSB3aXRoIHRoYXQgdGhpbmcuXG5leHBvcnQgZnVuY3Rpb24gZXF1YWxpdHlFbGVtZW50TWF0Y2hlcihlbGVtZW50U2VsZWN0b3IpIHtcbiAgaWYgKGlzT3BlcmF0b3JPYmplY3QoZWxlbWVudFNlbGVjdG9yKSkge1xuICAgIHRocm93IEVycm9yKCdDYW5cXCd0IGNyZWF0ZSBlcXVhbGl0eVZhbHVlU2VsZWN0b3IgZm9yIG9wZXJhdG9yIG9iamVjdCcpO1xuICB9XG5cbiAgLy8gU3BlY2lhbC1jYXNlOiBudWxsIGFuZCB1bmRlZmluZWQgYXJlIGVxdWFsIChpZiB5b3UgZ290IHVuZGVmaW5lZCBpbiB0aGVyZVxuICAvLyBzb21ld2hlcmUsIG9yIGlmIHlvdSBnb3QgaXQgZHVlIHRvIHNvbWUgYnJhbmNoIGJlaW5nIG5vbi1leGlzdGVudCBpbiB0aGVcbiAgLy8gd2VpcmQgc3BlY2lhbCBjYXNlKSwgZXZlbiB0aG91Z2ggdGhleSBhcmVuJ3Qgd2l0aCBFSlNPTi5lcXVhbHMuXG4gIC8vIHVuZGVmaW5lZCBvciBudWxsXG4gIGlmIChlbGVtZW50U2VsZWN0b3IgPT0gbnVsbCkge1xuICAgIHJldHVybiB2YWx1ZSA9PiB2YWx1ZSA9PSBudWxsO1xuICB9XG5cbiAgcmV0dXJuIHZhbHVlID0+IExvY2FsQ29sbGVjdGlvbi5fZi5fZXF1YWwoZWxlbWVudFNlbGVjdG9yLCB2YWx1ZSk7XG59XG5cbmZ1bmN0aW9uIGV2ZXJ5dGhpbmdNYXRjaGVyKGRvY09yQnJhbmNoZWRWYWx1ZXMpIHtcbiAgcmV0dXJuIHtyZXN1bHQ6IHRydWV9O1xufVxuXG5leHBvcnQgZnVuY3Rpb24gZXhwYW5kQXJyYXlzSW5CcmFuY2hlcyhicmFuY2hlcywgc2tpcFRoZUFycmF5cykge1xuICBjb25zdCBicmFuY2hlc091dCA9IFtdO1xuXG4gIGJyYW5jaGVzLmZvckVhY2goYnJhbmNoID0+IHtcbiAgICBjb25zdCB0aGlzSXNBcnJheSA9IEFycmF5LmlzQXJyYXkoYnJhbmNoLnZhbHVlKTtcblxuICAgIC8vIFdlIGluY2x1ZGUgdGhlIGJyYW5jaCBpdHNlbGYsICpVTkxFU1MqIHdlIGl0J3MgYW4gYXJyYXkgdGhhdCB3ZSdyZSBnb2luZ1xuICAgIC8vIHRvIGl0ZXJhdGUgYW5kIHdlJ3JlIHRvbGQgdG8gc2tpcCBhcnJheXMuICAoVGhhdCdzIHJpZ2h0LCB3ZSBpbmNsdWRlIHNvbWVcbiAgICAvLyBhcnJheXMgZXZlbiBza2lwVGhlQXJyYXlzIGlzIHRydWU6IHRoZXNlIGFyZSBhcnJheXMgdGhhdCB3ZXJlIGZvdW5kIHZpYVxuICAgIC8vIGV4cGxpY2l0IG51bWVyaWNhbCBpbmRpY2VzLilcbiAgICBpZiAoIShza2lwVGhlQXJyYXlzICYmIHRoaXNJc0FycmF5ICYmICFicmFuY2guZG9udEl0ZXJhdGUpKSB7XG4gICAgICBicmFuY2hlc091dC5wdXNoKHthcnJheUluZGljZXM6IGJyYW5jaC5hcnJheUluZGljZXMsIHZhbHVlOiBicmFuY2gudmFsdWV9KTtcbiAgICB9XG5cbiAgICBpZiAodGhpc0lzQXJyYXkgJiYgIWJyYW5jaC5kb250SXRlcmF0ZSkge1xuICAgICAgYnJhbmNoLnZhbHVlLmZvckVhY2goKHZhbHVlLCBpKSA9PiB7XG4gICAgICAgIGJyYW5jaGVzT3V0LnB1c2goe1xuICAgICAgICAgIGFycmF5SW5kaWNlczogKGJyYW5jaC5hcnJheUluZGljZXMgfHwgW10pLmNvbmNhdChpKSxcbiAgICAgICAgICB2YWx1ZVxuICAgICAgICB9KTtcbiAgICAgIH0pO1xuICAgIH1cbiAgfSk7XG5cbiAgcmV0dXJuIGJyYW5jaGVzT3V0O1xufVxuXG4vLyBIZWxwZXJzIGZvciAkYml0c0FsbFNldC8kYml0c0FueVNldC8kYml0c0FsbENsZWFyLyRiaXRzQW55Q2xlYXIuXG5mdW5jdGlvbiBnZXRPcGVyYW5kQml0bWFzayhvcGVyYW5kLCBzZWxlY3Rvcikge1xuICAvLyBudW1lcmljIGJpdG1hc2tcbiAgLy8gWW91IGNhbiBwcm92aWRlIGEgbnVtZXJpYyBiaXRtYXNrIHRvIGJlIG1hdGNoZWQgYWdhaW5zdCB0aGUgb3BlcmFuZCBmaWVsZC5cbiAgLy8gSXQgbXVzdCBiZSByZXByZXNlbnRhYmxlIGFzIGEgbm9uLW5lZ2F0aXZlIDMyLWJpdCBzaWduZWQgaW50ZWdlci5cbiAgLy8gT3RoZXJ3aXNlLCAkYml0c0FsbFNldCB3aWxsIHJldHVybiBhbiBlcnJvci5cbiAgaWYgKE51bWJlci5pc0ludGVnZXIob3BlcmFuZCkgJiYgb3BlcmFuZCA+PSAwKSB7XG4gICAgcmV0dXJuIG5ldyBVaW50OEFycmF5KG5ldyBJbnQzMkFycmF5KFtvcGVyYW5kXSkuYnVmZmVyKTtcbiAgfVxuXG4gIC8vIGJpbmRhdGEgYml0bWFza1xuICAvLyBZb3UgY2FuIGFsc28gdXNlIGFuIGFyYml0cmFyaWx5IGxhcmdlIEJpbkRhdGEgaW5zdGFuY2UgYXMgYSBiaXRtYXNrLlxuICBpZiAoRUpTT04uaXNCaW5hcnkob3BlcmFuZCkpIHtcbiAgICByZXR1cm4gbmV3IFVpbnQ4QXJyYXkob3BlcmFuZC5idWZmZXIpO1xuICB9XG5cbiAgLy8gcG9zaXRpb24gbGlzdFxuICAvLyBJZiBxdWVyeWluZyBhIGxpc3Qgb2YgYml0IHBvc2l0aW9ucywgZWFjaCA8cG9zaXRpb24+IG11c3QgYmUgYSBub24tbmVnYXRpdmVcbiAgLy8gaW50ZWdlci4gQml0IHBvc2l0aW9ucyBzdGFydCBhdCAwIGZyb20gdGhlIGxlYXN0IHNpZ25pZmljYW50IGJpdC5cbiAgaWYgKEFycmF5LmlzQXJyYXkob3BlcmFuZCkgJiZcbiAgICAgIG9wZXJhbmQuZXZlcnkoeCA9PiBOdW1iZXIuaXNJbnRlZ2VyKHgpICYmIHggPj0gMCkpIHtcbiAgICBjb25zdCBidWZmZXIgPSBuZXcgQXJyYXlCdWZmZXIoKE1hdGgubWF4KC4uLm9wZXJhbmQpID4+IDMpICsgMSk7XG4gICAgY29uc3QgdmlldyA9IG5ldyBVaW50OEFycmF5KGJ1ZmZlcik7XG5cbiAgICBvcGVyYW5kLmZvckVhY2goeCA9PiB7XG4gICAgICB2aWV3W3ggPj4gM10gfD0gMSA8PCAoeCAmIDB4Nyk7XG4gICAgfSk7XG5cbiAgICByZXR1cm4gdmlldztcbiAgfVxuXG4gIC8vIGJhZCBvcGVyYW5kXG4gIHRocm93IEVycm9yKFxuICAgIGBvcGVyYW5kIHRvICR7c2VsZWN0b3J9IG11c3QgYmUgYSBudW1lcmljIGJpdG1hc2sgKHJlcHJlc2VudGFibGUgYXMgYSBgICtcbiAgICAnbm9uLW5lZ2F0aXZlIDMyLWJpdCBzaWduZWQgaW50ZWdlciksIGEgYmluZGF0YSBiaXRtYXNrIG9yIGFuIGFycmF5IHdpdGggJyArXG4gICAgJ2JpdCBwb3NpdGlvbnMgKG5vbi1uZWdhdGl2ZSBpbnRlZ2VycyknXG4gICk7XG59XG5cbmZ1bmN0aW9uIGdldFZhbHVlQml0bWFzayh2YWx1ZSwgbGVuZ3RoKSB7XG4gIC8vIFRoZSBmaWVsZCB2YWx1ZSBtdXN0IGJlIGVpdGhlciBudW1lcmljYWwgb3IgYSBCaW5EYXRhIGluc3RhbmNlLiBPdGhlcndpc2UsXG4gIC8vICRiaXRzLi4uIHdpbGwgbm90IG1hdGNoIHRoZSBjdXJyZW50IGRvY3VtZW50LlxuXG4gIC8vIG51bWVyaWNhbFxuICBpZiAoTnVtYmVyLmlzU2FmZUludGVnZXIodmFsdWUpKSB7XG4gICAgLy8gJGJpdHMuLi4gd2lsbCBub3QgbWF0Y2ggbnVtZXJpY2FsIHZhbHVlcyB0aGF0IGNhbm5vdCBiZSByZXByZXNlbnRlZCBhcyBhXG4gICAgLy8gc2lnbmVkIDY0LWJpdCBpbnRlZ2VyLiBUaGlzIGNhbiBiZSB0aGUgY2FzZSBpZiBhIHZhbHVlIGlzIGVpdGhlciB0b29cbiAgICAvLyBsYXJnZSBvciBzbWFsbCB0byBmaXQgaW4gYSBzaWduZWQgNjQtYml0IGludGVnZXIsIG9yIGlmIGl0IGhhcyBhXG4gICAgLy8gZnJhY3Rpb25hbCBjb21wb25lbnQuXG4gICAgY29uc3QgYnVmZmVyID0gbmV3IEFycmF5QnVmZmVyKFxuICAgICAgTWF0aC5tYXgobGVuZ3RoLCAyICogVWludDMyQXJyYXkuQllURVNfUEVSX0VMRU1FTlQpXG4gICAgKTtcblxuICAgIGxldCB2aWV3ID0gbmV3IFVpbnQzMkFycmF5KGJ1ZmZlciwgMCwgMik7XG4gICAgdmlld1swXSA9IHZhbHVlICUgKCgxIDw8IDE2KSAqICgxIDw8IDE2KSkgfCAwO1xuICAgIHZpZXdbMV0gPSB2YWx1ZSAvICgoMSA8PCAxNikgKiAoMSA8PCAxNikpIHwgMDtcblxuICAgIC8vIHNpZ24gZXh0ZW5zaW9uXG4gICAgaWYgKHZhbHVlIDwgMCkge1xuICAgICAgdmlldyA9IG5ldyBVaW50OEFycmF5KGJ1ZmZlciwgMik7XG4gICAgICB2aWV3LmZvckVhY2goKGJ5dGUsIGkpID0+IHtcbiAgICAgICAgdmlld1tpXSA9IDB4ZmY7XG4gICAgICB9KTtcbiAgICB9XG5cbiAgICByZXR1cm4gbmV3IFVpbnQ4QXJyYXkoYnVmZmVyKTtcbiAgfVxuXG4gIC8vIGJpbmRhdGFcbiAgaWYgKEVKU09OLmlzQmluYXJ5KHZhbHVlKSkge1xuICAgIHJldHVybiBuZXcgVWludDhBcnJheSh2YWx1ZS5idWZmZXIpO1xuICB9XG5cbiAgLy8gbm8gbWF0Y2hcbiAgcmV0dXJuIGZhbHNlO1xufVxuXG4vLyBBY3R1YWxseSBpbnNlcnRzIGEga2V5IHZhbHVlIGludG8gdGhlIHNlbGVjdG9yIGRvY3VtZW50XG4vLyBIb3dldmVyLCB0aGlzIGNoZWNrcyB0aGVyZSBpcyBubyBhbWJpZ3VpdHkgaW4gc2V0dGluZ1xuLy8gdGhlIHZhbHVlIGZvciB0aGUgZ2l2ZW4ga2V5LCB0aHJvd3Mgb3RoZXJ3aXNlXG5mdW5jdGlvbiBpbnNlcnRJbnRvRG9jdW1lbnQoZG9jdW1lbnQsIGtleSwgdmFsdWUpIHtcbiAgT2JqZWN0LmtleXMoZG9jdW1lbnQpLmZvckVhY2goZXhpc3RpbmdLZXkgPT4ge1xuICAgIGlmIChcbiAgICAgIChleGlzdGluZ0tleS5sZW5ndGggPiBrZXkubGVuZ3RoICYmIGV4aXN0aW5nS2V5LmluZGV4T2YoYCR7a2V5fS5gKSA9PT0gMCkgfHxcbiAgICAgIChrZXkubGVuZ3RoID4gZXhpc3RpbmdLZXkubGVuZ3RoICYmIGtleS5pbmRleE9mKGAke2V4aXN0aW5nS2V5fS5gKSA9PT0gMClcbiAgICApIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihcbiAgICAgICAgYGNhbm5vdCBpbmZlciBxdWVyeSBmaWVsZHMgdG8gc2V0LCBib3RoIHBhdGhzICcke2V4aXN0aW5nS2V5fScgYW5kIGAgK1xuICAgICAgICBgJyR7a2V5fScgYXJlIG1hdGNoZWRgXG4gICAgICApO1xuICAgIH0gZWxzZSBpZiAoZXhpc3RpbmdLZXkgPT09IGtleSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKFxuICAgICAgICBgY2Fubm90IGluZmVyIHF1ZXJ5IGZpZWxkcyB0byBzZXQsIHBhdGggJyR7a2V5fScgaXMgbWF0Y2hlZCB0d2ljZWBcbiAgICAgICk7XG4gICAgfVxuICB9KTtcblxuICBkb2N1bWVudFtrZXldID0gdmFsdWU7XG59XG5cbi8vIFJldHVybnMgYSBicmFuY2hlZCBtYXRjaGVyIHRoYXQgbWF0Y2hlcyBpZmYgdGhlIGdpdmVuIG1hdGNoZXIgZG9lcyBub3QuXG4vLyBOb3RlIHRoYXQgdGhpcyBpbXBsaWNpdGx5IFwiZGVNb3JnYW5pemVzXCIgdGhlIHdyYXBwZWQgZnVuY3Rpb24uICBpZSwgaXRcbi8vIG1lYW5zIHRoYXQgQUxMIGJyYW5jaCB2YWx1ZXMgbmVlZCB0byBmYWlsIHRvIG1hdGNoIGlubmVyQnJhbmNoZWRNYXRjaGVyLlxuZnVuY3Rpb24gaW52ZXJ0QnJhbmNoZWRNYXRjaGVyKGJyYW5jaGVkTWF0Y2hlcikge1xuICByZXR1cm4gYnJhbmNoVmFsdWVzID0+IHtcbiAgICAvLyBXZSBleHBsaWNpdGx5IGNob29zZSB0byBzdHJpcCBhcnJheUluZGljZXMgaGVyZTogaXQgZG9lc24ndCBtYWtlIHNlbnNlIHRvXG4gICAgLy8gc2F5IFwidXBkYXRlIHRoZSBhcnJheSBlbGVtZW50IHRoYXQgZG9lcyBub3QgbWF0Y2ggc29tZXRoaW5nXCIsIGF0IGxlYXN0XG4gICAgLy8gaW4gbW9uZ28tbGFuZC5cbiAgICByZXR1cm4ge3Jlc3VsdDogIWJyYW5jaGVkTWF0Y2hlcihicmFuY2hWYWx1ZXMpLnJlc3VsdH07XG4gIH07XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBpc0luZGV4YWJsZShvYmopIHtcbiAgcmV0dXJuIEFycmF5LmlzQXJyYXkob2JqKSB8fCBMb2NhbENvbGxlY3Rpb24uX2lzUGxhaW5PYmplY3Qob2JqKTtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGlzTnVtZXJpY0tleShzKSB7XG4gIHJldHVybiAvXlswLTldKyQvLnRlc3Qocyk7XG59XG5cbi8vIFJldHVybnMgdHJ1ZSBpZiB0aGlzIGlzIGFuIG9iamVjdCB3aXRoIGF0IGxlYXN0IG9uZSBrZXkgYW5kIGFsbCBrZXlzIGJlZ2luXG4vLyB3aXRoICQuICBVbmxlc3MgaW5jb25zaXN0ZW50T0sgaXMgc2V0LCB0aHJvd3MgaWYgc29tZSBrZXlzIGJlZ2luIHdpdGggJCBhbmRcbi8vIG90aGVycyBkb24ndC5cbmV4cG9ydCBmdW5jdGlvbiBpc09wZXJhdG9yT2JqZWN0KHZhbHVlU2VsZWN0b3IsIGluY29uc2lzdGVudE9LKSB7XG4gIGlmICghTG9jYWxDb2xsZWN0aW9uLl9pc1BsYWluT2JqZWN0KHZhbHVlU2VsZWN0b3IpKSB7XG4gICAgcmV0dXJuIGZhbHNlO1xuICB9XG5cbiAgbGV0IHRoZXNlQXJlT3BlcmF0b3JzID0gdW5kZWZpbmVkO1xuICBPYmplY3Qua2V5cyh2YWx1ZVNlbGVjdG9yKS5mb3JFYWNoKHNlbEtleSA9PiB7XG4gICAgY29uc3QgdGhpc0lzT3BlcmF0b3IgPSBzZWxLZXkuc3Vic3RyKDAsIDEpID09PSAnJCc7XG5cbiAgICBpZiAodGhlc2VBcmVPcGVyYXRvcnMgPT09IHVuZGVmaW5lZCkge1xuICAgICAgdGhlc2VBcmVPcGVyYXRvcnMgPSB0aGlzSXNPcGVyYXRvcjtcbiAgICB9IGVsc2UgaWYgKHRoZXNlQXJlT3BlcmF0b3JzICE9PSB0aGlzSXNPcGVyYXRvcikge1xuICAgICAgaWYgKCFpbmNvbnNpc3RlbnRPSykge1xuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoXG4gICAgICAgICAgYEluY29uc2lzdGVudCBvcGVyYXRvcjogJHtKU09OLnN0cmluZ2lmeSh2YWx1ZVNlbGVjdG9yKX1gXG4gICAgICAgICk7XG4gICAgICB9XG5cbiAgICAgIHRoZXNlQXJlT3BlcmF0b3JzID0gZmFsc2U7XG4gICAgfVxuICB9KTtcblxuICByZXR1cm4gISF0aGVzZUFyZU9wZXJhdG9yczsgLy8ge30gaGFzIG5vIG9wZXJhdG9yc1xufVxuXG4vLyBIZWxwZXIgZm9yICRsdC8kZ3QvJGx0ZS8kZ3RlLlxuZnVuY3Rpb24gbWFrZUluZXF1YWxpdHkoY21wVmFsdWVDb21wYXJhdG9yKSB7XG4gIHJldHVybiB7XG4gICAgY29tcGlsZUVsZW1lbnRTZWxlY3RvcihvcGVyYW5kKSB7XG4gICAgICAvLyBBcnJheXMgbmV2ZXIgY29tcGFyZSBmYWxzZSB3aXRoIG5vbi1hcnJheXMgZm9yIGFueSBpbmVxdWFsaXR5LlxuICAgICAgLy8gWFhYIFRoaXMgd2FzIGJlaGF2aW9yIHdlIG9ic2VydmVkIGluIHByZS1yZWxlYXNlIE1vbmdvREIgMi41LCBidXRcbiAgICAgIC8vICAgICBpdCBzZWVtcyB0byBoYXZlIGJlZW4gcmV2ZXJ0ZWQuXG4gICAgICAvLyAgICAgU2VlIGh0dHBzOi8vamlyYS5tb25nb2RiLm9yZy9icm93c2UvU0VSVkVSLTExNDQ0XG4gICAgICBpZiAoQXJyYXkuaXNBcnJheShvcGVyYW5kKSkge1xuICAgICAgICByZXR1cm4gKCkgPT4gZmFsc2U7XG4gICAgICB9XG5cbiAgICAgIC8vIFNwZWNpYWwgY2FzZTogY29uc2lkZXIgdW5kZWZpbmVkIGFuZCBudWxsIHRoZSBzYW1lIChzbyB0cnVlIHdpdGhcbiAgICAgIC8vICRndGUvJGx0ZSkuXG4gICAgICBpZiAob3BlcmFuZCA9PT0gdW5kZWZpbmVkKSB7XG4gICAgICAgIG9wZXJhbmQgPSBudWxsO1xuICAgICAgfVxuXG4gICAgICBjb25zdCBvcGVyYW5kVHlwZSA9IExvY2FsQ29sbGVjdGlvbi5fZi5fdHlwZShvcGVyYW5kKTtcblxuICAgICAgcmV0dXJuIHZhbHVlID0+IHtcbiAgICAgICAgaWYgKHZhbHVlID09PSB1bmRlZmluZWQpIHtcbiAgICAgICAgICB2YWx1ZSA9IG51bGw7XG4gICAgICAgIH1cblxuICAgICAgICAvLyBDb21wYXJpc29ucyBhcmUgbmV2ZXIgdHJ1ZSBhbW9uZyB0aGluZ3Mgb2YgZGlmZmVyZW50IHR5cGUgKGV4Y2VwdFxuICAgICAgICAvLyBudWxsIHZzIHVuZGVmaW5lZCkuXG4gICAgICAgIGlmIChMb2NhbENvbGxlY3Rpb24uX2YuX3R5cGUodmFsdWUpICE9PSBvcGVyYW5kVHlwZSkge1xuICAgICAgICAgIHJldHVybiBmYWxzZTtcbiAgICAgICAgfVxuXG4gICAgICAgIHJldHVybiBjbXBWYWx1ZUNvbXBhcmF0b3IoTG9jYWxDb2xsZWN0aW9uLl9mLl9jbXAodmFsdWUsIG9wZXJhbmQpKTtcbiAgICAgIH07XG4gICAgfSxcbiAgfTtcbn1cblxuLy8gbWFrZUxvb2t1cEZ1bmN0aW9uKGtleSkgcmV0dXJucyBhIGxvb2t1cCBmdW5jdGlvbi5cbi8vXG4vLyBBIGxvb2t1cCBmdW5jdGlvbiB0YWtlcyBpbiBhIGRvY3VtZW50IGFuZCByZXR1cm5zIGFuIGFycmF5IG9mIG1hdGNoaW5nXG4vLyBicmFuY2hlcy4gIElmIG5vIGFycmF5cyBhcmUgZm91bmQgd2hpbGUgbG9va2luZyB1cCB0aGUga2V5LCB0aGlzIGFycmF5IHdpbGxcbi8vIGhhdmUgZXhhY3RseSBvbmUgYnJhbmNoZXMgKHBvc3NpYmx5ICd1bmRlZmluZWQnLCBpZiBzb21lIHNlZ21lbnQgb2YgdGhlIGtleVxuLy8gd2FzIG5vdCBmb3VuZCkuXG4vL1xuLy8gSWYgYXJyYXlzIGFyZSBmb3VuZCBpbiB0aGUgbWlkZGxlLCB0aGlzIGNhbiBoYXZlIG1vcmUgdGhhbiBvbmUgZWxlbWVudCwgc2luY2Vcbi8vIHdlICdicmFuY2gnLiBXaGVuIHdlICdicmFuY2gnLCBpZiB0aGVyZSBhcmUgbW9yZSBrZXkgc2VnbWVudHMgdG8gbG9vayB1cCxcbi8vIHRoZW4gd2Ugb25seSBwdXJzdWUgYnJhbmNoZXMgdGhhdCBhcmUgcGxhaW4gb2JqZWN0cyAobm90IGFycmF5cyBvciBzY2FsYXJzKS5cbi8vIFRoaXMgbWVhbnMgd2UgY2FuIGFjdHVhbGx5IGVuZCB1cCB3aXRoIG5vIGJyYW5jaGVzIVxuLy9cbi8vIFdlIGRvICpOT1QqIGJyYW5jaCBvbiBhcnJheXMgdGhhdCBhcmUgZm91bmQgYXQgdGhlIGVuZCAoaWUsIGF0IHRoZSBsYXN0XG4vLyBkb3R0ZWQgbWVtYmVyIG9mIHRoZSBrZXkpLiBXZSBqdXN0IHJldHVybiB0aGF0IGFycmF5OyBpZiB5b3Ugd2FudCB0b1xuLy8gZWZmZWN0aXZlbHkgJ2JyYW5jaCcgb3ZlciB0aGUgYXJyYXkncyB2YWx1ZXMsIHBvc3QtcHJvY2VzcyB0aGUgbG9va3VwXG4vLyBmdW5jdGlvbiB3aXRoIGV4cGFuZEFycmF5c0luQnJhbmNoZXMuXG4vL1xuLy8gRWFjaCBicmFuY2ggaXMgYW4gb2JqZWN0IHdpdGgga2V5czpcbi8vICAtIHZhbHVlOiB0aGUgdmFsdWUgYXQgdGhlIGJyYW5jaFxuLy8gIC0gZG9udEl0ZXJhdGU6IGFuIG9wdGlvbmFsIGJvb2w7IGlmIHRydWUsIGl0IG1lYW5zIHRoYXQgJ3ZhbHVlJyBpcyBhbiBhcnJheVxuLy8gICAgdGhhdCBleHBhbmRBcnJheXNJbkJyYW5jaGVzIHNob3VsZCBOT1QgZXhwYW5kLiBUaGlzIHNwZWNpZmljYWxseSBoYXBwZW5zXG4vLyAgICB3aGVuIHRoZXJlIGlzIGEgbnVtZXJpYyBpbmRleCBpbiB0aGUga2V5LCBhbmQgZW5zdXJlcyB0aGVcbi8vICAgIHBlcmhhcHMtc3VycHJpc2luZyBNb25nb0RCIGJlaGF2aW9yIHdoZXJlIHsnYS4wJzogNX0gZG9lcyBOT1Rcbi8vICAgIG1hdGNoIHthOiBbWzVdXX0uXG4vLyAgLSBhcnJheUluZGljZXM6IGlmIGFueSBhcnJheSBpbmRleGluZyB3YXMgZG9uZSBkdXJpbmcgbG9va3VwIChlaXRoZXIgZHVlIHRvXG4vLyAgICBleHBsaWNpdCBudW1lcmljIGluZGljZXMgb3IgaW1wbGljaXQgYnJhbmNoaW5nKSwgdGhpcyB3aWxsIGJlIGFuIGFycmF5IG9mXG4vLyAgICB0aGUgYXJyYXkgaW5kaWNlcyB1c2VkLCBmcm9tIG91dGVybW9zdCB0byBpbm5lcm1vc3Q7IGl0IGlzIGZhbHNleSBvclxuLy8gICAgYWJzZW50IGlmIG5vIGFycmF5IGluZGV4IGlzIHVzZWQuIElmIGFuIGV4cGxpY2l0IG51bWVyaWMgaW5kZXggaXMgdXNlZCxcbi8vICAgIHRoZSBpbmRleCB3aWxsIGJlIGZvbGxvd2VkIGluIGFycmF5SW5kaWNlcyBieSB0aGUgc3RyaW5nICd4Jy5cbi8vXG4vLyAgICBOb3RlOiBhcnJheUluZGljZXMgaXMgdXNlZCBmb3IgdHdvIHB1cnBvc2VzLiBGaXJzdCwgaXQgaXMgdXNlZCB0b1xuLy8gICAgaW1wbGVtZW50IHRoZSAnJCcgbW9kaWZpZXIgZmVhdHVyZSwgd2hpY2ggb25seSBldmVyIGxvb2tzIGF0IGl0cyBmaXJzdFxuLy8gICAgZWxlbWVudC5cbi8vXG4vLyAgICBTZWNvbmQsIGl0IGlzIHVzZWQgZm9yIHNvcnQga2V5IGdlbmVyYXRpb24sIHdoaWNoIG5lZWRzIHRvIGJlIGFibGUgdG8gdGVsbFxuLy8gICAgdGhlIGRpZmZlcmVuY2UgYmV0d2VlbiBkaWZmZXJlbnQgcGF0aHMuIE1vcmVvdmVyLCBpdCBuZWVkcyB0b1xuLy8gICAgZGlmZmVyZW50aWF0ZSBiZXR3ZWVuIGV4cGxpY2l0IGFuZCBpbXBsaWNpdCBicmFuY2hpbmcsIHdoaWNoIGlzIHdoeVxuLy8gICAgdGhlcmUncyB0aGUgc29tZXdoYXQgaGFja3kgJ3gnIGVudHJ5OiB0aGlzIG1lYW5zIHRoYXQgZXhwbGljaXQgYW5kXG4vLyAgICBpbXBsaWNpdCBhcnJheSBsb29rdXBzIHdpbGwgaGF2ZSBkaWZmZXJlbnQgZnVsbCBhcnJheUluZGljZXMgcGF0aHMuIChUaGF0XG4vLyAgICBjb2RlIG9ubHkgcmVxdWlyZXMgdGhhdCBkaWZmZXJlbnQgcGF0aHMgaGF2ZSBkaWZmZXJlbnQgYXJyYXlJbmRpY2VzOyBpdFxuLy8gICAgZG9lc24ndCBhY3R1YWxseSAncGFyc2UnIGFycmF5SW5kaWNlcy4gQXMgYW4gYWx0ZXJuYXRpdmUsIGFycmF5SW5kaWNlc1xuLy8gICAgY291bGQgY29udGFpbiBvYmplY3RzIHdpdGggZmxhZ3MgbGlrZSAnaW1wbGljaXQnLCBidXQgSSB0aGluayB0aGF0IG9ubHlcbi8vICAgIG1ha2VzIHRoZSBjb2RlIHN1cnJvdW5kaW5nIHRoZW0gbW9yZSBjb21wbGV4Lilcbi8vXG4vLyAgICAoQnkgdGhlIHdheSwgdGhpcyBmaWVsZCBlbmRzIHVwIGdldHRpbmcgcGFzc2VkIGFyb3VuZCBhIGxvdCB3aXRob3V0XG4vLyAgICBjbG9uaW5nLCBzbyBuZXZlciBtdXRhdGUgYW55IGFycmF5SW5kaWNlcyBmaWVsZC92YXIgaW4gdGhpcyBwYWNrYWdlISlcbi8vXG4vL1xuLy8gQXQgdGhlIHRvcCBsZXZlbCwgeW91IG1heSBvbmx5IHBhc3MgaW4gYSBwbGFpbiBvYmplY3Qgb3IgYXJyYXkuXG4vL1xuLy8gU2VlIHRoZSB0ZXN0ICdtaW5pbW9uZ28gLSBsb29rdXAnIGZvciBzb21lIGV4YW1wbGVzIG9mIHdoYXQgbG9va3VwIGZ1bmN0aW9uc1xuLy8gcmV0dXJuLlxuZXhwb3J0IGZ1bmN0aW9uIG1ha2VMb29rdXBGdW5jdGlvbihrZXksIG9wdGlvbnMgPSB7fSkge1xuICBjb25zdCBwYXJ0cyA9IGtleS5zcGxpdCgnLicpO1xuICBjb25zdCBmaXJzdFBhcnQgPSBwYXJ0cy5sZW5ndGggPyBwYXJ0c1swXSA6ICcnO1xuICBjb25zdCBsb29rdXBSZXN0ID0gKFxuICAgIHBhcnRzLmxlbmd0aCA+IDEgJiZcbiAgICBtYWtlTG9va3VwRnVuY3Rpb24ocGFydHMuc2xpY2UoMSkuam9pbignLicpLCBvcHRpb25zKVxuICApO1xuXG4gIGNvbnN0IG9taXRVbm5lY2Vzc2FyeUZpZWxkcyA9IHJlc3VsdCA9PiB7XG4gICAgaWYgKCFyZXN1bHQuZG9udEl0ZXJhdGUpIHtcbiAgICAgIGRlbGV0ZSByZXN1bHQuZG9udEl0ZXJhdGU7XG4gICAgfVxuXG4gICAgaWYgKHJlc3VsdC5hcnJheUluZGljZXMgJiYgIXJlc3VsdC5hcnJheUluZGljZXMubGVuZ3RoKSB7XG4gICAgICBkZWxldGUgcmVzdWx0LmFycmF5SW5kaWNlcztcbiAgICB9XG5cbiAgICByZXR1cm4gcmVzdWx0O1xuICB9O1xuXG4gIC8vIERvYyB3aWxsIGFsd2F5cyBiZSBhIHBsYWluIG9iamVjdCBvciBhbiBhcnJheS5cbiAgLy8gYXBwbHkgYW4gZXhwbGljaXQgbnVtZXJpYyBpbmRleCwgYW4gYXJyYXkuXG4gIHJldHVybiAoZG9jLCBhcnJheUluZGljZXMgPSBbXSkgPT4ge1xuICAgIGlmIChBcnJheS5pc0FycmF5KGRvYykpIHtcbiAgICAgIC8vIElmIHdlJ3JlIGJlaW5nIGFza2VkIHRvIGRvIGFuIGludmFsaWQgbG9va3VwIGludG8gYW4gYXJyYXkgKG5vbi1pbnRlZ2VyXG4gICAgICAvLyBvciBvdXQtb2YtYm91bmRzKSwgcmV0dXJuIG5vIHJlc3VsdHMgKHdoaWNoIGlzIGRpZmZlcmVudCBmcm9tIHJldHVybmluZ1xuICAgICAgLy8gYSBzaW5nbGUgdW5kZWZpbmVkIHJlc3VsdCwgaW4gdGhhdCBgbnVsbGAgZXF1YWxpdHkgY2hlY2tzIHdvbid0IG1hdGNoKS5cbiAgICAgIGlmICghKGlzTnVtZXJpY0tleShmaXJzdFBhcnQpICYmIGZpcnN0UGFydCA8IGRvYy5sZW5ndGgpKSB7XG4gICAgICAgIHJldHVybiBbXTtcbiAgICAgIH1cblxuICAgICAgLy8gUmVtZW1iZXIgdGhhdCB3ZSB1c2VkIHRoaXMgYXJyYXkgaW5kZXguIEluY2x1ZGUgYW4gJ3gnIHRvIGluZGljYXRlIHRoYXRcbiAgICAgIC8vIHRoZSBwcmV2aW91cyBpbmRleCBjYW1lIGZyb20gYmVpbmcgY29uc2lkZXJlZCBhcyBhbiBleHBsaWNpdCBhcnJheVxuICAgICAgLy8gaW5kZXggKG5vdCBicmFuY2hpbmcpLlxuICAgICAgYXJyYXlJbmRpY2VzID0gYXJyYXlJbmRpY2VzLmNvbmNhdCgrZmlyc3RQYXJ0LCAneCcpO1xuICAgIH1cblxuICAgIC8vIERvIG91ciBmaXJzdCBsb29rdXAuXG4gICAgY29uc3QgZmlyc3RMZXZlbCA9IGRvY1tmaXJzdFBhcnRdO1xuXG4gICAgLy8gSWYgdGhlcmUgaXMgbm8gZGVlcGVyIHRvIGRpZywgcmV0dXJuIHdoYXQgd2UgZm91bmQuXG4gICAgLy9cbiAgICAvLyBJZiB3aGF0IHdlIGZvdW5kIGlzIGFuIGFycmF5LCBtb3N0IHZhbHVlIHNlbGVjdG9ycyB3aWxsIGNob29zZSB0byB0cmVhdFxuICAgIC8vIHRoZSBlbGVtZW50cyBvZiB0aGUgYXJyYXkgYXMgbWF0Y2hhYmxlIHZhbHVlcyBpbiB0aGVpciBvd24gcmlnaHQsIGJ1dFxuICAgIC8vIHRoYXQncyBkb25lIG91dHNpZGUgb2YgdGhlIGxvb2t1cCBmdW5jdGlvbi4gKEV4Y2VwdGlvbnMgdG8gdGhpcyBhcmUgJHNpemVcbiAgICAvLyBhbmQgc3R1ZmYgcmVsYXRpbmcgdG8gJGVsZW1NYXRjaC4gIGVnLCB7YTogeyRzaXplOiAyfX0gZG9lcyBub3QgbWF0Y2gge2E6XG4gICAgLy8gW1sxLCAyXV19LilcbiAgICAvL1xuICAgIC8vIFRoYXQgc2FpZCwgaWYgd2UganVzdCBkaWQgYW4gKmV4cGxpY2l0KiBhcnJheSBsb29rdXAgKG9uIGRvYykgdG8gZmluZFxuICAgIC8vIGZpcnN0TGV2ZWwsIGFuZCBmaXJzdExldmVsIGlzIGFuIGFycmF5IHRvbywgd2UgZG8gTk9UIHdhbnQgdmFsdWVcbiAgICAvLyBzZWxlY3RvcnMgdG8gaXRlcmF0ZSBvdmVyIGl0LiAgZWcsIHsnYS4wJzogNX0gZG9lcyBub3QgbWF0Y2gge2E6IFtbNV1dfS5cbiAgICAvLyBTbyBpbiB0aGF0IGNhc2UsIHdlIG1hcmsgdGhlIHJldHVybiB2YWx1ZSBhcyAnZG9uJ3QgaXRlcmF0ZScuXG4gICAgaWYgKCFsb29rdXBSZXN0KSB7XG4gICAgICByZXR1cm4gW29taXRVbm5lY2Vzc2FyeUZpZWxkcyh7XG4gICAgICAgIGFycmF5SW5kaWNlcyxcbiAgICAgICAgZG9udEl0ZXJhdGU6IEFycmF5LmlzQXJyYXkoZG9jKSAmJiBBcnJheS5pc0FycmF5KGZpcnN0TGV2ZWwpLFxuICAgICAgICB2YWx1ZTogZmlyc3RMZXZlbFxuICAgICAgfSldO1xuICAgIH1cblxuICAgIC8vIFdlIG5lZWQgdG8gZGlnIGRlZXBlci4gIEJ1dCBpZiB3ZSBjYW4ndCwgYmVjYXVzZSB3aGF0IHdlJ3ZlIGZvdW5kIGlzIG5vdFxuICAgIC8vIGFuIGFycmF5IG9yIHBsYWluIG9iamVjdCwgd2UncmUgZG9uZS4gSWYgd2UganVzdCBkaWQgYSBudW1lcmljIGluZGV4IGludG9cbiAgICAvLyBhbiBhcnJheSwgd2UgcmV0dXJuIG5vdGhpbmcgaGVyZSAodGhpcyBpcyBhIGNoYW5nZSBpbiBNb25nbyAyLjUgZnJvbVxuICAgIC8vIE1vbmdvIDIuNCwgd2hlcmUgeydhLjAuYic6IG51bGx9IHN0b3BwZWQgbWF0Y2hpbmcge2E6IFs1XX0pLiBPdGhlcndpc2UsXG4gICAgLy8gcmV0dXJuIGEgc2luZ2xlIGB1bmRlZmluZWRgICh3aGljaCBjYW4sIGZvciBleGFtcGxlLCBtYXRjaCB2aWEgZXF1YWxpdHlcbiAgICAvLyB3aXRoIGBudWxsYCkuXG4gICAgaWYgKCFpc0luZGV4YWJsZShmaXJzdExldmVsKSkge1xuICAgICAgaWYgKEFycmF5LmlzQXJyYXkoZG9jKSkge1xuICAgICAgICByZXR1cm4gW107XG4gICAgICB9XG5cbiAgICAgIHJldHVybiBbb21pdFVubmVjZXNzYXJ5RmllbGRzKHthcnJheUluZGljZXMsIHZhbHVlOiB1bmRlZmluZWR9KV07XG4gICAgfVxuXG4gICAgY29uc3QgcmVzdWx0ID0gW107XG4gICAgY29uc3QgYXBwZW5kVG9SZXN1bHQgPSBtb3JlID0+IHtcbiAgICAgIHJlc3VsdC5wdXNoKC4uLm1vcmUpO1xuICAgIH07XG5cbiAgICAvLyBEaWcgZGVlcGVyOiBsb29rIHVwIHRoZSByZXN0IG9mIHRoZSBwYXJ0cyBvbiB3aGF0ZXZlciB3ZSd2ZSBmb3VuZC5cbiAgICAvLyAobG9va3VwUmVzdCBpcyBzbWFydCBlbm91Z2ggdG8gbm90IHRyeSB0byBkbyBpbnZhbGlkIGxvb2t1cHMgaW50b1xuICAgIC8vIGZpcnN0TGV2ZWwgaWYgaXQncyBhbiBhcnJheS4pXG4gICAgYXBwZW5kVG9SZXN1bHQobG9va3VwUmVzdChmaXJzdExldmVsLCBhcnJheUluZGljZXMpKTtcblxuICAgIC8vIElmIHdlIGZvdW5kIGFuIGFycmF5LCB0aGVuIGluICphZGRpdGlvbiogdG8gcG90ZW50aWFsbHkgdHJlYXRpbmcgdGhlIG5leHRcbiAgICAvLyBwYXJ0IGFzIGEgbGl0ZXJhbCBpbnRlZ2VyIGxvb2t1cCwgd2Ugc2hvdWxkIGFsc28gJ2JyYW5jaCc6IHRyeSB0byBsb29rIHVwXG4gICAgLy8gdGhlIHJlc3Qgb2YgdGhlIHBhcnRzIG9uIGVhY2ggYXJyYXkgZWxlbWVudCBpbiBwYXJhbGxlbC5cbiAgICAvL1xuICAgIC8vIEluIHRoaXMgY2FzZSwgd2UgKm9ubHkqIGRpZyBkZWVwZXIgaW50byBhcnJheSBlbGVtZW50cyB0aGF0IGFyZSBwbGFpblxuICAgIC8vIG9iamVjdHMuIChSZWNhbGwgdGhhdCB3ZSBvbmx5IGdvdCB0aGlzIGZhciBpZiB3ZSBoYXZlIGZ1cnRoZXIgdG8gZGlnLilcbiAgICAvLyBUaGlzIG1ha2VzIHNlbnNlOiB3ZSBjZXJ0YWlubHkgZG9uJ3QgZGlnIGRlZXBlciBpbnRvIG5vbi1pbmRleGFibGVcbiAgICAvLyBvYmplY3RzLiBBbmQgaXQgd291bGQgYmUgd2VpcmQgdG8gZGlnIGludG8gYW4gYXJyYXk6IGl0J3Mgc2ltcGxlciB0byBoYXZlXG4gICAgLy8gYSBydWxlIHRoYXQgZXhwbGljaXQgaW50ZWdlciBpbmRleGVzIG9ubHkgYXBwbHkgdG8gYW4gb3V0ZXIgYXJyYXksIG5vdCB0b1xuICAgIC8vIGFuIGFycmF5IHlvdSBmaW5kIGFmdGVyIGEgYnJhbmNoaW5nIHNlYXJjaC5cbiAgICAvL1xuICAgIC8vIEluIHRoZSBzcGVjaWFsIGNhc2Ugb2YgYSBudW1lcmljIHBhcnQgaW4gYSAqc29ydCBzZWxlY3RvciogKG5vdCBhIHF1ZXJ5XG4gICAgLy8gc2VsZWN0b3IpLCB3ZSBza2lwIHRoZSBicmFuY2hpbmc6IHdlIE9OTFkgYWxsb3cgdGhlIG51bWVyaWMgcGFydCB0byBtZWFuXG4gICAgLy8gJ2xvb2sgdXAgdGhpcyBpbmRleCcgaW4gdGhhdCBjYXNlLCBub3QgJ2Fsc28gbG9vayB1cCB0aGlzIGluZGV4IGluIGFsbFxuICAgIC8vIHRoZSBlbGVtZW50cyBvZiB0aGUgYXJyYXknLlxuICAgIGlmIChBcnJheS5pc0FycmF5KGZpcnN0TGV2ZWwpICYmXG4gICAgICAgICEoaXNOdW1lcmljS2V5KHBhcnRzWzFdKSAmJiBvcHRpb25zLmZvclNvcnQpKSB7XG4gICAgICBmaXJzdExldmVsLmZvckVhY2goKGJyYW5jaCwgYXJyYXlJbmRleCkgPT4ge1xuICAgICAgICBpZiAoTG9jYWxDb2xsZWN0aW9uLl9pc1BsYWluT2JqZWN0KGJyYW5jaCkpIHtcbiAgICAgICAgICBhcHBlbmRUb1Jlc3VsdChsb29rdXBSZXN0KGJyYW5jaCwgYXJyYXlJbmRpY2VzLmNvbmNhdChhcnJheUluZGV4KSkpO1xuICAgICAgICB9XG4gICAgICB9KTtcbiAgICB9XG5cbiAgICByZXR1cm4gcmVzdWx0O1xuICB9O1xufVxuXG4vLyBPYmplY3QgZXhwb3J0ZWQgb25seSBmb3IgdW5pdCB0ZXN0aW5nLlxuLy8gVXNlIGl0IHRvIGV4cG9ydCBwcml2YXRlIGZ1bmN0aW9ucyB0byB0ZXN0IGluIFRpbnl0ZXN0LlxuTWluaW1vbmdvVGVzdCA9IHttYWtlTG9va3VwRnVuY3Rpb259O1xuTWluaW1vbmdvRXJyb3IgPSAobWVzc2FnZSwgb3B0aW9ucyA9IHt9KSA9PiB7XG4gIGlmICh0eXBlb2YgbWVzc2FnZSA9PT0gJ3N0cmluZycgJiYgb3B0aW9ucy5maWVsZCkge1xuICAgIG1lc3NhZ2UgKz0gYCBmb3IgZmllbGQgJyR7b3B0aW9ucy5maWVsZH0nYDtcbiAgfVxuXG4gIGNvbnN0IGVycm9yID0gbmV3IEVycm9yKG1lc3NhZ2UpO1xuICBlcnJvci5uYW1lID0gJ01pbmltb25nb0Vycm9yJztcbiAgcmV0dXJuIGVycm9yO1xufTtcblxuZXhwb3J0IGZ1bmN0aW9uIG5vdGhpbmdNYXRjaGVyKGRvY09yQnJhbmNoZWRWYWx1ZXMpIHtcbiAgcmV0dXJuIHtyZXN1bHQ6IGZhbHNlfTtcbn1cblxuLy8gVGFrZXMgYW4gb3BlcmF0b3Igb2JqZWN0IChhbiBvYmplY3Qgd2l0aCAkIGtleXMpIGFuZCByZXR1cm5zIGEgYnJhbmNoZWRcbi8vIG1hdGNoZXIgZm9yIGl0LlxuZnVuY3Rpb24gb3BlcmF0b3JCcmFuY2hlZE1hdGNoZXIodmFsdWVTZWxlY3RvciwgbWF0Y2hlciwgaXNSb290KSB7XG4gIC8vIEVhY2ggdmFsdWVTZWxlY3RvciB3b3JrcyBzZXBhcmF0ZWx5IG9uIHRoZSB2YXJpb3VzIGJyYW5jaGVzLiAgU28gb25lXG4gIC8vIG9wZXJhdG9yIGNhbiBtYXRjaCBvbmUgYnJhbmNoIGFuZCBhbm90aGVyIGNhbiBtYXRjaCBhbm90aGVyIGJyYW5jaC4gIFRoaXNcbiAgLy8gaXMgT0suXG4gIGNvbnN0IG9wZXJhdG9yTWF0Y2hlcnMgPSBPYmplY3Qua2V5cyh2YWx1ZVNlbGVjdG9yKS5tYXAob3BlcmF0b3IgPT4ge1xuICAgIGNvbnN0IG9wZXJhbmQgPSB2YWx1ZVNlbGVjdG9yW29wZXJhdG9yXTtcblxuICAgIGNvbnN0IHNpbXBsZVJhbmdlID0gKFxuICAgICAgWyckbHQnLCAnJGx0ZScsICckZ3QnLCAnJGd0ZSddLmluY2x1ZGVzKG9wZXJhdG9yKSAmJlxuICAgICAgdHlwZW9mIG9wZXJhbmQgPT09ICdudW1iZXInXG4gICAgKTtcblxuICAgIGNvbnN0IHNpbXBsZUVxdWFsaXR5ID0gKFxuICAgICAgWyckbmUnLCAnJGVxJ10uaW5jbHVkZXMob3BlcmF0b3IpICYmXG4gICAgICBvcGVyYW5kICE9PSBPYmplY3Qob3BlcmFuZClcbiAgICApO1xuXG4gICAgY29uc3Qgc2ltcGxlSW5jbHVzaW9uID0gKFxuICAgICAgWyckaW4nLCAnJG5pbiddLmluY2x1ZGVzKG9wZXJhdG9yKVxuICAgICAgJiYgQXJyYXkuaXNBcnJheShvcGVyYW5kKVxuICAgICAgJiYgIW9wZXJhbmQuc29tZSh4ID0+IHggPT09IE9iamVjdCh4KSlcbiAgICApO1xuXG4gICAgaWYgKCEoc2ltcGxlUmFuZ2UgfHwgc2ltcGxlSW5jbHVzaW9uIHx8IHNpbXBsZUVxdWFsaXR5KSkge1xuICAgICAgbWF0Y2hlci5faXNTaW1wbGUgPSBmYWxzZTtcbiAgICB9XG5cbiAgICBpZiAoaGFzT3duLmNhbGwoVkFMVUVfT1BFUkFUT1JTLCBvcGVyYXRvcikpIHtcbiAgICAgIHJldHVybiBWQUxVRV9PUEVSQVRPUlNbb3BlcmF0b3JdKG9wZXJhbmQsIHZhbHVlU2VsZWN0b3IsIG1hdGNoZXIsIGlzUm9vdCk7XG4gICAgfVxuXG4gICAgaWYgKGhhc093bi5jYWxsKEVMRU1FTlRfT1BFUkFUT1JTLCBvcGVyYXRvcikpIHtcbiAgICAgIGNvbnN0IG9wdGlvbnMgPSBFTEVNRU5UX09QRVJBVE9SU1tvcGVyYXRvcl07XG4gICAgICByZXR1cm4gY29udmVydEVsZW1lbnRNYXRjaGVyVG9CcmFuY2hlZE1hdGNoZXIoXG4gICAgICAgIG9wdGlvbnMuY29tcGlsZUVsZW1lbnRTZWxlY3RvcihvcGVyYW5kLCB2YWx1ZVNlbGVjdG9yLCBtYXRjaGVyKSxcbiAgICAgICAgb3B0aW9uc1xuICAgICAgKTtcbiAgICB9XG5cbiAgICB0aHJvdyBuZXcgRXJyb3IoYFVucmVjb2duaXplZCBvcGVyYXRvcjogJHtvcGVyYXRvcn1gKTtcbiAgfSk7XG5cbiAgcmV0dXJuIGFuZEJyYW5jaGVkTWF0Y2hlcnMob3BlcmF0b3JNYXRjaGVycyk7XG59XG5cbi8vIHBhdGhzIC0gQXJyYXk6IGxpc3Qgb2YgbW9uZ28gc3R5bGUgcGF0aHNcbi8vIG5ld0xlYWZGbiAtIEZ1bmN0aW9uOiBvZiBmb3JtIGZ1bmN0aW9uKHBhdGgpIHNob3VsZCByZXR1cm4gYSBzY2FsYXIgdmFsdWUgdG9cbi8vICAgICAgICAgICAgICAgICAgICAgICBwdXQgaW50byBsaXN0IGNyZWF0ZWQgZm9yIHRoYXQgcGF0aFxuLy8gY29uZmxpY3RGbiAtIEZ1bmN0aW9uOiBvZiBmb3JtIGZ1bmN0aW9uKG5vZGUsIHBhdGgsIGZ1bGxQYXRoKSBpcyBjYWxsZWRcbi8vICAgICAgICAgICAgICAgICAgICAgICAgd2hlbiBidWlsZGluZyBhIHRyZWUgcGF0aCBmb3IgJ2Z1bGxQYXRoJyBub2RlIG9uXG4vLyAgICAgICAgICAgICAgICAgICAgICAgICdwYXRoJyB3YXMgYWxyZWFkeSBhIGxlYWYgd2l0aCBhIHZhbHVlLiBNdXN0IHJldHVybiBhXG4vLyAgICAgICAgICAgICAgICAgICAgICAgIGNvbmZsaWN0IHJlc29sdXRpb24uXG4vLyBpbml0aWFsIHRyZWUgLSBPcHRpb25hbCBPYmplY3Q6IHN0YXJ0aW5nIHRyZWUuXG4vLyBAcmV0dXJucyAtIE9iamVjdDogdHJlZSByZXByZXNlbnRlZCBhcyBhIHNldCBvZiBuZXN0ZWQgb2JqZWN0c1xuZXhwb3J0IGZ1bmN0aW9uIHBhdGhzVG9UcmVlKHBhdGhzLCBuZXdMZWFmRm4sIGNvbmZsaWN0Rm4sIHJvb3QgPSB7fSkge1xuICBwYXRocy5mb3JFYWNoKHBhdGggPT4ge1xuICAgIGNvbnN0IHBhdGhBcnJheSA9IHBhdGguc3BsaXQoJy4nKTtcbiAgICBsZXQgdHJlZSA9IHJvb3Q7XG5cbiAgICAvLyB1c2UgLmV2ZXJ5IGp1c3QgZm9yIGl0ZXJhdGlvbiB3aXRoIGJyZWFrXG4gICAgY29uc3Qgc3VjY2VzcyA9IHBhdGhBcnJheS5zbGljZSgwLCAtMSkuZXZlcnkoKGtleSwgaSkgPT4ge1xuICAgICAgaWYgKCFoYXNPd24uY2FsbCh0cmVlLCBrZXkpKSB7XG4gICAgICAgIHRyZWVba2V5XSA9IHt9O1xuICAgICAgfSBlbHNlIGlmICh0cmVlW2tleV0gIT09IE9iamVjdCh0cmVlW2tleV0pKSB7XG4gICAgICAgIHRyZWVba2V5XSA9IGNvbmZsaWN0Rm4oXG4gICAgICAgICAgdHJlZVtrZXldLFxuICAgICAgICAgIHBhdGhBcnJheS5zbGljZSgwLCBpICsgMSkuam9pbignLicpLFxuICAgICAgICAgIHBhdGhcbiAgICAgICAgKTtcblxuICAgICAgICAvLyBicmVhayBvdXQgb2YgbG9vcCBpZiB3ZSBhcmUgZmFpbGluZyBmb3IgdGhpcyBwYXRoXG4gICAgICAgIGlmICh0cmVlW2tleV0gIT09IE9iamVjdCh0cmVlW2tleV0pKSB7XG4gICAgICAgICAgcmV0dXJuIGZhbHNlO1xuICAgICAgICB9XG4gICAgICB9XG5cbiAgICAgIHRyZWUgPSB0cmVlW2tleV07XG5cbiAgICAgIHJldHVybiB0cnVlO1xuICAgIH0pO1xuXG4gICAgaWYgKHN1Y2Nlc3MpIHtcbiAgICAgIGNvbnN0IGxhc3RLZXkgPSBwYXRoQXJyYXlbcGF0aEFycmF5Lmxlbmd0aCAtIDFdO1xuICAgICAgaWYgKGhhc093bi5jYWxsKHRyZWUsIGxhc3RLZXkpKSB7XG4gICAgICAgIHRyZWVbbGFzdEtleV0gPSBjb25mbGljdEZuKHRyZWVbbGFzdEtleV0sIHBhdGgsIHBhdGgpO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgdHJlZVtsYXN0S2V5XSA9IG5ld0xlYWZGbihwYXRoKTtcbiAgICAgIH1cbiAgICB9XG4gIH0pO1xuXG4gIHJldHVybiByb290O1xufVxuXG4vLyBNYWtlcyBzdXJlIHdlIGdldCAyIGVsZW1lbnRzIGFycmF5IGFuZCBhc3N1bWUgdGhlIGZpcnN0IG9uZSB0byBiZSB4IGFuZFxuLy8gdGhlIHNlY29uZCBvbmUgdG8geSBubyBtYXR0ZXIgd2hhdCB1c2VyIHBhc3Nlcy5cbi8vIEluIGNhc2UgdXNlciBwYXNzZXMgeyBsb246IHgsIGxhdDogeSB9IHJldHVybnMgW3gsIHldXG5mdW5jdGlvbiBwb2ludFRvQXJyYXkocG9pbnQpIHtcbiAgcmV0dXJuIEFycmF5LmlzQXJyYXkocG9pbnQpID8gcG9pbnQuc2xpY2UoKSA6IFtwb2ludC54LCBwb2ludC55XTtcbn1cblxuLy8gQ3JlYXRpbmcgYSBkb2N1bWVudCBmcm9tIGFuIHVwc2VydCBpcyBxdWl0ZSB0cmlja3kuXG4vLyBFLmcuIHRoaXMgc2VsZWN0b3I6IHtcIiRvclwiOiBbe1wiYi5mb29cIjoge1wiJGFsbFwiOiBbXCJiYXJcIl19fV19LCBzaG91bGQgcmVzdWx0XG4vLyBpbjoge1wiYi5mb29cIjogXCJiYXJcIn1cbi8vIEJ1dCB0aGlzIHNlbGVjdG9yOiB7XCIkb3JcIjogW3tcImJcIjoge1wiZm9vXCI6IHtcIiRhbGxcIjogW1wiYmFyXCJdfX19XX0gc2hvdWxkIHRocm93XG4vLyBhbiBlcnJvclxuXG4vLyBTb21lIHJ1bGVzIChmb3VuZCBtYWlubHkgd2l0aCB0cmlhbCAmIGVycm9yLCBzbyB0aGVyZSBtaWdodCBiZSBtb3JlKTpcbi8vIC0gaGFuZGxlIGFsbCBjaGlsZHMgb2YgJGFuZCAob3IgaW1wbGljaXQgJGFuZClcbi8vIC0gaGFuZGxlICRvciBub2RlcyB3aXRoIGV4YWN0bHkgMSBjaGlsZFxuLy8gLSBpZ25vcmUgJG9yIG5vZGVzIHdpdGggbW9yZSB0aGFuIDEgY2hpbGRcbi8vIC0gaWdub3JlICRub3IgYW5kICRub3Qgbm9kZXNcbi8vIC0gdGhyb3cgd2hlbiBhIHZhbHVlIGNhbiBub3QgYmUgc2V0IHVuYW1iaWd1b3VzbHlcbi8vIC0gZXZlcnkgdmFsdWUgZm9yICRhbGwgc2hvdWxkIGJlIGRlYWx0IHdpdGggYXMgc2VwYXJhdGUgJGVxLXNcbi8vIC0gdGhyZWF0IGFsbCBjaGlsZHJlbiBvZiAkYWxsIGFzICRlcSBzZXR0ZXJzICg9PiBzZXQgaWYgJGFsbC5sZW5ndGggPT09IDEsXG4vLyAgIG90aGVyd2lzZSB0aHJvdyBlcnJvcilcbi8vIC0geW91IGNhbiBub3QgbWl4ICckJy1wcmVmaXhlZCBrZXlzIGFuZCBub24tJyQnLXByZWZpeGVkIGtleXNcbi8vIC0geW91IGNhbiBvbmx5IGhhdmUgZG90dGVkIGtleXMgb24gYSByb290LWxldmVsXG4vLyAtIHlvdSBjYW4gbm90IGhhdmUgJyQnLXByZWZpeGVkIGtleXMgbW9yZSB0aGFuIG9uZS1sZXZlbCBkZWVwIGluIGFuIG9iamVjdFxuXG4vLyBIYW5kbGVzIG9uZSBrZXkvdmFsdWUgcGFpciB0byBwdXQgaW4gdGhlIHNlbGVjdG9yIGRvY3VtZW50XG5mdW5jdGlvbiBwb3B1bGF0ZURvY3VtZW50V2l0aEtleVZhbHVlKGRvY3VtZW50LCBrZXksIHZhbHVlKSB7XG4gIGlmICh2YWx1ZSAmJiBPYmplY3QuZ2V0UHJvdG90eXBlT2YodmFsdWUpID09PSBPYmplY3QucHJvdG90eXBlKSB7XG4gICAgcG9wdWxhdGVEb2N1bWVudFdpdGhPYmplY3QoZG9jdW1lbnQsIGtleSwgdmFsdWUpO1xuICB9IGVsc2UgaWYgKCEodmFsdWUgaW5zdGFuY2VvZiBSZWdFeHApKSB7XG4gICAgaW5zZXJ0SW50b0RvY3VtZW50KGRvY3VtZW50LCBrZXksIHZhbHVlKTtcbiAgfVxufVxuXG4vLyBIYW5kbGVzIGEga2V5LCB2YWx1ZSBwYWlyIHRvIHB1dCBpbiB0aGUgc2VsZWN0b3IgZG9jdW1lbnRcbi8vIGlmIHRoZSB2YWx1ZSBpcyBhbiBvYmplY3RcbmZ1bmN0aW9uIHBvcHVsYXRlRG9jdW1lbnRXaXRoT2JqZWN0KGRvY3VtZW50LCBrZXksIHZhbHVlKSB7XG4gIGNvbnN0IGtleXMgPSBPYmplY3Qua2V5cyh2YWx1ZSk7XG4gIGNvbnN0IHVucHJlZml4ZWRLZXlzID0ga2V5cy5maWx0ZXIob3AgPT4gb3BbMF0gIT09ICckJyk7XG5cbiAgaWYgKHVucHJlZml4ZWRLZXlzLmxlbmd0aCA+IDAgfHwgIWtleXMubGVuZ3RoKSB7XG4gICAgLy8gTGl0ZXJhbCAocG9zc2libHkgZW1wdHkpIG9iamVjdCAoIG9yIGVtcHR5IG9iamVjdCApXG4gICAgLy8gRG9uJ3QgYWxsb3cgbWl4aW5nICckJy1wcmVmaXhlZCB3aXRoIG5vbi0nJCctcHJlZml4ZWQgZmllbGRzXG4gICAgaWYgKGtleXMubGVuZ3RoICE9PSB1bnByZWZpeGVkS2V5cy5sZW5ndGgpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgdW5rbm93biBvcGVyYXRvcjogJHt1bnByZWZpeGVkS2V5c1swXX1gKTtcbiAgICB9XG5cbiAgICB2YWxpZGF0ZU9iamVjdCh2YWx1ZSwga2V5KTtcbiAgICBpbnNlcnRJbnRvRG9jdW1lbnQoZG9jdW1lbnQsIGtleSwgdmFsdWUpO1xuICB9IGVsc2Uge1xuICAgIE9iamVjdC5rZXlzKHZhbHVlKS5mb3JFYWNoKG9wID0+IHtcbiAgICAgIGNvbnN0IG9iamVjdCA9IHZhbHVlW29wXTtcblxuICAgICAgaWYgKG9wID09PSAnJGVxJykge1xuICAgICAgICBwb3B1bGF0ZURvY3VtZW50V2l0aEtleVZhbHVlKGRvY3VtZW50LCBrZXksIG9iamVjdCk7XG4gICAgICB9IGVsc2UgaWYgKG9wID09PSAnJGFsbCcpIHtcbiAgICAgICAgLy8gZXZlcnkgdmFsdWUgZm9yICRhbGwgc2hvdWxkIGJlIGRlYWx0IHdpdGggYXMgc2VwYXJhdGUgJGVxLXNcbiAgICAgICAgb2JqZWN0LmZvckVhY2goZWxlbWVudCA9PlxuICAgICAgICAgIHBvcHVsYXRlRG9jdW1lbnRXaXRoS2V5VmFsdWUoZG9jdW1lbnQsIGtleSwgZWxlbWVudClcbiAgICAgICAgKTtcbiAgICAgIH1cbiAgICB9KTtcbiAgfVxufVxuXG4vLyBGaWxscyBhIGRvY3VtZW50IHdpdGggY2VydGFpbiBmaWVsZHMgZnJvbSBhbiB1cHNlcnQgc2VsZWN0b3JcbmV4cG9ydCBmdW5jdGlvbiBwb3B1bGF0ZURvY3VtZW50V2l0aFF1ZXJ5RmllbGRzKHF1ZXJ5LCBkb2N1bWVudCA9IHt9KSB7XG4gIGlmIChPYmplY3QuZ2V0UHJvdG90eXBlT2YocXVlcnkpID09PSBPYmplY3QucHJvdG90eXBlKSB7XG4gICAgLy8gaGFuZGxlIGltcGxpY2l0ICRhbmRcbiAgICBPYmplY3Qua2V5cyhxdWVyeSkuZm9yRWFjaChrZXkgPT4ge1xuICAgICAgY29uc3QgdmFsdWUgPSBxdWVyeVtrZXldO1xuXG4gICAgICBpZiAoa2V5ID09PSAnJGFuZCcpIHtcbiAgICAgICAgLy8gaGFuZGxlIGV4cGxpY2l0ICRhbmRcbiAgICAgICAgdmFsdWUuZm9yRWFjaChlbGVtZW50ID0+XG4gICAgICAgICAgcG9wdWxhdGVEb2N1bWVudFdpdGhRdWVyeUZpZWxkcyhlbGVtZW50LCBkb2N1bWVudClcbiAgICAgICAgKTtcbiAgICAgIH0gZWxzZSBpZiAoa2V5ID09PSAnJG9yJykge1xuICAgICAgICAvLyBoYW5kbGUgJG9yIG5vZGVzIHdpdGggZXhhY3RseSAxIGNoaWxkXG4gICAgICAgIGlmICh2YWx1ZS5sZW5ndGggPT09IDEpIHtcbiAgICAgICAgICBwb3B1bGF0ZURvY3VtZW50V2l0aFF1ZXJ5RmllbGRzKHZhbHVlWzBdLCBkb2N1bWVudCk7XG4gICAgICAgIH1cbiAgICAgIH0gZWxzZSBpZiAoa2V5WzBdICE9PSAnJCcpIHtcbiAgICAgICAgLy8gSWdub3JlIG90aGVyICckJy1wcmVmaXhlZCBsb2dpY2FsIHNlbGVjdG9yc1xuICAgICAgICBwb3B1bGF0ZURvY3VtZW50V2l0aEtleVZhbHVlKGRvY3VtZW50LCBrZXksIHZhbHVlKTtcbiAgICAgIH1cbiAgICB9KTtcbiAgfSBlbHNlIHtcbiAgICAvLyBIYW5kbGUgbWV0ZW9yLXNwZWNpZmljIHNob3J0Y3V0IGZvciBzZWxlY3RpbmcgX2lkXG4gICAgaWYgKExvY2FsQ29sbGVjdGlvbi5fc2VsZWN0b3JJc0lkKHF1ZXJ5KSkge1xuICAgICAgaW5zZXJ0SW50b0RvY3VtZW50KGRvY3VtZW50LCAnX2lkJywgcXVlcnkpO1xuICAgIH1cbiAgfVxuXG4gIHJldHVybiBkb2N1bWVudDtcbn1cblxuLy8gVHJhdmVyc2VzIHRoZSBrZXlzIG9mIHBhc3NlZCBwcm9qZWN0aW9uIGFuZCBjb25zdHJ1Y3RzIGEgdHJlZSB3aGVyZSBhbGxcbi8vIGxlYXZlcyBhcmUgZWl0aGVyIGFsbCBUcnVlIG9yIGFsbCBGYWxzZVxuLy8gQHJldHVybnMgT2JqZWN0OlxuLy8gIC0gdHJlZSAtIE9iamVjdCAtIHRyZWUgcmVwcmVzZW50YXRpb24gb2Yga2V5cyBpbnZvbHZlZCBpbiBwcm9qZWN0aW9uXG4vLyAgKGV4Y2VwdGlvbiBmb3IgJ19pZCcgYXMgaXQgaXMgYSBzcGVjaWFsIGNhc2UgaGFuZGxlZCBzZXBhcmF0ZWx5KVxuLy8gIC0gaW5jbHVkaW5nIC0gQm9vbGVhbiAtIFwidGFrZSBvbmx5IGNlcnRhaW4gZmllbGRzXCIgdHlwZSBvZiBwcm9qZWN0aW9uXG5leHBvcnQgZnVuY3Rpb24gcHJvamVjdGlvbkRldGFpbHMoZmllbGRzKSB7XG4gIC8vIEZpbmQgdGhlIG5vbi1faWQga2V5cyAoX2lkIGlzIGhhbmRsZWQgc3BlY2lhbGx5IGJlY2F1c2UgaXQgaXMgaW5jbHVkZWRcbiAgLy8gdW5sZXNzIGV4cGxpY2l0bHkgZXhjbHVkZWQpLiBTb3J0IHRoZSBrZXlzLCBzbyB0aGF0IG91ciBjb2RlIHRvIGRldGVjdFxuICAvLyBvdmVybGFwcyBsaWtlICdmb28nIGFuZCAnZm9vLmJhcicgY2FuIGFzc3VtZSB0aGF0ICdmb28nIGNvbWVzIGZpcnN0LlxuICBsZXQgZmllbGRzS2V5cyA9IE9iamVjdC5rZXlzKGZpZWxkcykuc29ydCgpO1xuXG4gIC8vIElmIF9pZCBpcyB0aGUgb25seSBmaWVsZCBpbiB0aGUgcHJvamVjdGlvbiwgZG8gbm90IHJlbW92ZSBpdCwgc2luY2UgaXQgaXNcbiAgLy8gcmVxdWlyZWQgdG8gZGV0ZXJtaW5lIGlmIHRoaXMgaXMgYW4gZXhjbHVzaW9uIG9yIGV4Y2x1c2lvbi4gQWxzbyBrZWVwIGFuXG4gIC8vIGluY2x1c2l2ZSBfaWQsIHNpbmNlIGluY2x1c2l2ZSBfaWQgZm9sbG93cyB0aGUgbm9ybWFsIHJ1bGVzIGFib3V0IG1peGluZ1xuICAvLyBpbmNsdXNpdmUgYW5kIGV4Y2x1c2l2ZSBmaWVsZHMuIElmIF9pZCBpcyBub3QgdGhlIG9ubHkgZmllbGQgaW4gdGhlXG4gIC8vIHByb2plY3Rpb24gYW5kIGlzIGV4Y2x1c2l2ZSwgcmVtb3ZlIGl0IHNvIGl0IGNhbiBiZSBoYW5kbGVkIGxhdGVyIGJ5IGFcbiAgLy8gc3BlY2lhbCBjYXNlLCBzaW5jZSBleGNsdXNpdmUgX2lkIGlzIGFsd2F5cyBhbGxvd2VkLlxuICBpZiAoIShmaWVsZHNLZXlzLmxlbmd0aCA9PT0gMSAmJiBmaWVsZHNLZXlzWzBdID09PSAnX2lkJykgJiZcbiAgICAgICEoZmllbGRzS2V5cy5pbmNsdWRlcygnX2lkJykgJiYgZmllbGRzLl9pZCkpIHtcbiAgICBmaWVsZHNLZXlzID0gZmllbGRzS2V5cy5maWx0ZXIoa2V5ID0+IGtleSAhPT0gJ19pZCcpO1xuICB9XG5cbiAgbGV0IGluY2x1ZGluZyA9IG51bGw7IC8vIFVua25vd25cblxuICBmaWVsZHNLZXlzLmZvckVhY2goa2V5UGF0aCA9PiB7XG4gICAgY29uc3QgcnVsZSA9ICEhZmllbGRzW2tleVBhdGhdO1xuXG4gICAgaWYgKGluY2x1ZGluZyA9PT0gbnVsbCkge1xuICAgICAgaW5jbHVkaW5nID0gcnVsZTtcbiAgICB9XG5cbiAgICAvLyBUaGlzIGVycm9yIG1lc3NhZ2UgaXMgY29waWVkIGZyb20gTW9uZ29EQiBzaGVsbFxuICAgIGlmIChpbmNsdWRpbmcgIT09IHJ1bGUpIHtcbiAgICAgIHRocm93IE1pbmltb25nb0Vycm9yKFxuICAgICAgICAnWW91IGNhbm5vdCBjdXJyZW50bHkgbWl4IGluY2x1ZGluZyBhbmQgZXhjbHVkaW5nIGZpZWxkcy4nXG4gICAgICApO1xuICAgIH1cbiAgfSk7XG5cbiAgY29uc3QgcHJvamVjdGlvblJ1bGVzVHJlZSA9IHBhdGhzVG9UcmVlKFxuICAgIGZpZWxkc0tleXMsXG4gICAgcGF0aCA9PiBpbmNsdWRpbmcsXG4gICAgKG5vZGUsIHBhdGgsIGZ1bGxQYXRoKSA9PiB7XG4gICAgICAvLyBDaGVjayBwYXNzZWQgcHJvamVjdGlvbiBmaWVsZHMnIGtleXM6IElmIHlvdSBoYXZlIHR3byBydWxlcyBzdWNoIGFzXG4gICAgICAvLyAnZm9vLmJhcicgYW5kICdmb28uYmFyLmJheicsIHRoZW4gdGhlIHJlc3VsdCBiZWNvbWVzIGFtYmlndW91cy4gSWZcbiAgICAgIC8vIHRoYXQgaGFwcGVucywgdGhlcmUgaXMgYSBwcm9iYWJpbGl0eSB5b3UgYXJlIGRvaW5nIHNvbWV0aGluZyB3cm9uZyxcbiAgICAgIC8vIGZyYW1ld29yayBzaG91bGQgbm90aWZ5IHlvdSBhYm91dCBzdWNoIG1pc3Rha2UgZWFybGllciBvbiBjdXJzb3JcbiAgICAgIC8vIGNvbXBpbGF0aW9uIHN0ZXAgdGhhbiBsYXRlciBkdXJpbmcgcnVudGltZS4gIE5vdGUsIHRoYXQgcmVhbCBtb25nb1xuICAgICAgLy8gZG9lc24ndCBkbyBhbnl0aGluZyBhYm91dCBpdCBhbmQgdGhlIGxhdGVyIHJ1bGUgYXBwZWFycyBpbiBwcm9qZWN0aW9uXG4gICAgICAvLyBwcm9qZWN0LCBtb3JlIHByaW9yaXR5IGl0IHRha2VzLlxuICAgICAgLy9cbiAgICAgIC8vIEV4YW1wbGUsIGFzc3VtZSBmb2xsb3dpbmcgaW4gbW9uZ28gc2hlbGw6XG4gICAgICAvLyA+IGRiLmNvbGwuaW5zZXJ0KHsgYTogeyBiOiAyMywgYzogNDQgfSB9KVxuICAgICAgLy8gPiBkYi5jb2xsLmZpbmQoe30sIHsgJ2EnOiAxLCAnYS5iJzogMSB9KVxuICAgICAgLy8ge1wiX2lkXCI6IE9iamVjdElkKFwiNTIwYmZlNDU2MDI0NjA4ZThlZjI0YWYzXCIpLCBcImFcIjoge1wiYlwiOiAyM319XG4gICAgICAvLyA+IGRiLmNvbGwuZmluZCh7fSwgeyAnYS5iJzogMSwgJ2EnOiAxIH0pXG4gICAgICAvLyB7XCJfaWRcIjogT2JqZWN0SWQoXCI1MjBiZmU0NTYwMjQ2MDhlOGVmMjRhZjNcIiksIFwiYVwiOiB7XCJiXCI6IDIzLCBcImNcIjogNDR9fVxuICAgICAgLy9cbiAgICAgIC8vIE5vdGUsIGhvdyBzZWNvbmQgdGltZSB0aGUgcmV0dXJuIHNldCBvZiBrZXlzIGlzIGRpZmZlcmVudC5cbiAgICAgIGNvbnN0IGN1cnJlbnRQYXRoID0gZnVsbFBhdGg7XG4gICAgICBjb25zdCBhbm90aGVyUGF0aCA9IHBhdGg7XG4gICAgICB0aHJvdyBNaW5pbW9uZ29FcnJvcihcbiAgICAgICAgYGJvdGggJHtjdXJyZW50UGF0aH0gYW5kICR7YW5vdGhlclBhdGh9IGZvdW5kIGluIGZpZWxkcyBvcHRpb24sIGAgK1xuICAgICAgICAndXNpbmcgYm90aCBvZiB0aGVtIG1heSB0cmlnZ2VyIHVuZXhwZWN0ZWQgYmVoYXZpb3IuIERpZCB5b3UgbWVhbiB0byAnICtcbiAgICAgICAgJ3VzZSBvbmx5IG9uZSBvZiB0aGVtPydcbiAgICAgICk7XG4gICAgfSk7XG5cbiAgcmV0dXJuIHtpbmNsdWRpbmcsIHRyZWU6IHByb2plY3Rpb25SdWxlc1RyZWV9O1xufVxuXG4vLyBUYWtlcyBhIFJlZ0V4cCBvYmplY3QgYW5kIHJldHVybnMgYW4gZWxlbWVudCBtYXRjaGVyLlxuZXhwb3J0IGZ1bmN0aW9uIHJlZ2V4cEVsZW1lbnRNYXRjaGVyKHJlZ2V4cCkge1xuICByZXR1cm4gdmFsdWUgPT4ge1xuICAgIGlmICh2YWx1ZSBpbnN0YW5jZW9mIFJlZ0V4cCkge1xuICAgICAgcmV0dXJuIHZhbHVlLnRvU3RyaW5nKCkgPT09IHJlZ2V4cC50b1N0cmluZygpO1xuICAgIH1cblxuICAgIC8vIFJlZ2V4cHMgb25seSB3b3JrIGFnYWluc3Qgc3RyaW5ncy5cbiAgICBpZiAodHlwZW9mIHZhbHVlICE9PSAnc3RyaW5nJykge1xuICAgICAgcmV0dXJuIGZhbHNlO1xuICAgIH1cblxuICAgIC8vIFJlc2V0IHJlZ2V4cCdzIHN0YXRlIHRvIGF2b2lkIGluY29uc2lzdGVudCBtYXRjaGluZyBmb3Igb2JqZWN0cyB3aXRoIHRoZVxuICAgIC8vIHNhbWUgdmFsdWUgb24gY29uc2VjdXRpdmUgY2FsbHMgb2YgcmVnZXhwLnRlc3QuIFRoaXMgaGFwcGVucyBvbmx5IGlmIHRoZVxuICAgIC8vIHJlZ2V4cCBoYXMgdGhlICdnJyBmbGFnLiBBbHNvIG5vdGUgdGhhdCBFUzYgaW50cm9kdWNlcyBhIG5ldyBmbGFnICd5JyBmb3JcbiAgICAvLyB3aGljaCB3ZSBzaG91bGQgKm5vdCogY2hhbmdlIHRoZSBsYXN0SW5kZXggYnV0IE1vbmdvREIgZG9lc24ndCBzdXBwb3J0XG4gICAgLy8gZWl0aGVyIG9mIHRoZXNlIGZsYWdzLlxuICAgIHJlZ2V4cC5sYXN0SW5kZXggPSAwO1xuXG4gICAgcmV0dXJuIHJlZ2V4cC50ZXN0KHZhbHVlKTtcbiAgfTtcbn1cblxuLy8gVmFsaWRhdGVzIHRoZSBrZXkgaW4gYSBwYXRoLlxuLy8gT2JqZWN0cyB0aGF0IGFyZSBuZXN0ZWQgbW9yZSB0aGVuIDEgbGV2ZWwgY2Fubm90IGhhdmUgZG90dGVkIGZpZWxkc1xuLy8gb3IgZmllbGRzIHN0YXJ0aW5nIHdpdGggJyQnXG5mdW5jdGlvbiB2YWxpZGF0ZUtleUluUGF0aChrZXksIHBhdGgpIHtcbiAgaWYgKGtleS5pbmNsdWRlcygnLicpKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKFxuICAgICAgYFRoZSBkb3R0ZWQgZmllbGQgJyR7a2V5fScgaW4gJyR7cGF0aH0uJHtrZXl9IGlzIG5vdCB2YWxpZCBmb3Igc3RvcmFnZS5gXG4gICAgKTtcbiAgfVxuXG4gIGlmIChrZXlbMF0gPT09ICckJykge1xuICAgIHRocm93IG5ldyBFcnJvcihcbiAgICAgIGBUaGUgZG9sbGFyICgkKSBwcmVmaXhlZCBmaWVsZCAgJyR7cGF0aH0uJHtrZXl9IGlzIG5vdCB2YWxpZCBmb3Igc3RvcmFnZS5gXG4gICAgKTtcbiAgfVxufVxuXG4vLyBSZWN1cnNpdmVseSB2YWxpZGF0ZXMgYW4gb2JqZWN0IHRoYXQgaXMgbmVzdGVkIG1vcmUgdGhhbiBvbmUgbGV2ZWwgZGVlcFxuZnVuY3Rpb24gdmFsaWRhdGVPYmplY3Qob2JqZWN0LCBwYXRoKSB7XG4gIGlmIChvYmplY3QgJiYgT2JqZWN0LmdldFByb3RvdHlwZU9mKG9iamVjdCkgPT09IE9iamVjdC5wcm90b3R5cGUpIHtcbiAgICBPYmplY3Qua2V5cyhvYmplY3QpLmZvckVhY2goa2V5ID0+IHtcbiAgICAgIHZhbGlkYXRlS2V5SW5QYXRoKGtleSwgcGF0aCk7XG4gICAgICB2YWxpZGF0ZU9iamVjdChvYmplY3Rba2V5XSwgcGF0aCArICcuJyArIGtleSk7XG4gICAgfSk7XG4gIH1cbn1cbiIsImltcG9ydCBMb2NhbENvbGxlY3Rpb24gZnJvbSAnLi9sb2NhbF9jb2xsZWN0aW9uLmpzJztcbmltcG9ydCB7IGhhc093biB9IGZyb20gJy4vY29tbW9uLmpzJztcblxuLy8gQ3Vyc29yOiBhIHNwZWNpZmljYXRpb24gZm9yIGEgcGFydGljdWxhciBzdWJzZXQgb2YgZG9jdW1lbnRzLCB3LyBhIGRlZmluZWRcbi8vIG9yZGVyLCBsaW1pdCwgYW5kIG9mZnNldC4gIGNyZWF0aW5nIGEgQ3Vyc29yIHdpdGggTG9jYWxDb2xsZWN0aW9uLmZpbmQoKSxcbmV4cG9ydCBkZWZhdWx0IGNsYXNzIEN1cnNvciB7XG4gIC8vIGRvbid0IGNhbGwgdGhpcyBjdG9yIGRpcmVjdGx5LiAgdXNlIExvY2FsQ29sbGVjdGlvbi5maW5kKCkuXG4gIGNvbnN0cnVjdG9yKGNvbGxlY3Rpb24sIHNlbGVjdG9yLCBvcHRpb25zID0ge30pIHtcbiAgICB0aGlzLmNvbGxlY3Rpb24gPSBjb2xsZWN0aW9uO1xuICAgIHRoaXMuc29ydGVyID0gbnVsbDtcbiAgICB0aGlzLm1hdGNoZXIgPSBuZXcgTWluaW1vbmdvLk1hdGNoZXIoc2VsZWN0b3IpO1xuXG4gICAgaWYgKExvY2FsQ29sbGVjdGlvbi5fc2VsZWN0b3JJc0lkUGVyaGFwc0FzT2JqZWN0KHNlbGVjdG9yKSkge1xuICAgICAgLy8gc3Rhc2ggZm9yIGZhc3QgX2lkIGFuZCB7IF9pZCB9XG4gICAgICB0aGlzLl9zZWxlY3RvcklkID0gaGFzT3duLmNhbGwoc2VsZWN0b3IsICdfaWQnKVxuICAgICAgICA/IHNlbGVjdG9yLl9pZFxuICAgICAgICA6IHNlbGVjdG9yO1xuICAgIH0gZWxzZSB7XG4gICAgICB0aGlzLl9zZWxlY3RvcklkID0gdW5kZWZpbmVkO1xuXG4gICAgICBpZiAodGhpcy5tYXRjaGVyLmhhc0dlb1F1ZXJ5KCkgfHwgb3B0aW9ucy5zb3J0KSB7XG4gICAgICAgIHRoaXMuc29ydGVyID0gbmV3IE1pbmltb25nby5Tb3J0ZXIob3B0aW9ucy5zb3J0IHx8IFtdKTtcbiAgICAgIH1cbiAgICB9XG5cbiAgICB0aGlzLnNraXAgPSBvcHRpb25zLnNraXAgfHwgMDtcbiAgICB0aGlzLmxpbWl0ID0gb3B0aW9ucy5saW1pdDtcbiAgICB0aGlzLmZpZWxkcyA9IG9wdGlvbnMuZmllbGRzO1xuXG4gICAgdGhpcy5fcHJvamVjdGlvbkZuID0gTG9jYWxDb2xsZWN0aW9uLl9jb21waWxlUHJvamVjdGlvbih0aGlzLmZpZWxkcyB8fCB7fSk7XG5cbiAgICB0aGlzLl90cmFuc2Zvcm0gPSBMb2NhbENvbGxlY3Rpb24ud3JhcFRyYW5zZm9ybShvcHRpb25zLnRyYW5zZm9ybSk7XG5cbiAgICAvLyBieSBkZWZhdWx0LCBxdWVyaWVzIHJlZ2lzdGVyIHcvIFRyYWNrZXIgd2hlbiBpdCBpcyBhdmFpbGFibGUuXG4gICAgaWYgKHR5cGVvZiBUcmFja2VyICE9PSAndW5kZWZpbmVkJykge1xuICAgICAgdGhpcy5yZWFjdGl2ZSA9IG9wdGlvbnMucmVhY3RpdmUgPT09IHVuZGVmaW5lZCA/IHRydWUgOiBvcHRpb25zLnJlYWN0aXZlO1xuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBAc3VtbWFyeSBSZXR1cm5zIHRoZSBudW1iZXIgb2YgZG9jdW1lbnRzIHRoYXQgbWF0Y2ggYSBxdWVyeS5cbiAgICogQG1lbWJlck9mIE1vbmdvLkN1cnNvclxuICAgKiBAbWV0aG9kICBjb3VudFxuICAgKiBAcGFyYW0ge2Jvb2xlYW59IFthcHBseVNraXBMaW1pdD10cnVlXSBJZiBzZXQgdG8gYGZhbHNlYCwgdGhlIHZhbHVlXG4gICAqICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICByZXR1cm5lZCB3aWxsIHJlZmxlY3QgdGhlIHRvdGFsXG4gICAqICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBudW1iZXIgb2YgbWF0Y2hpbmcgZG9jdW1lbnRzLFxuICAgKiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgaWdub3JpbmcgYW55IHZhbHVlIHN1cHBsaWVkIGZvclxuICAgKiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgbGltaXRcbiAgICogQGluc3RhbmNlXG4gICAqIEBsb2N1cyBBbnl3aGVyZVxuICAgKiBAcmV0dXJucyB7TnVtYmVyfVxuICAgKi9cbiAgY291bnQoYXBwbHlTa2lwTGltaXQgPSB0cnVlKSB7XG4gICAgaWYgKHRoaXMucmVhY3RpdmUpIHtcbiAgICAgIC8vIGFsbG93IHRoZSBvYnNlcnZlIHRvIGJlIHVub3JkZXJlZFxuICAgICAgdGhpcy5fZGVwZW5kKHthZGRlZDogdHJ1ZSwgcmVtb3ZlZDogdHJ1ZX0sIHRydWUpO1xuICAgIH1cblxuICAgIHJldHVybiB0aGlzLl9nZXRSYXdPYmplY3RzKHtcbiAgICAgIG9yZGVyZWQ6IHRydWUsXG4gICAgICBhcHBseVNraXBMaW1pdFxuICAgIH0pLmxlbmd0aDtcbiAgfVxuXG4gIC8qKlxuICAgKiBAc3VtbWFyeSBSZXR1cm4gYWxsIG1hdGNoaW5nIGRvY3VtZW50cyBhcyBhbiBBcnJheS5cbiAgICogQG1lbWJlck9mIE1vbmdvLkN1cnNvclxuICAgKiBAbWV0aG9kICBmZXRjaFxuICAgKiBAaW5zdGFuY2VcbiAgICogQGxvY3VzIEFueXdoZXJlXG4gICAqIEByZXR1cm5zIHtPYmplY3RbXX1cbiAgICovXG4gIGZldGNoKCkge1xuICAgIGNvbnN0IHJlc3VsdCA9IFtdO1xuXG4gICAgdGhpcy5mb3JFYWNoKGRvYyA9PiB7XG4gICAgICByZXN1bHQucHVzaChkb2MpO1xuICAgIH0pO1xuXG4gICAgcmV0dXJuIHJlc3VsdDtcbiAgfVxuXG4gIFtTeW1ib2wuaXRlcmF0b3JdKCkge1xuICAgIGlmICh0aGlzLnJlYWN0aXZlKSB7XG4gICAgICB0aGlzLl9kZXBlbmQoe1xuICAgICAgICBhZGRlZEJlZm9yZTogdHJ1ZSxcbiAgICAgICAgcmVtb3ZlZDogdHJ1ZSxcbiAgICAgICAgY2hhbmdlZDogdHJ1ZSxcbiAgICAgICAgbW92ZWRCZWZvcmU6IHRydWV9KTtcbiAgICB9XG5cbiAgICBsZXQgaW5kZXggPSAwO1xuICAgIGNvbnN0IG9iamVjdHMgPSB0aGlzLl9nZXRSYXdPYmplY3RzKHtvcmRlcmVkOiB0cnVlfSk7XG5cbiAgICByZXR1cm4ge1xuICAgICAgbmV4dDogKCkgPT4ge1xuICAgICAgICBpZiAoaW5kZXggPCBvYmplY3RzLmxlbmd0aCkge1xuICAgICAgICAgIC8vIFRoaXMgZG91YmxlcyBhcyBhIGNsb25lIG9wZXJhdGlvbi5cbiAgICAgICAgICBsZXQgZWxlbWVudCA9IHRoaXMuX3Byb2plY3Rpb25GbihvYmplY3RzW2luZGV4KytdKTtcblxuICAgICAgICAgIGlmICh0aGlzLl90cmFuc2Zvcm0pXG4gICAgICAgICAgICBlbGVtZW50ID0gdGhpcy5fdHJhbnNmb3JtKGVsZW1lbnQpO1xuXG4gICAgICAgICAgcmV0dXJuIHt2YWx1ZTogZWxlbWVudH07XG4gICAgICAgIH1cblxuICAgICAgICByZXR1cm4ge2RvbmU6IHRydWV9O1xuICAgICAgfVxuICAgIH07XG4gIH1cblxuICAvKipcbiAgICogQGNhbGxiYWNrIEl0ZXJhdGlvbkNhbGxiYWNrXG4gICAqIEBwYXJhbSB7T2JqZWN0fSBkb2NcbiAgICogQHBhcmFtIHtOdW1iZXJ9IGluZGV4XG4gICAqL1xuICAvKipcbiAgICogQHN1bW1hcnkgQ2FsbCBgY2FsbGJhY2tgIG9uY2UgZm9yIGVhY2ggbWF0Y2hpbmcgZG9jdW1lbnQsIHNlcXVlbnRpYWxseSBhbmRcbiAgICogICAgICAgICAgc3luY2hyb25vdXNseS5cbiAgICogQGxvY3VzIEFueXdoZXJlXG4gICAqIEBtZXRob2QgIGZvckVhY2hcbiAgICogQGluc3RhbmNlXG4gICAqIEBtZW1iZXJPZiBNb25nby5DdXJzb3JcbiAgICogQHBhcmFtIHtJdGVyYXRpb25DYWxsYmFja30gY2FsbGJhY2sgRnVuY3Rpb24gdG8gY2FsbC4gSXQgd2lsbCBiZSBjYWxsZWRcbiAgICogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgd2l0aCB0aHJlZSBhcmd1bWVudHM6IHRoZSBkb2N1bWVudCwgYVxuICAgKiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAwLWJhc2VkIGluZGV4LCBhbmQgPGVtPmN1cnNvcjwvZW0+XG4gICAqICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGl0c2VsZi5cbiAgICogQHBhcmFtIHtBbnl9IFt0aGlzQXJnXSBBbiBvYmplY3Qgd2hpY2ggd2lsbCBiZSB0aGUgdmFsdWUgb2YgYHRoaXNgIGluc2lkZVxuICAgKiAgICAgICAgICAgICAgICAgICAgICAgIGBjYWxsYmFja2AuXG4gICAqL1xuICBmb3JFYWNoKGNhbGxiYWNrLCB0aGlzQXJnKSB7XG4gICAgaWYgKHRoaXMucmVhY3RpdmUpIHtcbiAgICAgIHRoaXMuX2RlcGVuZCh7XG4gICAgICAgIGFkZGVkQmVmb3JlOiB0cnVlLFxuICAgICAgICByZW1vdmVkOiB0cnVlLFxuICAgICAgICBjaGFuZ2VkOiB0cnVlLFxuICAgICAgICBtb3ZlZEJlZm9yZTogdHJ1ZX0pO1xuICAgIH1cblxuICAgIHRoaXMuX2dldFJhd09iamVjdHMoe29yZGVyZWQ6IHRydWV9KS5mb3JFYWNoKChlbGVtZW50LCBpKSA9PiB7XG4gICAgICAvLyBUaGlzIGRvdWJsZXMgYXMgYSBjbG9uZSBvcGVyYXRpb24uXG4gICAgICBlbGVtZW50ID0gdGhpcy5fcHJvamVjdGlvbkZuKGVsZW1lbnQpO1xuXG4gICAgICBpZiAodGhpcy5fdHJhbnNmb3JtKSB7XG4gICAgICAgIGVsZW1lbnQgPSB0aGlzLl90cmFuc2Zvcm0oZWxlbWVudCk7XG4gICAgICB9XG5cbiAgICAgIGNhbGxiYWNrLmNhbGwodGhpc0FyZywgZWxlbWVudCwgaSwgdGhpcyk7XG4gICAgfSk7XG4gIH1cblxuICBnZXRUcmFuc2Zvcm0oKSB7XG4gICAgcmV0dXJuIHRoaXMuX3RyYW5zZm9ybTtcbiAgfVxuXG4gIC8qKlxuICAgKiBAc3VtbWFyeSBNYXAgY2FsbGJhY2sgb3ZlciBhbGwgbWF0Y2hpbmcgZG9jdW1lbnRzLiAgUmV0dXJucyBhbiBBcnJheS5cbiAgICogQGxvY3VzIEFueXdoZXJlXG4gICAqIEBtZXRob2QgbWFwXG4gICAqIEBpbnN0YW5jZVxuICAgKiBAbWVtYmVyT2YgTW9uZ28uQ3Vyc29yXG4gICAqIEBwYXJhbSB7SXRlcmF0aW9uQ2FsbGJhY2t9IGNhbGxiYWNrIEZ1bmN0aW9uIHRvIGNhbGwuIEl0IHdpbGwgYmUgY2FsbGVkXG4gICAqICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHdpdGggdGhyZWUgYXJndW1lbnRzOiB0aGUgZG9jdW1lbnQsIGFcbiAgICogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgMC1iYXNlZCBpbmRleCwgYW5kIDxlbT5jdXJzb3I8L2VtPlxuICAgKiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBpdHNlbGYuXG4gICAqIEBwYXJhbSB7QW55fSBbdGhpc0FyZ10gQW4gb2JqZWN0IHdoaWNoIHdpbGwgYmUgdGhlIHZhbHVlIG9mIGB0aGlzYCBpbnNpZGVcbiAgICogICAgICAgICAgICAgICAgICAgICAgICBgY2FsbGJhY2tgLlxuICAgKi9cbiAgbWFwKGNhbGxiYWNrLCB0aGlzQXJnKSB7XG4gICAgY29uc3QgcmVzdWx0ID0gW107XG5cbiAgICB0aGlzLmZvckVhY2goKGRvYywgaSkgPT4ge1xuICAgICAgcmVzdWx0LnB1c2goY2FsbGJhY2suY2FsbCh0aGlzQXJnLCBkb2MsIGksIHRoaXMpKTtcbiAgICB9KTtcblxuICAgIHJldHVybiByZXN1bHQ7XG4gIH1cblxuICAvLyBvcHRpb25zIHRvIGNvbnRhaW46XG4gIC8vICAqIGNhbGxiYWNrcyBmb3Igb2JzZXJ2ZSgpOlxuICAvLyAgICAtIGFkZGVkQXQgKGRvY3VtZW50LCBhdEluZGV4KVxuICAvLyAgICAtIGFkZGVkIChkb2N1bWVudClcbiAgLy8gICAgLSBjaGFuZ2VkQXQgKG5ld0RvY3VtZW50LCBvbGREb2N1bWVudCwgYXRJbmRleClcbiAgLy8gICAgLSBjaGFuZ2VkIChuZXdEb2N1bWVudCwgb2xkRG9jdW1lbnQpXG4gIC8vICAgIC0gcmVtb3ZlZEF0IChkb2N1bWVudCwgYXRJbmRleClcbiAgLy8gICAgLSByZW1vdmVkIChkb2N1bWVudClcbiAgLy8gICAgLSBtb3ZlZFRvIChkb2N1bWVudCwgb2xkSW5kZXgsIG5ld0luZGV4KVxuICAvL1xuICAvLyBhdHRyaWJ1dGVzIGF2YWlsYWJsZSBvbiByZXR1cm5lZCBxdWVyeSBoYW5kbGU6XG4gIC8vICAqIHN0b3AoKTogZW5kIHVwZGF0ZXNcbiAgLy8gICogY29sbGVjdGlvbjogdGhlIGNvbGxlY3Rpb24gdGhpcyBxdWVyeSBpcyBxdWVyeWluZ1xuICAvL1xuICAvLyBpZmYgeCBpcyBhIHJldHVybmVkIHF1ZXJ5IGhhbmRsZSwgKHggaW5zdGFuY2VvZlxuICAvLyBMb2NhbENvbGxlY3Rpb24uT2JzZXJ2ZUhhbmRsZSkgaXMgdHJ1ZVxuICAvL1xuICAvLyBpbml0aWFsIHJlc3VsdHMgZGVsaXZlcmVkIHRocm91Z2ggYWRkZWQgY2FsbGJhY2tcbiAgLy8gWFhYIG1heWJlIGNhbGxiYWNrcyBzaG91bGQgdGFrZSBhIGxpc3Qgb2Ygb2JqZWN0cywgdG8gZXhwb3NlIHRyYW5zYWN0aW9ucz9cbiAgLy8gWFhYIG1heWJlIHN1cHBvcnQgZmllbGQgbGltaXRpbmcgKHRvIGxpbWl0IHdoYXQgeW91J3JlIG5vdGlmaWVkIG9uKVxuXG4gIC8qKlxuICAgKiBAc3VtbWFyeSBXYXRjaCBhIHF1ZXJ5LiAgUmVjZWl2ZSBjYWxsYmFja3MgYXMgdGhlIHJlc3VsdCBzZXQgY2hhbmdlcy5cbiAgICogQGxvY3VzIEFueXdoZXJlXG4gICAqIEBtZW1iZXJPZiBNb25nby5DdXJzb3JcbiAgICogQGluc3RhbmNlXG4gICAqIEBwYXJhbSB7T2JqZWN0fSBjYWxsYmFja3MgRnVuY3Rpb25zIHRvIGNhbGwgdG8gZGVsaXZlciB0aGUgcmVzdWx0IHNldCBhcyBpdFxuICAgKiAgICAgICAgICAgICAgICAgICAgICAgICAgIGNoYW5nZXNcbiAgICovXG4gIG9ic2VydmUob3B0aW9ucykge1xuICAgIHJldHVybiBMb2NhbENvbGxlY3Rpb24uX29ic2VydmVGcm9tT2JzZXJ2ZUNoYW5nZXModGhpcywgb3B0aW9ucyk7XG4gIH1cblxuICAvKipcbiAgICogQHN1bW1hcnkgV2F0Y2ggYSBxdWVyeS4gUmVjZWl2ZSBjYWxsYmFja3MgYXMgdGhlIHJlc3VsdCBzZXQgY2hhbmdlcy4gT25seVxuICAgKiAgICAgICAgICB0aGUgZGlmZmVyZW5jZXMgYmV0d2VlbiB0aGUgb2xkIGFuZCBuZXcgZG9jdW1lbnRzIGFyZSBwYXNzZWQgdG9cbiAgICogICAgICAgICAgdGhlIGNhbGxiYWNrcy5cbiAgICogQGxvY3VzIEFueXdoZXJlXG4gICAqIEBtZW1iZXJPZiBNb25nby5DdXJzb3JcbiAgICogQGluc3RhbmNlXG4gICAqIEBwYXJhbSB7T2JqZWN0fSBjYWxsYmFja3MgRnVuY3Rpb25zIHRvIGNhbGwgdG8gZGVsaXZlciB0aGUgcmVzdWx0IHNldCBhcyBpdFxuICAgKiAgICAgICAgICAgICAgICAgICAgICAgICAgIGNoYW5nZXNcbiAgICovXG4gIG9ic2VydmVDaGFuZ2VzKG9wdGlvbnMpIHtcbiAgICBjb25zdCBvcmRlcmVkID0gTG9jYWxDb2xsZWN0aW9uLl9vYnNlcnZlQ2hhbmdlc0NhbGxiYWNrc0FyZU9yZGVyZWQob3B0aW9ucyk7XG5cbiAgICAvLyB0aGVyZSBhcmUgc2V2ZXJhbCBwbGFjZXMgdGhhdCBhc3N1bWUgeW91IGFyZW4ndCBjb21iaW5pbmcgc2tpcC9saW1pdCB3aXRoXG4gICAgLy8gdW5vcmRlcmVkIG9ic2VydmUuICBlZywgdXBkYXRlJ3MgRUpTT04uY2xvbmUsIGFuZCB0aGUgXCJ0aGVyZSBhcmUgc2V2ZXJhbFwiXG4gICAgLy8gY29tbWVudCBpbiBfbW9kaWZ5QW5kTm90aWZ5XG4gICAgLy8gWFhYIGFsbG93IHNraXAvbGltaXQgd2l0aCB1bm9yZGVyZWQgb2JzZXJ2ZVxuICAgIGlmICghb3B0aW9ucy5fYWxsb3dfdW5vcmRlcmVkICYmICFvcmRlcmVkICYmICh0aGlzLnNraXAgfHwgdGhpcy5saW1pdCkpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihcbiAgICAgICAgXCJNdXN0IHVzZSBhbiBvcmRlcmVkIG9ic2VydmUgd2l0aCBza2lwIG9yIGxpbWl0IChpLmUuICdhZGRlZEJlZm9yZScgXCIgK1xuICAgICAgICBcImZvciBvYnNlcnZlQ2hhbmdlcyBvciAnYWRkZWRBdCcgZm9yIG9ic2VydmUsIGluc3RlYWQgb2YgJ2FkZGVkJykuXCJcbiAgICAgICk7XG4gICAgfVxuXG4gICAgaWYgKHRoaXMuZmllbGRzICYmICh0aGlzLmZpZWxkcy5faWQgPT09IDAgfHwgdGhpcy5maWVsZHMuX2lkID09PSBmYWxzZSkpIHtcbiAgICAgIHRocm93IEVycm9yKCdZb3UgbWF5IG5vdCBvYnNlcnZlIGEgY3Vyc29yIHdpdGgge2ZpZWxkczoge19pZDogMH19Jyk7XG4gICAgfVxuXG4gICAgY29uc3QgZGlzdGFuY2VzID0gKFxuICAgICAgdGhpcy5tYXRjaGVyLmhhc0dlb1F1ZXJ5KCkgJiZcbiAgICAgIG9yZGVyZWQgJiZcbiAgICAgIG5ldyBMb2NhbENvbGxlY3Rpb24uX0lkTWFwXG4gICAgKTtcblxuICAgIGNvbnN0IHF1ZXJ5ID0ge1xuICAgICAgY3Vyc29yOiB0aGlzLFxuICAgICAgZGlydHk6IGZhbHNlLFxuICAgICAgZGlzdGFuY2VzLFxuICAgICAgbWF0Y2hlcjogdGhpcy5tYXRjaGVyLCAvLyBub3QgZmFzdCBwYXRoZWRcbiAgICAgIG9yZGVyZWQsXG4gICAgICBwcm9qZWN0aW9uRm46IHRoaXMuX3Byb2plY3Rpb25GbixcbiAgICAgIHJlc3VsdHNTbmFwc2hvdDogbnVsbCxcbiAgICAgIHNvcnRlcjogb3JkZXJlZCAmJiB0aGlzLnNvcnRlclxuICAgIH07XG5cbiAgICBsZXQgcWlkO1xuXG4gICAgLy8gTm9uLXJlYWN0aXZlIHF1ZXJpZXMgY2FsbCBhZGRlZFtCZWZvcmVdIGFuZCB0aGVuIG5ldmVyIGNhbGwgYW55dGhpbmdcbiAgICAvLyBlbHNlLlxuICAgIGlmICh0aGlzLnJlYWN0aXZlKSB7XG4gICAgICBxaWQgPSB0aGlzLmNvbGxlY3Rpb24ubmV4dF9xaWQrKztcbiAgICAgIHRoaXMuY29sbGVjdGlvbi5xdWVyaWVzW3FpZF0gPSBxdWVyeTtcbiAgICB9XG5cbiAgICBxdWVyeS5yZXN1bHRzID0gdGhpcy5fZ2V0UmF3T2JqZWN0cyh7b3JkZXJlZCwgZGlzdGFuY2VzOiBxdWVyeS5kaXN0YW5jZXN9KTtcblxuICAgIGlmICh0aGlzLmNvbGxlY3Rpb24ucGF1c2VkKSB7XG4gICAgICBxdWVyeS5yZXN1bHRzU25hcHNob3QgPSBvcmRlcmVkID8gW10gOiBuZXcgTG9jYWxDb2xsZWN0aW9uLl9JZE1hcDtcbiAgICB9XG5cbiAgICAvLyB3cmFwIGNhbGxiYWNrcyB3ZSB3ZXJlIHBhc3NlZC4gY2FsbGJhY2tzIG9ubHkgZmlyZSB3aGVuIG5vdCBwYXVzZWQgYW5kXG4gICAgLy8gYXJlIG5ldmVyIHVuZGVmaW5lZFxuICAgIC8vIEZpbHRlcnMgb3V0IGJsYWNrbGlzdGVkIGZpZWxkcyBhY2NvcmRpbmcgdG8gY3Vyc29yJ3MgcHJvamVjdGlvbi5cbiAgICAvLyBYWFggd3JvbmcgcGxhY2UgZm9yIHRoaXM/XG5cbiAgICAvLyBmdXJ0aGVybW9yZSwgY2FsbGJhY2tzIGVucXVldWUgdW50aWwgdGhlIG9wZXJhdGlvbiB3ZSdyZSB3b3JraW5nIG9uIGlzXG4gICAgLy8gZG9uZS5cbiAgICBjb25zdCB3cmFwQ2FsbGJhY2sgPSBmbiA9PiB7XG4gICAgICBpZiAoIWZuKSB7XG4gICAgICAgIHJldHVybiAoKSA9PiB7fTtcbiAgICAgIH1cblxuICAgICAgY29uc3Qgc2VsZiA9IHRoaXM7XG4gICAgICByZXR1cm4gZnVuY3Rpb24oLyogYXJncyovKSB7XG4gICAgICAgIGlmIChzZWxmLmNvbGxlY3Rpb24ucGF1c2VkKSB7XG4gICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG5cbiAgICAgICAgY29uc3QgYXJncyA9IGFyZ3VtZW50cztcblxuICAgICAgICBzZWxmLmNvbGxlY3Rpb24uX29ic2VydmVRdWV1ZS5xdWV1ZVRhc2soKCkgPT4ge1xuICAgICAgICAgIGZuLmFwcGx5KHRoaXMsIGFyZ3MpO1xuICAgICAgICB9KTtcbiAgICAgIH07XG4gICAgfTtcblxuICAgIHF1ZXJ5LmFkZGVkID0gd3JhcENhbGxiYWNrKG9wdGlvbnMuYWRkZWQpO1xuICAgIHF1ZXJ5LmNoYW5nZWQgPSB3cmFwQ2FsbGJhY2sob3B0aW9ucy5jaGFuZ2VkKTtcbiAgICBxdWVyeS5yZW1vdmVkID0gd3JhcENhbGxiYWNrKG9wdGlvbnMucmVtb3ZlZCk7XG5cbiAgICBpZiAob3JkZXJlZCkge1xuICAgICAgcXVlcnkuYWRkZWRCZWZvcmUgPSB3cmFwQ2FsbGJhY2sob3B0aW9ucy5hZGRlZEJlZm9yZSk7XG4gICAgICBxdWVyeS5tb3ZlZEJlZm9yZSA9IHdyYXBDYWxsYmFjayhvcHRpb25zLm1vdmVkQmVmb3JlKTtcbiAgICB9XG5cbiAgICBpZiAoIW9wdGlvbnMuX3N1cHByZXNzX2luaXRpYWwgJiYgIXRoaXMuY29sbGVjdGlvbi5wYXVzZWQpIHtcbiAgICAgIHF1ZXJ5LnJlc3VsdHMuZm9yRWFjaChkb2MgPT4ge1xuICAgICAgICBjb25zdCBmaWVsZHMgPSBFSlNPTi5jbG9uZShkb2MpO1xuXG4gICAgICAgIGRlbGV0ZSBmaWVsZHMuX2lkO1xuXG4gICAgICAgIGlmIChvcmRlcmVkKSB7XG4gICAgICAgICAgcXVlcnkuYWRkZWRCZWZvcmUoZG9jLl9pZCwgdGhpcy5fcHJvamVjdGlvbkZuKGZpZWxkcyksIG51bGwpO1xuICAgICAgICB9XG5cbiAgICAgICAgcXVlcnkuYWRkZWQoZG9jLl9pZCwgdGhpcy5fcHJvamVjdGlvbkZuKGZpZWxkcykpO1xuICAgICAgfSk7XG4gICAgfVxuXG4gICAgY29uc3QgaGFuZGxlID0gT2JqZWN0LmFzc2lnbihuZXcgTG9jYWxDb2xsZWN0aW9uLk9ic2VydmVIYW5kbGUsIHtcbiAgICAgIGNvbGxlY3Rpb246IHRoaXMuY29sbGVjdGlvbixcbiAgICAgIHN0b3A6ICgpID0+IHtcbiAgICAgICAgaWYgKHRoaXMucmVhY3RpdmUpIHtcbiAgICAgICAgICBkZWxldGUgdGhpcy5jb2xsZWN0aW9uLnF1ZXJpZXNbcWlkXTtcbiAgICAgICAgfVxuICAgICAgfVxuICAgIH0pO1xuXG4gICAgaWYgKHRoaXMucmVhY3RpdmUgJiYgVHJhY2tlci5hY3RpdmUpIHtcbiAgICAgIC8vIFhYWCBpbiBtYW55IGNhc2VzLCB0aGUgc2FtZSBvYnNlcnZlIHdpbGwgYmUgcmVjcmVhdGVkIHdoZW5cbiAgICAgIC8vIHRoZSBjdXJyZW50IGF1dG9ydW4gaXMgcmVydW4uICB3ZSBjb3VsZCBzYXZlIHdvcmsgYnlcbiAgICAgIC8vIGxldHRpbmcgaXQgbGluZ2VyIGFjcm9zcyByZXJ1biBhbmQgcG90ZW50aWFsbHkgZ2V0XG4gICAgICAvLyByZXB1cnBvc2VkIGlmIHRoZSBzYW1lIG9ic2VydmUgaXMgcGVyZm9ybWVkLCB1c2luZyBsb2dpY1xuICAgICAgLy8gc2ltaWxhciB0byB0aGF0IG9mIE1ldGVvci5zdWJzY3JpYmUuXG4gICAgICBUcmFja2VyLm9uSW52YWxpZGF0ZSgoKSA9PiB7XG4gICAgICAgIGhhbmRsZS5zdG9wKCk7XG4gICAgICB9KTtcbiAgICB9XG5cbiAgICAvLyBydW4gdGhlIG9ic2VydmUgY2FsbGJhY2tzIHJlc3VsdGluZyBmcm9tIHRoZSBpbml0aWFsIGNvbnRlbnRzXG4gICAgLy8gYmVmb3JlIHdlIGxlYXZlIHRoZSBvYnNlcnZlLlxuICAgIHRoaXMuY29sbGVjdGlvbi5fb2JzZXJ2ZVF1ZXVlLmRyYWluKCk7XG5cbiAgICByZXR1cm4gaGFuZGxlO1xuICB9XG5cbiAgLy8gU2luY2Ugd2UgZG9uJ3QgYWN0dWFsbHkgaGF2ZSBhIFwibmV4dE9iamVjdFwiIGludGVyZmFjZSwgdGhlcmUncyByZWFsbHkgbm9cbiAgLy8gcmVhc29uIHRvIGhhdmUgYSBcInJld2luZFwiIGludGVyZmFjZS4gIEFsbCBpdCBkaWQgd2FzIG1ha2UgbXVsdGlwbGUgY2FsbHNcbiAgLy8gdG8gZmV0Y2gvbWFwL2ZvckVhY2ggcmV0dXJuIG5vdGhpbmcgdGhlIHNlY29uZCB0aW1lLlxuICAvLyBYWFggQ09NUEFUIFdJVEggMC44LjFcbiAgcmV3aW5kKCkge31cblxuICAvLyBYWFggTWF5YmUgd2UgbmVlZCBhIHZlcnNpb24gb2Ygb2JzZXJ2ZSB0aGF0IGp1c3QgY2FsbHMgYSBjYWxsYmFjayBpZlxuICAvLyBhbnl0aGluZyBjaGFuZ2VkLlxuICBfZGVwZW5kKGNoYW5nZXJzLCBfYWxsb3dfdW5vcmRlcmVkKSB7XG4gICAgaWYgKFRyYWNrZXIuYWN0aXZlKSB7XG4gICAgICBjb25zdCBkZXBlbmRlbmN5ID0gbmV3IFRyYWNrZXIuRGVwZW5kZW5jeTtcbiAgICAgIGNvbnN0IG5vdGlmeSA9IGRlcGVuZGVuY3kuY2hhbmdlZC5iaW5kKGRlcGVuZGVuY3kpO1xuXG4gICAgICBkZXBlbmRlbmN5LmRlcGVuZCgpO1xuXG4gICAgICBjb25zdCBvcHRpb25zID0ge19hbGxvd191bm9yZGVyZWQsIF9zdXBwcmVzc19pbml0aWFsOiB0cnVlfTtcblxuICAgICAgWydhZGRlZCcsICdhZGRlZEJlZm9yZScsICdjaGFuZ2VkJywgJ21vdmVkQmVmb3JlJywgJ3JlbW92ZWQnXVxuICAgICAgICAuZm9yRWFjaChmbiA9PiB7XG4gICAgICAgICAgaWYgKGNoYW5nZXJzW2ZuXSkge1xuICAgICAgICAgICAgb3B0aW9uc1tmbl0gPSBub3RpZnk7XG4gICAgICAgICAgfVxuICAgICAgICB9KTtcblxuICAgICAgLy8gb2JzZXJ2ZUNoYW5nZXMgd2lsbCBzdG9wKCkgd2hlbiB0aGlzIGNvbXB1dGF0aW9uIGlzIGludmFsaWRhdGVkXG4gICAgICB0aGlzLm9ic2VydmVDaGFuZ2VzKG9wdGlvbnMpO1xuICAgIH1cbiAgfVxuXG4gIF9nZXRDb2xsZWN0aW9uTmFtZSgpIHtcbiAgICByZXR1cm4gdGhpcy5jb2xsZWN0aW9uLm5hbWU7XG4gIH1cblxuICAvLyBSZXR1cm5zIGEgY29sbGVjdGlvbiBvZiBtYXRjaGluZyBvYmplY3RzLCBidXQgZG9lc24ndCBkZWVwIGNvcHkgdGhlbS5cbiAgLy9cbiAgLy8gSWYgb3JkZXJlZCBpcyBzZXQsIHJldHVybnMgYSBzb3J0ZWQgYXJyYXksIHJlc3BlY3Rpbmcgc29ydGVyLCBza2lwLCBhbmRcbiAgLy8gbGltaXQgcHJvcGVydGllcyBvZiB0aGUgcXVlcnkgcHJvdmlkZWQgdGhhdCBvcHRpb25zLmFwcGx5U2tpcExpbWl0IGlzXG4gIC8vIG5vdCBzZXQgdG8gZmFsc2UgKCMxMjAxKS4gSWYgc29ydGVyIGlzIGZhbHNleSwgbm8gc29ydCAtLSB5b3UgZ2V0IHRoZVxuICAvLyBuYXR1cmFsIG9yZGVyLlxuICAvL1xuICAvLyBJZiBvcmRlcmVkIGlzIG5vdCBzZXQsIHJldHVybnMgYW4gb2JqZWN0IG1hcHBpbmcgZnJvbSBJRCB0byBkb2MgKHNvcnRlcixcbiAgLy8gc2tpcCBhbmQgbGltaXQgc2hvdWxkIG5vdCBiZSBzZXQpLlxuICAvL1xuICAvLyBJZiBvcmRlcmVkIGlzIHNldCBhbmQgdGhpcyBjdXJzb3IgaXMgYSAkbmVhciBnZW9xdWVyeSwgdGhlbiB0aGlzIGZ1bmN0aW9uXG4gIC8vIHdpbGwgdXNlIGFuIF9JZE1hcCB0byB0cmFjayBlYWNoIGRpc3RhbmNlIGZyb20gdGhlICRuZWFyIGFyZ3VtZW50IHBvaW50IGluXG4gIC8vIG9yZGVyIHRvIHVzZSBpdCBhcyBhIHNvcnQga2V5LiBJZiBhbiBfSWRNYXAgaXMgcGFzc2VkIGluIHRoZSAnZGlzdGFuY2VzJ1xuICAvLyBhcmd1bWVudCwgdGhpcyBmdW5jdGlvbiB3aWxsIGNsZWFyIGl0IGFuZCB1c2UgaXQgZm9yIHRoaXMgcHVycG9zZVxuICAvLyAob3RoZXJ3aXNlIGl0IHdpbGwganVzdCBjcmVhdGUgaXRzIG93biBfSWRNYXApLiBUaGUgb2JzZXJ2ZUNoYW5nZXNcbiAgLy8gaW1wbGVtZW50YXRpb24gdXNlcyB0aGlzIHRvIHJlbWVtYmVyIHRoZSBkaXN0YW5jZXMgYWZ0ZXIgdGhpcyBmdW5jdGlvblxuICAvLyByZXR1cm5zLlxuICBfZ2V0UmF3T2JqZWN0cyhvcHRpb25zID0ge30pIHtcbiAgICAvLyBCeSBkZWZhdWx0IHRoaXMgbWV0aG9kIHdpbGwgcmVzcGVjdCBza2lwIGFuZCBsaW1pdCBiZWNhdXNlIC5mZXRjaCgpLFxuICAgIC8vIC5mb3JFYWNoKCkgZXRjLi4uIGV4cGVjdCB0aGlzIGJlaGF2aW91ci4gSXQgY2FuIGJlIGZvcmNlZCB0byBpZ25vcmVcbiAgICAvLyBza2lwIGFuZCBsaW1pdCBieSBzZXR0aW5nIGFwcGx5U2tpcExpbWl0IHRvIGZhbHNlICguY291bnQoKSBkb2VzIHRoaXMsXG4gICAgLy8gZm9yIGV4YW1wbGUpXG4gICAgY29uc3QgYXBwbHlTa2lwTGltaXQgPSBvcHRpb25zLmFwcGx5U2tpcExpbWl0ICE9PSBmYWxzZTtcblxuICAgIC8vIFhYWCB1c2UgT3JkZXJlZERpY3QgaW5zdGVhZCBvZiBhcnJheSwgYW5kIG1ha2UgSWRNYXAgYW5kIE9yZGVyZWREaWN0XG4gICAgLy8gY29tcGF0aWJsZVxuICAgIGNvbnN0IHJlc3VsdHMgPSBvcHRpb25zLm9yZGVyZWQgPyBbXSA6IG5ldyBMb2NhbENvbGxlY3Rpb24uX0lkTWFwO1xuXG4gICAgLy8gZmFzdCBwYXRoIGZvciBzaW5nbGUgSUQgdmFsdWVcbiAgICBpZiAodGhpcy5fc2VsZWN0b3JJZCAhPT0gdW5kZWZpbmVkKSB7XG4gICAgICAvLyBJZiB5b3UgaGF2ZSBub24temVybyBza2lwIGFuZCBhc2sgZm9yIGEgc2luZ2xlIGlkLCB5b3UgZ2V0IG5vdGhpbmcuXG4gICAgICAvLyBUaGlzIGlzIHNvIGl0IG1hdGNoZXMgdGhlIGJlaGF2aW9yIG9mIHRoZSAne19pZDogZm9vfScgcGF0aC5cbiAgICAgIGlmIChhcHBseVNraXBMaW1pdCAmJiB0aGlzLnNraXApIHtcbiAgICAgICAgcmV0dXJuIHJlc3VsdHM7XG4gICAgICB9XG5cbiAgICAgIGNvbnN0IHNlbGVjdGVkRG9jID0gdGhpcy5jb2xsZWN0aW9uLl9kb2NzLmdldCh0aGlzLl9zZWxlY3RvcklkKTtcblxuICAgICAgaWYgKHNlbGVjdGVkRG9jKSB7XG4gICAgICAgIGlmIChvcHRpb25zLm9yZGVyZWQpIHtcbiAgICAgICAgICByZXN1bHRzLnB1c2goc2VsZWN0ZWREb2MpO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIHJlc3VsdHMuc2V0KHRoaXMuX3NlbGVjdG9ySWQsIHNlbGVjdGVkRG9jKTtcbiAgICAgICAgfVxuICAgICAgfVxuXG4gICAgICByZXR1cm4gcmVzdWx0cztcbiAgICB9XG5cbiAgICAvLyBzbG93IHBhdGggZm9yIGFyYml0cmFyeSBzZWxlY3Rvciwgc29ydCwgc2tpcCwgbGltaXRcblxuICAgIC8vIGluIHRoZSBvYnNlcnZlQ2hhbmdlcyBjYXNlLCBkaXN0YW5jZXMgaXMgYWN0dWFsbHkgcGFydCBvZiB0aGUgXCJxdWVyeVwiXG4gICAgLy8gKGllLCBsaXZlIHJlc3VsdHMgc2V0KSBvYmplY3QuICBpbiBvdGhlciBjYXNlcywgZGlzdGFuY2VzIGlzIG9ubHkgdXNlZFxuICAgIC8vIGluc2lkZSB0aGlzIGZ1bmN0aW9uLlxuICAgIGxldCBkaXN0YW5jZXM7XG4gICAgaWYgKHRoaXMubWF0Y2hlci5oYXNHZW9RdWVyeSgpICYmIG9wdGlvbnMub3JkZXJlZCkge1xuICAgICAgaWYgKG9wdGlvbnMuZGlzdGFuY2VzKSB7XG4gICAgICAgIGRpc3RhbmNlcyA9IG9wdGlvbnMuZGlzdGFuY2VzO1xuICAgICAgICBkaXN0YW5jZXMuY2xlYXIoKTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIGRpc3RhbmNlcyA9IG5ldyBMb2NhbENvbGxlY3Rpb24uX0lkTWFwKCk7XG4gICAgICB9XG4gICAgfVxuXG4gICAgdGhpcy5jb2xsZWN0aW9uLl9kb2NzLmZvckVhY2goKGRvYywgaWQpID0+IHtcbiAgICAgIGNvbnN0IG1hdGNoUmVzdWx0ID0gdGhpcy5tYXRjaGVyLmRvY3VtZW50TWF0Y2hlcyhkb2MpO1xuXG4gICAgICBpZiAobWF0Y2hSZXN1bHQucmVzdWx0KSB7XG4gICAgICAgIGlmIChvcHRpb25zLm9yZGVyZWQpIHtcbiAgICAgICAgICByZXN1bHRzLnB1c2goZG9jKTtcblxuICAgICAgICAgIGlmIChkaXN0YW5jZXMgJiYgbWF0Y2hSZXN1bHQuZGlzdGFuY2UgIT09IHVuZGVmaW5lZCkge1xuICAgICAgICAgICAgZGlzdGFuY2VzLnNldChpZCwgbWF0Y2hSZXN1bHQuZGlzdGFuY2UpO1xuICAgICAgICAgIH1cbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICByZXN1bHRzLnNldChpZCwgZG9jKTtcbiAgICAgICAgfVxuICAgICAgfVxuXG4gICAgICAvLyBPdmVycmlkZSB0byBlbnN1cmUgYWxsIGRvY3MgYXJlIG1hdGNoZWQgaWYgaWdub3Jpbmcgc2tpcCAmIGxpbWl0XG4gICAgICBpZiAoIWFwcGx5U2tpcExpbWl0KSB7XG4gICAgICAgIHJldHVybiB0cnVlO1xuICAgICAgfVxuXG4gICAgICAvLyBGYXN0IHBhdGggZm9yIGxpbWl0ZWQgdW5zb3J0ZWQgcXVlcmllcy5cbiAgICAgIC8vIFhYWCAnbGVuZ3RoJyBjaGVjayBoZXJlIHNlZW1zIHdyb25nIGZvciBvcmRlcmVkXG4gICAgICByZXR1cm4gKFxuICAgICAgICAhdGhpcy5saW1pdCB8fFxuICAgICAgICB0aGlzLnNraXAgfHxcbiAgICAgICAgdGhpcy5zb3J0ZXIgfHxcbiAgICAgICAgcmVzdWx0cy5sZW5ndGggIT09IHRoaXMubGltaXRcbiAgICAgICk7XG4gICAgfSk7XG5cbiAgICBpZiAoIW9wdGlvbnMub3JkZXJlZCkge1xuICAgICAgcmV0dXJuIHJlc3VsdHM7XG4gICAgfVxuXG4gICAgaWYgKHRoaXMuc29ydGVyKSB7XG4gICAgICByZXN1bHRzLnNvcnQodGhpcy5zb3J0ZXIuZ2V0Q29tcGFyYXRvcih7ZGlzdGFuY2VzfSkpO1xuICAgIH1cblxuICAgIC8vIFJldHVybiB0aGUgZnVsbCBzZXQgb2YgcmVzdWx0cyBpZiB0aGVyZSBpcyBubyBza2lwIG9yIGxpbWl0IG9yIGlmIHdlJ3JlXG4gICAgLy8gaWdub3JpbmcgdGhlbVxuICAgIGlmICghYXBwbHlTa2lwTGltaXQgfHwgKCF0aGlzLmxpbWl0ICYmICF0aGlzLnNraXApKSB7XG4gICAgICByZXR1cm4gcmVzdWx0cztcbiAgICB9XG5cbiAgICByZXR1cm4gcmVzdWx0cy5zbGljZShcbiAgICAgIHRoaXMuc2tpcCxcbiAgICAgIHRoaXMubGltaXQgPyB0aGlzLmxpbWl0ICsgdGhpcy5za2lwIDogcmVzdWx0cy5sZW5ndGhcbiAgICApO1xuICB9XG5cbiAgX3B1Ymxpc2hDdXJzb3Ioc3Vic2NyaXB0aW9uKSB7XG4gICAgLy8gWFhYIG1pbmltb25nbyBzaG91bGQgbm90IGRlcGVuZCBvbiBtb25nby1saXZlZGF0YSFcbiAgICBpZiAoIVBhY2thZ2UubW9uZ28pIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihcbiAgICAgICAgJ0NhblxcJ3QgcHVibGlzaCBmcm9tIE1pbmltb25nbyB3aXRob3V0IHRoZSBgbW9uZ29gIHBhY2thZ2UuJ1xuICAgICAgKTtcbiAgICB9XG5cbiAgICBpZiAoIXRoaXMuY29sbGVjdGlvbi5uYW1lKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXG4gICAgICAgICdDYW5cXCd0IHB1Ymxpc2ggYSBjdXJzb3IgZnJvbSBhIGNvbGxlY3Rpb24gd2l0aG91dCBhIG5hbWUuJ1xuICAgICAgKTtcbiAgICB9XG5cbiAgICByZXR1cm4gUGFja2FnZS5tb25nby5Nb25nby5Db2xsZWN0aW9uLl9wdWJsaXNoQ3Vyc29yKFxuICAgICAgdGhpcyxcbiAgICAgIHN1YnNjcmlwdGlvbixcbiAgICAgIHRoaXMuY29sbGVjdGlvbi5uYW1lXG4gICAgKTtcbiAgfVxufVxuIiwiaW1wb3J0IEN1cnNvciBmcm9tICcuL2N1cnNvci5qcyc7XG5pbXBvcnQgT2JzZXJ2ZUhhbmRsZSBmcm9tICcuL29ic2VydmVfaGFuZGxlLmpzJztcbmltcG9ydCB7XG4gIGhhc093bixcbiAgaXNJbmRleGFibGUsXG4gIGlzTnVtZXJpY0tleSxcbiAgaXNPcGVyYXRvck9iamVjdCxcbiAgcG9wdWxhdGVEb2N1bWVudFdpdGhRdWVyeUZpZWxkcyxcbiAgcHJvamVjdGlvbkRldGFpbHMsXG59IGZyb20gJy4vY29tbW9uLmpzJztcblxuLy8gWFhYIHR5cGUgY2hlY2tpbmcgb24gc2VsZWN0b3JzIChncmFjZWZ1bCBlcnJvciBpZiBtYWxmb3JtZWQpXG5cbi8vIExvY2FsQ29sbGVjdGlvbjogYSBzZXQgb2YgZG9jdW1lbnRzIHRoYXQgc3VwcG9ydHMgcXVlcmllcyBhbmQgbW9kaWZpZXJzLlxuZXhwb3J0IGRlZmF1bHQgY2xhc3MgTG9jYWxDb2xsZWN0aW9uIHtcbiAgY29uc3RydWN0b3IobmFtZSkge1xuICAgIHRoaXMubmFtZSA9IG5hbWU7XG4gICAgLy8gX2lkIC0+IGRvY3VtZW50IChhbHNvIGNvbnRhaW5pbmcgaWQpXG4gICAgdGhpcy5fZG9jcyA9IG5ldyBMb2NhbENvbGxlY3Rpb24uX0lkTWFwO1xuXG4gICAgdGhpcy5fb2JzZXJ2ZVF1ZXVlID0gbmV3IE1ldGVvci5fU3luY2hyb25vdXNRdWV1ZSgpO1xuXG4gICAgdGhpcy5uZXh0X3FpZCA9IDE7IC8vIGxpdmUgcXVlcnkgaWQgZ2VuZXJhdG9yXG5cbiAgICAvLyBxaWQgLT4gbGl2ZSBxdWVyeSBvYmplY3QuIGtleXM6XG4gICAgLy8gIG9yZGVyZWQ6IGJvb2wuIG9yZGVyZWQgcXVlcmllcyBoYXZlIGFkZGVkQmVmb3JlL21vdmVkQmVmb3JlIGNhbGxiYWNrcy5cbiAgICAvLyAgcmVzdWx0czogYXJyYXkgKG9yZGVyZWQpIG9yIG9iamVjdCAodW5vcmRlcmVkKSBvZiBjdXJyZW50IHJlc3VsdHNcbiAgICAvLyAgICAoYWxpYXNlZCB3aXRoIHRoaXMuX2RvY3MhKVxuICAgIC8vICByZXN1bHRzU25hcHNob3Q6IHNuYXBzaG90IG9mIHJlc3VsdHMuIG51bGwgaWYgbm90IHBhdXNlZC5cbiAgICAvLyAgY3Vyc29yOiBDdXJzb3Igb2JqZWN0IGZvciB0aGUgcXVlcnkuXG4gICAgLy8gIHNlbGVjdG9yLCBzb3J0ZXIsIChjYWxsYmFja3MpOiBmdW5jdGlvbnNcbiAgICB0aGlzLnF1ZXJpZXMgPSBPYmplY3QuY3JlYXRlKG51bGwpO1xuXG4gICAgLy8gbnVsbCBpZiBub3Qgc2F2aW5nIG9yaWdpbmFsczsgYW4gSWRNYXAgZnJvbSBpZCB0byBvcmlnaW5hbCBkb2N1bWVudCB2YWx1ZVxuICAgIC8vIGlmIHNhdmluZyBvcmlnaW5hbHMuIFNlZSBjb21tZW50cyBiZWZvcmUgc2F2ZU9yaWdpbmFscygpLlxuICAgIHRoaXMuX3NhdmVkT3JpZ2luYWxzID0gbnVsbDtcblxuICAgIC8vIFRydWUgd2hlbiBvYnNlcnZlcnMgYXJlIHBhdXNlZCBhbmQgd2Ugc2hvdWxkIG5vdCBzZW5kIGNhbGxiYWNrcy5cbiAgICB0aGlzLnBhdXNlZCA9IGZhbHNlO1xuICB9XG5cbiAgLy8gb3B0aW9ucyBtYXkgaW5jbHVkZSBzb3J0LCBza2lwLCBsaW1pdCwgcmVhY3RpdmVcbiAgLy8gc29ydCBtYXkgYmUgYW55IG9mIHRoZXNlIGZvcm1zOlxuICAvLyAgICAge2E6IDEsIGI6IC0xfVxuICAvLyAgICAgW1tcImFcIiwgXCJhc2NcIl0sIFtcImJcIiwgXCJkZXNjXCJdXVxuICAvLyAgICAgW1wiYVwiLCBbXCJiXCIsIFwiZGVzY1wiXV1cbiAgLy8gICAoaW4gdGhlIGZpcnN0IGZvcm0geW91J3JlIGJlaG9sZGVuIHRvIGtleSBlbnVtZXJhdGlvbiBvcmRlciBpblxuICAvLyAgIHlvdXIgamF2YXNjcmlwdCBWTSlcbiAgLy9cbiAgLy8gcmVhY3RpdmU6IGlmIGdpdmVuLCBhbmQgZmFsc2UsIGRvbid0IHJlZ2lzdGVyIHdpdGggVHJhY2tlciAoZGVmYXVsdFxuICAvLyBpcyB0cnVlKVxuICAvL1xuICAvLyBYWFggcG9zc2libHkgc2hvdWxkIHN1cHBvcnQgcmV0cmlldmluZyBhIHN1YnNldCBvZiBmaWVsZHM/IGFuZFxuICAvLyBoYXZlIGl0IGJlIGEgaGludCAoaWdub3JlZCBvbiB0aGUgY2xpZW50LCB3aGVuIG5vdCBjb3B5aW5nIHRoZVxuICAvLyBkb2M/KVxuICAvL1xuICAvLyBYWFggc29ydCBkb2VzIG5vdCB5ZXQgc3VwcG9ydCBzdWJrZXlzICgnYS5iJykgLi4gZml4IHRoYXQhXG4gIC8vIFhYWCBhZGQgb25lIG1vcmUgc29ydCBmb3JtOiBcImtleVwiXG4gIC8vIFhYWCB0ZXN0c1xuICBmaW5kKHNlbGVjdG9yLCBvcHRpb25zKSB7XG4gICAgLy8gZGVmYXVsdCBzeW50YXggZm9yIGV2ZXJ5dGhpbmcgaXMgdG8gb21pdCB0aGUgc2VsZWN0b3IgYXJndW1lbnQuXG4gICAgLy8gYnV0IGlmIHNlbGVjdG9yIGlzIGV4cGxpY2l0bHkgcGFzc2VkIGluIGFzIGZhbHNlIG9yIHVuZGVmaW5lZCwgd2VcbiAgICAvLyB3YW50IGEgc2VsZWN0b3IgdGhhdCBtYXRjaGVzIG5vdGhpbmcuXG4gICAgaWYgKGFyZ3VtZW50cy5sZW5ndGggPT09IDApIHtcbiAgICAgIHNlbGVjdG9yID0ge307XG4gICAgfVxuXG4gICAgcmV0dXJuIG5ldyBMb2NhbENvbGxlY3Rpb24uQ3Vyc29yKHRoaXMsIHNlbGVjdG9yLCBvcHRpb25zKTtcbiAgfVxuXG4gIGZpbmRPbmUoc2VsZWN0b3IsIG9wdGlvbnMgPSB7fSkge1xuICAgIGlmIChhcmd1bWVudHMubGVuZ3RoID09PSAwKSB7XG4gICAgICBzZWxlY3RvciA9IHt9O1xuICAgIH1cblxuICAgIC8vIE5PVEU6IGJ5IHNldHRpbmcgbGltaXQgMSBoZXJlLCB3ZSBlbmQgdXAgdXNpbmcgdmVyeSBpbmVmZmljaWVudFxuICAgIC8vIGNvZGUgdGhhdCByZWNvbXB1dGVzIHRoZSB3aG9sZSBxdWVyeSBvbiBlYWNoIHVwZGF0ZS4gVGhlIHVwc2lkZSBpc1xuICAgIC8vIHRoYXQgd2hlbiB5b3UgcmVhY3RpdmVseSBkZXBlbmQgb24gYSBmaW5kT25lIHlvdSBvbmx5IGdldFxuICAgIC8vIGludmFsaWRhdGVkIHdoZW4gdGhlIGZvdW5kIG9iamVjdCBjaGFuZ2VzLCBub3QgYW55IG9iamVjdCBpbiB0aGVcbiAgICAvLyBjb2xsZWN0aW9uLiBNb3N0IGZpbmRPbmUgd2lsbCBiZSBieSBpZCwgd2hpY2ggaGFzIGEgZmFzdCBwYXRoLCBzb1xuICAgIC8vIHRoaXMgbWlnaHQgbm90IGJlIGEgYmlnIGRlYWwuIEluIG1vc3QgY2FzZXMsIGludmFsaWRhdGlvbiBjYXVzZXNcbiAgICAvLyB0aGUgY2FsbGVkIHRvIHJlLXF1ZXJ5IGFueXdheSwgc28gdGhpcyBzaG91bGQgYmUgYSBuZXQgcGVyZm9ybWFuY2VcbiAgICAvLyBpbXByb3ZlbWVudC5cbiAgICBvcHRpb25zLmxpbWl0ID0gMTtcblxuICAgIHJldHVybiB0aGlzLmZpbmQoc2VsZWN0b3IsIG9wdGlvbnMpLmZldGNoKClbMF07XG4gIH1cblxuICAvLyBYWFggcG9zc2libHkgZW5mb3JjZSB0aGF0ICd1bmRlZmluZWQnIGRvZXMgbm90IGFwcGVhciAod2UgYXNzdW1lXG4gIC8vIHRoaXMgaW4gb3VyIGhhbmRsaW5nIG9mIG51bGwgYW5kICRleGlzdHMpXG4gIGluc2VydChkb2MsIGNhbGxiYWNrKSB7XG4gICAgZG9jID0gRUpTT04uY2xvbmUoZG9jKTtcblxuICAgIGFzc2VydEhhc1ZhbGlkRmllbGROYW1lcyhkb2MpO1xuXG4gICAgLy8gaWYgeW91IHJlYWxseSB3YW50IHRvIHVzZSBPYmplY3RJRHMsIHNldCB0aGlzIGdsb2JhbC5cbiAgICAvLyBNb25nby5Db2xsZWN0aW9uIHNwZWNpZmllcyBpdHMgb3duIGlkcyBhbmQgZG9lcyBub3QgdXNlIHRoaXMgY29kZS5cbiAgICBpZiAoIWhhc093bi5jYWxsKGRvYywgJ19pZCcpKSB7XG4gICAgICBkb2MuX2lkID0gTG9jYWxDb2xsZWN0aW9uLl91c2VPSUQgPyBuZXcgTW9uZ29JRC5PYmplY3RJRCgpIDogUmFuZG9tLmlkKCk7XG4gICAgfVxuXG4gICAgY29uc3QgaWQgPSBkb2MuX2lkO1xuXG4gICAgaWYgKHRoaXMuX2RvY3MuaGFzKGlkKSkge1xuICAgICAgdGhyb3cgTWluaW1vbmdvRXJyb3IoYER1cGxpY2F0ZSBfaWQgJyR7aWR9J2ApO1xuICAgIH1cblxuICAgIHRoaXMuX3NhdmVPcmlnaW5hbChpZCwgdW5kZWZpbmVkKTtcbiAgICB0aGlzLl9kb2NzLnNldChpZCwgZG9jKTtcblxuICAgIGNvbnN0IHF1ZXJpZXNUb1JlY29tcHV0ZSA9IFtdO1xuXG4gICAgLy8gdHJpZ2dlciBsaXZlIHF1ZXJpZXMgdGhhdCBtYXRjaFxuICAgIE9iamVjdC5rZXlzKHRoaXMucXVlcmllcykuZm9yRWFjaChxaWQgPT4ge1xuICAgICAgY29uc3QgcXVlcnkgPSB0aGlzLnF1ZXJpZXNbcWlkXTtcblxuICAgICAgaWYgKHF1ZXJ5LmRpcnR5KSB7XG4gICAgICAgIHJldHVybjtcbiAgICAgIH1cblxuICAgICAgY29uc3QgbWF0Y2hSZXN1bHQgPSBxdWVyeS5tYXRjaGVyLmRvY3VtZW50TWF0Y2hlcyhkb2MpO1xuXG4gICAgICBpZiAobWF0Y2hSZXN1bHQucmVzdWx0KSB7XG4gICAgICAgIGlmIChxdWVyeS5kaXN0YW5jZXMgJiYgbWF0Y2hSZXN1bHQuZGlzdGFuY2UgIT09IHVuZGVmaW5lZCkge1xuICAgICAgICAgIHF1ZXJ5LmRpc3RhbmNlcy5zZXQoaWQsIG1hdGNoUmVzdWx0LmRpc3RhbmNlKTtcbiAgICAgICAgfVxuXG4gICAgICAgIGlmIChxdWVyeS5jdXJzb3Iuc2tpcCB8fCBxdWVyeS5jdXJzb3IubGltaXQpIHtcbiAgICAgICAgICBxdWVyaWVzVG9SZWNvbXB1dGUucHVzaChxaWQpO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIExvY2FsQ29sbGVjdGlvbi5faW5zZXJ0SW5SZXN1bHRzKHF1ZXJ5LCBkb2MpO1xuICAgICAgICB9XG4gICAgICB9XG4gICAgfSk7XG5cbiAgICBxdWVyaWVzVG9SZWNvbXB1dGUuZm9yRWFjaChxaWQgPT4ge1xuICAgICAgaWYgKHRoaXMucXVlcmllc1txaWRdKSB7XG4gICAgICAgIHRoaXMuX3JlY29tcHV0ZVJlc3VsdHModGhpcy5xdWVyaWVzW3FpZF0pO1xuICAgICAgfVxuICAgIH0pO1xuXG4gICAgdGhpcy5fb2JzZXJ2ZVF1ZXVlLmRyYWluKCk7XG5cbiAgICAvLyBEZWZlciBiZWNhdXNlIHRoZSBjYWxsZXIgbGlrZWx5IGRvZXNuJ3QgZXhwZWN0IHRoZSBjYWxsYmFjayB0byBiZSBydW5cbiAgICAvLyBpbW1lZGlhdGVseS5cbiAgICBpZiAoY2FsbGJhY2spIHtcbiAgICAgIE1ldGVvci5kZWZlcigoKSA9PiB7XG4gICAgICAgIGNhbGxiYWNrKG51bGwsIGlkKTtcbiAgICAgIH0pO1xuICAgIH1cblxuICAgIHJldHVybiBpZDtcbiAgfVxuXG4gIC8vIFBhdXNlIHRoZSBvYnNlcnZlcnMuIE5vIGNhbGxiYWNrcyBmcm9tIG9ic2VydmVycyB3aWxsIGZpcmUgdW50aWxcbiAgLy8gJ3Jlc3VtZU9ic2VydmVycycgaXMgY2FsbGVkLlxuICBwYXVzZU9ic2VydmVycygpIHtcbiAgICAvLyBOby1vcCBpZiBhbHJlYWR5IHBhdXNlZC5cbiAgICBpZiAodGhpcy5wYXVzZWQpIHtcbiAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICAvLyBTZXQgdGhlICdwYXVzZWQnIGZsYWcgc3VjaCB0aGF0IG5ldyBvYnNlcnZlciBtZXNzYWdlcyBkb24ndCBmaXJlLlxuICAgIHRoaXMucGF1c2VkID0gdHJ1ZTtcblxuICAgIC8vIFRha2UgYSBzbmFwc2hvdCBvZiB0aGUgcXVlcnkgcmVzdWx0cyBmb3IgZWFjaCBxdWVyeS5cbiAgICBPYmplY3Qua2V5cyh0aGlzLnF1ZXJpZXMpLmZvckVhY2gocWlkID0+IHtcbiAgICAgIGNvbnN0IHF1ZXJ5ID0gdGhpcy5xdWVyaWVzW3FpZF07XG4gICAgICBxdWVyeS5yZXN1bHRzU25hcHNob3QgPSBFSlNPTi5jbG9uZShxdWVyeS5yZXN1bHRzKTtcbiAgICB9KTtcbiAgfVxuXG4gIHJlbW92ZShzZWxlY3RvciwgY2FsbGJhY2spIHtcbiAgICAvLyBFYXN5IHNwZWNpYWwgY2FzZTogaWYgd2UncmUgbm90IGNhbGxpbmcgb2JzZXJ2ZUNoYW5nZXMgY2FsbGJhY2tzIGFuZFxuICAgIC8vIHdlJ3JlIG5vdCBzYXZpbmcgb3JpZ2luYWxzIGFuZCB3ZSBnb3QgYXNrZWQgdG8gcmVtb3ZlIGV2ZXJ5dGhpbmcsIHRoZW5cbiAgICAvLyBqdXN0IGVtcHR5IGV2ZXJ5dGhpbmcgZGlyZWN0bHkuXG4gICAgaWYgKHRoaXMucGF1c2VkICYmICF0aGlzLl9zYXZlZE9yaWdpbmFscyAmJiBFSlNPTi5lcXVhbHMoc2VsZWN0b3IsIHt9KSkge1xuICAgICAgY29uc3QgcmVzdWx0ID0gdGhpcy5fZG9jcy5zaXplKCk7XG5cbiAgICAgIHRoaXMuX2RvY3MuY2xlYXIoKTtcblxuICAgICAgT2JqZWN0LmtleXModGhpcy5xdWVyaWVzKS5mb3JFYWNoKHFpZCA9PiB7XG4gICAgICAgIGNvbnN0IHF1ZXJ5ID0gdGhpcy5xdWVyaWVzW3FpZF07XG5cbiAgICAgICAgaWYgKHF1ZXJ5Lm9yZGVyZWQpIHtcbiAgICAgICAgICBxdWVyeS5yZXN1bHRzID0gW107XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgcXVlcnkucmVzdWx0cy5jbGVhcigpO1xuICAgICAgICB9XG4gICAgICB9KTtcblxuICAgICAgaWYgKGNhbGxiYWNrKSB7XG4gICAgICAgIE1ldGVvci5kZWZlcigoKSA9PiB7XG4gICAgICAgICAgY2FsbGJhY2sobnVsbCwgcmVzdWx0KTtcbiAgICAgICAgfSk7XG4gICAgICB9XG5cbiAgICAgIHJldHVybiByZXN1bHQ7XG4gICAgfVxuXG4gICAgY29uc3QgbWF0Y2hlciA9IG5ldyBNaW5pbW9uZ28uTWF0Y2hlcihzZWxlY3Rvcik7XG4gICAgY29uc3QgcmVtb3ZlID0gW107XG5cbiAgICB0aGlzLl9lYWNoUG9zc2libHlNYXRjaGluZ0RvYyhzZWxlY3RvciwgKGRvYywgaWQpID0+IHtcbiAgICAgIGlmIChtYXRjaGVyLmRvY3VtZW50TWF0Y2hlcyhkb2MpLnJlc3VsdCkge1xuICAgICAgICByZW1vdmUucHVzaChpZCk7XG4gICAgICB9XG4gICAgfSk7XG5cbiAgICBjb25zdCBxdWVyaWVzVG9SZWNvbXB1dGUgPSBbXTtcbiAgICBjb25zdCBxdWVyeVJlbW92ZSA9IFtdO1xuXG4gICAgZm9yIChsZXQgaSA9IDA7IGkgPCByZW1vdmUubGVuZ3RoOyBpKyspIHtcbiAgICAgIGNvbnN0IHJlbW92ZUlkID0gcmVtb3ZlW2ldO1xuICAgICAgY29uc3QgcmVtb3ZlRG9jID0gdGhpcy5fZG9jcy5nZXQocmVtb3ZlSWQpO1xuXG4gICAgICBPYmplY3Qua2V5cyh0aGlzLnF1ZXJpZXMpLmZvckVhY2gocWlkID0+IHtcbiAgICAgICAgY29uc3QgcXVlcnkgPSB0aGlzLnF1ZXJpZXNbcWlkXTtcblxuICAgICAgICBpZiAocXVlcnkuZGlydHkpIHtcbiAgICAgICAgICByZXR1cm47XG4gICAgICAgIH1cblxuICAgICAgICBpZiAocXVlcnkubWF0Y2hlci5kb2N1bWVudE1hdGNoZXMocmVtb3ZlRG9jKS5yZXN1bHQpIHtcbiAgICAgICAgICBpZiAocXVlcnkuY3Vyc29yLnNraXAgfHwgcXVlcnkuY3Vyc29yLmxpbWl0KSB7XG4gICAgICAgICAgICBxdWVyaWVzVG9SZWNvbXB1dGUucHVzaChxaWQpO1xuICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICBxdWVyeVJlbW92ZS5wdXNoKHtxaWQsIGRvYzogcmVtb3ZlRG9jfSk7XG4gICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICB9KTtcblxuICAgICAgdGhpcy5fc2F2ZU9yaWdpbmFsKHJlbW92ZUlkLCByZW1vdmVEb2MpO1xuICAgICAgdGhpcy5fZG9jcy5yZW1vdmUocmVtb3ZlSWQpO1xuICAgIH1cblxuICAgIC8vIHJ1biBsaXZlIHF1ZXJ5IGNhbGxiYWNrcyBfYWZ0ZXJfIHdlJ3ZlIHJlbW92ZWQgdGhlIGRvY3VtZW50cy5cbiAgICBxdWVyeVJlbW92ZS5mb3JFYWNoKHJlbW92ZSA9PiB7XG4gICAgICBjb25zdCBxdWVyeSA9IHRoaXMucXVlcmllc1tyZW1vdmUucWlkXTtcblxuICAgICAgaWYgKHF1ZXJ5KSB7XG4gICAgICAgIHF1ZXJ5LmRpc3RhbmNlcyAmJiBxdWVyeS5kaXN0YW5jZXMucmVtb3ZlKHJlbW92ZS5kb2MuX2lkKTtcbiAgICAgICAgTG9jYWxDb2xsZWN0aW9uLl9yZW1vdmVGcm9tUmVzdWx0cyhxdWVyeSwgcmVtb3ZlLmRvYyk7XG4gICAgICB9XG4gICAgfSk7XG5cbiAgICBxdWVyaWVzVG9SZWNvbXB1dGUuZm9yRWFjaChxaWQgPT4ge1xuICAgICAgY29uc3QgcXVlcnkgPSB0aGlzLnF1ZXJpZXNbcWlkXTtcblxuICAgICAgaWYgKHF1ZXJ5KSB7XG4gICAgICAgIHRoaXMuX3JlY29tcHV0ZVJlc3VsdHMocXVlcnkpO1xuICAgICAgfVxuICAgIH0pO1xuXG4gICAgdGhpcy5fb2JzZXJ2ZVF1ZXVlLmRyYWluKCk7XG5cbiAgICBjb25zdCByZXN1bHQgPSByZW1vdmUubGVuZ3RoO1xuXG4gICAgaWYgKGNhbGxiYWNrKSB7XG4gICAgICBNZXRlb3IuZGVmZXIoKCkgPT4ge1xuICAgICAgICBjYWxsYmFjayhudWxsLCByZXN1bHQpO1xuICAgICAgfSk7XG4gICAgfVxuXG4gICAgcmV0dXJuIHJlc3VsdDtcbiAgfVxuXG4gIC8vIFJlc3VtZSB0aGUgb2JzZXJ2ZXJzLiBPYnNlcnZlcnMgaW1tZWRpYXRlbHkgcmVjZWl2ZSBjaGFuZ2VcbiAgLy8gbm90aWZpY2F0aW9ucyB0byBicmluZyB0aGVtIHRvIHRoZSBjdXJyZW50IHN0YXRlIG9mIHRoZVxuICAvLyBkYXRhYmFzZS4gTm90ZSB0aGF0IHRoaXMgaXMgbm90IGp1c3QgcmVwbGF5aW5nIGFsbCB0aGUgY2hhbmdlcyB0aGF0XG4gIC8vIGhhcHBlbmVkIGR1cmluZyB0aGUgcGF1c2UsIGl0IGlzIGEgc21hcnRlciAnY29hbGVzY2VkJyBkaWZmLlxuICByZXN1bWVPYnNlcnZlcnMoKSB7XG4gICAgLy8gTm8tb3AgaWYgbm90IHBhdXNlZC5cbiAgICBpZiAoIXRoaXMucGF1c2VkKSB7XG4gICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgLy8gVW5zZXQgdGhlICdwYXVzZWQnIGZsYWcuIE1ha2Ugc3VyZSB0byBkbyB0aGlzIGZpcnN0LCBvdGhlcndpc2VcbiAgICAvLyBvYnNlcnZlciBtZXRob2RzIHdvbid0IGFjdHVhbGx5IGZpcmUgd2hlbiB3ZSB0cmlnZ2VyIHRoZW0uXG4gICAgdGhpcy5wYXVzZWQgPSBmYWxzZTtcblxuICAgIE9iamVjdC5rZXlzKHRoaXMucXVlcmllcykuZm9yRWFjaChxaWQgPT4ge1xuICAgICAgY29uc3QgcXVlcnkgPSB0aGlzLnF1ZXJpZXNbcWlkXTtcblxuICAgICAgaWYgKHF1ZXJ5LmRpcnR5KSB7XG4gICAgICAgIHF1ZXJ5LmRpcnR5ID0gZmFsc2U7XG5cbiAgICAgICAgLy8gcmUtY29tcHV0ZSByZXN1bHRzIHdpbGwgcGVyZm9ybSBgTG9jYWxDb2xsZWN0aW9uLl9kaWZmUXVlcnlDaGFuZ2VzYFxuICAgICAgICAvLyBhdXRvbWF0aWNhbGx5LlxuICAgICAgICB0aGlzLl9yZWNvbXB1dGVSZXN1bHRzKHF1ZXJ5LCBxdWVyeS5yZXN1bHRzU25hcHNob3QpO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgLy8gRGlmZiB0aGUgY3VycmVudCByZXN1bHRzIGFnYWluc3QgdGhlIHNuYXBzaG90IGFuZCBzZW5kIHRvIG9ic2VydmVycy5cbiAgICAgICAgLy8gcGFzcyB0aGUgcXVlcnkgb2JqZWN0IGZvciBpdHMgb2JzZXJ2ZXIgY2FsbGJhY2tzLlxuICAgICAgICBMb2NhbENvbGxlY3Rpb24uX2RpZmZRdWVyeUNoYW5nZXMoXG4gICAgICAgICAgcXVlcnkub3JkZXJlZCxcbiAgICAgICAgICBxdWVyeS5yZXN1bHRzU25hcHNob3QsXG4gICAgICAgICAgcXVlcnkucmVzdWx0cyxcbiAgICAgICAgICBxdWVyeSxcbiAgICAgICAgICB7cHJvamVjdGlvbkZuOiBxdWVyeS5wcm9qZWN0aW9uRm59XG4gICAgICAgICk7XG4gICAgICB9XG5cbiAgICAgIHF1ZXJ5LnJlc3VsdHNTbmFwc2hvdCA9IG51bGw7XG4gICAgfSk7XG5cbiAgICB0aGlzLl9vYnNlcnZlUXVldWUuZHJhaW4oKTtcbiAgfVxuXG4gIHJldHJpZXZlT3JpZ2luYWxzKCkge1xuICAgIGlmICghdGhpcy5fc2F2ZWRPcmlnaW5hbHMpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcignQ2FsbGVkIHJldHJpZXZlT3JpZ2luYWxzIHdpdGhvdXQgc2F2ZU9yaWdpbmFscycpO1xuICAgIH1cblxuICAgIGNvbnN0IG9yaWdpbmFscyA9IHRoaXMuX3NhdmVkT3JpZ2luYWxzO1xuXG4gICAgdGhpcy5fc2F2ZWRPcmlnaW5hbHMgPSBudWxsO1xuXG4gICAgcmV0dXJuIG9yaWdpbmFscztcbiAgfVxuXG4gIC8vIFRvIHRyYWNrIHdoYXQgZG9jdW1lbnRzIGFyZSBhZmZlY3RlZCBieSBhIHBpZWNlIG9mIGNvZGUsIGNhbGxcbiAgLy8gc2F2ZU9yaWdpbmFscygpIGJlZm9yZSBpdCBhbmQgcmV0cmlldmVPcmlnaW5hbHMoKSBhZnRlciBpdC5cbiAgLy8gcmV0cmlldmVPcmlnaW5hbHMgcmV0dXJucyBhbiBvYmplY3Qgd2hvc2Uga2V5cyBhcmUgdGhlIGlkcyBvZiB0aGUgZG9jdW1lbnRzXG4gIC8vIHRoYXQgd2VyZSBhZmZlY3RlZCBzaW5jZSB0aGUgY2FsbCB0byBzYXZlT3JpZ2luYWxzKCksIGFuZCB0aGUgdmFsdWVzIGFyZVxuICAvLyBlcXVhbCB0byB0aGUgZG9jdW1lbnQncyBjb250ZW50cyBhdCB0aGUgdGltZSBvZiBzYXZlT3JpZ2luYWxzLiAoSW4gdGhlIGNhc2VcbiAgLy8gb2YgYW4gaW5zZXJ0ZWQgZG9jdW1lbnQsIHVuZGVmaW5lZCBpcyB0aGUgdmFsdWUuKSBZb3UgbXVzdCBhbHRlcm5hdGVcbiAgLy8gYmV0d2VlbiBjYWxscyB0byBzYXZlT3JpZ2luYWxzKCkgYW5kIHJldHJpZXZlT3JpZ2luYWxzKCkuXG4gIHNhdmVPcmlnaW5hbHMoKSB7XG4gICAgaWYgKHRoaXMuX3NhdmVkT3JpZ2luYWxzKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoJ0NhbGxlZCBzYXZlT3JpZ2luYWxzIHR3aWNlIHdpdGhvdXQgcmV0cmlldmVPcmlnaW5hbHMnKTtcbiAgICB9XG5cbiAgICB0aGlzLl9zYXZlZE9yaWdpbmFscyA9IG5ldyBMb2NhbENvbGxlY3Rpb24uX0lkTWFwO1xuICB9XG5cbiAgLy8gWFhYIGF0b21pY2l0eTogaWYgbXVsdGkgaXMgdHJ1ZSwgYW5kIG9uZSBtb2RpZmljYXRpb24gZmFpbHMsIGRvXG4gIC8vIHdlIHJvbGxiYWNrIHRoZSB3aG9sZSBvcGVyYXRpb24sIG9yIHdoYXQ/XG4gIHVwZGF0ZShzZWxlY3RvciwgbW9kLCBvcHRpb25zLCBjYWxsYmFjaykge1xuICAgIGlmICghIGNhbGxiYWNrICYmIG9wdGlvbnMgaW5zdGFuY2VvZiBGdW5jdGlvbikge1xuICAgICAgY2FsbGJhY2sgPSBvcHRpb25zO1xuICAgICAgb3B0aW9ucyA9IG51bGw7XG4gICAgfVxuXG4gICAgaWYgKCFvcHRpb25zKSB7XG4gICAgICBvcHRpb25zID0ge307XG4gICAgfVxuXG4gICAgY29uc3QgbWF0Y2hlciA9IG5ldyBNaW5pbW9uZ28uTWF0Y2hlcihzZWxlY3RvciwgdHJ1ZSk7XG5cbiAgICAvLyBTYXZlIHRoZSBvcmlnaW5hbCByZXN1bHRzIG9mIGFueSBxdWVyeSB0aGF0IHdlIG1pZ2h0IG5lZWQgdG9cbiAgICAvLyBfcmVjb21wdXRlUmVzdWx0cyBvbiwgYmVjYXVzZSBfbW9kaWZ5QW5kTm90aWZ5IHdpbGwgbXV0YXRlIHRoZSBvYmplY3RzIGluXG4gICAgLy8gaXQuIChXZSBkb24ndCBuZWVkIHRvIHNhdmUgdGhlIG9yaWdpbmFsIHJlc3VsdHMgb2YgcGF1c2VkIHF1ZXJpZXMgYmVjYXVzZVxuICAgIC8vIHRoZXkgYWxyZWFkeSBoYXZlIGEgcmVzdWx0c1NuYXBzaG90IGFuZCB3ZSB3b24ndCBiZSBkaWZmaW5nIGluXG4gICAgLy8gX3JlY29tcHV0ZVJlc3VsdHMuKVxuICAgIGNvbnN0IHFpZFRvT3JpZ2luYWxSZXN1bHRzID0ge307XG5cbiAgICAvLyBXZSBzaG91bGQgb25seSBjbG9uZSBlYWNoIGRvY3VtZW50IG9uY2UsIGV2ZW4gaWYgaXQgYXBwZWFycyBpbiBtdWx0aXBsZVxuICAgIC8vIHF1ZXJpZXNcbiAgICBjb25zdCBkb2NNYXAgPSBuZXcgTG9jYWxDb2xsZWN0aW9uLl9JZE1hcDtcbiAgICBjb25zdCBpZHNNYXRjaGVkID0gTG9jYWxDb2xsZWN0aW9uLl9pZHNNYXRjaGVkQnlTZWxlY3RvcihzZWxlY3Rvcik7XG5cbiAgICBPYmplY3Qua2V5cyh0aGlzLnF1ZXJpZXMpLmZvckVhY2gocWlkID0+IHtcbiAgICAgIGNvbnN0IHF1ZXJ5ID0gdGhpcy5xdWVyaWVzW3FpZF07XG5cbiAgICAgIGlmICgocXVlcnkuY3Vyc29yLnNraXAgfHwgcXVlcnkuY3Vyc29yLmxpbWl0KSAmJiAhIHRoaXMucGF1c2VkKSB7XG4gICAgICAgIC8vIENhdGNoIHRoZSBjYXNlIG9mIGEgcmVhY3RpdmUgYGNvdW50KClgIG9uIGEgY3Vyc29yIHdpdGggc2tpcFxuICAgICAgICAvLyBvciBsaW1pdCwgd2hpY2ggcmVnaXN0ZXJzIGFuIHVub3JkZXJlZCBvYnNlcnZlLiBUaGlzIGlzIGFcbiAgICAgICAgLy8gcHJldHR5IHJhcmUgY2FzZSwgc28gd2UganVzdCBjbG9uZSB0aGUgZW50aXJlIHJlc3VsdCBzZXQgd2l0aFxuICAgICAgICAvLyBubyBvcHRpbWl6YXRpb25zIGZvciBkb2N1bWVudHMgdGhhdCBhcHBlYXIgaW4gdGhlc2UgcmVzdWx0XG4gICAgICAgIC8vIHNldHMgYW5kIG90aGVyIHF1ZXJpZXMuXG4gICAgICAgIGlmIChxdWVyeS5yZXN1bHRzIGluc3RhbmNlb2YgTG9jYWxDb2xsZWN0aW9uLl9JZE1hcCkge1xuICAgICAgICAgIHFpZFRvT3JpZ2luYWxSZXN1bHRzW3FpZF0gPSBxdWVyeS5yZXN1bHRzLmNsb25lKCk7XG4gICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG5cbiAgICAgICAgaWYgKCEocXVlcnkucmVzdWx0cyBpbnN0YW5jZW9mIEFycmF5KSkge1xuICAgICAgICAgIHRocm93IG5ldyBFcnJvcignQXNzZXJ0aW9uIGZhaWxlZDogcXVlcnkucmVzdWx0cyBub3QgYW4gYXJyYXknKTtcbiAgICAgICAgfVxuXG4gICAgICAgIC8vIENsb25lcyBhIGRvY3VtZW50IHRvIGJlIHN0b3JlZCBpbiBgcWlkVG9PcmlnaW5hbFJlc3VsdHNgXG4gICAgICAgIC8vIGJlY2F1c2UgaXQgbWF5IGJlIG1vZGlmaWVkIGJlZm9yZSB0aGUgbmV3IGFuZCBvbGQgcmVzdWx0IHNldHNcbiAgICAgICAgLy8gYXJlIGRpZmZlZC4gQnV0IGlmIHdlIGtub3cgZXhhY3RseSB3aGljaCBkb2N1bWVudCBJRHMgd2UncmVcbiAgICAgICAgLy8gZ29pbmcgdG8gbW9kaWZ5LCB0aGVuIHdlIG9ubHkgbmVlZCB0byBjbG9uZSB0aG9zZS5cbiAgICAgICAgY29uc3QgbWVtb2l6ZWRDbG9uZUlmTmVlZGVkID0gZG9jID0+IHtcbiAgICAgICAgICBpZiAoZG9jTWFwLmhhcyhkb2MuX2lkKSkge1xuICAgICAgICAgICAgcmV0dXJuIGRvY01hcC5nZXQoZG9jLl9pZCk7XG4gICAgICAgICAgfVxuXG4gICAgICAgICAgY29uc3QgZG9jVG9NZW1vaXplID0gKFxuICAgICAgICAgICAgaWRzTWF0Y2hlZCAmJlxuICAgICAgICAgICAgIWlkc01hdGNoZWQuc29tZShpZCA9PiBFSlNPTi5lcXVhbHMoaWQsIGRvYy5faWQpKVxuICAgICAgICAgICkgPyBkb2MgOiBFSlNPTi5jbG9uZShkb2MpO1xuXG4gICAgICAgICAgZG9jTWFwLnNldChkb2MuX2lkLCBkb2NUb01lbW9pemUpO1xuXG4gICAgICAgICAgcmV0dXJuIGRvY1RvTWVtb2l6ZTtcbiAgICAgICAgfTtcblxuICAgICAgICBxaWRUb09yaWdpbmFsUmVzdWx0c1txaWRdID0gcXVlcnkucmVzdWx0cy5tYXAobWVtb2l6ZWRDbG9uZUlmTmVlZGVkKTtcbiAgICAgIH1cbiAgICB9KTtcblxuICAgIGNvbnN0IHJlY29tcHV0ZVFpZHMgPSB7fTtcblxuICAgIGxldCB1cGRhdGVDb3VudCA9IDA7XG5cbiAgICB0aGlzLl9lYWNoUG9zc2libHlNYXRjaGluZ0RvYyhzZWxlY3RvciwgKGRvYywgaWQpID0+IHtcbiAgICAgIGNvbnN0IHF1ZXJ5UmVzdWx0ID0gbWF0Y2hlci5kb2N1bWVudE1hdGNoZXMoZG9jKTtcblxuICAgICAgaWYgKHF1ZXJ5UmVzdWx0LnJlc3VsdCkge1xuICAgICAgICAvLyBYWFggU2hvdWxkIHdlIHNhdmUgdGhlIG9yaWdpbmFsIGV2ZW4gaWYgbW9kIGVuZHMgdXAgYmVpbmcgYSBuby1vcD9cbiAgICAgICAgdGhpcy5fc2F2ZU9yaWdpbmFsKGlkLCBkb2MpO1xuICAgICAgICB0aGlzLl9tb2RpZnlBbmROb3RpZnkoXG4gICAgICAgICAgZG9jLFxuICAgICAgICAgIG1vZCxcbiAgICAgICAgICByZWNvbXB1dGVRaWRzLFxuICAgICAgICAgIHF1ZXJ5UmVzdWx0LmFycmF5SW5kaWNlc1xuICAgICAgICApO1xuXG4gICAgICAgICsrdXBkYXRlQ291bnQ7XG5cbiAgICAgICAgaWYgKCFvcHRpb25zLm11bHRpKSB7XG4gICAgICAgICAgcmV0dXJuIGZhbHNlOyAvLyBicmVha1xuICAgICAgICB9XG4gICAgICB9XG5cbiAgICAgIHJldHVybiB0cnVlO1xuICAgIH0pO1xuXG4gICAgT2JqZWN0LmtleXMocmVjb21wdXRlUWlkcykuZm9yRWFjaChxaWQgPT4ge1xuICAgICAgY29uc3QgcXVlcnkgPSB0aGlzLnF1ZXJpZXNbcWlkXTtcblxuICAgICAgaWYgKHF1ZXJ5KSB7XG4gICAgICAgIHRoaXMuX3JlY29tcHV0ZVJlc3VsdHMocXVlcnksIHFpZFRvT3JpZ2luYWxSZXN1bHRzW3FpZF0pO1xuICAgICAgfVxuICAgIH0pO1xuXG4gICAgdGhpcy5fb2JzZXJ2ZVF1ZXVlLmRyYWluKCk7XG5cbiAgICAvLyBJZiB3ZSBhcmUgZG9pbmcgYW4gdXBzZXJ0LCBhbmQgd2UgZGlkbid0IG1vZGlmeSBhbnkgZG9jdW1lbnRzIHlldCwgdGhlblxuICAgIC8vIGl0J3MgdGltZSB0byBkbyBhbiBpbnNlcnQuIEZpZ3VyZSBvdXQgd2hhdCBkb2N1bWVudCB3ZSBhcmUgaW5zZXJ0aW5nLCBhbmRcbiAgICAvLyBnZW5lcmF0ZSBhbiBpZCBmb3IgaXQuXG4gICAgbGV0IGluc2VydGVkSWQ7XG4gICAgaWYgKHVwZGF0ZUNvdW50ID09PSAwICYmIG9wdGlvbnMudXBzZXJ0KSB7XG4gICAgICBjb25zdCBkb2MgPSBMb2NhbENvbGxlY3Rpb24uX2NyZWF0ZVVwc2VydERvY3VtZW50KHNlbGVjdG9yLCBtb2QpO1xuICAgICAgaWYgKCEgZG9jLl9pZCAmJiBvcHRpb25zLmluc2VydGVkSWQpIHtcbiAgICAgICAgZG9jLl9pZCA9IG9wdGlvbnMuaW5zZXJ0ZWRJZDtcbiAgICAgIH1cblxuICAgICAgaW5zZXJ0ZWRJZCA9IHRoaXMuaW5zZXJ0KGRvYyk7XG4gICAgICB1cGRhdGVDb3VudCA9IDE7XG4gICAgfVxuXG4gICAgLy8gUmV0dXJuIHRoZSBudW1iZXIgb2YgYWZmZWN0ZWQgZG9jdW1lbnRzLCBvciBpbiB0aGUgdXBzZXJ0IGNhc2UsIGFuIG9iamVjdFxuICAgIC8vIGNvbnRhaW5pbmcgdGhlIG51bWJlciBvZiBhZmZlY3RlZCBkb2NzIGFuZCB0aGUgaWQgb2YgdGhlIGRvYyB0aGF0IHdhc1xuICAgIC8vIGluc2VydGVkLCBpZiBhbnkuXG4gICAgbGV0IHJlc3VsdDtcbiAgICBpZiAob3B0aW9ucy5fcmV0dXJuT2JqZWN0KSB7XG4gICAgICByZXN1bHQgPSB7bnVtYmVyQWZmZWN0ZWQ6IHVwZGF0ZUNvdW50fTtcblxuICAgICAgaWYgKGluc2VydGVkSWQgIT09IHVuZGVmaW5lZCkge1xuICAgICAgICByZXN1bHQuaW5zZXJ0ZWRJZCA9IGluc2VydGVkSWQ7XG4gICAgICB9XG4gICAgfSBlbHNlIHtcbiAgICAgIHJlc3VsdCA9IHVwZGF0ZUNvdW50O1xuICAgIH1cblxuICAgIGlmIChjYWxsYmFjaykge1xuICAgICAgTWV0ZW9yLmRlZmVyKCgpID0+IHtcbiAgICAgICAgY2FsbGJhY2sobnVsbCwgcmVzdWx0KTtcbiAgICAgIH0pO1xuICAgIH1cblxuICAgIHJldHVybiByZXN1bHQ7XG4gIH1cblxuICAvLyBBIGNvbnZlbmllbmNlIHdyYXBwZXIgb24gdXBkYXRlLiBMb2NhbENvbGxlY3Rpb24udXBzZXJ0KHNlbCwgbW9kKSBpc1xuICAvLyBlcXVpdmFsZW50IHRvIExvY2FsQ29sbGVjdGlvbi51cGRhdGUoc2VsLCBtb2QsIHt1cHNlcnQ6IHRydWUsXG4gIC8vIF9yZXR1cm5PYmplY3Q6IHRydWV9KS5cbiAgdXBzZXJ0KHNlbGVjdG9yLCBtb2QsIG9wdGlvbnMsIGNhbGxiYWNrKSB7XG4gICAgaWYgKCFjYWxsYmFjayAmJiB0eXBlb2Ygb3B0aW9ucyA9PT0gJ2Z1bmN0aW9uJykge1xuICAgICAgY2FsbGJhY2sgPSBvcHRpb25zO1xuICAgICAgb3B0aW9ucyA9IHt9O1xuICAgIH1cblxuICAgIHJldHVybiB0aGlzLnVwZGF0ZShcbiAgICAgIHNlbGVjdG9yLFxuICAgICAgbW9kLFxuICAgICAgT2JqZWN0LmFzc2lnbih7fSwgb3B0aW9ucywge3Vwc2VydDogdHJ1ZSwgX3JldHVybk9iamVjdDogdHJ1ZX0pLFxuICAgICAgY2FsbGJhY2tcbiAgICApO1xuICB9XG5cbiAgLy8gSXRlcmF0ZXMgb3ZlciBhIHN1YnNldCBvZiBkb2N1bWVudHMgdGhhdCBjb3VsZCBtYXRjaCBzZWxlY3RvcjsgY2FsbHNcbiAgLy8gZm4oZG9jLCBpZCkgb24gZWFjaCBvZiB0aGVtLiAgU3BlY2lmaWNhbGx5LCBpZiBzZWxlY3RvciBzcGVjaWZpZXNcbiAgLy8gc3BlY2lmaWMgX2lkJ3MsIGl0IG9ubHkgbG9va3MgYXQgdGhvc2UuICBkb2MgaXMgKm5vdCogY2xvbmVkOiBpdCBpcyB0aGVcbiAgLy8gc2FtZSBvYmplY3QgdGhhdCBpcyBpbiBfZG9jcy5cbiAgX2VhY2hQb3NzaWJseU1hdGNoaW5nRG9jKHNlbGVjdG9yLCBmbikge1xuICAgIGNvbnN0IHNwZWNpZmljSWRzID0gTG9jYWxDb2xsZWN0aW9uLl9pZHNNYXRjaGVkQnlTZWxlY3RvcihzZWxlY3Rvcik7XG5cbiAgICBpZiAoc3BlY2lmaWNJZHMpIHtcbiAgICAgIHNwZWNpZmljSWRzLnNvbWUoaWQgPT4ge1xuICAgICAgICBjb25zdCBkb2MgPSB0aGlzLl9kb2NzLmdldChpZCk7XG5cbiAgICAgICAgaWYgKGRvYykge1xuICAgICAgICAgIHJldHVybiBmbihkb2MsIGlkKSA9PT0gZmFsc2U7XG4gICAgICAgIH1cbiAgICAgIH0pO1xuICAgIH0gZWxzZSB7XG4gICAgICB0aGlzLl9kb2NzLmZvckVhY2goZm4pO1xuICAgIH1cbiAgfVxuXG4gIF9tb2RpZnlBbmROb3RpZnkoZG9jLCBtb2QsIHJlY29tcHV0ZVFpZHMsIGFycmF5SW5kaWNlcykge1xuICAgIGNvbnN0IG1hdGNoZWRfYmVmb3JlID0ge307XG5cbiAgICBPYmplY3Qua2V5cyh0aGlzLnF1ZXJpZXMpLmZvckVhY2gocWlkID0+IHtcbiAgICAgIGNvbnN0IHF1ZXJ5ID0gdGhpcy5xdWVyaWVzW3FpZF07XG5cbiAgICAgIGlmIChxdWVyeS5kaXJ0eSkge1xuICAgICAgICByZXR1cm47XG4gICAgICB9XG5cbiAgICAgIGlmIChxdWVyeS5vcmRlcmVkKSB7XG4gICAgICAgIG1hdGNoZWRfYmVmb3JlW3FpZF0gPSBxdWVyeS5tYXRjaGVyLmRvY3VtZW50TWF0Y2hlcyhkb2MpLnJlc3VsdDtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIC8vIEJlY2F1c2Ugd2UgZG9uJ3Qgc3VwcG9ydCBza2lwIG9yIGxpbWl0ICh5ZXQpIGluIHVub3JkZXJlZCBxdWVyaWVzLCB3ZVxuICAgICAgICAvLyBjYW4ganVzdCBkbyBhIGRpcmVjdCBsb29rdXAuXG4gICAgICAgIG1hdGNoZWRfYmVmb3JlW3FpZF0gPSBxdWVyeS5yZXN1bHRzLmhhcyhkb2MuX2lkKTtcbiAgICAgIH1cbiAgICB9KTtcblxuICAgIGNvbnN0IG9sZF9kb2MgPSBFSlNPTi5jbG9uZShkb2MpO1xuXG4gICAgTG9jYWxDb2xsZWN0aW9uLl9tb2RpZnkoZG9jLCBtb2QsIHthcnJheUluZGljZXN9KTtcblxuICAgIE9iamVjdC5rZXlzKHRoaXMucXVlcmllcykuZm9yRWFjaChxaWQgPT4ge1xuICAgICAgY29uc3QgcXVlcnkgPSB0aGlzLnF1ZXJpZXNbcWlkXTtcblxuICAgICAgaWYgKHF1ZXJ5LmRpcnR5KSB7XG4gICAgICAgIHJldHVybjtcbiAgICAgIH1cblxuICAgICAgY29uc3QgYWZ0ZXJNYXRjaCA9IHF1ZXJ5Lm1hdGNoZXIuZG9jdW1lbnRNYXRjaGVzKGRvYyk7XG4gICAgICBjb25zdCBhZnRlciA9IGFmdGVyTWF0Y2gucmVzdWx0O1xuICAgICAgY29uc3QgYmVmb3JlID0gbWF0Y2hlZF9iZWZvcmVbcWlkXTtcblxuICAgICAgaWYgKGFmdGVyICYmIHF1ZXJ5LmRpc3RhbmNlcyAmJiBhZnRlck1hdGNoLmRpc3RhbmNlICE9PSB1bmRlZmluZWQpIHtcbiAgICAgICAgcXVlcnkuZGlzdGFuY2VzLnNldChkb2MuX2lkLCBhZnRlck1hdGNoLmRpc3RhbmNlKTtcbiAgICAgIH1cblxuICAgICAgaWYgKHF1ZXJ5LmN1cnNvci5za2lwIHx8IHF1ZXJ5LmN1cnNvci5saW1pdCkge1xuICAgICAgICAvLyBXZSBuZWVkIHRvIHJlY29tcHV0ZSBhbnkgcXVlcnkgd2hlcmUgdGhlIGRvYyBtYXkgaGF2ZSBiZWVuIGluIHRoZVxuICAgICAgICAvLyBjdXJzb3IncyB3aW5kb3cgZWl0aGVyIGJlZm9yZSBvciBhZnRlciB0aGUgdXBkYXRlLiAoTm90ZSB0aGF0IGlmIHNraXBcbiAgICAgICAgLy8gb3IgbGltaXQgaXMgc2V0LCBcImJlZm9yZVwiIGFuZCBcImFmdGVyXCIgYmVpbmcgdHJ1ZSBkbyBub3QgbmVjZXNzYXJpbHlcbiAgICAgICAgLy8gbWVhbiB0aGF0IHRoZSBkb2N1bWVudCBpcyBpbiB0aGUgY3Vyc29yJ3Mgb3V0cHV0IGFmdGVyIHNraXAvbGltaXQgaXNcbiAgICAgICAgLy8gYXBwbGllZC4uLiBidXQgaWYgdGhleSBhcmUgZmFsc2UsIHRoZW4gdGhlIGRvY3VtZW50IGRlZmluaXRlbHkgaXMgTk9UXG4gICAgICAgIC8vIGluIHRoZSBvdXRwdXQuIFNvIGl0J3Mgc2FmZSB0byBza2lwIHJlY29tcHV0ZSBpZiBuZWl0aGVyIGJlZm9yZSBvclxuICAgICAgICAvLyBhZnRlciBhcmUgdHJ1ZS4pXG4gICAgICAgIGlmIChiZWZvcmUgfHwgYWZ0ZXIpIHtcbiAgICAgICAgICByZWNvbXB1dGVRaWRzW3FpZF0gPSB0cnVlO1xuICAgICAgICB9XG4gICAgICB9IGVsc2UgaWYgKGJlZm9yZSAmJiAhYWZ0ZXIpIHtcbiAgICAgICAgTG9jYWxDb2xsZWN0aW9uLl9yZW1vdmVGcm9tUmVzdWx0cyhxdWVyeSwgZG9jKTtcbiAgICAgIH0gZWxzZSBpZiAoIWJlZm9yZSAmJiBhZnRlcikge1xuICAgICAgICBMb2NhbENvbGxlY3Rpb24uX2luc2VydEluUmVzdWx0cyhxdWVyeSwgZG9jKTtcbiAgICAgIH0gZWxzZSBpZiAoYmVmb3JlICYmIGFmdGVyKSB7XG4gICAgICAgIExvY2FsQ29sbGVjdGlvbi5fdXBkYXRlSW5SZXN1bHRzKHF1ZXJ5LCBkb2MsIG9sZF9kb2MpO1xuICAgICAgfVxuICAgIH0pO1xuICB9XG5cbiAgLy8gUmVjb21wdXRlcyB0aGUgcmVzdWx0cyBvZiBhIHF1ZXJ5IGFuZCBydW5zIG9ic2VydmUgY2FsbGJhY2tzIGZvciB0aGVcbiAgLy8gZGlmZmVyZW5jZSBiZXR3ZWVuIHRoZSBwcmV2aW91cyByZXN1bHRzIGFuZCB0aGUgY3VycmVudCByZXN1bHRzICh1bmxlc3NcbiAgLy8gcGF1c2VkKS4gVXNlZCBmb3Igc2tpcC9saW1pdCBxdWVyaWVzLlxuICAvL1xuICAvLyBXaGVuIHRoaXMgaXMgdXNlZCBieSBpbnNlcnQgb3IgcmVtb3ZlLCBpdCBjYW4ganVzdCB1c2UgcXVlcnkucmVzdWx0cyBmb3JcbiAgLy8gdGhlIG9sZCByZXN1bHRzIChhbmQgdGhlcmUncyBubyBuZWVkIHRvIHBhc3MgaW4gb2xkUmVzdWx0cyksIGJlY2F1c2UgdGhlc2VcbiAgLy8gb3BlcmF0aW9ucyBkb24ndCBtdXRhdGUgdGhlIGRvY3VtZW50cyBpbiB0aGUgY29sbGVjdGlvbi4gVXBkYXRlIG5lZWRzIHRvXG4gIC8vIHBhc3MgaW4gYW4gb2xkUmVzdWx0cyB3aGljaCB3YXMgZGVlcC1jb3BpZWQgYmVmb3JlIHRoZSBtb2RpZmllciB3YXNcbiAgLy8gYXBwbGllZC5cbiAgLy9cbiAgLy8gb2xkUmVzdWx0cyBpcyBndWFyYW50ZWVkIHRvIGJlIGlnbm9yZWQgaWYgdGhlIHF1ZXJ5IGlzIG5vdCBwYXVzZWQuXG4gIF9yZWNvbXB1dGVSZXN1bHRzKHF1ZXJ5LCBvbGRSZXN1bHRzKSB7XG4gICAgaWYgKHRoaXMucGF1c2VkKSB7XG4gICAgICAvLyBUaGVyZSdzIG5vIHJlYXNvbiB0byByZWNvbXB1dGUgdGhlIHJlc3VsdHMgbm93IGFzIHdlJ3JlIHN0aWxsIHBhdXNlZC5cbiAgICAgIC8vIEJ5IGZsYWdnaW5nIHRoZSBxdWVyeSBhcyBcImRpcnR5XCIsIHRoZSByZWNvbXB1dGUgd2lsbCBiZSBwZXJmb3JtZWRcbiAgICAgIC8vIHdoZW4gcmVzdW1lT2JzZXJ2ZXJzIGlzIGNhbGxlZC5cbiAgICAgIHF1ZXJ5LmRpcnR5ID0gdHJ1ZTtcbiAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICBpZiAoIXRoaXMucGF1c2VkICYmICFvbGRSZXN1bHRzKSB7XG4gICAgICBvbGRSZXN1bHRzID0gcXVlcnkucmVzdWx0cztcbiAgICB9XG5cbiAgICBpZiAocXVlcnkuZGlzdGFuY2VzKSB7XG4gICAgICBxdWVyeS5kaXN0YW5jZXMuY2xlYXIoKTtcbiAgICB9XG5cbiAgICBxdWVyeS5yZXN1bHRzID0gcXVlcnkuY3Vyc29yLl9nZXRSYXdPYmplY3RzKHtcbiAgICAgIGRpc3RhbmNlczogcXVlcnkuZGlzdGFuY2VzLFxuICAgICAgb3JkZXJlZDogcXVlcnkub3JkZXJlZFxuICAgIH0pO1xuXG4gICAgaWYgKCF0aGlzLnBhdXNlZCkge1xuICAgICAgTG9jYWxDb2xsZWN0aW9uLl9kaWZmUXVlcnlDaGFuZ2VzKFxuICAgICAgICBxdWVyeS5vcmRlcmVkLFxuICAgICAgICBvbGRSZXN1bHRzLFxuICAgICAgICBxdWVyeS5yZXN1bHRzLFxuICAgICAgICBxdWVyeSxcbiAgICAgICAge3Byb2plY3Rpb25GbjogcXVlcnkucHJvamVjdGlvbkZufVxuICAgICAgKTtcbiAgICB9XG4gIH1cblxuICBfc2F2ZU9yaWdpbmFsKGlkLCBkb2MpIHtcbiAgICAvLyBBcmUgd2UgZXZlbiB0cnlpbmcgdG8gc2F2ZSBvcmlnaW5hbHM/XG4gICAgaWYgKCF0aGlzLl9zYXZlZE9yaWdpbmFscykge1xuICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIC8vIEhhdmUgd2UgcHJldmlvdXNseSBtdXRhdGVkIHRoZSBvcmlnaW5hbCAoYW5kIHNvICdkb2MnIGlzIG5vdCBhY3R1YWxseVxuICAgIC8vIG9yaWdpbmFsKT8gIChOb3RlIHRoZSAnaGFzJyBjaGVjayByYXRoZXIgdGhhbiB0cnV0aDogd2Ugc3RvcmUgdW5kZWZpbmVkXG4gICAgLy8gaGVyZSBmb3IgaW5zZXJ0ZWQgZG9jcyEpXG4gICAgaWYgKHRoaXMuX3NhdmVkT3JpZ2luYWxzLmhhcyhpZCkpIHtcbiAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICB0aGlzLl9zYXZlZE9yaWdpbmFscy5zZXQoaWQsIEVKU09OLmNsb25lKGRvYykpO1xuICB9XG59XG5cbkxvY2FsQ29sbGVjdGlvbi5DdXJzb3IgPSBDdXJzb3I7XG5cbkxvY2FsQ29sbGVjdGlvbi5PYnNlcnZlSGFuZGxlID0gT2JzZXJ2ZUhhbmRsZTtcblxuLy8gWFhYIG1heWJlIG1vdmUgdGhlc2UgaW50byBhbm90aGVyIE9ic2VydmVIZWxwZXJzIHBhY2thZ2Ugb3Igc29tZXRoaW5nXG5cbi8vIF9DYWNoaW5nQ2hhbmdlT2JzZXJ2ZXIgaXMgYW4gb2JqZWN0IHdoaWNoIHJlY2VpdmVzIG9ic2VydmVDaGFuZ2VzIGNhbGxiYWNrc1xuLy8gYW5kIGtlZXBzIGEgY2FjaGUgb2YgdGhlIGN1cnJlbnQgY3Vyc29yIHN0YXRlIHVwIHRvIGRhdGUgaW4gdGhpcy5kb2NzLiBVc2Vyc1xuLy8gb2YgdGhpcyBjbGFzcyBzaG91bGQgcmVhZCB0aGUgZG9jcyBmaWVsZCBidXQgbm90IG1vZGlmeSBpdC4gWW91IHNob3VsZCBwYXNzXG4vLyB0aGUgXCJhcHBseUNoYW5nZVwiIGZpZWxkIGFzIHRoZSBjYWxsYmFja3MgdG8gdGhlIHVuZGVybHlpbmcgb2JzZXJ2ZUNoYW5nZXNcbi8vIGNhbGwuIE9wdGlvbmFsbHksIHlvdSBjYW4gc3BlY2lmeSB5b3VyIG93biBvYnNlcnZlQ2hhbmdlcyBjYWxsYmFja3Mgd2hpY2ggYXJlXG4vLyBpbnZva2VkIGltbWVkaWF0ZWx5IGJlZm9yZSB0aGUgZG9jcyBmaWVsZCBpcyB1cGRhdGVkOyB0aGlzIG9iamVjdCBpcyBtYWRlXG4vLyBhdmFpbGFibGUgYXMgYHRoaXNgIHRvIHRob3NlIGNhbGxiYWNrcy5cbkxvY2FsQ29sbGVjdGlvbi5fQ2FjaGluZ0NoYW5nZU9ic2VydmVyID0gY2xhc3MgX0NhY2hpbmdDaGFuZ2VPYnNlcnZlciB7XG4gIGNvbnN0cnVjdG9yKG9wdGlvbnMgPSB7fSkge1xuICAgIGNvbnN0IG9yZGVyZWRGcm9tQ2FsbGJhY2tzID0gKFxuICAgICAgb3B0aW9ucy5jYWxsYmFja3MgJiZcbiAgICAgIExvY2FsQ29sbGVjdGlvbi5fb2JzZXJ2ZUNoYW5nZXNDYWxsYmFja3NBcmVPcmRlcmVkKG9wdGlvbnMuY2FsbGJhY2tzKVxuICAgICk7XG5cbiAgICBpZiAoaGFzT3duLmNhbGwob3B0aW9ucywgJ29yZGVyZWQnKSkge1xuICAgICAgdGhpcy5vcmRlcmVkID0gb3B0aW9ucy5vcmRlcmVkO1xuXG4gICAgICBpZiAob3B0aW9ucy5jYWxsYmFja3MgJiYgb3B0aW9ucy5vcmRlcmVkICE9PSBvcmRlcmVkRnJvbUNhbGxiYWNrcykge1xuICAgICAgICB0aHJvdyBFcnJvcignb3JkZXJlZCBvcHRpb24gZG9lc25cXCd0IG1hdGNoIGNhbGxiYWNrcycpO1xuICAgICAgfVxuICAgIH0gZWxzZSBpZiAob3B0aW9ucy5jYWxsYmFja3MpIHtcbiAgICAgIHRoaXMub3JkZXJlZCA9IG9yZGVyZWRGcm9tQ2FsbGJhY2tzO1xuICAgIH0gZWxzZSB7XG4gICAgICB0aHJvdyBFcnJvcignbXVzdCBwcm92aWRlIG9yZGVyZWQgb3IgY2FsbGJhY2tzJyk7XG4gICAgfVxuXG4gICAgY29uc3QgY2FsbGJhY2tzID0gb3B0aW9ucy5jYWxsYmFja3MgfHwge307XG5cbiAgICBpZiAodGhpcy5vcmRlcmVkKSB7XG4gICAgICB0aGlzLmRvY3MgPSBuZXcgT3JkZXJlZERpY3QoTW9uZ29JRC5pZFN0cmluZ2lmeSk7XG4gICAgICB0aGlzLmFwcGx5Q2hhbmdlID0ge1xuICAgICAgICBhZGRlZEJlZm9yZTogKGlkLCBmaWVsZHMsIGJlZm9yZSkgPT4ge1xuICAgICAgICAgIC8vIFRha2UgYSBzaGFsbG93IGNvcHkgc2luY2UgdGhlIHRvcC1sZXZlbCBwcm9wZXJ0aWVzIGNhbiBiZSBjaGFuZ2VkXG4gICAgICAgICAgY29uc3QgZG9jID0geyAuLi5maWVsZHMgfTtcblxuICAgICAgICAgIGRvYy5faWQgPSBpZDtcblxuICAgICAgICAgIGlmIChjYWxsYmFja3MuYWRkZWRCZWZvcmUpIHtcbiAgICAgICAgICAgIGNhbGxiYWNrcy5hZGRlZEJlZm9yZS5jYWxsKHRoaXMsIGlkLCBFSlNPTi5jbG9uZShmaWVsZHMpLCBiZWZvcmUpO1xuICAgICAgICAgIH1cblxuICAgICAgICAgIC8vIFRoaXMgbGluZSB0cmlnZ2VycyBpZiB3ZSBwcm92aWRlIGFkZGVkIHdpdGggbW92ZWRCZWZvcmUuXG4gICAgICAgICAgaWYgKGNhbGxiYWNrcy5hZGRlZCkge1xuICAgICAgICAgICAgY2FsbGJhY2tzLmFkZGVkLmNhbGwodGhpcywgaWQsIEVKU09OLmNsb25lKGZpZWxkcykpO1xuICAgICAgICAgIH1cblxuICAgICAgICAgIC8vIFhYWCBjb3VsZCBgYmVmb3JlYCBiZSBhIGZhbHN5IElEPyAgVGVjaG5pY2FsbHlcbiAgICAgICAgICAvLyBpZFN0cmluZ2lmeSBzZWVtcyB0byBhbGxvdyBmb3IgdGhlbSAtLSB0aG91Z2hcbiAgICAgICAgICAvLyBPcmRlcmVkRGljdCB3b24ndCBjYWxsIHN0cmluZ2lmeSBvbiBhIGZhbHN5IGFyZy5cbiAgICAgICAgICB0aGlzLmRvY3MucHV0QmVmb3JlKGlkLCBkb2MsIGJlZm9yZSB8fCBudWxsKTtcbiAgICAgICAgfSxcbiAgICAgICAgbW92ZWRCZWZvcmU6IChpZCwgYmVmb3JlKSA9PiB7XG4gICAgICAgICAgY29uc3QgZG9jID0gdGhpcy5kb2NzLmdldChpZCk7XG5cbiAgICAgICAgICBpZiAoY2FsbGJhY2tzLm1vdmVkQmVmb3JlKSB7XG4gICAgICAgICAgICBjYWxsYmFja3MubW92ZWRCZWZvcmUuY2FsbCh0aGlzLCBpZCwgYmVmb3JlKTtcbiAgICAgICAgICB9XG5cbiAgICAgICAgICB0aGlzLmRvY3MubW92ZUJlZm9yZShpZCwgYmVmb3JlIHx8IG51bGwpO1xuICAgICAgICB9LFxuICAgICAgfTtcbiAgICB9IGVsc2Uge1xuICAgICAgdGhpcy5kb2NzID0gbmV3IExvY2FsQ29sbGVjdGlvbi5fSWRNYXA7XG4gICAgICB0aGlzLmFwcGx5Q2hhbmdlID0ge1xuICAgICAgICBhZGRlZDogKGlkLCBmaWVsZHMpID0+IHtcbiAgICAgICAgICAvLyBUYWtlIGEgc2hhbGxvdyBjb3B5IHNpbmNlIHRoZSB0b3AtbGV2ZWwgcHJvcGVydGllcyBjYW4gYmUgY2hhbmdlZFxuICAgICAgICAgIGNvbnN0IGRvYyA9IHsgLi4uZmllbGRzIH07XG5cbiAgICAgICAgICBpZiAoY2FsbGJhY2tzLmFkZGVkKSB7XG4gICAgICAgICAgICBjYWxsYmFja3MuYWRkZWQuY2FsbCh0aGlzLCBpZCwgRUpTT04uY2xvbmUoZmllbGRzKSk7XG4gICAgICAgICAgfVxuXG4gICAgICAgICAgZG9jLl9pZCA9IGlkO1xuXG4gICAgICAgICAgdGhpcy5kb2NzLnNldChpZCwgIGRvYyk7XG4gICAgICAgIH0sXG4gICAgICB9O1xuICAgIH1cblxuICAgIC8vIFRoZSBtZXRob2RzIGluIF9JZE1hcCBhbmQgT3JkZXJlZERpY3QgdXNlZCBieSB0aGVzZSBjYWxsYmFja3MgYXJlXG4gICAgLy8gaWRlbnRpY2FsLlxuICAgIHRoaXMuYXBwbHlDaGFuZ2UuY2hhbmdlZCA9IChpZCwgZmllbGRzKSA9PiB7XG4gICAgICBjb25zdCBkb2MgPSB0aGlzLmRvY3MuZ2V0KGlkKTtcblxuICAgICAgaWYgKCFkb2MpIHtcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBVbmtub3duIGlkIGZvciBjaGFuZ2VkOiAke2lkfWApO1xuICAgICAgfVxuXG4gICAgICBpZiAoY2FsbGJhY2tzLmNoYW5nZWQpIHtcbiAgICAgICAgY2FsbGJhY2tzLmNoYW5nZWQuY2FsbCh0aGlzLCBpZCwgRUpTT04uY2xvbmUoZmllbGRzKSk7XG4gICAgICB9XG5cbiAgICAgIERpZmZTZXF1ZW5jZS5hcHBseUNoYW5nZXMoZG9jLCBmaWVsZHMpO1xuICAgIH07XG5cbiAgICB0aGlzLmFwcGx5Q2hhbmdlLnJlbW92ZWQgPSBpZCA9PiB7XG4gICAgICBpZiAoY2FsbGJhY2tzLnJlbW92ZWQpIHtcbiAgICAgICAgY2FsbGJhY2tzLnJlbW92ZWQuY2FsbCh0aGlzLCBpZCk7XG4gICAgICB9XG5cbiAgICAgIHRoaXMuZG9jcy5yZW1vdmUoaWQpO1xuICAgIH07XG4gIH1cbn07XG5cbkxvY2FsQ29sbGVjdGlvbi5fSWRNYXAgPSBjbGFzcyBfSWRNYXAgZXh0ZW5kcyBJZE1hcCB7XG4gIGNvbnN0cnVjdG9yKCkge1xuICAgIHN1cGVyKE1vbmdvSUQuaWRTdHJpbmdpZnksIE1vbmdvSUQuaWRQYXJzZSk7XG4gIH1cbn07XG5cbi8vIFdyYXAgYSB0cmFuc2Zvcm0gZnVuY3Rpb24gdG8gcmV0dXJuIG9iamVjdHMgdGhhdCBoYXZlIHRoZSBfaWQgZmllbGRcbi8vIG9mIHRoZSB1bnRyYW5zZm9ybWVkIGRvY3VtZW50LiBUaGlzIGVuc3VyZXMgdGhhdCBzdWJzeXN0ZW1zIHN1Y2ggYXNcbi8vIHRoZSBvYnNlcnZlLXNlcXVlbmNlIHBhY2thZ2UgdGhhdCBjYWxsIGBvYnNlcnZlYCBjYW4ga2VlcCB0cmFjayBvZlxuLy8gdGhlIGRvY3VtZW50cyBpZGVudGl0aWVzLlxuLy9cbi8vIC0gUmVxdWlyZSB0aGF0IGl0IHJldHVybnMgb2JqZWN0c1xuLy8gLSBJZiB0aGUgcmV0dXJuIHZhbHVlIGhhcyBhbiBfaWQgZmllbGQsIHZlcmlmeSB0aGF0IGl0IG1hdGNoZXMgdGhlXG4vLyAgIG9yaWdpbmFsIF9pZCBmaWVsZFxuLy8gLSBJZiB0aGUgcmV0dXJuIHZhbHVlIGRvZXNuJ3QgaGF2ZSBhbiBfaWQgZmllbGQsIGFkZCBpdCBiYWNrLlxuTG9jYWxDb2xsZWN0aW9uLndyYXBUcmFuc2Zvcm0gPSB0cmFuc2Zvcm0gPT4ge1xuICBpZiAoIXRyYW5zZm9ybSkge1xuICAgIHJldHVybiBudWxsO1xuICB9XG5cbiAgLy8gTm8gbmVlZCB0byBkb3VibHktd3JhcCB0cmFuc2Zvcm1zLlxuICBpZiAodHJhbnNmb3JtLl9fd3JhcHBlZFRyYW5zZm9ybV9fKSB7XG4gICAgcmV0dXJuIHRyYW5zZm9ybTtcbiAgfVxuXG4gIGNvbnN0IHdyYXBwZWQgPSBkb2MgPT4ge1xuICAgIGlmICghaGFzT3duLmNhbGwoZG9jLCAnX2lkJykpIHtcbiAgICAgIC8vIFhYWCBkbyB3ZSBldmVyIGhhdmUgYSB0cmFuc2Zvcm0gb24gdGhlIG9wbG9nJ3MgY29sbGVjdGlvbj8gYmVjYXVzZSB0aGF0XG4gICAgICAvLyBjb2xsZWN0aW9uIGhhcyBubyBfaWQuXG4gICAgICB0aHJvdyBuZXcgRXJyb3IoJ2NhbiBvbmx5IHRyYW5zZm9ybSBkb2N1bWVudHMgd2l0aCBfaWQnKTtcbiAgICB9XG5cbiAgICBjb25zdCBpZCA9IGRvYy5faWQ7XG5cbiAgICAvLyBYWFggY29uc2lkZXIgbWFraW5nIHRyYWNrZXIgYSB3ZWFrIGRlcGVuZGVuY3kgYW5kIGNoZWNraW5nXG4gICAgLy8gUGFja2FnZS50cmFja2VyIGhlcmVcbiAgICBjb25zdCB0cmFuc2Zvcm1lZCA9IFRyYWNrZXIubm9ucmVhY3RpdmUoKCkgPT4gdHJhbnNmb3JtKGRvYykpO1xuXG4gICAgaWYgKCFMb2NhbENvbGxlY3Rpb24uX2lzUGxhaW5PYmplY3QodHJhbnNmb3JtZWQpKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoJ3RyYW5zZm9ybSBtdXN0IHJldHVybiBvYmplY3QnKTtcbiAgICB9XG5cbiAgICBpZiAoaGFzT3duLmNhbGwodHJhbnNmb3JtZWQsICdfaWQnKSkge1xuICAgICAgaWYgKCFFSlNPTi5lcXVhbHModHJhbnNmb3JtZWQuX2lkLCBpZCkpIHtcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKCd0cmFuc2Zvcm1lZCBkb2N1bWVudCBjYW5cXCd0IGhhdmUgZGlmZmVyZW50IF9pZCcpO1xuICAgICAgfVxuICAgIH0gZWxzZSB7XG4gICAgICB0cmFuc2Zvcm1lZC5faWQgPSBpZDtcbiAgICB9XG5cbiAgICByZXR1cm4gdHJhbnNmb3JtZWQ7XG4gIH07XG5cbiAgd3JhcHBlZC5fX3dyYXBwZWRUcmFuc2Zvcm1fXyA9IHRydWU7XG5cbiAgcmV0dXJuIHdyYXBwZWQ7XG59O1xuXG4vLyBYWFggdGhlIHNvcnRlZC1xdWVyeSBsb2dpYyBiZWxvdyBpcyBsYXVnaGFibHkgaW5lZmZpY2llbnQuIHdlJ2xsXG4vLyBuZWVkIHRvIGNvbWUgdXAgd2l0aCBhIGJldHRlciBkYXRhc3RydWN0dXJlIGZvciB0aGlzLlxuLy9cbi8vIFhYWCB0aGUgbG9naWMgZm9yIG9ic2VydmluZyB3aXRoIGEgc2tpcCBvciBhIGxpbWl0IGlzIGV2ZW4gbW9yZVxuLy8gbGF1Z2hhYmx5IGluZWZmaWNpZW50LiB3ZSByZWNvbXB1dGUgdGhlIHdob2xlIHJlc3VsdHMgZXZlcnkgdGltZSFcblxuLy8gVGhpcyBiaW5hcnkgc2VhcmNoIHB1dHMgYSB2YWx1ZSBiZXR3ZWVuIGFueSBlcXVhbCB2YWx1ZXMsIGFuZCB0aGUgZmlyc3Rcbi8vIGxlc3NlciB2YWx1ZS5cbkxvY2FsQ29sbGVjdGlvbi5fYmluYXJ5U2VhcmNoID0gKGNtcCwgYXJyYXksIHZhbHVlKSA9PiB7XG4gIGxldCBmaXJzdCA9IDA7XG4gIGxldCByYW5nZSA9IGFycmF5Lmxlbmd0aDtcblxuICB3aGlsZSAocmFuZ2UgPiAwKSB7XG4gICAgY29uc3QgaGFsZlJhbmdlID0gTWF0aC5mbG9vcihyYW5nZSAvIDIpO1xuXG4gICAgaWYgKGNtcCh2YWx1ZSwgYXJyYXlbZmlyc3QgKyBoYWxmUmFuZ2VdKSA+PSAwKSB7XG4gICAgICBmaXJzdCArPSBoYWxmUmFuZ2UgKyAxO1xuICAgICAgcmFuZ2UgLT0gaGFsZlJhbmdlICsgMTtcbiAgICB9IGVsc2Uge1xuICAgICAgcmFuZ2UgPSBoYWxmUmFuZ2U7XG4gICAgfVxuICB9XG5cbiAgcmV0dXJuIGZpcnN0O1xufTtcblxuTG9jYWxDb2xsZWN0aW9uLl9jaGVja1N1cHBvcnRlZFByb2plY3Rpb24gPSBmaWVsZHMgPT4ge1xuICBpZiAoZmllbGRzICE9PSBPYmplY3QoZmllbGRzKSB8fCBBcnJheS5pc0FycmF5KGZpZWxkcykpIHtcbiAgICB0aHJvdyBNaW5pbW9uZ29FcnJvcignZmllbGRzIG9wdGlvbiBtdXN0IGJlIGFuIG9iamVjdCcpO1xuICB9XG5cbiAgT2JqZWN0LmtleXMoZmllbGRzKS5mb3JFYWNoKGtleVBhdGggPT4ge1xuICAgIGlmIChrZXlQYXRoLnNwbGl0KCcuJykuaW5jbHVkZXMoJyQnKSkge1xuICAgICAgdGhyb3cgTWluaW1vbmdvRXJyb3IoXG4gICAgICAgICdNaW5pbW9uZ28gZG9lc25cXCd0IHN1cHBvcnQgJCBvcGVyYXRvciBpbiBwcm9qZWN0aW9ucyB5ZXQuJ1xuICAgICAgKTtcbiAgICB9XG5cbiAgICBjb25zdCB2YWx1ZSA9IGZpZWxkc1trZXlQYXRoXTtcblxuICAgIGlmICh0eXBlb2YgdmFsdWUgPT09ICdvYmplY3QnICYmXG4gICAgICAgIFsnJGVsZW1NYXRjaCcsICckbWV0YScsICckc2xpY2UnXS5zb21lKGtleSA9PlxuICAgICAgICAgIGhhc093bi5jYWxsKHZhbHVlLCBrZXkpXG4gICAgICAgICkpIHtcbiAgICAgIHRocm93IE1pbmltb25nb0Vycm9yKFxuICAgICAgICAnTWluaW1vbmdvIGRvZXNuXFwndCBzdXBwb3J0IG9wZXJhdG9ycyBpbiBwcm9qZWN0aW9ucyB5ZXQuJ1xuICAgICAgKTtcbiAgICB9XG5cbiAgICBpZiAoIVsxLCAwLCB0cnVlLCBmYWxzZV0uaW5jbHVkZXModmFsdWUpKSB7XG4gICAgICB0aHJvdyBNaW5pbW9uZ29FcnJvcihcbiAgICAgICAgJ1Byb2plY3Rpb24gdmFsdWVzIHNob3VsZCBiZSBvbmUgb2YgMSwgMCwgdHJ1ZSwgb3IgZmFsc2UnXG4gICAgICApO1xuICAgIH1cbiAgfSk7XG59O1xuXG4vLyBLbm93cyBob3cgdG8gY29tcGlsZSBhIGZpZWxkcyBwcm9qZWN0aW9uIHRvIGEgcHJlZGljYXRlIGZ1bmN0aW9uLlxuLy8gQHJldHVybnMgLSBGdW5jdGlvbjogYSBjbG9zdXJlIHRoYXQgZmlsdGVycyBvdXQgYW4gb2JqZWN0IGFjY29yZGluZyB0byB0aGVcbi8vICAgICAgICAgICAgZmllbGRzIHByb2plY3Rpb24gcnVsZXM6XG4vLyAgICAgICAgICAgIEBwYXJhbSBvYmogLSBPYmplY3Q6IE1vbmdvREItc3R5bGVkIGRvY3VtZW50XG4vLyAgICAgICAgICAgIEByZXR1cm5zIC0gT2JqZWN0OiBhIGRvY3VtZW50IHdpdGggdGhlIGZpZWxkcyBmaWx0ZXJlZCBvdXRcbi8vICAgICAgICAgICAgICAgICAgICAgICBhY2NvcmRpbmcgdG8gcHJvamVjdGlvbiBydWxlcy4gRG9lc24ndCByZXRhaW4gc3ViZmllbGRzXG4vLyAgICAgICAgICAgICAgICAgICAgICAgb2YgcGFzc2VkIGFyZ3VtZW50LlxuTG9jYWxDb2xsZWN0aW9uLl9jb21waWxlUHJvamVjdGlvbiA9IGZpZWxkcyA9PiB7XG4gIExvY2FsQ29sbGVjdGlvbi5fY2hlY2tTdXBwb3J0ZWRQcm9qZWN0aW9uKGZpZWxkcyk7XG5cbiAgY29uc3QgX2lkUHJvamVjdGlvbiA9IGZpZWxkcy5faWQgPT09IHVuZGVmaW5lZCA/IHRydWUgOiBmaWVsZHMuX2lkO1xuICBjb25zdCBkZXRhaWxzID0gcHJvamVjdGlvbkRldGFpbHMoZmllbGRzKTtcblxuICAvLyByZXR1cm5zIHRyYW5zZm9ybWVkIGRvYyBhY2NvcmRpbmcgdG8gcnVsZVRyZWVcbiAgY29uc3QgdHJhbnNmb3JtID0gKGRvYywgcnVsZVRyZWUpID0+IHtcbiAgICAvLyBTcGVjaWFsIGNhc2UgZm9yIFwic2V0c1wiXG4gICAgaWYgKEFycmF5LmlzQXJyYXkoZG9jKSkge1xuICAgICAgcmV0dXJuIGRvYy5tYXAoc3ViZG9jID0+IHRyYW5zZm9ybShzdWJkb2MsIHJ1bGVUcmVlKSk7XG4gICAgfVxuXG4gICAgY29uc3QgcmVzdWx0ID0gZGV0YWlscy5pbmNsdWRpbmcgPyB7fSA6IEVKU09OLmNsb25lKGRvYyk7XG5cbiAgICBPYmplY3Qua2V5cyhydWxlVHJlZSkuZm9yRWFjaChrZXkgPT4ge1xuICAgICAgaWYgKCFoYXNPd24uY2FsbChkb2MsIGtleSkpIHtcbiAgICAgICAgcmV0dXJuO1xuICAgICAgfVxuXG4gICAgICBjb25zdCBydWxlID0gcnVsZVRyZWVba2V5XTtcblxuICAgICAgaWYgKHJ1bGUgPT09IE9iamVjdChydWxlKSkge1xuICAgICAgICAvLyBGb3Igc3ViLW9iamVjdHMvc3Vic2V0cyB3ZSBicmFuY2hcbiAgICAgICAgaWYgKGRvY1trZXldID09PSBPYmplY3QoZG9jW2tleV0pKSB7XG4gICAgICAgICAgcmVzdWx0W2tleV0gPSB0cmFuc2Zvcm0oZG9jW2tleV0sIHJ1bGUpO1xuICAgICAgICB9XG4gICAgICB9IGVsc2UgaWYgKGRldGFpbHMuaW5jbHVkaW5nKSB7XG4gICAgICAgIC8vIE90aGVyd2lzZSB3ZSBkb24ndCBldmVuIHRvdWNoIHRoaXMgc3ViZmllbGRcbiAgICAgICAgcmVzdWx0W2tleV0gPSBFSlNPTi5jbG9uZShkb2Nba2V5XSk7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICBkZWxldGUgcmVzdWx0W2tleV07XG4gICAgICB9XG4gICAgfSk7XG5cbiAgICByZXR1cm4gcmVzdWx0O1xuICB9O1xuXG4gIHJldHVybiBkb2MgPT4ge1xuICAgIGNvbnN0IHJlc3VsdCA9IHRyYW5zZm9ybShkb2MsIGRldGFpbHMudHJlZSk7XG5cbiAgICBpZiAoX2lkUHJvamVjdGlvbiAmJiBoYXNPd24uY2FsbChkb2MsICdfaWQnKSkge1xuICAgICAgcmVzdWx0Ll9pZCA9IGRvYy5faWQ7XG4gICAgfVxuXG4gICAgaWYgKCFfaWRQcm9qZWN0aW9uICYmIGhhc093bi5jYWxsKHJlc3VsdCwgJ19pZCcpKSB7XG4gICAgICBkZWxldGUgcmVzdWx0Ll9pZDtcbiAgICB9XG5cbiAgICByZXR1cm4gcmVzdWx0O1xuICB9O1xufTtcblxuLy8gQ2FsY3VsYXRlcyB0aGUgZG9jdW1lbnQgdG8gaW5zZXJ0IGluIGNhc2Ugd2UncmUgZG9pbmcgYW4gdXBzZXJ0IGFuZCB0aGVcbi8vIHNlbGVjdG9yIGRvZXMgbm90IG1hdGNoIGFueSBlbGVtZW50c1xuTG9jYWxDb2xsZWN0aW9uLl9jcmVhdGVVcHNlcnREb2N1bWVudCA9IChzZWxlY3RvciwgbW9kaWZpZXIpID0+IHtcbiAgY29uc3Qgc2VsZWN0b3JEb2N1bWVudCA9IHBvcHVsYXRlRG9jdW1lbnRXaXRoUXVlcnlGaWVsZHMoc2VsZWN0b3IpO1xuICBjb25zdCBpc01vZGlmeSA9IExvY2FsQ29sbGVjdGlvbi5faXNNb2RpZmljYXRpb25Nb2QobW9kaWZpZXIpO1xuXG4gIGNvbnN0IG5ld0RvYyA9IHt9O1xuXG4gIGlmIChzZWxlY3RvckRvY3VtZW50Ll9pZCkge1xuICAgIG5ld0RvYy5faWQgPSBzZWxlY3RvckRvY3VtZW50Ll9pZDtcbiAgICBkZWxldGUgc2VsZWN0b3JEb2N1bWVudC5faWQ7XG4gIH1cblxuICAvLyBUaGlzIGRvdWJsZSBfbW9kaWZ5IGNhbGwgaXMgbWFkZSB0byBoZWxwIHdpdGggbmVzdGVkIHByb3BlcnRpZXMgKHNlZSBpc3N1ZVxuICAvLyAjODYzMSkuIFdlIGRvIHRoaXMgZXZlbiBpZiBpdCdzIGEgcmVwbGFjZW1lbnQgZm9yIHZhbGlkYXRpb24gcHVycG9zZXMgKGUuZy5cbiAgLy8gYW1iaWd1b3VzIGlkJ3MpXG4gIExvY2FsQ29sbGVjdGlvbi5fbW9kaWZ5KG5ld0RvYywgeyRzZXQ6IHNlbGVjdG9yRG9jdW1lbnR9KTtcbiAgTG9jYWxDb2xsZWN0aW9uLl9tb2RpZnkobmV3RG9jLCBtb2RpZmllciwge2lzSW5zZXJ0OiB0cnVlfSk7XG5cbiAgaWYgKGlzTW9kaWZ5KSB7XG4gICAgcmV0dXJuIG5ld0RvYztcbiAgfVxuXG4gIC8vIFJlcGxhY2VtZW50IGNhbiB0YWtlIF9pZCBmcm9tIHF1ZXJ5IGRvY3VtZW50XG4gIGNvbnN0IHJlcGxhY2VtZW50ID0gT2JqZWN0LmFzc2lnbih7fSwgbW9kaWZpZXIpO1xuICBpZiAobmV3RG9jLl9pZCkge1xuICAgIHJlcGxhY2VtZW50Ll9pZCA9IG5ld0RvYy5faWQ7XG4gIH1cblxuICByZXR1cm4gcmVwbGFjZW1lbnQ7XG59O1xuXG5Mb2NhbENvbGxlY3Rpb24uX2RpZmZPYmplY3RzID0gKGxlZnQsIHJpZ2h0LCBjYWxsYmFja3MpID0+IHtcbiAgcmV0dXJuIERpZmZTZXF1ZW5jZS5kaWZmT2JqZWN0cyhsZWZ0LCByaWdodCwgY2FsbGJhY2tzKTtcbn07XG5cbi8vIG9yZGVyZWQ6IGJvb2wuXG4vLyBvbGRfcmVzdWx0cyBhbmQgbmV3X3Jlc3VsdHM6IGNvbGxlY3Rpb25zIG9mIGRvY3VtZW50cy5cbi8vICAgIGlmIG9yZGVyZWQsIHRoZXkgYXJlIGFycmF5cy5cbi8vICAgIGlmIHVub3JkZXJlZCwgdGhleSBhcmUgSWRNYXBzXG5Mb2NhbENvbGxlY3Rpb24uX2RpZmZRdWVyeUNoYW5nZXMgPSAob3JkZXJlZCwgb2xkUmVzdWx0cywgbmV3UmVzdWx0cywgb2JzZXJ2ZXIsIG9wdGlvbnMpID0+XG4gIERpZmZTZXF1ZW5jZS5kaWZmUXVlcnlDaGFuZ2VzKG9yZGVyZWQsIG9sZFJlc3VsdHMsIG5ld1Jlc3VsdHMsIG9ic2VydmVyLCBvcHRpb25zKVxuO1xuXG5Mb2NhbENvbGxlY3Rpb24uX2RpZmZRdWVyeU9yZGVyZWRDaGFuZ2VzID0gKG9sZFJlc3VsdHMsIG5ld1Jlc3VsdHMsIG9ic2VydmVyLCBvcHRpb25zKSA9PlxuICBEaWZmU2VxdWVuY2UuZGlmZlF1ZXJ5T3JkZXJlZENoYW5nZXMob2xkUmVzdWx0cywgbmV3UmVzdWx0cywgb2JzZXJ2ZXIsIG9wdGlvbnMpXG47XG5cbkxvY2FsQ29sbGVjdGlvbi5fZGlmZlF1ZXJ5VW5vcmRlcmVkQ2hhbmdlcyA9IChvbGRSZXN1bHRzLCBuZXdSZXN1bHRzLCBvYnNlcnZlciwgb3B0aW9ucykgPT5cbiAgRGlmZlNlcXVlbmNlLmRpZmZRdWVyeVVub3JkZXJlZENoYW5nZXMob2xkUmVzdWx0cywgbmV3UmVzdWx0cywgb2JzZXJ2ZXIsIG9wdGlvbnMpXG47XG5cbkxvY2FsQ29sbGVjdGlvbi5fZmluZEluT3JkZXJlZFJlc3VsdHMgPSAocXVlcnksIGRvYykgPT4ge1xuICBpZiAoIXF1ZXJ5Lm9yZGVyZWQpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoJ0NhblxcJ3QgY2FsbCBfZmluZEluT3JkZXJlZFJlc3VsdHMgb24gdW5vcmRlcmVkIHF1ZXJ5Jyk7XG4gIH1cblxuICBmb3IgKGxldCBpID0gMDsgaSA8IHF1ZXJ5LnJlc3VsdHMubGVuZ3RoOyBpKyspIHtcbiAgICBpZiAocXVlcnkucmVzdWx0c1tpXSA9PT0gZG9jKSB7XG4gICAgICByZXR1cm4gaTtcbiAgICB9XG4gIH1cblxuICB0aHJvdyBFcnJvcignb2JqZWN0IG1pc3NpbmcgZnJvbSBxdWVyeScpO1xufTtcblxuLy8gSWYgdGhpcyBpcyBhIHNlbGVjdG9yIHdoaWNoIGV4cGxpY2l0bHkgY29uc3RyYWlucyB0aGUgbWF0Y2ggYnkgSUQgdG8gYSBmaW5pdGVcbi8vIG51bWJlciBvZiBkb2N1bWVudHMsIHJldHVybnMgYSBsaXN0IG9mIHRoZWlyIElEcy4gIE90aGVyd2lzZSByZXR1cm5zXG4vLyBudWxsLiBOb3RlIHRoYXQgdGhlIHNlbGVjdG9yIG1heSBoYXZlIG90aGVyIHJlc3RyaWN0aW9ucyBzbyBpdCBtYXkgbm90IGV2ZW5cbi8vIG1hdGNoIHRob3NlIGRvY3VtZW50ISAgV2UgY2FyZSBhYm91dCAkaW4gYW5kICRhbmQgc2luY2UgdGhvc2UgYXJlIGdlbmVyYXRlZFxuLy8gYWNjZXNzLWNvbnRyb2xsZWQgdXBkYXRlIGFuZCByZW1vdmUuXG5Mb2NhbENvbGxlY3Rpb24uX2lkc01hdGNoZWRCeVNlbGVjdG9yID0gc2VsZWN0b3IgPT4ge1xuICAvLyBJcyB0aGUgc2VsZWN0b3IganVzdCBhbiBJRD9cbiAgaWYgKExvY2FsQ29sbGVjdGlvbi5fc2VsZWN0b3JJc0lkKHNlbGVjdG9yKSkge1xuICAgIHJldHVybiBbc2VsZWN0b3JdO1xuICB9XG5cbiAgaWYgKCFzZWxlY3Rvcikge1xuICAgIHJldHVybiBudWxsO1xuICB9XG5cbiAgLy8gRG8gd2UgaGF2ZSBhbiBfaWQgY2xhdXNlP1xuICBpZiAoaGFzT3duLmNhbGwoc2VsZWN0b3IsICdfaWQnKSkge1xuICAgIC8vIElzIHRoZSBfaWQgY2xhdXNlIGp1c3QgYW4gSUQ/XG4gICAgaWYgKExvY2FsQ29sbGVjdGlvbi5fc2VsZWN0b3JJc0lkKHNlbGVjdG9yLl9pZCkpIHtcbiAgICAgIHJldHVybiBbc2VsZWN0b3IuX2lkXTtcbiAgICB9XG5cbiAgICAvLyBJcyB0aGUgX2lkIGNsYXVzZSB7X2lkOiB7JGluOiBbXCJ4XCIsIFwieVwiLCBcInpcIl19fT9cbiAgICBpZiAoc2VsZWN0b3IuX2lkXG4gICAgICAgICYmIEFycmF5LmlzQXJyYXkoc2VsZWN0b3IuX2lkLiRpbilcbiAgICAgICAgJiYgc2VsZWN0b3IuX2lkLiRpbi5sZW5ndGhcbiAgICAgICAgJiYgc2VsZWN0b3IuX2lkLiRpbi5ldmVyeShMb2NhbENvbGxlY3Rpb24uX3NlbGVjdG9ySXNJZCkpIHtcbiAgICAgIHJldHVybiBzZWxlY3Rvci5faWQuJGluO1xuICAgIH1cblxuICAgIHJldHVybiBudWxsO1xuICB9XG5cbiAgLy8gSWYgdGhpcyBpcyBhIHRvcC1sZXZlbCAkYW5kLCBhbmQgYW55IG9mIHRoZSBjbGF1c2VzIGNvbnN0cmFpbiB0aGVpclxuICAvLyBkb2N1bWVudHMsIHRoZW4gdGhlIHdob2xlIHNlbGVjdG9yIGlzIGNvbnN0cmFpbmVkIGJ5IGFueSBvbmUgY2xhdXNlJ3NcbiAgLy8gY29uc3RyYWludC4gKFdlbGwsIGJ5IHRoZWlyIGludGVyc2VjdGlvbiwgYnV0IHRoYXQgc2VlbXMgdW5saWtlbHkuKVxuICBpZiAoQXJyYXkuaXNBcnJheShzZWxlY3Rvci4kYW5kKSkge1xuICAgIGZvciAobGV0IGkgPSAwOyBpIDwgc2VsZWN0b3IuJGFuZC5sZW5ndGg7ICsraSkge1xuICAgICAgY29uc3Qgc3ViSWRzID0gTG9jYWxDb2xsZWN0aW9uLl9pZHNNYXRjaGVkQnlTZWxlY3RvcihzZWxlY3Rvci4kYW5kW2ldKTtcblxuICAgICAgaWYgKHN1Yklkcykge1xuICAgICAgICByZXR1cm4gc3ViSWRzO1xuICAgICAgfVxuICAgIH1cbiAgfVxuXG4gIHJldHVybiBudWxsO1xufTtcblxuTG9jYWxDb2xsZWN0aW9uLl9pbnNlcnRJblJlc3VsdHMgPSAocXVlcnksIGRvYykgPT4ge1xuICBjb25zdCBmaWVsZHMgPSBFSlNPTi5jbG9uZShkb2MpO1xuXG4gIGRlbGV0ZSBmaWVsZHMuX2lkO1xuXG4gIGlmIChxdWVyeS5vcmRlcmVkKSB7XG4gICAgaWYgKCFxdWVyeS5zb3J0ZXIpIHtcbiAgICAgIHF1ZXJ5LmFkZGVkQmVmb3JlKGRvYy5faWQsIHF1ZXJ5LnByb2plY3Rpb25GbihmaWVsZHMpLCBudWxsKTtcbiAgICAgIHF1ZXJ5LnJlc3VsdHMucHVzaChkb2MpO1xuICAgIH0gZWxzZSB7XG4gICAgICBjb25zdCBpID0gTG9jYWxDb2xsZWN0aW9uLl9pbnNlcnRJblNvcnRlZExpc3QoXG4gICAgICAgIHF1ZXJ5LnNvcnRlci5nZXRDb21wYXJhdG9yKHtkaXN0YW5jZXM6IHF1ZXJ5LmRpc3RhbmNlc30pLFxuICAgICAgICBxdWVyeS5yZXN1bHRzLFxuICAgICAgICBkb2NcbiAgICAgICk7XG5cbiAgICAgIGxldCBuZXh0ID0gcXVlcnkucmVzdWx0c1tpICsgMV07XG4gICAgICBpZiAobmV4dCkge1xuICAgICAgICBuZXh0ID0gbmV4dC5faWQ7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICBuZXh0ID0gbnVsbDtcbiAgICAgIH1cblxuICAgICAgcXVlcnkuYWRkZWRCZWZvcmUoZG9jLl9pZCwgcXVlcnkucHJvamVjdGlvbkZuKGZpZWxkcyksIG5leHQpO1xuICAgIH1cblxuICAgIHF1ZXJ5LmFkZGVkKGRvYy5faWQsIHF1ZXJ5LnByb2plY3Rpb25GbihmaWVsZHMpKTtcbiAgfSBlbHNlIHtcbiAgICBxdWVyeS5hZGRlZChkb2MuX2lkLCBxdWVyeS5wcm9qZWN0aW9uRm4oZmllbGRzKSk7XG4gICAgcXVlcnkucmVzdWx0cy5zZXQoZG9jLl9pZCwgZG9jKTtcbiAgfVxufTtcblxuTG9jYWxDb2xsZWN0aW9uLl9pbnNlcnRJblNvcnRlZExpc3QgPSAoY21wLCBhcnJheSwgdmFsdWUpID0+IHtcbiAgaWYgKGFycmF5Lmxlbmd0aCA9PT0gMCkge1xuICAgIGFycmF5LnB1c2godmFsdWUpO1xuICAgIHJldHVybiAwO1xuICB9XG5cbiAgY29uc3QgaSA9IExvY2FsQ29sbGVjdGlvbi5fYmluYXJ5U2VhcmNoKGNtcCwgYXJyYXksIHZhbHVlKTtcblxuICBhcnJheS5zcGxpY2UoaSwgMCwgdmFsdWUpO1xuXG4gIHJldHVybiBpO1xufTtcblxuTG9jYWxDb2xsZWN0aW9uLl9pc01vZGlmaWNhdGlvbk1vZCA9IG1vZCA9PiB7XG4gIGxldCBpc01vZGlmeSA9IGZhbHNlO1xuICBsZXQgaXNSZXBsYWNlID0gZmFsc2U7XG5cbiAgT2JqZWN0LmtleXMobW9kKS5mb3JFYWNoKGtleSA9PiB7XG4gICAgaWYgKGtleS5zdWJzdHIoMCwgMSkgPT09ICckJykge1xuICAgICAgaXNNb2RpZnkgPSB0cnVlO1xuICAgIH0gZWxzZSB7XG4gICAgICBpc1JlcGxhY2UgPSB0cnVlO1xuICAgIH1cbiAgfSk7XG5cbiAgaWYgKGlzTW9kaWZ5ICYmIGlzUmVwbGFjZSkge1xuICAgIHRocm93IG5ldyBFcnJvcihcbiAgICAgICdVcGRhdGUgcGFyYW1ldGVyIGNhbm5vdCBoYXZlIGJvdGggbW9kaWZpZXIgYW5kIG5vbi1tb2RpZmllciBmaWVsZHMuJ1xuICAgICk7XG4gIH1cblxuICByZXR1cm4gaXNNb2RpZnk7XG59O1xuXG4vLyBYWFggbWF5YmUgdGhpcyBzaG91bGQgYmUgRUpTT04uaXNPYmplY3QsIHRob3VnaCBFSlNPTiBkb2Vzbid0IGtub3cgYWJvdXRcbi8vIFJlZ0V4cFxuLy8gWFhYIG5vdGUgdGhhdCBfdHlwZSh1bmRlZmluZWQpID09PSAzISEhIVxuTG9jYWxDb2xsZWN0aW9uLl9pc1BsYWluT2JqZWN0ID0geCA9PiB7XG4gIHJldHVybiB4ICYmIExvY2FsQ29sbGVjdGlvbi5fZi5fdHlwZSh4KSA9PT0gMztcbn07XG5cbi8vIFhYWCBuZWVkIGEgc3RyYXRlZ3kgZm9yIHBhc3NpbmcgdGhlIGJpbmRpbmcgb2YgJCBpbnRvIHRoaXNcbi8vIGZ1bmN0aW9uLCBmcm9tIHRoZSBjb21waWxlZCBzZWxlY3RvclxuLy9cbi8vIG1heWJlIGp1c3Qge2tleS51cC50by5qdXN0LmJlZm9yZS5kb2xsYXJzaWduOiBhcnJheV9pbmRleH1cbi8vXG4vLyBYWFggYXRvbWljaXR5OiBpZiBvbmUgbW9kaWZpY2F0aW9uIGZhaWxzLCBkbyB3ZSByb2xsIGJhY2sgdGhlIHdob2xlXG4vLyBjaGFuZ2U/XG4vL1xuLy8gb3B0aW9uczpcbi8vICAgLSBpc0luc2VydCBpcyBzZXQgd2hlbiBfbW9kaWZ5IGlzIGJlaW5nIGNhbGxlZCB0byBjb21wdXRlIHRoZSBkb2N1bWVudCB0b1xuLy8gICAgIGluc2VydCBhcyBwYXJ0IG9mIGFuIHVwc2VydCBvcGVyYXRpb24uIFdlIHVzZSB0aGlzIHByaW1hcmlseSB0byBmaWd1cmVcbi8vICAgICBvdXQgd2hlbiB0byBzZXQgdGhlIGZpZWxkcyBpbiAkc2V0T25JbnNlcnQsIGlmIHByZXNlbnQuXG5Mb2NhbENvbGxlY3Rpb24uX21vZGlmeSA9IChkb2MsIG1vZGlmaWVyLCBvcHRpb25zID0ge30pID0+IHtcbiAgaWYgKCFMb2NhbENvbGxlY3Rpb24uX2lzUGxhaW5PYmplY3QobW9kaWZpZXIpKSB7XG4gICAgdGhyb3cgTWluaW1vbmdvRXJyb3IoJ01vZGlmaWVyIG11c3QgYmUgYW4gb2JqZWN0Jyk7XG4gIH1cblxuICAvLyBNYWtlIHN1cmUgdGhlIGNhbGxlciBjYW4ndCBtdXRhdGUgb3VyIGRhdGEgc3RydWN0dXJlcy5cbiAgbW9kaWZpZXIgPSBFSlNPTi5jbG9uZShtb2RpZmllcik7XG5cbiAgY29uc3QgaXNNb2RpZmllciA9IGlzT3BlcmF0b3JPYmplY3QobW9kaWZpZXIpO1xuICBjb25zdCBuZXdEb2MgPSBpc01vZGlmaWVyID8gRUpTT04uY2xvbmUoZG9jKSA6IG1vZGlmaWVyO1xuXG4gIGlmIChpc01vZGlmaWVyKSB7XG4gICAgLy8gYXBwbHkgbW9kaWZpZXJzIHRvIHRoZSBkb2MuXG4gICAgT2JqZWN0LmtleXMobW9kaWZpZXIpLmZvckVhY2gob3BlcmF0b3IgPT4ge1xuICAgICAgLy8gVHJlYXQgJHNldE9uSW5zZXJ0IGFzICRzZXQgaWYgdGhpcyBpcyBhbiBpbnNlcnQuXG4gICAgICBjb25zdCBzZXRPbkluc2VydCA9IG9wdGlvbnMuaXNJbnNlcnQgJiYgb3BlcmF0b3IgPT09ICckc2V0T25JbnNlcnQnO1xuICAgICAgY29uc3QgbW9kRnVuYyA9IE1PRElGSUVSU1tzZXRPbkluc2VydCA/ICckc2V0JyA6IG9wZXJhdG9yXTtcbiAgICAgIGNvbnN0IG9wZXJhbmQgPSBtb2RpZmllcltvcGVyYXRvcl07XG5cbiAgICAgIGlmICghbW9kRnVuYykge1xuICAgICAgICB0aHJvdyBNaW5pbW9uZ29FcnJvcihgSW52YWxpZCBtb2RpZmllciBzcGVjaWZpZWQgJHtvcGVyYXRvcn1gKTtcbiAgICAgIH1cblxuICAgICAgT2JqZWN0LmtleXMob3BlcmFuZCkuZm9yRWFjaChrZXlwYXRoID0+IHtcbiAgICAgICAgY29uc3QgYXJnID0gb3BlcmFuZFtrZXlwYXRoXTtcblxuICAgICAgICBpZiAoa2V5cGF0aCA9PT0gJycpIHtcbiAgICAgICAgICB0aHJvdyBNaW5pbW9uZ29FcnJvcignQW4gZW1wdHkgdXBkYXRlIHBhdGggaXMgbm90IHZhbGlkLicpO1xuICAgICAgICB9XG5cbiAgICAgICAgY29uc3Qga2V5cGFydHMgPSBrZXlwYXRoLnNwbGl0KCcuJyk7XG5cbiAgICAgICAgaWYgKCFrZXlwYXJ0cy5ldmVyeShCb29sZWFuKSkge1xuICAgICAgICAgIHRocm93IE1pbmltb25nb0Vycm9yKFxuICAgICAgICAgICAgYFRoZSB1cGRhdGUgcGF0aCAnJHtrZXlwYXRofScgY29udGFpbnMgYW4gZW1wdHkgZmllbGQgbmFtZSwgYCArXG4gICAgICAgICAgICAnd2hpY2ggaXMgbm90IGFsbG93ZWQuJ1xuICAgICAgICAgICk7XG4gICAgICAgIH1cblxuICAgICAgICBjb25zdCB0YXJnZXQgPSBmaW5kTW9kVGFyZ2V0KG5ld0RvYywga2V5cGFydHMsIHtcbiAgICAgICAgICBhcnJheUluZGljZXM6IG9wdGlvbnMuYXJyYXlJbmRpY2VzLFxuICAgICAgICAgIGZvcmJpZEFycmF5OiBvcGVyYXRvciA9PT0gJyRyZW5hbWUnLFxuICAgICAgICAgIG5vQ3JlYXRlOiBOT19DUkVBVEVfTU9ESUZJRVJTW29wZXJhdG9yXVxuICAgICAgICB9KTtcblxuICAgICAgICBtb2RGdW5jKHRhcmdldCwga2V5cGFydHMucG9wKCksIGFyZywga2V5cGF0aCwgbmV3RG9jKTtcbiAgICAgIH0pO1xuICAgIH0pO1xuXG4gICAgaWYgKGRvYy5faWQgJiYgIUVKU09OLmVxdWFscyhkb2MuX2lkLCBuZXdEb2MuX2lkKSkge1xuICAgICAgdGhyb3cgTWluaW1vbmdvRXJyb3IoXG4gICAgICAgIGBBZnRlciBhcHBseWluZyB0aGUgdXBkYXRlIHRvIHRoZSBkb2N1bWVudCB7X2lkOiBcIiR7ZG9jLl9pZH1cIiwgLi4ufSxgICtcbiAgICAgICAgJyB0aGUgKGltbXV0YWJsZSkgZmllbGQgXFwnX2lkXFwnIHdhcyBmb3VuZCB0byBoYXZlIGJlZW4gYWx0ZXJlZCB0byAnICtcbiAgICAgICAgYF9pZDogXCIke25ld0RvYy5faWR9XCJgXG4gICAgICApO1xuICAgIH1cbiAgfSBlbHNlIHtcbiAgICBpZiAoZG9jLl9pZCAmJiBtb2RpZmllci5faWQgJiYgIUVKU09OLmVxdWFscyhkb2MuX2lkLCBtb2RpZmllci5faWQpKSB7XG4gICAgICB0aHJvdyBNaW5pbW9uZ29FcnJvcihcbiAgICAgICAgYFRoZSBfaWQgZmllbGQgY2Fubm90IGJlIGNoYW5nZWQgZnJvbSB7X2lkOiBcIiR7ZG9jLl9pZH1cIn0gdG8gYCArXG4gICAgICAgIGB7X2lkOiBcIiR7bW9kaWZpZXIuX2lkfVwifWBcbiAgICAgICk7XG4gICAgfVxuXG4gICAgLy8gcmVwbGFjZSB0aGUgd2hvbGUgZG9jdW1lbnRcbiAgICBhc3NlcnRIYXNWYWxpZEZpZWxkTmFtZXMobW9kaWZpZXIpO1xuICB9XG5cbiAgLy8gbW92ZSBuZXcgZG9jdW1lbnQgaW50byBwbGFjZS5cbiAgT2JqZWN0LmtleXMoZG9jKS5mb3JFYWNoKGtleSA9PiB7XG4gICAgLy8gTm90ZTogdGhpcyB1c2VkIHRvIGJlIGZvciAodmFyIGtleSBpbiBkb2MpIGhvd2V2ZXIsIHRoaXMgZG9lcyBub3RcbiAgICAvLyB3b3JrIHJpZ2h0IGluIE9wZXJhLiBEZWxldGluZyBmcm9tIGEgZG9jIHdoaWxlIGl0ZXJhdGluZyBvdmVyIGl0XG4gICAgLy8gd291bGQgc29tZXRpbWVzIGNhdXNlIG9wZXJhIHRvIHNraXAgc29tZSBrZXlzLlxuICAgIGlmIChrZXkgIT09ICdfaWQnKSB7XG4gICAgICBkZWxldGUgZG9jW2tleV07XG4gICAgfVxuICB9KTtcblxuICBPYmplY3Qua2V5cyhuZXdEb2MpLmZvckVhY2goa2V5ID0+IHtcbiAgICBkb2Nba2V5XSA9IG5ld0RvY1trZXldO1xuICB9KTtcbn07XG5cbkxvY2FsQ29sbGVjdGlvbi5fb2JzZXJ2ZUZyb21PYnNlcnZlQ2hhbmdlcyA9IChjdXJzb3IsIG9ic2VydmVDYWxsYmFja3MpID0+IHtcbiAgY29uc3QgdHJhbnNmb3JtID0gY3Vyc29yLmdldFRyYW5zZm9ybSgpIHx8IChkb2MgPT4gZG9jKTtcbiAgbGV0IHN1cHByZXNzZWQgPSAhIW9ic2VydmVDYWxsYmFja3MuX3N1cHByZXNzX2luaXRpYWw7XG5cbiAgbGV0IG9ic2VydmVDaGFuZ2VzQ2FsbGJhY2tzO1xuICBpZiAoTG9jYWxDb2xsZWN0aW9uLl9vYnNlcnZlQ2FsbGJhY2tzQXJlT3JkZXJlZChvYnNlcnZlQ2FsbGJhY2tzKSkge1xuICAgIC8vIFRoZSBcIl9ub19pbmRpY2VzXCIgb3B0aW9uIHNldHMgYWxsIGluZGV4IGFyZ3VtZW50cyB0byAtMSBhbmQgc2tpcHMgdGhlXG4gICAgLy8gbGluZWFyIHNjYW5zIHJlcXVpcmVkIHRvIGdlbmVyYXRlIHRoZW0uICBUaGlzIGxldHMgb2JzZXJ2ZXJzIHRoYXQgZG9uJ3RcbiAgICAvLyBuZWVkIGFic29sdXRlIGluZGljZXMgYmVuZWZpdCBmcm9tIHRoZSBvdGhlciBmZWF0dXJlcyBvZiB0aGlzIEFQSSAtLVxuICAgIC8vIHJlbGF0aXZlIG9yZGVyLCB0cmFuc2Zvcm1zLCBhbmQgYXBwbHlDaGFuZ2VzIC0tIHdpdGhvdXQgdGhlIHNwZWVkIGhpdC5cbiAgICBjb25zdCBpbmRpY2VzID0gIW9ic2VydmVDYWxsYmFja3MuX25vX2luZGljZXM7XG5cbiAgICBvYnNlcnZlQ2hhbmdlc0NhbGxiYWNrcyA9IHtcbiAgICAgIGFkZGVkQmVmb3JlKGlkLCBmaWVsZHMsIGJlZm9yZSkge1xuICAgICAgICBpZiAoc3VwcHJlc3NlZCB8fCAhKG9ic2VydmVDYWxsYmFja3MuYWRkZWRBdCB8fCBvYnNlcnZlQ2FsbGJhY2tzLmFkZGVkKSkge1xuICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuXG4gICAgICAgIGNvbnN0IGRvYyA9IHRyYW5zZm9ybShPYmplY3QuYXNzaWduKGZpZWxkcywge19pZDogaWR9KSk7XG5cbiAgICAgICAgaWYgKG9ic2VydmVDYWxsYmFja3MuYWRkZWRBdCkge1xuICAgICAgICAgIG9ic2VydmVDYWxsYmFja3MuYWRkZWRBdChcbiAgICAgICAgICAgIGRvYyxcbiAgICAgICAgICAgIGluZGljZXNcbiAgICAgICAgICAgICAgPyBiZWZvcmVcbiAgICAgICAgICAgICAgICA/IHRoaXMuZG9jcy5pbmRleE9mKGJlZm9yZSlcbiAgICAgICAgICAgICAgICA6IHRoaXMuZG9jcy5zaXplKClcbiAgICAgICAgICAgICAgOiAtMSxcbiAgICAgICAgICAgIGJlZm9yZVxuICAgICAgICAgICk7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgb2JzZXJ2ZUNhbGxiYWNrcy5hZGRlZChkb2MpO1xuICAgICAgICB9XG4gICAgICB9LFxuICAgICAgY2hhbmdlZChpZCwgZmllbGRzKSB7XG4gICAgICAgIGlmICghKG9ic2VydmVDYWxsYmFja3MuY2hhbmdlZEF0IHx8IG9ic2VydmVDYWxsYmFja3MuY2hhbmdlZCkpIHtcbiAgICAgICAgICByZXR1cm47XG4gICAgICAgIH1cblxuICAgICAgICBsZXQgZG9jID0gRUpTT04uY2xvbmUodGhpcy5kb2NzLmdldChpZCkpO1xuICAgICAgICBpZiAoIWRvYykge1xuICAgICAgICAgIHRocm93IG5ldyBFcnJvcihgVW5rbm93biBpZCBmb3IgY2hhbmdlZDogJHtpZH1gKTtcbiAgICAgICAgfVxuXG4gICAgICAgIGNvbnN0IG9sZERvYyA9IHRyYW5zZm9ybShFSlNPTi5jbG9uZShkb2MpKTtcblxuICAgICAgICBEaWZmU2VxdWVuY2UuYXBwbHlDaGFuZ2VzKGRvYywgZmllbGRzKTtcblxuICAgICAgICBpZiAob2JzZXJ2ZUNhbGxiYWNrcy5jaGFuZ2VkQXQpIHtcbiAgICAgICAgICBvYnNlcnZlQ2FsbGJhY2tzLmNoYW5nZWRBdChcbiAgICAgICAgICAgIHRyYW5zZm9ybShkb2MpLFxuICAgICAgICAgICAgb2xkRG9jLFxuICAgICAgICAgICAgaW5kaWNlcyA/IHRoaXMuZG9jcy5pbmRleE9mKGlkKSA6IC0xXG4gICAgICAgICAgKTtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICBvYnNlcnZlQ2FsbGJhY2tzLmNoYW5nZWQodHJhbnNmb3JtKGRvYyksIG9sZERvYyk7XG4gICAgICAgIH1cbiAgICAgIH0sXG4gICAgICBtb3ZlZEJlZm9yZShpZCwgYmVmb3JlKSB7XG4gICAgICAgIGlmICghb2JzZXJ2ZUNhbGxiYWNrcy5tb3ZlZFRvKSB7XG4gICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG5cbiAgICAgICAgY29uc3QgZnJvbSA9IGluZGljZXMgPyB0aGlzLmRvY3MuaW5kZXhPZihpZCkgOiAtMTtcbiAgICAgICAgbGV0IHRvID0gaW5kaWNlc1xuICAgICAgICAgID8gYmVmb3JlXG4gICAgICAgICAgICA/IHRoaXMuZG9jcy5pbmRleE9mKGJlZm9yZSlcbiAgICAgICAgICAgIDogdGhpcy5kb2NzLnNpemUoKVxuICAgICAgICAgIDogLTE7XG5cbiAgICAgICAgLy8gV2hlbiBub3QgbW92aW5nIGJhY2t3YXJkcywgYWRqdXN0IGZvciB0aGUgZmFjdCB0aGF0IHJlbW92aW5nIHRoZVxuICAgICAgICAvLyBkb2N1bWVudCBzbGlkZXMgZXZlcnl0aGluZyBiYWNrIG9uZSBzbG90LlxuICAgICAgICBpZiAodG8gPiBmcm9tKSB7XG4gICAgICAgICAgLS10bztcbiAgICAgICAgfVxuXG4gICAgICAgIG9ic2VydmVDYWxsYmFja3MubW92ZWRUbyhcbiAgICAgICAgICB0cmFuc2Zvcm0oRUpTT04uY2xvbmUodGhpcy5kb2NzLmdldChpZCkpKSxcbiAgICAgICAgICBmcm9tLFxuICAgICAgICAgIHRvLFxuICAgICAgICAgIGJlZm9yZSB8fCBudWxsXG4gICAgICAgICk7XG4gICAgICB9LFxuICAgICAgcmVtb3ZlZChpZCkge1xuICAgICAgICBpZiAoIShvYnNlcnZlQ2FsbGJhY2tzLnJlbW92ZWRBdCB8fCBvYnNlcnZlQ2FsbGJhY2tzLnJlbW92ZWQpKSB7XG4gICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG5cbiAgICAgICAgLy8gdGVjaG5pY2FsbHkgbWF5YmUgdGhlcmUgc2hvdWxkIGJlIGFuIEVKU09OLmNsb25lIGhlcmUsIGJ1dCBpdCdzIGFib3V0XG4gICAgICAgIC8vIHRvIGJlIHJlbW92ZWQgZnJvbSB0aGlzLmRvY3MhXG4gICAgICAgIGNvbnN0IGRvYyA9IHRyYW5zZm9ybSh0aGlzLmRvY3MuZ2V0KGlkKSk7XG5cbiAgICAgICAgaWYgKG9ic2VydmVDYWxsYmFja3MucmVtb3ZlZEF0KSB7XG4gICAgICAgICAgb2JzZXJ2ZUNhbGxiYWNrcy5yZW1vdmVkQXQoZG9jLCBpbmRpY2VzID8gdGhpcy5kb2NzLmluZGV4T2YoaWQpIDogLTEpO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIG9ic2VydmVDYWxsYmFja3MucmVtb3ZlZChkb2MpO1xuICAgICAgICB9XG4gICAgICB9LFxuICAgIH07XG4gIH0gZWxzZSB7XG4gICAgb2JzZXJ2ZUNoYW5nZXNDYWxsYmFja3MgPSB7XG4gICAgICBhZGRlZChpZCwgZmllbGRzKSB7XG4gICAgICAgIGlmICghc3VwcHJlc3NlZCAmJiBvYnNlcnZlQ2FsbGJhY2tzLmFkZGVkKSB7XG4gICAgICAgICAgb2JzZXJ2ZUNhbGxiYWNrcy5hZGRlZCh0cmFuc2Zvcm0oT2JqZWN0LmFzc2lnbihmaWVsZHMsIHtfaWQ6IGlkfSkpKTtcbiAgICAgICAgfVxuICAgICAgfSxcbiAgICAgIGNoYW5nZWQoaWQsIGZpZWxkcykge1xuICAgICAgICBpZiAob2JzZXJ2ZUNhbGxiYWNrcy5jaGFuZ2VkKSB7XG4gICAgICAgICAgY29uc3Qgb2xkRG9jID0gdGhpcy5kb2NzLmdldChpZCk7XG4gICAgICAgICAgY29uc3QgZG9jID0gRUpTT04uY2xvbmUob2xkRG9jKTtcblxuICAgICAgICAgIERpZmZTZXF1ZW5jZS5hcHBseUNoYW5nZXMoZG9jLCBmaWVsZHMpO1xuXG4gICAgICAgICAgb2JzZXJ2ZUNhbGxiYWNrcy5jaGFuZ2VkKFxuICAgICAgICAgICAgdHJhbnNmb3JtKGRvYyksXG4gICAgICAgICAgICB0cmFuc2Zvcm0oRUpTT04uY2xvbmUob2xkRG9jKSlcbiAgICAgICAgICApO1xuICAgICAgICB9XG4gICAgICB9LFxuICAgICAgcmVtb3ZlZChpZCkge1xuICAgICAgICBpZiAob2JzZXJ2ZUNhbGxiYWNrcy5yZW1vdmVkKSB7XG4gICAgICAgICAgb2JzZXJ2ZUNhbGxiYWNrcy5yZW1vdmVkKHRyYW5zZm9ybSh0aGlzLmRvY3MuZ2V0KGlkKSkpO1xuICAgICAgICB9XG4gICAgICB9LFxuICAgIH07XG4gIH1cblxuICBjb25zdCBjaGFuZ2VPYnNlcnZlciA9IG5ldyBMb2NhbENvbGxlY3Rpb24uX0NhY2hpbmdDaGFuZ2VPYnNlcnZlcih7XG4gICAgY2FsbGJhY2tzOiBvYnNlcnZlQ2hhbmdlc0NhbGxiYWNrc1xuICB9KTtcblxuICAvLyBDYWNoaW5nQ2hhbmdlT2JzZXJ2ZXIgY2xvbmVzIGFsbCByZWNlaXZlZCBpbnB1dCBvbiBpdHMgY2FsbGJhY2tzXG4gIC8vIFNvIHdlIGNhbiBtYXJrIGl0IGFzIHNhZmUgdG8gcmVkdWNlIHRoZSBlanNvbiBjbG9uZXMuXG4gIC8vIFRoaXMgaXMgdGVzdGVkIGJ5IHRoZSBgbW9uZ28tbGl2ZWRhdGEgLSAoZXh0ZW5kZWQpIHNjcmliYmxpbmdgIHRlc3RzXG4gIGNoYW5nZU9ic2VydmVyLmFwcGx5Q2hhbmdlLl9mcm9tT2JzZXJ2ZSA9IHRydWU7XG4gIGNvbnN0IGhhbmRsZSA9IGN1cnNvci5vYnNlcnZlQ2hhbmdlcyhjaGFuZ2VPYnNlcnZlci5hcHBseUNoYW5nZSxcbiAgICB7IG5vbk11dGF0aW5nQ2FsbGJhY2tzOiB0cnVlIH0pO1xuXG4gIHN1cHByZXNzZWQgPSBmYWxzZTtcblxuICByZXR1cm4gaGFuZGxlO1xufTtcblxuTG9jYWxDb2xsZWN0aW9uLl9vYnNlcnZlQ2FsbGJhY2tzQXJlT3JkZXJlZCA9IGNhbGxiYWNrcyA9PiB7XG4gIGlmIChjYWxsYmFja3MuYWRkZWQgJiYgY2FsbGJhY2tzLmFkZGVkQXQpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoJ1BsZWFzZSBzcGVjaWZ5IG9ubHkgb25lIG9mIGFkZGVkKCkgYW5kIGFkZGVkQXQoKScpO1xuICB9XG5cbiAgaWYgKGNhbGxiYWNrcy5jaGFuZ2VkICYmIGNhbGxiYWNrcy5jaGFuZ2VkQXQpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoJ1BsZWFzZSBzcGVjaWZ5IG9ubHkgb25lIG9mIGNoYW5nZWQoKSBhbmQgY2hhbmdlZEF0KCknKTtcbiAgfVxuXG4gIGlmIChjYWxsYmFja3MucmVtb3ZlZCAmJiBjYWxsYmFja3MucmVtb3ZlZEF0KSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKCdQbGVhc2Ugc3BlY2lmeSBvbmx5IG9uZSBvZiByZW1vdmVkKCkgYW5kIHJlbW92ZWRBdCgpJyk7XG4gIH1cblxuICByZXR1cm4gISEoXG4gICAgY2FsbGJhY2tzLmFkZGVkQXQgfHxcbiAgICBjYWxsYmFja3MuY2hhbmdlZEF0IHx8XG4gICAgY2FsbGJhY2tzLm1vdmVkVG8gfHxcbiAgICBjYWxsYmFja3MucmVtb3ZlZEF0XG4gICk7XG59O1xuXG5Mb2NhbENvbGxlY3Rpb24uX29ic2VydmVDaGFuZ2VzQ2FsbGJhY2tzQXJlT3JkZXJlZCA9IGNhbGxiYWNrcyA9PiB7XG4gIGlmIChjYWxsYmFja3MuYWRkZWQgJiYgY2FsbGJhY2tzLmFkZGVkQmVmb3JlKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKCdQbGVhc2Ugc3BlY2lmeSBvbmx5IG9uZSBvZiBhZGRlZCgpIGFuZCBhZGRlZEJlZm9yZSgpJyk7XG4gIH1cblxuICByZXR1cm4gISEoY2FsbGJhY2tzLmFkZGVkQmVmb3JlIHx8IGNhbGxiYWNrcy5tb3ZlZEJlZm9yZSk7XG59O1xuXG5Mb2NhbENvbGxlY3Rpb24uX3JlbW92ZUZyb21SZXN1bHRzID0gKHF1ZXJ5LCBkb2MpID0+IHtcbiAgaWYgKHF1ZXJ5Lm9yZGVyZWQpIHtcbiAgICBjb25zdCBpID0gTG9jYWxDb2xsZWN0aW9uLl9maW5kSW5PcmRlcmVkUmVzdWx0cyhxdWVyeSwgZG9jKTtcblxuICAgIHF1ZXJ5LnJlbW92ZWQoZG9jLl9pZCk7XG4gICAgcXVlcnkucmVzdWx0cy5zcGxpY2UoaSwgMSk7XG4gIH0gZWxzZSB7XG4gICAgY29uc3QgaWQgPSBkb2MuX2lkOyAgLy8gaW4gY2FzZSBjYWxsYmFjayBtdXRhdGVzIGRvY1xuXG4gICAgcXVlcnkucmVtb3ZlZChkb2MuX2lkKTtcbiAgICBxdWVyeS5yZXN1bHRzLnJlbW92ZShpZCk7XG4gIH1cbn07XG5cbi8vIElzIHRoaXMgc2VsZWN0b3IganVzdCBzaG9ydGhhbmQgZm9yIGxvb2t1cCBieSBfaWQ/XG5Mb2NhbENvbGxlY3Rpb24uX3NlbGVjdG9ySXNJZCA9IHNlbGVjdG9yID0+XG4gIHR5cGVvZiBzZWxlY3RvciA9PT0gJ251bWJlcicgfHxcbiAgdHlwZW9mIHNlbGVjdG9yID09PSAnc3RyaW5nJyB8fFxuICBzZWxlY3RvciBpbnN0YW5jZW9mIE1vbmdvSUQuT2JqZWN0SURcbjtcblxuLy8gSXMgdGhlIHNlbGVjdG9yIGp1c3QgbG9va3VwIGJ5IF9pZCAoc2hvcnRoYW5kIG9yIG5vdCk/XG5Mb2NhbENvbGxlY3Rpb24uX3NlbGVjdG9ySXNJZFBlcmhhcHNBc09iamVjdCA9IHNlbGVjdG9yID0+XG4gIExvY2FsQ29sbGVjdGlvbi5fc2VsZWN0b3JJc0lkKHNlbGVjdG9yKSB8fFxuICBMb2NhbENvbGxlY3Rpb24uX3NlbGVjdG9ySXNJZChzZWxlY3RvciAmJiBzZWxlY3Rvci5faWQpICYmXG4gIE9iamVjdC5rZXlzKHNlbGVjdG9yKS5sZW5ndGggPT09IDFcbjtcblxuTG9jYWxDb2xsZWN0aW9uLl91cGRhdGVJblJlc3VsdHMgPSAocXVlcnksIGRvYywgb2xkX2RvYykgPT4ge1xuICBpZiAoIUVKU09OLmVxdWFscyhkb2MuX2lkLCBvbGRfZG9jLl9pZCkpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoJ0NhblxcJ3QgY2hhbmdlIGEgZG9jXFwncyBfaWQgd2hpbGUgdXBkYXRpbmcnKTtcbiAgfVxuXG4gIGNvbnN0IHByb2plY3Rpb25GbiA9IHF1ZXJ5LnByb2plY3Rpb25GbjtcbiAgY29uc3QgY2hhbmdlZEZpZWxkcyA9IERpZmZTZXF1ZW5jZS5tYWtlQ2hhbmdlZEZpZWxkcyhcbiAgICBwcm9qZWN0aW9uRm4oZG9jKSxcbiAgICBwcm9qZWN0aW9uRm4ob2xkX2RvYylcbiAgKTtcblxuICBpZiAoIXF1ZXJ5Lm9yZGVyZWQpIHtcbiAgICBpZiAoT2JqZWN0LmtleXMoY2hhbmdlZEZpZWxkcykubGVuZ3RoKSB7XG4gICAgICBxdWVyeS5jaGFuZ2VkKGRvYy5faWQsIGNoYW5nZWRGaWVsZHMpO1xuICAgICAgcXVlcnkucmVzdWx0cy5zZXQoZG9jLl9pZCwgZG9jKTtcbiAgICB9XG5cbiAgICByZXR1cm47XG4gIH1cblxuICBjb25zdCBvbGRfaWR4ID0gTG9jYWxDb2xsZWN0aW9uLl9maW5kSW5PcmRlcmVkUmVzdWx0cyhxdWVyeSwgZG9jKTtcblxuICBpZiAoT2JqZWN0LmtleXMoY2hhbmdlZEZpZWxkcykubGVuZ3RoKSB7XG4gICAgcXVlcnkuY2hhbmdlZChkb2MuX2lkLCBjaGFuZ2VkRmllbGRzKTtcbiAgfVxuXG4gIGlmICghcXVlcnkuc29ydGVyKSB7XG4gICAgcmV0dXJuO1xuICB9XG5cbiAgLy8ganVzdCB0YWtlIGl0IG91dCBhbmQgcHV0IGl0IGJhY2sgaW4gYWdhaW4sIGFuZCBzZWUgaWYgdGhlIGluZGV4IGNoYW5nZXNcbiAgcXVlcnkucmVzdWx0cy5zcGxpY2Uob2xkX2lkeCwgMSk7XG5cbiAgY29uc3QgbmV3X2lkeCA9IExvY2FsQ29sbGVjdGlvbi5faW5zZXJ0SW5Tb3J0ZWRMaXN0KFxuICAgIHF1ZXJ5LnNvcnRlci5nZXRDb21wYXJhdG9yKHtkaXN0YW5jZXM6IHF1ZXJ5LmRpc3RhbmNlc30pLFxuICAgIHF1ZXJ5LnJlc3VsdHMsXG4gICAgZG9jXG4gICk7XG5cbiAgaWYgKG9sZF9pZHggIT09IG5ld19pZHgpIHtcbiAgICBsZXQgbmV4dCA9IHF1ZXJ5LnJlc3VsdHNbbmV3X2lkeCArIDFdO1xuICAgIGlmIChuZXh0KSB7XG4gICAgICBuZXh0ID0gbmV4dC5faWQ7XG4gICAgfSBlbHNlIHtcbiAgICAgIG5leHQgPSBudWxsO1xuICAgIH1cblxuICAgIHF1ZXJ5Lm1vdmVkQmVmb3JlICYmIHF1ZXJ5Lm1vdmVkQmVmb3JlKGRvYy5faWQsIG5leHQpO1xuICB9XG59O1xuXG5jb25zdCBNT0RJRklFUlMgPSB7XG4gICRjdXJyZW50RGF0ZSh0YXJnZXQsIGZpZWxkLCBhcmcpIHtcbiAgICBpZiAodHlwZW9mIGFyZyA9PT0gJ29iamVjdCcgJiYgaGFzT3duLmNhbGwoYXJnLCAnJHR5cGUnKSkge1xuICAgICAgaWYgKGFyZy4kdHlwZSAhPT0gJ2RhdGUnKSB7XG4gICAgICAgIHRocm93IE1pbmltb25nb0Vycm9yKFxuICAgICAgICAgICdNaW5pbW9uZ28gZG9lcyBjdXJyZW50bHkgb25seSBzdXBwb3J0IHRoZSBkYXRlIHR5cGUgaW4gJyArXG4gICAgICAgICAgJyRjdXJyZW50RGF0ZSBtb2RpZmllcnMnLFxuICAgICAgICAgIHtmaWVsZH1cbiAgICAgICAgKTtcbiAgICAgIH1cbiAgICB9IGVsc2UgaWYgKGFyZyAhPT0gdHJ1ZSkge1xuICAgICAgdGhyb3cgTWluaW1vbmdvRXJyb3IoJ0ludmFsaWQgJGN1cnJlbnREYXRlIG1vZGlmaWVyJywge2ZpZWxkfSk7XG4gICAgfVxuXG4gICAgdGFyZ2V0W2ZpZWxkXSA9IG5ldyBEYXRlKCk7XG4gIH0sXG4gICRtaW4odGFyZ2V0LCBmaWVsZCwgYXJnKSB7XG4gICAgaWYgKHR5cGVvZiBhcmcgIT09ICdudW1iZXInKSB7XG4gICAgICB0aHJvdyBNaW5pbW9uZ29FcnJvcignTW9kaWZpZXIgJG1pbiBhbGxvd2VkIGZvciBudW1iZXJzIG9ubHknLCB7ZmllbGR9KTtcbiAgICB9XG5cbiAgICBpZiAoZmllbGQgaW4gdGFyZ2V0KSB7XG4gICAgICBpZiAodHlwZW9mIHRhcmdldFtmaWVsZF0gIT09ICdudW1iZXInKSB7XG4gICAgICAgIHRocm93IE1pbmltb25nb0Vycm9yKFxuICAgICAgICAgICdDYW5ub3QgYXBwbHkgJG1pbiBtb2RpZmllciB0byBub24tbnVtYmVyJyxcbiAgICAgICAgICB7ZmllbGR9XG4gICAgICAgICk7XG4gICAgICB9XG5cbiAgICAgIGlmICh0YXJnZXRbZmllbGRdID4gYXJnKSB7XG4gICAgICAgIHRhcmdldFtmaWVsZF0gPSBhcmc7XG4gICAgICB9XG4gICAgfSBlbHNlIHtcbiAgICAgIHRhcmdldFtmaWVsZF0gPSBhcmc7XG4gICAgfVxuICB9LFxuICAkbWF4KHRhcmdldCwgZmllbGQsIGFyZykge1xuICAgIGlmICh0eXBlb2YgYXJnICE9PSAnbnVtYmVyJykge1xuICAgICAgdGhyb3cgTWluaW1vbmdvRXJyb3IoJ01vZGlmaWVyICRtYXggYWxsb3dlZCBmb3IgbnVtYmVycyBvbmx5Jywge2ZpZWxkfSk7XG4gICAgfVxuXG4gICAgaWYgKGZpZWxkIGluIHRhcmdldCkge1xuICAgICAgaWYgKHR5cGVvZiB0YXJnZXRbZmllbGRdICE9PSAnbnVtYmVyJykge1xuICAgICAgICB0aHJvdyBNaW5pbW9uZ29FcnJvcihcbiAgICAgICAgICAnQ2Fubm90IGFwcGx5ICRtYXggbW9kaWZpZXIgdG8gbm9uLW51bWJlcicsXG4gICAgICAgICAge2ZpZWxkfVxuICAgICAgICApO1xuICAgICAgfVxuXG4gICAgICBpZiAodGFyZ2V0W2ZpZWxkXSA8IGFyZykge1xuICAgICAgICB0YXJnZXRbZmllbGRdID0gYXJnO1xuICAgICAgfVxuICAgIH0gZWxzZSB7XG4gICAgICB0YXJnZXRbZmllbGRdID0gYXJnO1xuICAgIH1cbiAgfSxcbiAgJGluYyh0YXJnZXQsIGZpZWxkLCBhcmcpIHtcbiAgICBpZiAodHlwZW9mIGFyZyAhPT0gJ251bWJlcicpIHtcbiAgICAgIHRocm93IE1pbmltb25nb0Vycm9yKCdNb2RpZmllciAkaW5jIGFsbG93ZWQgZm9yIG51bWJlcnMgb25seScsIHtmaWVsZH0pO1xuICAgIH1cblxuICAgIGlmIChmaWVsZCBpbiB0YXJnZXQpIHtcbiAgICAgIGlmICh0eXBlb2YgdGFyZ2V0W2ZpZWxkXSAhPT0gJ251bWJlcicpIHtcbiAgICAgICAgdGhyb3cgTWluaW1vbmdvRXJyb3IoXG4gICAgICAgICAgJ0Nhbm5vdCBhcHBseSAkaW5jIG1vZGlmaWVyIHRvIG5vbi1udW1iZXInLFxuICAgICAgICAgIHtmaWVsZH1cbiAgICAgICAgKTtcbiAgICAgIH1cblxuICAgICAgdGFyZ2V0W2ZpZWxkXSArPSBhcmc7XG4gICAgfSBlbHNlIHtcbiAgICAgIHRhcmdldFtmaWVsZF0gPSBhcmc7XG4gICAgfVxuICB9LFxuICAkc2V0KHRhcmdldCwgZmllbGQsIGFyZykge1xuICAgIGlmICh0YXJnZXQgIT09IE9iamVjdCh0YXJnZXQpKSB7IC8vIG5vdCBhbiBhcnJheSBvciBhbiBvYmplY3RcbiAgICAgIGNvbnN0IGVycm9yID0gTWluaW1vbmdvRXJyb3IoXG4gICAgICAgICdDYW5ub3Qgc2V0IHByb3BlcnR5IG9uIG5vbi1vYmplY3QgZmllbGQnLFxuICAgICAgICB7ZmllbGR9XG4gICAgICApO1xuICAgICAgZXJyb3Iuc2V0UHJvcGVydHlFcnJvciA9IHRydWU7XG4gICAgICB0aHJvdyBlcnJvcjtcbiAgICB9XG5cbiAgICBpZiAodGFyZ2V0ID09PSBudWxsKSB7XG4gICAgICBjb25zdCBlcnJvciA9IE1pbmltb25nb0Vycm9yKCdDYW5ub3Qgc2V0IHByb3BlcnR5IG9uIG51bGwnLCB7ZmllbGR9KTtcbiAgICAgIGVycm9yLnNldFByb3BlcnR5RXJyb3IgPSB0cnVlO1xuICAgICAgdGhyb3cgZXJyb3I7XG4gICAgfVxuXG4gICAgYXNzZXJ0SGFzVmFsaWRGaWVsZE5hbWVzKGFyZyk7XG5cbiAgICB0YXJnZXRbZmllbGRdID0gYXJnO1xuICB9LFxuICAkc2V0T25JbnNlcnQodGFyZ2V0LCBmaWVsZCwgYXJnKSB7XG4gICAgLy8gY29udmVydGVkIHRvIGAkc2V0YCBpbiBgX21vZGlmeWBcbiAgfSxcbiAgJHVuc2V0KHRhcmdldCwgZmllbGQsIGFyZykge1xuICAgIGlmICh0YXJnZXQgIT09IHVuZGVmaW5lZCkge1xuICAgICAgaWYgKHRhcmdldCBpbnN0YW5jZW9mIEFycmF5KSB7XG4gICAgICAgIGlmIChmaWVsZCBpbiB0YXJnZXQpIHtcbiAgICAgICAgICB0YXJnZXRbZmllbGRdID0gbnVsbDtcbiAgICAgICAgfVxuICAgICAgfSBlbHNlIHtcbiAgICAgICAgZGVsZXRlIHRhcmdldFtmaWVsZF07XG4gICAgICB9XG4gICAgfVxuICB9LFxuICAkcHVzaCh0YXJnZXQsIGZpZWxkLCBhcmcpIHtcbiAgICBpZiAodGFyZ2V0W2ZpZWxkXSA9PT0gdW5kZWZpbmVkKSB7XG4gICAgICB0YXJnZXRbZmllbGRdID0gW107XG4gICAgfVxuXG4gICAgaWYgKCEodGFyZ2V0W2ZpZWxkXSBpbnN0YW5jZW9mIEFycmF5KSkge1xuICAgICAgdGhyb3cgTWluaW1vbmdvRXJyb3IoJ0Nhbm5vdCBhcHBseSAkcHVzaCBtb2RpZmllciB0byBub24tYXJyYXknLCB7ZmllbGR9KTtcbiAgICB9XG5cbiAgICBpZiAoIShhcmcgJiYgYXJnLiRlYWNoKSkge1xuICAgICAgLy8gU2ltcGxlIG1vZGU6IG5vdCAkZWFjaFxuICAgICAgYXNzZXJ0SGFzVmFsaWRGaWVsZE5hbWVzKGFyZyk7XG5cbiAgICAgIHRhcmdldFtmaWVsZF0ucHVzaChhcmcpO1xuXG4gICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgLy8gRmFuY3kgbW9kZTogJGVhY2ggKGFuZCBtYXliZSAkc2xpY2UgYW5kICRzb3J0IGFuZCAkcG9zaXRpb24pXG4gICAgY29uc3QgdG9QdXNoID0gYXJnLiRlYWNoO1xuICAgIGlmICghKHRvUHVzaCBpbnN0YW5jZW9mIEFycmF5KSkge1xuICAgICAgdGhyb3cgTWluaW1vbmdvRXJyb3IoJyRlYWNoIG11c3QgYmUgYW4gYXJyYXknLCB7ZmllbGR9KTtcbiAgICB9XG5cbiAgICBhc3NlcnRIYXNWYWxpZEZpZWxkTmFtZXModG9QdXNoKTtcblxuICAgIC8vIFBhcnNlICRwb3NpdGlvblxuICAgIGxldCBwb3NpdGlvbiA9IHVuZGVmaW5lZDtcbiAgICBpZiAoJyRwb3NpdGlvbicgaW4gYXJnKSB7XG4gICAgICBpZiAodHlwZW9mIGFyZy4kcG9zaXRpb24gIT09ICdudW1iZXInKSB7XG4gICAgICAgIHRocm93IE1pbmltb25nb0Vycm9yKCckcG9zaXRpb24gbXVzdCBiZSBhIG51bWVyaWMgdmFsdWUnLCB7ZmllbGR9KTtcbiAgICAgIH1cblxuICAgICAgLy8gWFhYIHNob3VsZCBjaGVjayB0byBtYWtlIHN1cmUgaW50ZWdlclxuICAgICAgaWYgKGFyZy4kcG9zaXRpb24gPCAwKSB7XG4gICAgICAgIHRocm93IE1pbmltb25nb0Vycm9yKFxuICAgICAgICAgICckcG9zaXRpb24gaW4gJHB1c2ggbXVzdCBiZSB6ZXJvIG9yIHBvc2l0aXZlJyxcbiAgICAgICAgICB7ZmllbGR9XG4gICAgICAgICk7XG4gICAgICB9XG5cbiAgICAgIHBvc2l0aW9uID0gYXJnLiRwb3NpdGlvbjtcbiAgICB9XG5cbiAgICAvLyBQYXJzZSAkc2xpY2UuXG4gICAgbGV0IHNsaWNlID0gdW5kZWZpbmVkO1xuICAgIGlmICgnJHNsaWNlJyBpbiBhcmcpIHtcbiAgICAgIGlmICh0eXBlb2YgYXJnLiRzbGljZSAhPT0gJ251bWJlcicpIHtcbiAgICAgICAgdGhyb3cgTWluaW1vbmdvRXJyb3IoJyRzbGljZSBtdXN0IGJlIGEgbnVtZXJpYyB2YWx1ZScsIHtmaWVsZH0pO1xuICAgICAgfVxuXG4gICAgICAvLyBYWFggc2hvdWxkIGNoZWNrIHRvIG1ha2Ugc3VyZSBpbnRlZ2VyXG4gICAgICBzbGljZSA9IGFyZy4kc2xpY2U7XG4gICAgfVxuXG4gICAgLy8gUGFyc2UgJHNvcnQuXG4gICAgbGV0IHNvcnRGdW5jdGlvbiA9IHVuZGVmaW5lZDtcbiAgICBpZiAoYXJnLiRzb3J0KSB7XG4gICAgICBpZiAoc2xpY2UgPT09IHVuZGVmaW5lZCkge1xuICAgICAgICB0aHJvdyBNaW5pbW9uZ29FcnJvcignJHNvcnQgcmVxdWlyZXMgJHNsaWNlIHRvIGJlIHByZXNlbnQnLCB7ZmllbGR9KTtcbiAgICAgIH1cblxuICAgICAgLy8gWFhYIHRoaXMgYWxsb3dzIHVzIHRvIHVzZSBhICRzb3J0IHdob3NlIHZhbHVlIGlzIGFuIGFycmF5LCBidXQgdGhhdCdzXG4gICAgICAvLyBhY3R1YWxseSBhbiBleHRlbnNpb24gb2YgdGhlIE5vZGUgZHJpdmVyLCBzbyBpdCB3b24ndCB3b3JrXG4gICAgICAvLyBzZXJ2ZXItc2lkZS4gQ291bGQgYmUgY29uZnVzaW5nIVxuICAgICAgLy8gWFhYIGlzIGl0IGNvcnJlY3QgdGhhdCB3ZSBkb24ndCBkbyBnZW8tc3R1ZmYgaGVyZT9cbiAgICAgIHNvcnRGdW5jdGlvbiA9IG5ldyBNaW5pbW9uZ28uU29ydGVyKGFyZy4kc29ydCkuZ2V0Q29tcGFyYXRvcigpO1xuXG4gICAgICB0b1B1c2guZm9yRWFjaChlbGVtZW50ID0+IHtcbiAgICAgICAgaWYgKExvY2FsQ29sbGVjdGlvbi5fZi5fdHlwZShlbGVtZW50KSAhPT0gMykge1xuICAgICAgICAgIHRocm93IE1pbmltb25nb0Vycm9yKFxuICAgICAgICAgICAgJyRwdXNoIGxpa2UgbW9kaWZpZXJzIHVzaW5nICRzb3J0IHJlcXVpcmUgYWxsIGVsZW1lbnRzIHRvIGJlICcgK1xuICAgICAgICAgICAgJ29iamVjdHMnLFxuICAgICAgICAgICAge2ZpZWxkfVxuICAgICAgICAgICk7XG4gICAgICAgIH1cbiAgICAgIH0pO1xuICAgIH1cblxuICAgIC8vIEFjdHVhbGx5IHB1c2guXG4gICAgaWYgKHBvc2l0aW9uID09PSB1bmRlZmluZWQpIHtcbiAgICAgIHRvUHVzaC5mb3JFYWNoKGVsZW1lbnQgPT4ge1xuICAgICAgICB0YXJnZXRbZmllbGRdLnB1c2goZWxlbWVudCk7XG4gICAgICB9KTtcbiAgICB9IGVsc2Uge1xuICAgICAgY29uc3Qgc3BsaWNlQXJndW1lbnRzID0gW3Bvc2l0aW9uLCAwXTtcblxuICAgICAgdG9QdXNoLmZvckVhY2goZWxlbWVudCA9PiB7XG4gICAgICAgIHNwbGljZUFyZ3VtZW50cy5wdXNoKGVsZW1lbnQpO1xuICAgICAgfSk7XG5cbiAgICAgIHRhcmdldFtmaWVsZF0uc3BsaWNlKC4uLnNwbGljZUFyZ3VtZW50cyk7XG4gICAgfVxuXG4gICAgLy8gQWN0dWFsbHkgc29ydC5cbiAgICBpZiAoc29ydEZ1bmN0aW9uKSB7XG4gICAgICB0YXJnZXRbZmllbGRdLnNvcnQoc29ydEZ1bmN0aW9uKTtcbiAgICB9XG5cbiAgICAvLyBBY3R1YWxseSBzbGljZS5cbiAgICBpZiAoc2xpY2UgIT09IHVuZGVmaW5lZCkge1xuICAgICAgaWYgKHNsaWNlID09PSAwKSB7XG4gICAgICAgIHRhcmdldFtmaWVsZF0gPSBbXTsgLy8gZGlmZmVycyBmcm9tIEFycmF5LnNsaWNlIVxuICAgICAgfSBlbHNlIGlmIChzbGljZSA8IDApIHtcbiAgICAgICAgdGFyZ2V0W2ZpZWxkXSA9IHRhcmdldFtmaWVsZF0uc2xpY2Uoc2xpY2UpO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgdGFyZ2V0W2ZpZWxkXSA9IHRhcmdldFtmaWVsZF0uc2xpY2UoMCwgc2xpY2UpO1xuICAgICAgfVxuICAgIH1cbiAgfSxcbiAgJHB1c2hBbGwodGFyZ2V0LCBmaWVsZCwgYXJnKSB7XG4gICAgaWYgKCEodHlwZW9mIGFyZyA9PT0gJ29iamVjdCcgJiYgYXJnIGluc3RhbmNlb2YgQXJyYXkpKSB7XG4gICAgICB0aHJvdyBNaW5pbW9uZ29FcnJvcignTW9kaWZpZXIgJHB1c2hBbGwvcHVsbEFsbCBhbGxvd2VkIGZvciBhcnJheXMgb25seScpO1xuICAgIH1cblxuICAgIGFzc2VydEhhc1ZhbGlkRmllbGROYW1lcyhhcmcpO1xuXG4gICAgY29uc3QgdG9QdXNoID0gdGFyZ2V0W2ZpZWxkXTtcblxuICAgIGlmICh0b1B1c2ggPT09IHVuZGVmaW5lZCkge1xuICAgICAgdGFyZ2V0W2ZpZWxkXSA9IGFyZztcbiAgICB9IGVsc2UgaWYgKCEodG9QdXNoIGluc3RhbmNlb2YgQXJyYXkpKSB7XG4gICAgICB0aHJvdyBNaW5pbW9uZ29FcnJvcihcbiAgICAgICAgJ0Nhbm5vdCBhcHBseSAkcHVzaEFsbCBtb2RpZmllciB0byBub24tYXJyYXknLFxuICAgICAgICB7ZmllbGR9XG4gICAgICApO1xuICAgIH0gZWxzZSB7XG4gICAgICB0b1B1c2gucHVzaCguLi5hcmcpO1xuICAgIH1cbiAgfSxcbiAgJGFkZFRvU2V0KHRhcmdldCwgZmllbGQsIGFyZykge1xuICAgIGxldCBpc0VhY2ggPSBmYWxzZTtcblxuICAgIGlmICh0eXBlb2YgYXJnID09PSAnb2JqZWN0Jykge1xuICAgICAgLy8gY2hlY2sgaWYgZmlyc3Qga2V5IGlzICckZWFjaCdcbiAgICAgIGNvbnN0IGtleXMgPSBPYmplY3Qua2V5cyhhcmcpO1xuICAgICAgaWYgKGtleXNbMF0gPT09ICckZWFjaCcpIHtcbiAgICAgICAgaXNFYWNoID0gdHJ1ZTtcbiAgICAgIH1cbiAgICB9XG5cbiAgICBjb25zdCB2YWx1ZXMgPSBpc0VhY2ggPyBhcmcuJGVhY2ggOiBbYXJnXTtcblxuICAgIGFzc2VydEhhc1ZhbGlkRmllbGROYW1lcyh2YWx1ZXMpO1xuXG4gICAgY29uc3QgdG9BZGQgPSB0YXJnZXRbZmllbGRdO1xuICAgIGlmICh0b0FkZCA9PT0gdW5kZWZpbmVkKSB7XG4gICAgICB0YXJnZXRbZmllbGRdID0gdmFsdWVzO1xuICAgIH0gZWxzZSBpZiAoISh0b0FkZCBpbnN0YW5jZW9mIEFycmF5KSkge1xuICAgICAgdGhyb3cgTWluaW1vbmdvRXJyb3IoXG4gICAgICAgICdDYW5ub3QgYXBwbHkgJGFkZFRvU2V0IG1vZGlmaWVyIHRvIG5vbi1hcnJheScsXG4gICAgICAgIHtmaWVsZH1cbiAgICAgICk7XG4gICAgfSBlbHNlIHtcbiAgICAgIHZhbHVlcy5mb3JFYWNoKHZhbHVlID0+IHtcbiAgICAgICAgaWYgKHRvQWRkLnNvbWUoZWxlbWVudCA9PiBMb2NhbENvbGxlY3Rpb24uX2YuX2VxdWFsKHZhbHVlLCBlbGVtZW50KSkpIHtcbiAgICAgICAgICByZXR1cm47XG4gICAgICAgIH1cblxuICAgICAgICB0b0FkZC5wdXNoKHZhbHVlKTtcbiAgICAgIH0pO1xuICAgIH1cbiAgfSxcbiAgJHBvcCh0YXJnZXQsIGZpZWxkLCBhcmcpIHtcbiAgICBpZiAodGFyZ2V0ID09PSB1bmRlZmluZWQpIHtcbiAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICBjb25zdCB0b1BvcCA9IHRhcmdldFtmaWVsZF07XG5cbiAgICBpZiAodG9Qb3AgPT09IHVuZGVmaW5lZCkge1xuICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIGlmICghKHRvUG9wIGluc3RhbmNlb2YgQXJyYXkpKSB7XG4gICAgICB0aHJvdyBNaW5pbW9uZ29FcnJvcignQ2Fubm90IGFwcGx5ICRwb3AgbW9kaWZpZXIgdG8gbm9uLWFycmF5Jywge2ZpZWxkfSk7XG4gICAgfVxuXG4gICAgaWYgKHR5cGVvZiBhcmcgPT09ICdudW1iZXInICYmIGFyZyA8IDApIHtcbiAgICAgIHRvUG9wLnNwbGljZSgwLCAxKTtcbiAgICB9IGVsc2Uge1xuICAgICAgdG9Qb3AucG9wKCk7XG4gICAgfVxuICB9LFxuICAkcHVsbCh0YXJnZXQsIGZpZWxkLCBhcmcpIHtcbiAgICBpZiAodGFyZ2V0ID09PSB1bmRlZmluZWQpIHtcbiAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICBjb25zdCB0b1B1bGwgPSB0YXJnZXRbZmllbGRdO1xuICAgIGlmICh0b1B1bGwgPT09IHVuZGVmaW5lZCkge1xuICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIGlmICghKHRvUHVsbCBpbnN0YW5jZW9mIEFycmF5KSkge1xuICAgICAgdGhyb3cgTWluaW1vbmdvRXJyb3IoXG4gICAgICAgICdDYW5ub3QgYXBwbHkgJHB1bGwvcHVsbEFsbCBtb2RpZmllciB0byBub24tYXJyYXknLFxuICAgICAgICB7ZmllbGR9XG4gICAgICApO1xuICAgIH1cblxuICAgIGxldCBvdXQ7XG4gICAgaWYgKGFyZyAhPSBudWxsICYmIHR5cGVvZiBhcmcgPT09ICdvYmplY3QnICYmICEoYXJnIGluc3RhbmNlb2YgQXJyYXkpKSB7XG4gICAgICAvLyBYWFggd291bGQgYmUgbXVjaCBuaWNlciB0byBjb21waWxlIHRoaXMgb25jZSwgcmF0aGVyIHRoYW5cbiAgICAgIC8vIGZvciBlYWNoIGRvY3VtZW50IHdlIG1vZGlmeS4uIGJ1dCB1c3VhbGx5IHdlJ3JlIG5vdFxuICAgICAgLy8gbW9kaWZ5aW5nIHRoYXQgbWFueSBkb2N1bWVudHMsIHNvIHdlJ2xsIGxldCBpdCBzbGlkZSBmb3JcbiAgICAgIC8vIG5vd1xuXG4gICAgICAvLyBYWFggTWluaW1vbmdvLk1hdGNoZXIgaXNuJ3QgdXAgZm9yIHRoZSBqb2IsIGJlY2F1c2Ugd2UgbmVlZFxuICAgICAgLy8gdG8gcGVybWl0IHN0dWZmIGxpa2UgeyRwdWxsOiB7YTogeyRndDogNH19fS4uIHNvbWV0aGluZ1xuICAgICAgLy8gbGlrZSB7JGd0OiA0fSBpcyBub3Qgbm9ybWFsbHkgYSBjb21wbGV0ZSBzZWxlY3Rvci5cbiAgICAgIC8vIHNhbWUgaXNzdWUgYXMgJGVsZW1NYXRjaCBwb3NzaWJseT9cbiAgICAgIGNvbnN0IG1hdGNoZXIgPSBuZXcgTWluaW1vbmdvLk1hdGNoZXIoYXJnKTtcblxuICAgICAgb3V0ID0gdG9QdWxsLmZpbHRlcihlbGVtZW50ID0+ICFtYXRjaGVyLmRvY3VtZW50TWF0Y2hlcyhlbGVtZW50KS5yZXN1bHQpO1xuICAgIH0gZWxzZSB7XG4gICAgICBvdXQgPSB0b1B1bGwuZmlsdGVyKGVsZW1lbnQgPT4gIUxvY2FsQ29sbGVjdGlvbi5fZi5fZXF1YWwoZWxlbWVudCwgYXJnKSk7XG4gICAgfVxuXG4gICAgdGFyZ2V0W2ZpZWxkXSA9IG91dDtcbiAgfSxcbiAgJHB1bGxBbGwodGFyZ2V0LCBmaWVsZCwgYXJnKSB7XG4gICAgaWYgKCEodHlwZW9mIGFyZyA9PT0gJ29iamVjdCcgJiYgYXJnIGluc3RhbmNlb2YgQXJyYXkpKSB7XG4gICAgICB0aHJvdyBNaW5pbW9uZ29FcnJvcihcbiAgICAgICAgJ01vZGlmaWVyICRwdXNoQWxsL3B1bGxBbGwgYWxsb3dlZCBmb3IgYXJyYXlzIG9ubHknLFxuICAgICAgICB7ZmllbGR9XG4gICAgICApO1xuICAgIH1cblxuICAgIGlmICh0YXJnZXQgPT09IHVuZGVmaW5lZCkge1xuICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIGNvbnN0IHRvUHVsbCA9IHRhcmdldFtmaWVsZF07XG5cbiAgICBpZiAodG9QdWxsID09PSB1bmRlZmluZWQpIHtcbiAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICBpZiAoISh0b1B1bGwgaW5zdGFuY2VvZiBBcnJheSkpIHtcbiAgICAgIHRocm93IE1pbmltb25nb0Vycm9yKFxuICAgICAgICAnQ2Fubm90IGFwcGx5ICRwdWxsL3B1bGxBbGwgbW9kaWZpZXIgdG8gbm9uLWFycmF5JyxcbiAgICAgICAge2ZpZWxkfVxuICAgICAgKTtcbiAgICB9XG5cbiAgICB0YXJnZXRbZmllbGRdID0gdG9QdWxsLmZpbHRlcihvYmplY3QgPT5cbiAgICAgICFhcmcuc29tZShlbGVtZW50ID0+IExvY2FsQ29sbGVjdGlvbi5fZi5fZXF1YWwob2JqZWN0LCBlbGVtZW50KSlcbiAgICApO1xuICB9LFxuICAkcmVuYW1lKHRhcmdldCwgZmllbGQsIGFyZywga2V5cGF0aCwgZG9jKSB7XG4gICAgLy8gbm8gaWRlYSB3aHkgbW9uZ28gaGFzIHRoaXMgcmVzdHJpY3Rpb24uLlxuICAgIGlmIChrZXlwYXRoID09PSBhcmcpIHtcbiAgICAgIHRocm93IE1pbmltb25nb0Vycm9yKCckcmVuYW1lIHNvdXJjZSBtdXN0IGRpZmZlciBmcm9tIHRhcmdldCcsIHtmaWVsZH0pO1xuICAgIH1cblxuICAgIGlmICh0YXJnZXQgPT09IG51bGwpIHtcbiAgICAgIHRocm93IE1pbmltb25nb0Vycm9yKCckcmVuYW1lIHNvdXJjZSBmaWVsZCBpbnZhbGlkJywge2ZpZWxkfSk7XG4gICAgfVxuXG4gICAgaWYgKHR5cGVvZiBhcmcgIT09ICdzdHJpbmcnKSB7XG4gICAgICB0aHJvdyBNaW5pbW9uZ29FcnJvcignJHJlbmFtZSB0YXJnZXQgbXVzdCBiZSBhIHN0cmluZycsIHtmaWVsZH0pO1xuICAgIH1cblxuICAgIGlmIChhcmcuaW5jbHVkZXMoJ1xcMCcpKSB7XG4gICAgICAvLyBOdWxsIGJ5dGVzIGFyZSBub3QgYWxsb3dlZCBpbiBNb25nbyBmaWVsZCBuYW1lc1xuICAgICAgLy8gaHR0cHM6Ly9kb2NzLm1vbmdvZGIuY29tL21hbnVhbC9yZWZlcmVuY2UvbGltaXRzLyNSZXN0cmljdGlvbnMtb24tRmllbGQtTmFtZXNcbiAgICAgIHRocm93IE1pbmltb25nb0Vycm9yKFxuICAgICAgICAnVGhlIFxcJ3RvXFwnIGZpZWxkIGZvciAkcmVuYW1lIGNhbm5vdCBjb250YWluIGFuIGVtYmVkZGVkIG51bGwgYnl0ZScsXG4gICAgICAgIHtmaWVsZH1cbiAgICAgICk7XG4gICAgfVxuXG4gICAgaWYgKHRhcmdldCA9PT0gdW5kZWZpbmVkKSB7XG4gICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgY29uc3Qgb2JqZWN0ID0gdGFyZ2V0W2ZpZWxkXTtcblxuICAgIGRlbGV0ZSB0YXJnZXRbZmllbGRdO1xuXG4gICAgY29uc3Qga2V5cGFydHMgPSBhcmcuc3BsaXQoJy4nKTtcbiAgICBjb25zdCB0YXJnZXQyID0gZmluZE1vZFRhcmdldChkb2MsIGtleXBhcnRzLCB7Zm9yYmlkQXJyYXk6IHRydWV9KTtcblxuICAgIGlmICh0YXJnZXQyID09PSBudWxsKSB7XG4gICAgICB0aHJvdyBNaW5pbW9uZ29FcnJvcignJHJlbmFtZSB0YXJnZXQgZmllbGQgaW52YWxpZCcsIHtmaWVsZH0pO1xuICAgIH1cblxuICAgIHRhcmdldDJba2V5cGFydHMucG9wKCldID0gb2JqZWN0O1xuICB9LFxuICAkYml0KHRhcmdldCwgZmllbGQsIGFyZykge1xuICAgIC8vIFhYWCBtb25nbyBvbmx5IHN1cHBvcnRzICRiaXQgb24gaW50ZWdlcnMsIGFuZCB3ZSBvbmx5IHN1cHBvcnRcbiAgICAvLyBuYXRpdmUgamF2YXNjcmlwdCBudW1iZXJzIChkb3VibGVzKSBzbyBmYXIsIHNvIHdlIGNhbid0IHN1cHBvcnQgJGJpdFxuICAgIHRocm93IE1pbmltb25nb0Vycm9yKCckYml0IGlzIG5vdCBzdXBwb3J0ZWQnLCB7ZmllbGR9KTtcbiAgfSxcbiAgJHYoKSB7XG4gICAgLy8gQXMgZGlzY3Vzc2VkIGluIGh0dHBzOi8vZ2l0aHViLmNvbS9tZXRlb3IvbWV0ZW9yL2lzc3Vlcy85NjIzLFxuICAgIC8vIHRoZSBgJHZgIG9wZXJhdG9yIGlzIG5vdCBuZWVkZWQgYnkgTWV0ZW9yLCBidXQgcHJvYmxlbXMgY2FuIG9jY3VyIGlmXG4gICAgLy8gaXQncyBub3QgYXQgbGVhc3QgY2FsbGFibGUgKGFzIG9mIE1vbmdvID49IDMuNikuIEl0J3MgZGVmaW5lZCBoZXJlIGFzXG4gICAgLy8gYSBuby1vcCB0byB3b3JrIGFyb3VuZCB0aGVzZSBwcm9ibGVtcy5cbiAgfVxufTtcblxuY29uc3QgTk9fQ1JFQVRFX01PRElGSUVSUyA9IHtcbiAgJHBvcDogdHJ1ZSxcbiAgJHB1bGw6IHRydWUsXG4gICRwdWxsQWxsOiB0cnVlLFxuICAkcmVuYW1lOiB0cnVlLFxuICAkdW5zZXQ6IHRydWVcbn07XG5cbi8vIE1ha2Ugc3VyZSBmaWVsZCBuYW1lcyBkbyBub3QgY29udGFpbiBNb25nbyByZXN0cmljdGVkXG4vLyBjaGFyYWN0ZXJzICgnLicsICckJywgJ1xcMCcpLlxuLy8gaHR0cHM6Ly9kb2NzLm1vbmdvZGIuY29tL21hbnVhbC9yZWZlcmVuY2UvbGltaXRzLyNSZXN0cmljdGlvbnMtb24tRmllbGQtTmFtZXNcbmNvbnN0IGludmFsaWRDaGFyTXNnID0ge1xuICAkOiAnc3RhcnQgd2l0aCBcXCckXFwnJyxcbiAgJy4nOiAnY29udGFpbiBcXCcuXFwnJyxcbiAgJ1xcMCc6ICdjb250YWluIG51bGwgYnl0ZXMnXG59O1xuXG4vLyBjaGVja3MgaWYgYWxsIGZpZWxkIG5hbWVzIGluIGFuIG9iamVjdCBhcmUgdmFsaWRcbmZ1bmN0aW9uIGFzc2VydEhhc1ZhbGlkRmllbGROYW1lcyhkb2MpIHtcbiAgaWYgKGRvYyAmJiB0eXBlb2YgZG9jID09PSAnb2JqZWN0Jykge1xuICAgIEpTT04uc3RyaW5naWZ5KGRvYywgKGtleSwgdmFsdWUpID0+IHtcbiAgICAgIGFzc2VydElzVmFsaWRGaWVsZE5hbWUoa2V5KTtcbiAgICAgIHJldHVybiB2YWx1ZTtcbiAgICB9KTtcbiAgfVxufVxuXG5mdW5jdGlvbiBhc3NlcnRJc1ZhbGlkRmllbGROYW1lKGtleSkge1xuICBsZXQgbWF0Y2g7XG4gIGlmICh0eXBlb2Yga2V5ID09PSAnc3RyaW5nJyAmJiAobWF0Y2ggPSBrZXkubWF0Y2goL15cXCR8XFwufFxcMC8pKSkge1xuICAgIHRocm93IE1pbmltb25nb0Vycm9yKGBLZXkgJHtrZXl9IG11c3Qgbm90ICR7aW52YWxpZENoYXJNc2dbbWF0Y2hbMF1dfWApO1xuICB9XG59XG5cbi8vIGZvciBhLmIuYy4yLmQuZSwga2V5cGFydHMgc2hvdWxkIGJlIFsnYScsICdiJywgJ2MnLCAnMicsICdkJywgJ2UnXSxcbi8vIGFuZCB0aGVuIHlvdSB3b3VsZCBvcGVyYXRlIG9uIHRoZSAnZScgcHJvcGVydHkgb2YgdGhlIHJldHVybmVkXG4vLyBvYmplY3QuXG4vL1xuLy8gaWYgb3B0aW9ucy5ub0NyZWF0ZSBpcyBmYWxzZXksIGNyZWF0ZXMgaW50ZXJtZWRpYXRlIGxldmVscyBvZlxuLy8gc3RydWN0dXJlIGFzIG5lY2Vzc2FyeSwgbGlrZSBta2RpciAtcCAoYW5kIHJhaXNlcyBhbiBleGNlcHRpb24gaWZcbi8vIHRoYXQgd291bGQgbWVhbiBnaXZpbmcgYSBub24tbnVtZXJpYyBwcm9wZXJ0eSB0byBhbiBhcnJheS4pIGlmXG4vLyBvcHRpb25zLm5vQ3JlYXRlIGlzIHRydWUsIHJldHVybiB1bmRlZmluZWQgaW5zdGVhZC5cbi8vXG4vLyBtYXkgbW9kaWZ5IHRoZSBsYXN0IGVsZW1lbnQgb2Yga2V5cGFydHMgdG8gc2lnbmFsIHRvIHRoZSBjYWxsZXIgdGhhdCBpdCBuZWVkc1xuLy8gdG8gdXNlIGEgZGlmZmVyZW50IHZhbHVlIHRvIGluZGV4IGludG8gdGhlIHJldHVybmVkIG9iamVjdCAoZm9yIGV4YW1wbGUsXG4vLyBbJ2EnLCAnMDEnXSAtPiBbJ2EnLCAxXSkuXG4vL1xuLy8gaWYgZm9yYmlkQXJyYXkgaXMgdHJ1ZSwgcmV0dXJuIG51bGwgaWYgdGhlIGtleXBhdGggZ29lcyB0aHJvdWdoIGFuIGFycmF5LlxuLy9cbi8vIGlmIG9wdGlvbnMuYXJyYXlJbmRpY2VzIGlzIHNldCwgdXNlIGl0cyBmaXJzdCBlbGVtZW50IGZvciB0aGUgKGZpcnN0KSAnJCcgaW5cbi8vIHRoZSBwYXRoLlxuZnVuY3Rpb24gZmluZE1vZFRhcmdldChkb2MsIGtleXBhcnRzLCBvcHRpb25zID0ge30pIHtcbiAgbGV0IHVzZWRBcnJheUluZGV4ID0gZmFsc2U7XG5cbiAgZm9yIChsZXQgaSA9IDA7IGkgPCBrZXlwYXJ0cy5sZW5ndGg7IGkrKykge1xuICAgIGNvbnN0IGxhc3QgPSBpID09PSBrZXlwYXJ0cy5sZW5ndGggLSAxO1xuICAgIGxldCBrZXlwYXJ0ID0ga2V5cGFydHNbaV07XG5cbiAgICBpZiAoIWlzSW5kZXhhYmxlKGRvYykpIHtcbiAgICAgIGlmIChvcHRpb25zLm5vQ3JlYXRlKSB7XG4gICAgICAgIHJldHVybiB1bmRlZmluZWQ7XG4gICAgICB9XG5cbiAgICAgIGNvbnN0IGVycm9yID0gTWluaW1vbmdvRXJyb3IoXG4gICAgICAgIGBjYW5ub3QgdXNlIHRoZSBwYXJ0ICcke2tleXBhcnR9JyB0byB0cmF2ZXJzZSAke2RvY31gXG4gICAgICApO1xuICAgICAgZXJyb3Iuc2V0UHJvcGVydHlFcnJvciA9IHRydWU7XG4gICAgICB0aHJvdyBlcnJvcjtcbiAgICB9XG5cbiAgICBpZiAoZG9jIGluc3RhbmNlb2YgQXJyYXkpIHtcbiAgICAgIGlmIChvcHRpb25zLmZvcmJpZEFycmF5KSB7XG4gICAgICAgIHJldHVybiBudWxsO1xuICAgICAgfVxuXG4gICAgICBpZiAoa2V5cGFydCA9PT0gJyQnKSB7XG4gICAgICAgIGlmICh1c2VkQXJyYXlJbmRleCkge1xuICAgICAgICAgIHRocm93IE1pbmltb25nb0Vycm9yKCdUb28gbWFueSBwb3NpdGlvbmFsIChpLmUuIFxcJyRcXCcpIGVsZW1lbnRzJyk7XG4gICAgICAgIH1cblxuICAgICAgICBpZiAoIW9wdGlvbnMuYXJyYXlJbmRpY2VzIHx8ICFvcHRpb25zLmFycmF5SW5kaWNlcy5sZW5ndGgpIHtcbiAgICAgICAgICB0aHJvdyBNaW5pbW9uZ29FcnJvcihcbiAgICAgICAgICAgICdUaGUgcG9zaXRpb25hbCBvcGVyYXRvciBkaWQgbm90IGZpbmQgdGhlIG1hdGNoIG5lZWRlZCBmcm9tIHRoZSAnICtcbiAgICAgICAgICAgICdxdWVyeSdcbiAgICAgICAgICApO1xuICAgICAgICB9XG5cbiAgICAgICAga2V5cGFydCA9IG9wdGlvbnMuYXJyYXlJbmRpY2VzWzBdO1xuICAgICAgICB1c2VkQXJyYXlJbmRleCA9IHRydWU7XG4gICAgICB9IGVsc2UgaWYgKGlzTnVtZXJpY0tleShrZXlwYXJ0KSkge1xuICAgICAgICBrZXlwYXJ0ID0gcGFyc2VJbnQoa2V5cGFydCk7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICBpZiAob3B0aW9ucy5ub0NyZWF0ZSkge1xuICAgICAgICAgIHJldHVybiB1bmRlZmluZWQ7XG4gICAgICAgIH1cblxuICAgICAgICB0aHJvdyBNaW5pbW9uZ29FcnJvcihcbiAgICAgICAgICBgY2FuJ3QgYXBwZW5kIHRvIGFycmF5IHVzaW5nIHN0cmluZyBmaWVsZCBuYW1lIFske2tleXBhcnR9XWBcbiAgICAgICAgKTtcbiAgICAgIH1cblxuICAgICAgaWYgKGxhc3QpIHtcbiAgICAgICAga2V5cGFydHNbaV0gPSBrZXlwYXJ0OyAvLyBoYW5kbGUgJ2EuMDEnXG4gICAgICB9XG5cbiAgICAgIGlmIChvcHRpb25zLm5vQ3JlYXRlICYmIGtleXBhcnQgPj0gZG9jLmxlbmd0aCkge1xuICAgICAgICByZXR1cm4gdW5kZWZpbmVkO1xuICAgICAgfVxuXG4gICAgICB3aGlsZSAoZG9jLmxlbmd0aCA8IGtleXBhcnQpIHtcbiAgICAgICAgZG9jLnB1c2gobnVsbCk7XG4gICAgICB9XG5cbiAgICAgIGlmICghbGFzdCkge1xuICAgICAgICBpZiAoZG9jLmxlbmd0aCA9PT0ga2V5cGFydCkge1xuICAgICAgICAgIGRvYy5wdXNoKHt9KTtcbiAgICAgICAgfSBlbHNlIGlmICh0eXBlb2YgZG9jW2tleXBhcnRdICE9PSAnb2JqZWN0Jykge1xuICAgICAgICAgIHRocm93IE1pbmltb25nb0Vycm9yKFxuICAgICAgICAgICAgYGNhbid0IG1vZGlmeSBmaWVsZCAnJHtrZXlwYXJ0c1tpICsgMV19JyBvZiBsaXN0IHZhbHVlIGAgK1xuICAgICAgICAgICAgSlNPTi5zdHJpbmdpZnkoZG9jW2tleXBhcnRdKVxuICAgICAgICAgICk7XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9IGVsc2Uge1xuICAgICAgYXNzZXJ0SXNWYWxpZEZpZWxkTmFtZShrZXlwYXJ0KTtcblxuICAgICAgaWYgKCEoa2V5cGFydCBpbiBkb2MpKSB7XG4gICAgICAgIGlmIChvcHRpb25zLm5vQ3JlYXRlKSB7XG4gICAgICAgICAgcmV0dXJuIHVuZGVmaW5lZDtcbiAgICAgICAgfVxuXG4gICAgICAgIGlmICghbGFzdCkge1xuICAgICAgICAgIGRvY1trZXlwYXJ0XSA9IHt9O1xuICAgICAgICB9XG4gICAgICB9XG4gICAgfVxuXG4gICAgaWYgKGxhc3QpIHtcbiAgICAgIHJldHVybiBkb2M7XG4gICAgfVxuXG4gICAgZG9jID0gZG9jW2tleXBhcnRdO1xuICB9XG5cbiAgLy8gbm90cmVhY2hlZFxufVxuIiwiaW1wb3J0IExvY2FsQ29sbGVjdGlvbiBmcm9tICcuL2xvY2FsX2NvbGxlY3Rpb24uanMnO1xuaW1wb3J0IHtcbiAgY29tcGlsZURvY3VtZW50U2VsZWN0b3IsXG4gIGhhc093bixcbiAgbm90aGluZ01hdGNoZXIsXG59IGZyb20gJy4vY29tbW9uLmpzJztcblxuY29uc3QgRGVjaW1hbCA9IFBhY2thZ2VbJ21vbmdvLWRlY2ltYWwnXT8uRGVjaW1hbCB8fCBjbGFzcyBEZWNpbWFsU3R1YiB7fVxuXG4vLyBUaGUgbWluaW1vbmdvIHNlbGVjdG9yIGNvbXBpbGVyIVxuXG4vLyBUZXJtaW5vbG9neTpcbi8vICAtIGEgJ3NlbGVjdG9yJyBpcyB0aGUgRUpTT04gb2JqZWN0IHJlcHJlc2VudGluZyBhIHNlbGVjdG9yXG4vLyAgLSBhICdtYXRjaGVyJyBpcyBpdHMgY29tcGlsZWQgZm9ybSAod2hldGhlciBhIGZ1bGwgTWluaW1vbmdvLk1hdGNoZXJcbi8vICAgIG9iamVjdCBvciBvbmUgb2YgdGhlIGNvbXBvbmVudCBsYW1iZGFzIHRoYXQgbWF0Y2hlcyBwYXJ0cyBvZiBpdClcbi8vICAtIGEgJ3Jlc3VsdCBvYmplY3QnIGlzIGFuIG9iamVjdCB3aXRoIGEgJ3Jlc3VsdCcgZmllbGQgYW5kIG1heWJlXG4vLyAgICBkaXN0YW5jZSBhbmQgYXJyYXlJbmRpY2VzLlxuLy8gIC0gYSAnYnJhbmNoZWQgdmFsdWUnIGlzIGFuIG9iamVjdCB3aXRoIGEgJ3ZhbHVlJyBmaWVsZCBhbmQgbWF5YmVcbi8vICAgICdkb250SXRlcmF0ZScgYW5kICdhcnJheUluZGljZXMnLlxuLy8gIC0gYSAnZG9jdW1lbnQnIGlzIGEgdG9wLWxldmVsIG9iamVjdCB0aGF0IGNhbiBiZSBzdG9yZWQgaW4gYSBjb2xsZWN0aW9uLlxuLy8gIC0gYSAnbG9va3VwIGZ1bmN0aW9uJyBpcyBhIGZ1bmN0aW9uIHRoYXQgdGFrZXMgaW4gYSBkb2N1bWVudCBhbmQgcmV0dXJuc1xuLy8gICAgYW4gYXJyYXkgb2YgJ2JyYW5jaGVkIHZhbHVlcycuXG4vLyAgLSBhICdicmFuY2hlZCBtYXRjaGVyJyBtYXBzIGZyb20gYW4gYXJyYXkgb2YgYnJhbmNoZWQgdmFsdWVzIHRvIGEgcmVzdWx0XG4vLyAgICBvYmplY3QuXG4vLyAgLSBhbiAnZWxlbWVudCBtYXRjaGVyJyBtYXBzIGZyb20gYSBzaW5nbGUgdmFsdWUgdG8gYSBib29sLlxuXG4vLyBNYWluIGVudHJ5IHBvaW50LlxuLy8gICB2YXIgbWF0Y2hlciA9IG5ldyBNaW5pbW9uZ28uTWF0Y2hlcih7YTogeyRndDogNX19KTtcbi8vICAgaWYgKG1hdGNoZXIuZG9jdW1lbnRNYXRjaGVzKHthOiA3fSkpIC4uLlxuZXhwb3J0IGRlZmF1bHQgY2xhc3MgTWF0Y2hlciB7XG4gIGNvbnN0cnVjdG9yKHNlbGVjdG9yLCBpc1VwZGF0ZSkge1xuICAgIC8vIEEgc2V0IChvYmplY3QgbWFwcGluZyBzdHJpbmcgLT4gKikgb2YgYWxsIG9mIHRoZSBkb2N1bWVudCBwYXRocyBsb29rZWRcbiAgICAvLyBhdCBieSB0aGUgc2VsZWN0b3IuIEFsc28gaW5jbHVkZXMgdGhlIGVtcHR5IHN0cmluZyBpZiBpdCBtYXkgbG9vayBhdCBhbnlcbiAgICAvLyBwYXRoIChlZywgJHdoZXJlKS5cbiAgICB0aGlzLl9wYXRocyA9IHt9O1xuICAgIC8vIFNldCB0byB0cnVlIGlmIGNvbXBpbGF0aW9uIGZpbmRzIGEgJG5lYXIuXG4gICAgdGhpcy5faGFzR2VvUXVlcnkgPSBmYWxzZTtcbiAgICAvLyBTZXQgdG8gdHJ1ZSBpZiBjb21waWxhdGlvbiBmaW5kcyBhICR3aGVyZS5cbiAgICB0aGlzLl9oYXNXaGVyZSA9IGZhbHNlO1xuICAgIC8vIFNldCB0byBmYWxzZSBpZiBjb21waWxhdGlvbiBmaW5kcyBhbnl0aGluZyBvdGhlciB0aGFuIGEgc2ltcGxlIGVxdWFsaXR5XG4gICAgLy8gb3Igb25lIG9yIG1vcmUgb2YgJyRndCcsICckZ3RlJywgJyRsdCcsICckbHRlJywgJyRuZScsICckaW4nLCAnJG5pbicgdXNlZFxuICAgIC8vIHdpdGggc2NhbGFycyBhcyBvcGVyYW5kcy5cbiAgICB0aGlzLl9pc1NpbXBsZSA9IHRydWU7XG4gICAgLy8gU2V0IHRvIGEgZHVtbXkgZG9jdW1lbnQgd2hpY2ggYWx3YXlzIG1hdGNoZXMgdGhpcyBNYXRjaGVyLiBPciBzZXQgdG8gbnVsbFxuICAgIC8vIGlmIHN1Y2ggZG9jdW1lbnQgaXMgdG9vIGhhcmQgdG8gZmluZC5cbiAgICB0aGlzLl9tYXRjaGluZ0RvY3VtZW50ID0gdW5kZWZpbmVkO1xuICAgIC8vIEEgY2xvbmUgb2YgdGhlIG9yaWdpbmFsIHNlbGVjdG9yLiBJdCBtYXkganVzdCBiZSBhIGZ1bmN0aW9uIGlmIHRoZSB1c2VyXG4gICAgLy8gcGFzc2VkIGluIGEgZnVuY3Rpb247IG90aGVyd2lzZSBpcyBkZWZpbml0ZWx5IGFuIG9iamVjdCAoZWcsIElEcyBhcmVcbiAgICAvLyB0cmFuc2xhdGVkIGludG8ge19pZDogSUR9IGZpcnN0LiBVc2VkIGJ5IGNhbkJlY29tZVRydWVCeU1vZGlmaWVyIGFuZFxuICAgIC8vIFNvcnRlci5fdXNlV2l0aE1hdGNoZXIuXG4gICAgdGhpcy5fc2VsZWN0b3IgPSBudWxsO1xuICAgIHRoaXMuX2RvY01hdGNoZXIgPSB0aGlzLl9jb21waWxlU2VsZWN0b3Ioc2VsZWN0b3IpO1xuICAgIC8vIFNldCB0byB0cnVlIGlmIHNlbGVjdGlvbiBpcyBkb25lIGZvciBhbiB1cGRhdGUgb3BlcmF0aW9uXG4gICAgLy8gRGVmYXVsdCBpcyBmYWxzZVxuICAgIC8vIFVzZWQgZm9yICRuZWFyIGFycmF5IHVwZGF0ZSAoaXNzdWUgIzM1OTkpXG4gICAgdGhpcy5faXNVcGRhdGUgPSBpc1VwZGF0ZTtcbiAgfVxuXG4gIGRvY3VtZW50TWF0Y2hlcyhkb2MpIHtcbiAgICBpZiAoZG9jICE9PSBPYmplY3QoZG9jKSkge1xuICAgICAgdGhyb3cgRXJyb3IoJ2RvY3VtZW50TWF0Y2hlcyBuZWVkcyBhIGRvY3VtZW50Jyk7XG4gICAgfVxuXG4gICAgcmV0dXJuIHRoaXMuX2RvY01hdGNoZXIoZG9jKTtcbiAgfVxuXG4gIGhhc0dlb1F1ZXJ5KCkge1xuICAgIHJldHVybiB0aGlzLl9oYXNHZW9RdWVyeTtcbiAgfVxuXG4gIGhhc1doZXJlKCkge1xuICAgIHJldHVybiB0aGlzLl9oYXNXaGVyZTtcbiAgfVxuXG4gIGlzU2ltcGxlKCkge1xuICAgIHJldHVybiB0aGlzLl9pc1NpbXBsZTtcbiAgfVxuXG4gIC8vIEdpdmVuIGEgc2VsZWN0b3IsIHJldHVybiBhIGZ1bmN0aW9uIHRoYXQgdGFrZXMgb25lIGFyZ3VtZW50LCBhXG4gIC8vIGRvY3VtZW50LiBJdCByZXR1cm5zIGEgcmVzdWx0IG9iamVjdC5cbiAgX2NvbXBpbGVTZWxlY3RvcihzZWxlY3Rvcikge1xuICAgIC8vIHlvdSBjYW4gcGFzcyBhIGxpdGVyYWwgZnVuY3Rpb24gaW5zdGVhZCBvZiBhIHNlbGVjdG9yXG4gICAgaWYgKHNlbGVjdG9yIGluc3RhbmNlb2YgRnVuY3Rpb24pIHtcbiAgICAgIHRoaXMuX2lzU2ltcGxlID0gZmFsc2U7XG4gICAgICB0aGlzLl9zZWxlY3RvciA9IHNlbGVjdG9yO1xuICAgICAgdGhpcy5fcmVjb3JkUGF0aFVzZWQoJycpO1xuXG4gICAgICByZXR1cm4gZG9jID0+ICh7cmVzdWx0OiAhIXNlbGVjdG9yLmNhbGwoZG9jKX0pO1xuICAgIH1cblxuICAgIC8vIHNob3J0aGFuZCAtLSBzY2FsYXIgX2lkXG4gICAgaWYgKExvY2FsQ29sbGVjdGlvbi5fc2VsZWN0b3JJc0lkKHNlbGVjdG9yKSkge1xuICAgICAgdGhpcy5fc2VsZWN0b3IgPSB7X2lkOiBzZWxlY3Rvcn07XG4gICAgICB0aGlzLl9yZWNvcmRQYXRoVXNlZCgnX2lkJyk7XG5cbiAgICAgIHJldHVybiBkb2MgPT4gKHtyZXN1bHQ6IEVKU09OLmVxdWFscyhkb2MuX2lkLCBzZWxlY3Rvcil9KTtcbiAgICB9XG5cbiAgICAvLyBwcm90ZWN0IGFnYWluc3QgZGFuZ2Vyb3VzIHNlbGVjdG9ycy4gIGZhbHNleSBhbmQge19pZDogZmFsc2V5fSBhcmUgYm90aFxuICAgIC8vIGxpa2VseSBwcm9ncmFtbWVyIGVycm9yLCBhbmQgbm90IHdoYXQgeW91IHdhbnQsIHBhcnRpY3VsYXJseSBmb3JcbiAgICAvLyBkZXN0cnVjdGl2ZSBvcGVyYXRpb25zLlxuICAgIGlmICghc2VsZWN0b3IgfHwgaGFzT3duLmNhbGwoc2VsZWN0b3IsICdfaWQnKSAmJiAhc2VsZWN0b3IuX2lkKSB7XG4gICAgICB0aGlzLl9pc1NpbXBsZSA9IGZhbHNlO1xuICAgICAgcmV0dXJuIG5vdGhpbmdNYXRjaGVyO1xuICAgIH1cblxuICAgIC8vIFRvcCBsZXZlbCBjYW4ndCBiZSBhbiBhcnJheSBvciB0cnVlIG9yIGJpbmFyeS5cbiAgICBpZiAoQXJyYXkuaXNBcnJheShzZWxlY3RvcikgfHxcbiAgICAgICAgRUpTT04uaXNCaW5hcnkoc2VsZWN0b3IpIHx8XG4gICAgICAgIHR5cGVvZiBzZWxlY3RvciA9PT0gJ2Jvb2xlYW4nKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYEludmFsaWQgc2VsZWN0b3I6ICR7c2VsZWN0b3J9YCk7XG4gICAgfVxuXG4gICAgdGhpcy5fc2VsZWN0b3IgPSBFSlNPTi5jbG9uZShzZWxlY3Rvcik7XG5cbiAgICByZXR1cm4gY29tcGlsZURvY3VtZW50U2VsZWN0b3Ioc2VsZWN0b3IsIHRoaXMsIHtpc1Jvb3Q6IHRydWV9KTtcbiAgfVxuXG4gIC8vIFJldHVybnMgYSBsaXN0IG9mIGtleSBwYXRocyB0aGUgZ2l2ZW4gc2VsZWN0b3IgaXMgbG9va2luZyBmb3IuIEl0IGluY2x1ZGVzXG4gIC8vIHRoZSBlbXB0eSBzdHJpbmcgaWYgdGhlcmUgaXMgYSAkd2hlcmUuXG4gIF9nZXRQYXRocygpIHtcbiAgICByZXR1cm4gT2JqZWN0LmtleXModGhpcy5fcGF0aHMpO1xuICB9XG5cbiAgX3JlY29yZFBhdGhVc2VkKHBhdGgpIHtcbiAgICB0aGlzLl9wYXRoc1twYXRoXSA9IHRydWU7XG4gIH1cbn1cblxuLy8gaGVscGVycyB1c2VkIGJ5IGNvbXBpbGVkIHNlbGVjdG9yIGNvZGVcbkxvY2FsQ29sbGVjdGlvbi5fZiA9IHtcbiAgLy8gWFhYIGZvciBfYWxsIGFuZCBfaW4sIGNvbnNpZGVyIGJ1aWxkaW5nICdpbnF1ZXJ5JyBhdCBjb21waWxlIHRpbWUuLlxuICBfdHlwZSh2KSB7XG4gICAgaWYgKHR5cGVvZiB2ID09PSAnbnVtYmVyJykge1xuICAgICAgcmV0dXJuIDE7XG4gICAgfVxuXG4gICAgaWYgKHR5cGVvZiB2ID09PSAnc3RyaW5nJykge1xuICAgICAgcmV0dXJuIDI7XG4gICAgfVxuXG4gICAgaWYgKHR5cGVvZiB2ID09PSAnYm9vbGVhbicpIHtcbiAgICAgIHJldHVybiA4O1xuICAgIH1cblxuICAgIGlmIChBcnJheS5pc0FycmF5KHYpKSB7XG4gICAgICByZXR1cm4gNDtcbiAgICB9XG5cbiAgICBpZiAodiA9PT0gbnVsbCkge1xuICAgICAgcmV0dXJuIDEwO1xuICAgIH1cblxuICAgIC8vIG5vdGUgdGhhdCB0eXBlb2YoL3gvKSA9PT0gXCJvYmplY3RcIlxuICAgIGlmICh2IGluc3RhbmNlb2YgUmVnRXhwKSB7XG4gICAgICByZXR1cm4gMTE7XG4gICAgfVxuXG4gICAgaWYgKHR5cGVvZiB2ID09PSAnZnVuY3Rpb24nKSB7XG4gICAgICByZXR1cm4gMTM7XG4gICAgfVxuXG4gICAgaWYgKHYgaW5zdGFuY2VvZiBEYXRlKSB7XG4gICAgICByZXR1cm4gOTtcbiAgICB9XG5cbiAgICBpZiAoRUpTT04uaXNCaW5hcnkodikpIHtcbiAgICAgIHJldHVybiA1O1xuICAgIH1cblxuICAgIGlmICh2IGluc3RhbmNlb2YgTW9uZ29JRC5PYmplY3RJRCkge1xuICAgICAgcmV0dXJuIDc7XG4gICAgfVxuXG4gICAgaWYgKHYgaW5zdGFuY2VvZiBEZWNpbWFsKSB7XG4gICAgICByZXR1cm4gMTtcbiAgICB9XG5cbiAgICAvLyBvYmplY3RcbiAgICByZXR1cm4gMztcblxuICAgIC8vIFhYWCBzdXBwb3J0IHNvbWUvYWxsIG9mIHRoZXNlOlxuICAgIC8vIDE0LCBzeW1ib2xcbiAgICAvLyAxNSwgamF2YXNjcmlwdCBjb2RlIHdpdGggc2NvcGVcbiAgICAvLyAxNiwgMTg6IDMyLWJpdC82NC1iaXQgaW50ZWdlclxuICAgIC8vIDE3LCB0aW1lc3RhbXBcbiAgICAvLyAyNTUsIG1pbmtleVxuICAgIC8vIDEyNywgbWF4a2V5XG4gIH0sXG5cbiAgLy8gZGVlcCBlcXVhbGl0eSB0ZXN0OiB1c2UgZm9yIGxpdGVyYWwgZG9jdW1lbnQgYW5kIGFycmF5IG1hdGNoZXNcbiAgX2VxdWFsKGEsIGIpIHtcbiAgICByZXR1cm4gRUpTT04uZXF1YWxzKGEsIGIsIHtrZXlPcmRlclNlbnNpdGl2ZTogdHJ1ZX0pO1xuICB9LFxuXG4gIC8vIG1hcHMgYSB0eXBlIGNvZGUgdG8gYSB2YWx1ZSB0aGF0IGNhbiBiZSB1c2VkIHRvIHNvcnQgdmFsdWVzIG9mIGRpZmZlcmVudFxuICAvLyB0eXBlc1xuICBfdHlwZW9yZGVyKHQpIHtcbiAgICAvLyBodHRwOi8vd3d3Lm1vbmdvZGIub3JnL2Rpc3BsYXkvRE9DUy9XaGF0K2lzK3RoZStDb21wYXJlK09yZGVyK2ZvcitCU09OK1R5cGVzXG4gICAgLy8gWFhYIHdoYXQgaXMgdGhlIGNvcnJlY3Qgc29ydCBwb3NpdGlvbiBmb3IgSmF2YXNjcmlwdCBjb2RlP1xuICAgIC8vICgnMTAwJyBpbiB0aGUgbWF0cml4IGJlbG93KVxuICAgIC8vIFhYWCBtaW5rZXkvbWF4a2V5XG4gICAgcmV0dXJuIFtcbiAgICAgIC0xLCAgLy8gKG5vdCBhIHR5cGUpXG4gICAgICAxLCAgIC8vIG51bWJlclxuICAgICAgMiwgICAvLyBzdHJpbmdcbiAgICAgIDMsICAgLy8gb2JqZWN0XG4gICAgICA0LCAgIC8vIGFycmF5XG4gICAgICA1LCAgIC8vIGJpbmFyeVxuICAgICAgLTEsICAvLyBkZXByZWNhdGVkXG4gICAgICA2LCAgIC8vIE9iamVjdElEXG4gICAgICA3LCAgIC8vIGJvb2xcbiAgICAgIDgsICAgLy8gRGF0ZVxuICAgICAgMCwgICAvLyBudWxsXG4gICAgICA5LCAgIC8vIFJlZ0V4cFxuICAgICAgLTEsICAvLyBkZXByZWNhdGVkXG4gICAgICAxMDAsIC8vIEpTIGNvZGVcbiAgICAgIDIsICAgLy8gZGVwcmVjYXRlZCAoc3ltYm9sKVxuICAgICAgMTAwLCAvLyBKUyBjb2RlXG4gICAgICAxLCAgIC8vIDMyLWJpdCBpbnRcbiAgICAgIDgsICAgLy8gTW9uZ28gdGltZXN0YW1wXG4gICAgICAxICAgIC8vIDY0LWJpdCBpbnRcbiAgICBdW3RdO1xuICB9LFxuXG4gIC8vIGNvbXBhcmUgdHdvIHZhbHVlcyBvZiB1bmtub3duIHR5cGUgYWNjb3JkaW5nIHRvIEJTT04gb3JkZXJpbmdcbiAgLy8gc2VtYW50aWNzLiAoYXMgYW4gZXh0ZW5zaW9uLCBjb25zaWRlciAndW5kZWZpbmVkJyB0byBiZSBsZXNzIHRoYW5cbiAgLy8gYW55IG90aGVyIHZhbHVlLikgcmV0dXJuIG5lZ2F0aXZlIGlmIGEgaXMgbGVzcywgcG9zaXRpdmUgaWYgYiBpc1xuICAvLyBsZXNzLCBvciAwIGlmIGVxdWFsXG4gIF9jbXAoYSwgYikge1xuICAgIGlmIChhID09PSB1bmRlZmluZWQpIHtcbiAgICAgIHJldHVybiBiID09PSB1bmRlZmluZWQgPyAwIDogLTE7XG4gICAgfVxuXG4gICAgaWYgKGIgPT09IHVuZGVmaW5lZCkge1xuICAgICAgcmV0dXJuIDE7XG4gICAgfVxuXG4gICAgbGV0IHRhID0gTG9jYWxDb2xsZWN0aW9uLl9mLl90eXBlKGEpO1xuICAgIGxldCB0YiA9IExvY2FsQ29sbGVjdGlvbi5fZi5fdHlwZShiKTtcblxuICAgIGNvbnN0IG9hID0gTG9jYWxDb2xsZWN0aW9uLl9mLl90eXBlb3JkZXIodGEpO1xuICAgIGNvbnN0IG9iID0gTG9jYWxDb2xsZWN0aW9uLl9mLl90eXBlb3JkZXIodGIpO1xuXG4gICAgaWYgKG9hICE9PSBvYikge1xuICAgICAgcmV0dXJuIG9hIDwgb2IgPyAtMSA6IDE7XG4gICAgfVxuXG4gICAgLy8gWFhYIG5lZWQgdG8gaW1wbGVtZW50IHRoaXMgaWYgd2UgaW1wbGVtZW50IFN5bWJvbCBvciBpbnRlZ2Vycywgb3JcbiAgICAvLyBUaW1lc3RhbXBcbiAgICBpZiAodGEgIT09IHRiKSB7XG4gICAgICB0aHJvdyBFcnJvcignTWlzc2luZyB0eXBlIGNvZXJjaW9uIGxvZ2ljIGluIF9jbXAnKTtcbiAgICB9XG5cbiAgICBpZiAodGEgPT09IDcpIHsgLy8gT2JqZWN0SURcbiAgICAgIC8vIENvbnZlcnQgdG8gc3RyaW5nLlxuICAgICAgdGEgPSB0YiA9IDI7XG4gICAgICBhID0gYS50b0hleFN0cmluZygpO1xuICAgICAgYiA9IGIudG9IZXhTdHJpbmcoKTtcbiAgICB9XG5cbiAgICBpZiAodGEgPT09IDkpIHsgLy8gRGF0ZVxuICAgICAgLy8gQ29udmVydCB0byBtaWxsaXMuXG4gICAgICB0YSA9IHRiID0gMTtcbiAgICAgIGEgPSBhLmdldFRpbWUoKTtcbiAgICAgIGIgPSBiLmdldFRpbWUoKTtcbiAgICB9XG5cbiAgICBpZiAodGEgPT09IDEpIHsgLy8gZG91YmxlXG4gICAgICBpZiAoYSBpbnN0YW5jZW9mIERlY2ltYWwpIHtcbiAgICAgICAgcmV0dXJuIGEubWludXMoYikudG9OdW1iZXIoKTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIHJldHVybiBhIC0gYjtcbiAgICAgIH1cbiAgICB9XG5cbiAgICBpZiAodGIgPT09IDIpIC8vIHN0cmluZ1xuICAgICAgcmV0dXJuIGEgPCBiID8gLTEgOiBhID09PSBiID8gMCA6IDE7XG5cbiAgICBpZiAodGEgPT09IDMpIHsgLy8gT2JqZWN0XG4gICAgICAvLyB0aGlzIGNvdWxkIGJlIG11Y2ggbW9yZSBlZmZpY2llbnQgaW4gdGhlIGV4cGVjdGVkIGNhc2UgLi4uXG4gICAgICBjb25zdCB0b0FycmF5ID0gb2JqZWN0ID0+IHtcbiAgICAgICAgY29uc3QgcmVzdWx0ID0gW107XG5cbiAgICAgICAgT2JqZWN0LmtleXMob2JqZWN0KS5mb3JFYWNoKGtleSA9PiB7XG4gICAgICAgICAgcmVzdWx0LnB1c2goa2V5LCBvYmplY3Rba2V5XSk7XG4gICAgICAgIH0pO1xuXG4gICAgICAgIHJldHVybiByZXN1bHQ7XG4gICAgICB9O1xuXG4gICAgICByZXR1cm4gTG9jYWxDb2xsZWN0aW9uLl9mLl9jbXAodG9BcnJheShhKSwgdG9BcnJheShiKSk7XG4gICAgfVxuXG4gICAgaWYgKHRhID09PSA0KSB7IC8vIEFycmF5XG4gICAgICBmb3IgKGxldCBpID0gMDsgOyBpKyspIHtcbiAgICAgICAgaWYgKGkgPT09IGEubGVuZ3RoKSB7XG4gICAgICAgICAgcmV0dXJuIGkgPT09IGIubGVuZ3RoID8gMCA6IC0xO1xuICAgICAgICB9XG5cbiAgICAgICAgaWYgKGkgPT09IGIubGVuZ3RoKSB7XG4gICAgICAgICAgcmV0dXJuIDE7XG4gICAgICAgIH1cblxuICAgICAgICBjb25zdCBzID0gTG9jYWxDb2xsZWN0aW9uLl9mLl9jbXAoYVtpXSwgYltpXSk7XG4gICAgICAgIGlmIChzICE9PSAwKSB7XG4gICAgICAgICAgcmV0dXJuIHM7XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9XG5cbiAgICBpZiAodGEgPT09IDUpIHsgLy8gYmluYXJ5XG4gICAgICAvLyBTdXJwcmlzaW5nbHksIGEgc21hbGwgYmluYXJ5IGJsb2IgaXMgYWx3YXlzIGxlc3MgdGhhbiBhIGxhcmdlIG9uZSBpblxuICAgICAgLy8gTW9uZ28uXG4gICAgICBpZiAoYS5sZW5ndGggIT09IGIubGVuZ3RoKSB7XG4gICAgICAgIHJldHVybiBhLmxlbmd0aCAtIGIubGVuZ3RoO1xuICAgICAgfVxuXG4gICAgICBmb3IgKGxldCBpID0gMDsgaSA8IGEubGVuZ3RoOyBpKyspIHtcbiAgICAgICAgaWYgKGFbaV0gPCBiW2ldKSB7XG4gICAgICAgICAgcmV0dXJuIC0xO1xuICAgICAgICB9XG5cbiAgICAgICAgaWYgKGFbaV0gPiBiW2ldKSB7XG4gICAgICAgICAgcmV0dXJuIDE7XG4gICAgICAgIH1cbiAgICAgIH1cblxuICAgICAgcmV0dXJuIDA7XG4gICAgfVxuXG4gICAgaWYgKHRhID09PSA4KSB7IC8vIGJvb2xlYW5cbiAgICAgIGlmIChhKSB7XG4gICAgICAgIHJldHVybiBiID8gMCA6IDE7XG4gICAgICB9XG5cbiAgICAgIHJldHVybiBiID8gLTEgOiAwO1xuICAgIH1cblxuICAgIGlmICh0YSA9PT0gMTApIC8vIG51bGxcbiAgICAgIHJldHVybiAwO1xuXG4gICAgaWYgKHRhID09PSAxMSkgLy8gcmVnZXhwXG4gICAgICB0aHJvdyBFcnJvcignU29ydGluZyBub3Qgc3VwcG9ydGVkIG9uIHJlZ3VsYXIgZXhwcmVzc2lvbicpOyAvLyBYWFhcblxuICAgIC8vIDEzOiBqYXZhc2NyaXB0IGNvZGVcbiAgICAvLyAxNDogc3ltYm9sXG4gICAgLy8gMTU6IGphdmFzY3JpcHQgY29kZSB3aXRoIHNjb3BlXG4gICAgLy8gMTY6IDMyLWJpdCBpbnRlZ2VyXG4gICAgLy8gMTc6IHRpbWVzdGFtcFxuICAgIC8vIDE4OiA2NC1iaXQgaW50ZWdlclxuICAgIC8vIDI1NTogbWlua2V5XG4gICAgLy8gMTI3OiBtYXhrZXlcbiAgICBpZiAodGEgPT09IDEzKSAvLyBqYXZhc2NyaXB0IGNvZGVcbiAgICAgIHRocm93IEVycm9yKCdTb3J0aW5nIG5vdCBzdXBwb3J0ZWQgb24gSmF2YXNjcmlwdCBjb2RlJyk7IC8vIFhYWFxuXG4gICAgdGhyb3cgRXJyb3IoJ1Vua25vd24gdHlwZSB0byBzb3J0Jyk7XG4gIH0sXG59O1xuIiwiaW1wb3J0IExvY2FsQ29sbGVjdGlvbl8gZnJvbSAnLi9sb2NhbF9jb2xsZWN0aW9uLmpzJztcbmltcG9ydCBNYXRjaGVyIGZyb20gJy4vbWF0Y2hlci5qcyc7XG5pbXBvcnQgU29ydGVyIGZyb20gJy4vc29ydGVyLmpzJztcblxuTG9jYWxDb2xsZWN0aW9uID0gTG9jYWxDb2xsZWN0aW9uXztcbk1pbmltb25nbyA9IHtcbiAgICBMb2NhbENvbGxlY3Rpb246IExvY2FsQ29sbGVjdGlvbl8sXG4gICAgTWF0Y2hlcixcbiAgICBTb3J0ZXJcbn07XG4iLCIvLyBPYnNlcnZlSGFuZGxlOiB0aGUgcmV0dXJuIHZhbHVlIG9mIGEgbGl2ZSBxdWVyeS5cbmV4cG9ydCBkZWZhdWx0IGNsYXNzIE9ic2VydmVIYW5kbGUge31cbiIsImltcG9ydCB7XG4gIEVMRU1FTlRfT1BFUkFUT1JTLFxuICBlcXVhbGl0eUVsZW1lbnRNYXRjaGVyLFxuICBleHBhbmRBcnJheXNJbkJyYW5jaGVzLFxuICBoYXNPd24sXG4gIGlzT3BlcmF0b3JPYmplY3QsXG4gIG1ha2VMb29rdXBGdW5jdGlvbixcbiAgcmVnZXhwRWxlbWVudE1hdGNoZXIsXG59IGZyb20gJy4vY29tbW9uLmpzJztcblxuLy8gR2l2ZSBhIHNvcnQgc3BlYywgd2hpY2ggY2FuIGJlIGluIGFueSBvZiB0aGVzZSBmb3Jtczpcbi8vICAge1wia2V5MVwiOiAxLCBcImtleTJcIjogLTF9XG4vLyAgIFtbXCJrZXkxXCIsIFwiYXNjXCJdLCBbXCJrZXkyXCIsIFwiZGVzY1wiXV1cbi8vICAgW1wia2V5MVwiLCBbXCJrZXkyXCIsIFwiZGVzY1wiXV1cbi8vXG4vLyAoLi4gd2l0aCB0aGUgZmlyc3QgZm9ybSBiZWluZyBkZXBlbmRlbnQgb24gdGhlIGtleSBlbnVtZXJhdGlvblxuLy8gYmVoYXZpb3Igb2YgeW91ciBqYXZhc2NyaXB0IFZNLCB3aGljaCB1c3VhbGx5IGRvZXMgd2hhdCB5b3UgbWVhbiBpblxuLy8gdGhpcyBjYXNlIGlmIHRoZSBrZXkgbmFtZXMgZG9uJ3QgbG9vayBsaWtlIGludGVnZXJzIC4uKVxuLy9cbi8vIHJldHVybiBhIGZ1bmN0aW9uIHRoYXQgdGFrZXMgdHdvIG9iamVjdHMsIGFuZCByZXR1cm5zIC0xIGlmIHRoZVxuLy8gZmlyc3Qgb2JqZWN0IGNvbWVzIGZpcnN0IGluIG9yZGVyLCAxIGlmIHRoZSBzZWNvbmQgb2JqZWN0IGNvbWVzXG4vLyBmaXJzdCwgb3IgMCBpZiBuZWl0aGVyIG9iamVjdCBjb21lcyBiZWZvcmUgdGhlIG90aGVyLlxuXG5leHBvcnQgZGVmYXVsdCBjbGFzcyBTb3J0ZXIge1xuICBjb25zdHJ1Y3RvcihzcGVjKSB7XG4gICAgdGhpcy5fc29ydFNwZWNQYXJ0cyA9IFtdO1xuICAgIHRoaXMuX3NvcnRGdW5jdGlvbiA9IG51bGw7XG5cbiAgICBjb25zdCBhZGRTcGVjUGFydCA9IChwYXRoLCBhc2NlbmRpbmcpID0+IHtcbiAgICAgIGlmICghcGF0aCkge1xuICAgICAgICB0aHJvdyBFcnJvcignc29ydCBrZXlzIG11c3QgYmUgbm9uLWVtcHR5Jyk7XG4gICAgICB9XG5cbiAgICAgIGlmIChwYXRoLmNoYXJBdCgwKSA9PT0gJyQnKSB7XG4gICAgICAgIHRocm93IEVycm9yKGB1bnN1cHBvcnRlZCBzb3J0IGtleTogJHtwYXRofWApO1xuICAgICAgfVxuXG4gICAgICB0aGlzLl9zb3J0U3BlY1BhcnRzLnB1c2goe1xuICAgICAgICBhc2NlbmRpbmcsXG4gICAgICAgIGxvb2t1cDogbWFrZUxvb2t1cEZ1bmN0aW9uKHBhdGgsIHtmb3JTb3J0OiB0cnVlfSksXG4gICAgICAgIHBhdGhcbiAgICAgIH0pO1xuICAgIH07XG5cbiAgICBpZiAoc3BlYyBpbnN0YW5jZW9mIEFycmF5KSB7XG4gICAgICBzcGVjLmZvckVhY2goZWxlbWVudCA9PiB7XG4gICAgICAgIGlmICh0eXBlb2YgZWxlbWVudCA9PT0gJ3N0cmluZycpIHtcbiAgICAgICAgICBhZGRTcGVjUGFydChlbGVtZW50LCB0cnVlKTtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICBhZGRTcGVjUGFydChlbGVtZW50WzBdLCBlbGVtZW50WzFdICE9PSAnZGVzYycpO1xuICAgICAgICB9XG4gICAgICB9KTtcbiAgICB9IGVsc2UgaWYgKHR5cGVvZiBzcGVjID09PSAnb2JqZWN0Jykge1xuICAgICAgT2JqZWN0LmtleXMoc3BlYykuZm9yRWFjaChrZXkgPT4ge1xuICAgICAgICBhZGRTcGVjUGFydChrZXksIHNwZWNba2V5XSA+PSAwKTtcbiAgICAgIH0pO1xuICAgIH0gZWxzZSBpZiAodHlwZW9mIHNwZWMgPT09ICdmdW5jdGlvbicpIHtcbiAgICAgIHRoaXMuX3NvcnRGdW5jdGlvbiA9IHNwZWM7XG4gICAgfSBlbHNlIHtcbiAgICAgIHRocm93IEVycm9yKGBCYWQgc29ydCBzcGVjaWZpY2F0aW9uOiAke0pTT04uc3RyaW5naWZ5KHNwZWMpfWApO1xuICAgIH1cblxuICAgIC8vIElmIGEgZnVuY3Rpb24gaXMgc3BlY2lmaWVkIGZvciBzb3J0aW5nLCB3ZSBza2lwIHRoZSByZXN0LlxuICAgIGlmICh0aGlzLl9zb3J0RnVuY3Rpb24pIHtcbiAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICAvLyBUbyBpbXBsZW1lbnQgYWZmZWN0ZWRCeU1vZGlmaWVyLCB3ZSBwaWdneS1iYWNrIG9uIHRvcCBvZiBNYXRjaGVyJ3NcbiAgICAvLyBhZmZlY3RlZEJ5TW9kaWZpZXIgY29kZTsgd2UgY3JlYXRlIGEgc2VsZWN0b3IgdGhhdCBpcyBhZmZlY3RlZCBieSB0aGVcbiAgICAvLyBzYW1lIG1vZGlmaWVycyBhcyB0aGlzIHNvcnQgb3JkZXIuIFRoaXMgaXMgb25seSBpbXBsZW1lbnRlZCBvbiB0aGVcbiAgICAvLyBzZXJ2ZXIuXG4gICAgaWYgKHRoaXMuYWZmZWN0ZWRCeU1vZGlmaWVyKSB7XG4gICAgICBjb25zdCBzZWxlY3RvciA9IHt9O1xuXG4gICAgICB0aGlzLl9zb3J0U3BlY1BhcnRzLmZvckVhY2goc3BlYyA9PiB7XG4gICAgICAgIHNlbGVjdG9yW3NwZWMucGF0aF0gPSAxO1xuICAgICAgfSk7XG5cbiAgICAgIHRoaXMuX3NlbGVjdG9yRm9yQWZmZWN0ZWRCeU1vZGlmaWVyID0gbmV3IE1pbmltb25nby5NYXRjaGVyKHNlbGVjdG9yKTtcbiAgICB9XG5cbiAgICB0aGlzLl9rZXlDb21wYXJhdG9yID0gY29tcG9zZUNvbXBhcmF0b3JzKFxuICAgICAgdGhpcy5fc29ydFNwZWNQYXJ0cy5tYXAoKHNwZWMsIGkpID0+IHRoaXMuX2tleUZpZWxkQ29tcGFyYXRvcihpKSlcbiAgICApO1xuICB9XG5cbiAgZ2V0Q29tcGFyYXRvcihvcHRpb25zKSB7XG4gICAgLy8gSWYgc29ydCBpcyBzcGVjaWZpZWQgb3IgaGF2ZSBubyBkaXN0YW5jZXMsIGp1c3QgdXNlIHRoZSBjb21wYXJhdG9yIGZyb21cbiAgICAvLyB0aGUgc291cmNlIHNwZWNpZmljYXRpb24gKHdoaWNoIGRlZmF1bHRzIHRvIFwiZXZlcnl0aGluZyBpcyBlcXVhbFwiLlxuICAgIC8vIGlzc3VlICMzNTk5XG4gICAgLy8gaHR0cHM6Ly9kb2NzLm1vbmdvZGIuY29tL21hbnVhbC9yZWZlcmVuY2Uvb3BlcmF0b3IvcXVlcnkvbmVhci8jc29ydC1vcGVyYXRpb25cbiAgICAvLyBzb3J0IGVmZmVjdGl2ZWx5IG92ZXJyaWRlcyAkbmVhclxuICAgIGlmICh0aGlzLl9zb3J0U3BlY1BhcnRzLmxlbmd0aCB8fCAhb3B0aW9ucyB8fCAhb3B0aW9ucy5kaXN0YW5jZXMpIHtcbiAgICAgIHJldHVybiB0aGlzLl9nZXRCYXNlQ29tcGFyYXRvcigpO1xuICAgIH1cblxuICAgIGNvbnN0IGRpc3RhbmNlcyA9IG9wdGlvbnMuZGlzdGFuY2VzO1xuXG4gICAgLy8gUmV0dXJuIGEgY29tcGFyYXRvciB3aGljaCBjb21wYXJlcyB1c2luZyAkbmVhciBkaXN0YW5jZXMuXG4gICAgcmV0dXJuIChhLCBiKSA9PiB7XG4gICAgICBpZiAoIWRpc3RhbmNlcy5oYXMoYS5faWQpKSB7XG4gICAgICAgIHRocm93IEVycm9yKGBNaXNzaW5nIGRpc3RhbmNlIGZvciAke2EuX2lkfWApO1xuICAgICAgfVxuXG4gICAgICBpZiAoIWRpc3RhbmNlcy5oYXMoYi5faWQpKSB7XG4gICAgICAgIHRocm93IEVycm9yKGBNaXNzaW5nIGRpc3RhbmNlIGZvciAke2IuX2lkfWApO1xuICAgICAgfVxuXG4gICAgICByZXR1cm4gZGlzdGFuY2VzLmdldChhLl9pZCkgLSBkaXN0YW5jZXMuZ2V0KGIuX2lkKTtcbiAgICB9O1xuICB9XG5cbiAgLy8gVGFrZXMgaW4gdHdvIGtleXM6IGFycmF5cyB3aG9zZSBsZW5ndGhzIG1hdGNoIHRoZSBudW1iZXIgb2Ygc3BlY1xuICAvLyBwYXJ0cy4gUmV0dXJucyBuZWdhdGl2ZSwgMCwgb3IgcG9zaXRpdmUgYmFzZWQgb24gdXNpbmcgdGhlIHNvcnQgc3BlYyB0b1xuICAvLyBjb21wYXJlIGZpZWxkcy5cbiAgX2NvbXBhcmVLZXlzKGtleTEsIGtleTIpIHtcbiAgICBpZiAoa2V5MS5sZW5ndGggIT09IHRoaXMuX3NvcnRTcGVjUGFydHMubGVuZ3RoIHx8XG4gICAgICAgIGtleTIubGVuZ3RoICE9PSB0aGlzLl9zb3J0U3BlY1BhcnRzLmxlbmd0aCkge1xuICAgICAgdGhyb3cgRXJyb3IoJ0tleSBoYXMgd3JvbmcgbGVuZ3RoJyk7XG4gICAgfVxuXG4gICAgcmV0dXJuIHRoaXMuX2tleUNvbXBhcmF0b3Ioa2V5MSwga2V5Mik7XG4gIH1cblxuICAvLyBJdGVyYXRlcyBvdmVyIGVhY2ggcG9zc2libGUgXCJrZXlcIiBmcm9tIGRvYyAoaWUsIG92ZXIgZWFjaCBicmFuY2gpLCBjYWxsaW5nXG4gIC8vICdjYicgd2l0aCB0aGUga2V5LlxuICBfZ2VuZXJhdGVLZXlzRnJvbURvYyhkb2MsIGNiKSB7XG4gICAgaWYgKHRoaXMuX3NvcnRTcGVjUGFydHMubGVuZ3RoID09PSAwKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoJ2NhblxcJ3QgZ2VuZXJhdGUga2V5cyB3aXRob3V0IGEgc3BlYycpO1xuICAgIH1cblxuICAgIGNvbnN0IHBhdGhGcm9tSW5kaWNlcyA9IGluZGljZXMgPT4gYCR7aW5kaWNlcy5qb2luKCcsJyl9LGA7XG5cbiAgICBsZXQga25vd25QYXRocyA9IG51bGw7XG5cbiAgICAvLyBtYXBzIGluZGV4IC0+ICh7JycgLT4gdmFsdWV9IG9yIHtwYXRoIC0+IHZhbHVlfSlcbiAgICBjb25zdCB2YWx1ZXNCeUluZGV4QW5kUGF0aCA9IHRoaXMuX3NvcnRTcGVjUGFydHMubWFwKHNwZWMgPT4ge1xuICAgICAgLy8gRXhwYW5kIGFueSBsZWFmIGFycmF5cyB0aGF0IHdlIGZpbmQsIGFuZCBpZ25vcmUgdGhvc2UgYXJyYXlzXG4gICAgICAvLyB0aGVtc2VsdmVzLiAgKFdlIG5ldmVyIHNvcnQgYmFzZWQgb24gYW4gYXJyYXkgaXRzZWxmLilcbiAgICAgIGxldCBicmFuY2hlcyA9IGV4cGFuZEFycmF5c0luQnJhbmNoZXMoc3BlYy5sb29rdXAoZG9jKSwgdHJ1ZSk7XG5cbiAgICAgIC8vIElmIHRoZXJlIGFyZSBubyB2YWx1ZXMgZm9yIGEga2V5IChlZywga2V5IGdvZXMgdG8gYW4gZW1wdHkgYXJyYXkpLFxuICAgICAgLy8gcHJldGVuZCB3ZSBmb3VuZCBvbmUgdW5kZWZpbmVkIHZhbHVlLlxuICAgICAgaWYgKCFicmFuY2hlcy5sZW5ndGgpIHtcbiAgICAgICAgYnJhbmNoZXMgPSBbeyB2YWx1ZTogdm9pZCAwIH1dO1xuICAgICAgfVxuXG4gICAgICBjb25zdCBlbGVtZW50ID0gT2JqZWN0LmNyZWF0ZShudWxsKTtcbiAgICAgIGxldCB1c2VkUGF0aHMgPSBmYWxzZTtcblxuICAgICAgYnJhbmNoZXMuZm9yRWFjaChicmFuY2ggPT4ge1xuICAgICAgICBpZiAoIWJyYW5jaC5hcnJheUluZGljZXMpIHtcbiAgICAgICAgICAvLyBJZiB0aGVyZSBhcmUgbm8gYXJyYXkgaW5kaWNlcyBmb3IgYSBicmFuY2gsIHRoZW4gaXQgbXVzdCBiZSB0aGVcbiAgICAgICAgICAvLyBvbmx5IGJyYW5jaCwgYmVjYXVzZSB0aGUgb25seSB0aGluZyB0aGF0IHByb2R1Y2VzIG11bHRpcGxlIGJyYW5jaGVzXG4gICAgICAgICAgLy8gaXMgdGhlIHVzZSBvZiBhcnJheXMuXG4gICAgICAgICAgaWYgKGJyYW5jaGVzLmxlbmd0aCA+IDEpIHtcbiAgICAgICAgICAgIHRocm93IEVycm9yKCdtdWx0aXBsZSBicmFuY2hlcyBidXQgbm8gYXJyYXkgdXNlZD8nKTtcbiAgICAgICAgICB9XG5cbiAgICAgICAgICBlbGVtZW50WycnXSA9IGJyYW5jaC52YWx1ZTtcbiAgICAgICAgICByZXR1cm47XG4gICAgICAgIH1cblxuICAgICAgICB1c2VkUGF0aHMgPSB0cnVlO1xuXG4gICAgICAgIGNvbnN0IHBhdGggPSBwYXRoRnJvbUluZGljZXMoYnJhbmNoLmFycmF5SW5kaWNlcyk7XG5cbiAgICAgICAgaWYgKGhhc093bi5jYWxsKGVsZW1lbnQsIHBhdGgpKSB7XG4gICAgICAgICAgdGhyb3cgRXJyb3IoYGR1cGxpY2F0ZSBwYXRoOiAke3BhdGh9YCk7XG4gICAgICAgIH1cblxuICAgICAgICBlbGVtZW50W3BhdGhdID0gYnJhbmNoLnZhbHVlO1xuXG4gICAgICAgIC8vIElmIHR3byBzb3J0IGZpZWxkcyBib3RoIGdvIGludG8gYXJyYXlzLCB0aGV5IGhhdmUgdG8gZ28gaW50byB0aGVcbiAgICAgICAgLy8gZXhhY3Qgc2FtZSBhcnJheXMgYW5kIHdlIGhhdmUgdG8gZmluZCB0aGUgc2FtZSBwYXRocy4gIFRoaXMgaXNcbiAgICAgICAgLy8gcm91Z2hseSB0aGUgc2FtZSBjb25kaXRpb24gdGhhdCBtYWtlcyBNb25nb0RCIHRocm93IHRoaXMgc3RyYW5nZVxuICAgICAgICAvLyBlcnJvciBtZXNzYWdlLiAgZWcsIHRoZSBtYWluIHRoaW5nIGlzIHRoYXQgaWYgc29ydCBzcGVjIGlzIHthOiAxLFxuICAgICAgICAvLyBiOjF9IHRoZW4gYSBhbmQgYiBjYW5ub3QgYm90aCBiZSBhcnJheXMuXG4gICAgICAgIC8vXG4gICAgICAgIC8vIChJbiBNb25nb0RCIGl0IHNlZW1zIHRvIGJlIE9LIHRvIGhhdmUge2E6IDEsICdhLngueSc6IDF9IHdoZXJlICdhJ1xuICAgICAgICAvLyBhbmQgJ2EueC55JyBhcmUgYm90aCBhcnJheXMsIGJ1dCB3ZSBkb24ndCBhbGxvdyB0aGlzIGZvciBub3cuXG4gICAgICAgIC8vICNOZXN0ZWRBcnJheVNvcnRcbiAgICAgICAgLy8gWFhYIGFjaGlldmUgZnVsbCBjb21wYXRpYmlsaXR5IGhlcmVcbiAgICAgICAgaWYgKGtub3duUGF0aHMgJiYgIWhhc093bi5jYWxsKGtub3duUGF0aHMsIHBhdGgpKSB7XG4gICAgICAgICAgdGhyb3cgRXJyb3IoJ2Nhbm5vdCBpbmRleCBwYXJhbGxlbCBhcnJheXMnKTtcbiAgICAgICAgfVxuICAgICAgfSk7XG5cbiAgICAgIGlmIChrbm93blBhdGhzKSB7XG4gICAgICAgIC8vIFNpbWlsYXJseSB0byBhYm92ZSwgcGF0aHMgbXVzdCBtYXRjaCBldmVyeXdoZXJlLCB1bmxlc3MgdGhpcyBpcyBhXG4gICAgICAgIC8vIG5vbi1hcnJheSBmaWVsZC5cbiAgICAgICAgaWYgKCFoYXNPd24uY2FsbChlbGVtZW50LCAnJykgJiZcbiAgICAgICAgICAgIE9iamVjdC5rZXlzKGtub3duUGF0aHMpLmxlbmd0aCAhPT0gT2JqZWN0LmtleXMoZWxlbWVudCkubGVuZ3RoKSB7XG4gICAgICAgICAgdGhyb3cgRXJyb3IoJ2Nhbm5vdCBpbmRleCBwYXJhbGxlbCBhcnJheXMhJyk7XG4gICAgICAgIH1cbiAgICAgIH0gZWxzZSBpZiAodXNlZFBhdGhzKSB7XG4gICAgICAgIGtub3duUGF0aHMgPSB7fTtcblxuICAgICAgICBPYmplY3Qua2V5cyhlbGVtZW50KS5mb3JFYWNoKHBhdGggPT4ge1xuICAgICAgICAgIGtub3duUGF0aHNbcGF0aF0gPSB0cnVlO1xuICAgICAgICB9KTtcbiAgICAgIH1cblxuICAgICAgcmV0dXJuIGVsZW1lbnQ7XG4gICAgfSk7XG5cbiAgICBpZiAoIWtub3duUGF0aHMpIHtcbiAgICAgIC8vIEVhc3kgY2FzZTogbm8gdXNlIG9mIGFycmF5cy5cbiAgICAgIGNvbnN0IHNvbGVLZXkgPSB2YWx1ZXNCeUluZGV4QW5kUGF0aC5tYXAodmFsdWVzID0+IHtcbiAgICAgICAgaWYgKCFoYXNPd24uY2FsbCh2YWx1ZXMsICcnKSkge1xuICAgICAgICAgIHRocm93IEVycm9yKCdubyB2YWx1ZSBpbiBzb2xlIGtleSBjYXNlPycpO1xuICAgICAgICB9XG5cbiAgICAgICAgcmV0dXJuIHZhbHVlc1snJ107XG4gICAgICB9KTtcblxuICAgICAgY2Ioc29sZUtleSk7XG5cbiAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICBPYmplY3Qua2V5cyhrbm93blBhdGhzKS5mb3JFYWNoKHBhdGggPT4ge1xuICAgICAgY29uc3Qga2V5ID0gdmFsdWVzQnlJbmRleEFuZFBhdGgubWFwKHZhbHVlcyA9PiB7XG4gICAgICAgIGlmIChoYXNPd24uY2FsbCh2YWx1ZXMsICcnKSkge1xuICAgICAgICAgIHJldHVybiB2YWx1ZXNbJyddO1xuICAgICAgICB9XG5cbiAgICAgICAgaWYgKCFoYXNPd24uY2FsbCh2YWx1ZXMsIHBhdGgpKSB7XG4gICAgICAgICAgdGhyb3cgRXJyb3IoJ21pc3NpbmcgcGF0aD8nKTtcbiAgICAgICAgfVxuXG4gICAgICAgIHJldHVybiB2YWx1ZXNbcGF0aF07XG4gICAgICB9KTtcblxuICAgICAgY2Ioa2V5KTtcbiAgICB9KTtcbiAgfVxuXG4gIC8vIFJldHVybnMgYSBjb21wYXJhdG9yIHRoYXQgcmVwcmVzZW50cyB0aGUgc29ydCBzcGVjaWZpY2F0aW9uIChidXQgbm90XG4gIC8vIGluY2x1ZGluZyBhIHBvc3NpYmxlIGdlb3F1ZXJ5IGRpc3RhbmNlIHRpZS1icmVha2VyKS5cbiAgX2dldEJhc2VDb21wYXJhdG9yKCkge1xuICAgIGlmICh0aGlzLl9zb3J0RnVuY3Rpb24pIHtcbiAgICAgIHJldHVybiB0aGlzLl9zb3J0RnVuY3Rpb247XG4gICAgfVxuXG4gICAgLy8gSWYgd2UncmUgb25seSBzb3J0aW5nIG9uIGdlb3F1ZXJ5IGRpc3RhbmNlIGFuZCBubyBzcGVjcywganVzdCBzYXlcbiAgICAvLyBldmVyeXRoaW5nIGlzIGVxdWFsLlxuICAgIGlmICghdGhpcy5fc29ydFNwZWNQYXJ0cy5sZW5ndGgpIHtcbiAgICAgIHJldHVybiAoZG9jMSwgZG9jMikgPT4gMDtcbiAgICB9XG5cbiAgICByZXR1cm4gKGRvYzEsIGRvYzIpID0+IHtcbiAgICAgIGNvbnN0IGtleTEgPSB0aGlzLl9nZXRNaW5LZXlGcm9tRG9jKGRvYzEpO1xuICAgICAgY29uc3Qga2V5MiA9IHRoaXMuX2dldE1pbktleUZyb21Eb2MoZG9jMik7XG4gICAgICByZXR1cm4gdGhpcy5fY29tcGFyZUtleXMoa2V5MSwga2V5Mik7XG4gICAgfTtcbiAgfVxuXG4gIC8vIEZpbmRzIHRoZSBtaW5pbXVtIGtleSBmcm9tIHRoZSBkb2MsIGFjY29yZGluZyB0byB0aGUgc29ydCBzcGVjcy4gIChXZSBzYXlcbiAgLy8gXCJtaW5pbXVtXCIgaGVyZSBidXQgdGhpcyBpcyB3aXRoIHJlc3BlY3QgdG8gdGhlIHNvcnQgc3BlYywgc28gXCJkZXNjZW5kaW5nXCJcbiAgLy8gc29ydCBmaWVsZHMgbWVhbiB3ZSdyZSBmaW5kaW5nIHRoZSBtYXggZm9yIHRoYXQgZmllbGQuKVxuICAvL1xuICAvLyBOb3RlIHRoYXQgdGhpcyBpcyBOT1QgXCJmaW5kIHRoZSBtaW5pbXVtIHZhbHVlIG9mIHRoZSBmaXJzdCBmaWVsZCwgdGhlXG4gIC8vIG1pbmltdW0gdmFsdWUgb2YgdGhlIHNlY29uZCBmaWVsZCwgZXRjXCIuLi4gaXQncyBcImNob29zZSB0aGVcbiAgLy8gbGV4aWNvZ3JhcGhpY2FsbHkgbWluaW11bSB2YWx1ZSBvZiB0aGUga2V5IHZlY3RvciwgYWxsb3dpbmcgb25seSBrZXlzIHdoaWNoXG4gIC8vIHlvdSBjYW4gZmluZCBhbG9uZyB0aGUgc2FtZSBwYXRoc1wiLiAgaWUsIGZvciBhIGRvYyB7YTogW3t4OiAwLCB5OiA1fSwge3g6XG4gIC8vIDEsIHk6IDN9XX0gd2l0aCBzb3J0IHNwZWMgeydhLngnOiAxLCAnYS55JzogMX0sIHRoZSBvbmx5IGtleXMgYXJlIFswLDVdIGFuZFxuICAvLyBbMSwzXSwgYW5kIHRoZSBtaW5pbXVtIGtleSBpcyBbMCw1XTsgbm90YWJseSwgWzAsM10gaXMgTk9UIGEga2V5LlxuICBfZ2V0TWluS2V5RnJvbURvYyhkb2MpIHtcbiAgICBsZXQgbWluS2V5ID0gbnVsbDtcblxuICAgIHRoaXMuX2dlbmVyYXRlS2V5c0Zyb21Eb2MoZG9jLCBrZXkgPT4ge1xuICAgICAgaWYgKG1pbktleSA9PT0gbnVsbCkge1xuICAgICAgICBtaW5LZXkgPSBrZXk7XG4gICAgICAgIHJldHVybjtcbiAgICAgIH1cblxuICAgICAgaWYgKHRoaXMuX2NvbXBhcmVLZXlzKGtleSwgbWluS2V5KSA8IDApIHtcbiAgICAgICAgbWluS2V5ID0ga2V5O1xuICAgICAgfVxuICAgIH0pO1xuXG4gICAgcmV0dXJuIG1pbktleTtcbiAgfVxuXG4gIF9nZXRQYXRocygpIHtcbiAgICByZXR1cm4gdGhpcy5fc29ydFNwZWNQYXJ0cy5tYXAocGFydCA9PiBwYXJ0LnBhdGgpO1xuICB9XG5cbiAgLy8gR2l2ZW4gYW4gaW5kZXggJ2knLCByZXR1cm5zIGEgY29tcGFyYXRvciB0aGF0IGNvbXBhcmVzIHR3byBrZXkgYXJyYXlzIGJhc2VkXG4gIC8vIG9uIGZpZWxkICdpJy5cbiAgX2tleUZpZWxkQ29tcGFyYXRvcihpKSB7XG4gICAgY29uc3QgaW52ZXJ0ID0gIXRoaXMuX3NvcnRTcGVjUGFydHNbaV0uYXNjZW5kaW5nO1xuXG4gICAgcmV0dXJuIChrZXkxLCBrZXkyKSA9PiB7XG4gICAgICBjb25zdCBjb21wYXJlID0gTG9jYWxDb2xsZWN0aW9uLl9mLl9jbXAoa2V5MVtpXSwga2V5MltpXSk7XG4gICAgICByZXR1cm4gaW52ZXJ0ID8gLWNvbXBhcmUgOiBjb21wYXJlO1xuICAgIH07XG4gIH1cbn1cblxuLy8gR2l2ZW4gYW4gYXJyYXkgb2YgY29tcGFyYXRvcnNcbi8vIChmdW5jdGlvbnMgKGEsYiktPihuZWdhdGl2ZSBvciBwb3NpdGl2ZSBvciB6ZXJvKSksIHJldHVybnMgYSBzaW5nbGVcbi8vIGNvbXBhcmF0b3Igd2hpY2ggdXNlcyBlYWNoIGNvbXBhcmF0b3IgaW4gb3JkZXIgYW5kIHJldHVybnMgdGhlIGZpcnN0XG4vLyBub24temVybyB2YWx1ZS5cbmZ1bmN0aW9uIGNvbXBvc2VDb21wYXJhdG9ycyhjb21wYXJhdG9yQXJyYXkpIHtcbiAgcmV0dXJuIChhLCBiKSA9PiB7XG4gICAgZm9yIChsZXQgaSA9IDA7IGkgPCBjb21wYXJhdG9yQXJyYXkubGVuZ3RoOyArK2kpIHtcbiAgICAgIGNvbnN0IGNvbXBhcmUgPSBjb21wYXJhdG9yQXJyYXlbaV0oYSwgYik7XG4gICAgICBpZiAoY29tcGFyZSAhPT0gMCkge1xuICAgICAgICByZXR1cm4gY29tcGFyZTtcbiAgICAgIH1cbiAgICB9XG5cbiAgICByZXR1cm4gMDtcbiAgfTtcbn1cbiJdfQ==
