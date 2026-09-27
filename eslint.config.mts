import globals from 'globals'
import tseslint from 'typescript-eslint'
import reactHooks from 'eslint-plugin-react-hooks'

var nodeGlobalsOff = Object.fromEntries(Object.keys(globals.node).map(function(name) {
  return [name, 'off']
}))

var rules = {
    'accessor-pairs': 2
  , 'array-bracket-spacing': [2, 'never']
  , 'block-scoped-var': 2
  , 'block-spacing': [2, 'always']
  , 'brace-style': [2, 'stroustrup', {allowSingleLine: false}]
  , 'callback-return': 1
  , camelcase: [2, {properties: 'never'}]
  , 'comma-spacing': [2, {before: false, after: true}]
  , 'comma-style': [1, 'first']
  , 'computed-property-spacing': [2, 'never']
  , 'consistent-return': 1
  , 'consistent-this': [2, 'that']
  , 'constructor-super': 2
  , curly: 2
  , 'dot-location': [2, 'property']
  , 'dot-notation': 2
  , 'eol-last': 2
  , eqeqeq: [2, 'smart']
  , 'guard-for-in': 2
  , 'handle-callback-err': 1
  , 'jsx-quotes': [2, 'prefer-single']
  , 'key-spacing': [2, {beforeColon: false, afterColon: true, mode: 'strict'}]
  , 'lines-around-comment': [2, {beforeBlockComment: true, allowBlockStart: true}]
  , 'max-len': [2, 100, 2, {ignoreComments: true, ignoreUrls: true}]
  , 'max-nested-callbacks': [1, 5]
  , 'new-cap': [2, {capIsNewExceptionPattern: 'Service$'}]
  , 'new-parens': 2
  , 'no-alert': 1
  , 'no-array-constructor': 2
  , 'no-caller': 2
  , 'no-case-declarations': 2
  , 'no-class-assign': 2
  , 'no-compare-neg-zero': 2
  , 'no-cond-assign': 2
  , 'no-console': 2
  , 'no-const-assign': 2
  , 'no-constant-condition': 2
  , 'no-continue': 1
  , 'no-control-regex': 2
  , 'no-debugger': 2
  , 'no-delete-var': 2
  , 'no-div-regex': 2
  , 'no-dupe-args': 2
  , 'no-dupe-class-members': 2
  , 'no-dupe-keys': 2
  , 'no-duplicate-case': 2
  , 'no-empty': 2
  , 'no-empty-character-class': 2
  , 'no-empty-pattern': 2
  , 'no-eq-null': 2
  , 'no-eval': 2
  , 'no-ex-assign': 2
  , 'no-extend-native': 2
  , 'no-extra-bind': 2
  , 'no-extra-boolean-cast': 2
  , 'no-extra-semi': 2
  , 'no-fallthrough': 1
  , 'no-floating-decimal': 1
  , 'no-func-assign': 2
  , 'no-global-assign': 2
  , 'no-implicit-coercion': [2, {boolean: false, number: true, string: false}]
  , 'no-implied-eval': 2
  , 'no-inner-declarations': 2
  , 'no-invalid-regexp': 2
  , 'no-invalid-this': 1
  , 'no-irregular-whitespace': 2
  , 'no-iterator': 2
  , 'no-label-var': 2
  , 'no-labels': 2
  , 'no-lone-blocks': 2
  , 'no-loop-func': 2
  , 'no-mixed-spaces-and-tabs': 2
  , 'no-multi-spaces': 2
  , 'no-multi-str': 2
  , 'no-multiple-empty-lines': [1, {max: 2}]
  , 'no-native-reassign': 2
  , 'no-nested-ternary': 2
  , 'no-new': 2
  , 'no-new-func': 2
  , 'no-new-object': 2
  , 'no-new-require': 2
  , 'no-new-symbol': 2
  , 'no-new-wrappers': 2
  , 'no-obj-calls': 2
  , 'no-octal': 2
  , 'no-octal-escape': 2
  , 'no-param-reassign': 2
  , 'no-path-concat': 2
  , 'no-proto': 2
  , 'no-redeclare': [2, {builtinGlobals: true}]
  , 'no-regex-spaces': 2
  , 'no-return-assign': [1, 'except-parens']
  , 'no-script-url': 2
  , 'no-self-assign': 2
  , 'no-self-compare': 2
  , 'no-sequences': 2
  , 'no-shadow-restricted-names': 2
  , 'no-spaced-func': 2
  , 'no-sparse-arrays': 2
  , 'no-sync': 1
  , 'no-this-before-super': 2
  , 'no-throw-literal': 2
  , 'no-trailing-spaces': [2, {skipBlankLines: true}]
  , 'no-undef': 2
  , 'no-undefined': 1
  , 'no-unexpected-multiline': 2
  , 'no-unneeded-ternary': [2, {defaultAssignment: false}]
  , 'no-unreachable': 2
  , 'no-unsafe-finally': 2
  , 'no-unsafe-negation': 2
  , 'no-unused-expressions': 2
  , 'no-unused-labels': 2
  , 'no-unused-vars': [1, {varsIgnorePattern: '^_', caughtErrors: 'none'}]
  , 'no-use-before-define': 1
  , 'no-useless-call': 2
  , 'no-useless-concat': 2
  , 'no-useless-escape': 2
  , 'no-void': 2
  , 'no-with': 2
  , 'object-curly-spacing': [2, 'never']
  , 'one-var': [2, {uninitialized: 'always', initialized: 'never'}]
  , 'operator-assignment': [2, 'always']
  , 'operator-linebreak': [2, 'after']
  , 'padded-blocks': [2, 'never']
  , 'quote-props': [2, 'as-needed', {numbers: true}]
  , quotes: [2, 'single', 'avoid-escape']
  , radix: 1
  , 'require-yield': 2
  , semi: [2, 'never']
  , 'semi-spacing': [2, {before: false, after: true}]
  , 'space-before-blocks': [2, 'always']
  , 'space-before-function-paren': [2, 'never']
  , 'space-in-parens': [2, 'never']
  , 'space-infix-ops': 2
  , 'space-unary-ops': [2, {words: true, nonwords: false}]
  , 'spaced-comment': [1, 'always', {exceptions: ['/', '*']}]
  , 'use-isnan': 2
  , 'valid-typeof': 2
  , 'wrap-iife': [2, 'inside']
  , yoda: 2
}

var libTsRules = Object.assign({}, rules, {
    'no-invalid-this': 0
  , 'no-redeclare': 0
  , 'no-undef': 0
  , 'no-unused-vars': 0
  , '@typescript-eslint/no-unused-vars': [1, {argsIgnorePattern: '^_', varsIgnorePattern: '^_'
    , caughtErrors: 'none'}]
})

var tsRules = Object.assign({}, rules, {
    camelcase: 0
  , 'consistent-return': 0
  , 'max-len': [2, 120, 2, {ignoreComments: true, ignoreUrls: true, ignoreStrings: true
    , ignoreTemplateLiterals: true}]
  , 'new-cap': 0
  , 'no-invalid-this': 0
  , 'no-redeclare': 0
  , 'no-undef': 0
  , 'no-undefined': 0
  , 'no-unused-vars': 0
  , 'no-use-before-define': 0
  , 'one-var': 0
  , '@typescript-eslint/no-explicit-any': 0
  , '@typescript-eslint/no-unused-vars': [1, {argsIgnorePattern: '^_', varsIgnorePattern: '^_'
    , caughtErrors: 'none'}]
  , 'react-hooks/rules-of-hooks': 2
  , 'react-hooks/exhaustive-deps': 1
})

export default [
  {
    ignores: [
      'res/build/**'
    , 'tmp/**'
    , 'lib/**/*.js'
    , 'lib/types/wire.d.ts'
    , 'lib/types/stfservice-wire.d.ts'
    ]
  }
, {
    files: ['res/app/src/**/*.{ts,tsx}', 'res/app/*.ts']
  , languageOptions: {
      parser: tseslint.parser
    , parserOptions: {ecmaFeatures: {jsx: true}, sourceType: 'module'}
    , globals: Object.assign({}, globals.browser)
    }
  , plugins: {
      '@typescript-eslint': tseslint.plugin
    , 'react-hooks': reactHooks
    }
  , rules: tsRules
  }
, {
    files: ['lib/**/*.ts']
  , languageOptions: {
      parser: tseslint.parser
    , parserOptions: {sourceType: 'module'}
    , globals: Object.assign({}, globals.node)
    }
  , plugins: {
      '@typescript-eslint': tseslint.plugin
    }
  , rules: libTsRules
  }
, {
    files: [
      '*.{ts,mts}'
    , 'res/common/**/*.{ts,mts}'
    , 'test/**/*.mts'
    , 'test/playwright/**/*.ts'
    , '.github/scripts/**/*.mts'
    ]
  , languageOptions: {
      parser: tseslint.parser
    , parserOptions: {sourceType: 'module'}
    , globals: Object.assign({}, globals.node)
    }
  , plugins: {
      '@typescript-eslint': tseslint.plugin
    }
  , rules: libTsRules
  }
, {
    files: ['res/common/**/*.{ts,mts}']
  , languageOptions: {
      globals: Object.assign(
        {}
      , nodeGlobalsOff
      , globals.commonjs
      , globals.browser
      )
    }
  }
, {
    files: ['test/**/*.mts', 'test/playwright/**/*.ts']
  , languageOptions: {
      globals: Object.assign({}, globals.node, globals.mocha)
    }
  , rules: {
      'no-unused-expressions': 0
    , 'no-sync': 0
    }
  }
, {
    files: ['test/playwright/**/*.ts']
  , rules: {
      'no-console': 0
    , 'no-empty-pattern': [2, {allowObjectPatternsAsParameters: true}]
    }
  }
, {
    files: ['lib/wire/protobuf.ts']
  , rules: {
      'no-sync': 0
    }
  }
, {
    files: ['.github/scripts/**/*.mts']
  , rules: {
      'no-console': 0
    , 'no-nested-ternary': 0
    , 'no-sync': 0
    }
  }
, {
    files: ['build.mts']
  , rules: {
      'no-console': 0
    , 'no-sync': 0
    }
  }
]
