'use strict';

(function (angular) {
  var ngEpoch = angular.module('ng.epoch', []);

  var allOptions = {
    options: '=',
    chartAxes: '=',
    chartTicks: '=',
    chartTickFormats: '=',
    chartDomain: '=',
    chartRange: '=',
    chartMargins: '=',
    chartMargin: '=',
    chartInner: '=',
    chartWidth: '=',
    chartHeight: '=',
    chartData: '=',
    chartClass: '=',
    chartOrientation: '=',
    chartPadding: '=',
    chartOuterPadding: '=',
    chartRadius: '=',
    chartFps: '=',
    chartFormat: '=',
    chartWindowSize: '=',
    chartHistorySize: '=',
    chartQueueSize: '=',
    chartPixelRatio: '=',
    chartBuckets: '=',
    chartBucketRange: '=',
    chartBucketPadding: '=',
    chartOpacity: '=',
    chartPaintZeroValues: '=',
    chartStream: '=',
    gaugeValue: '=',
    gaugeDialSize: '=',
    gaugeFormat: '=',
    gaugeStream: '='
  };

  var baseDirective = {
    restrict: 'EA',
    replace: true,
    template: '<div class="epoch"></div>',
    scope: angular.copy(allOptions),
    controller: 'epochController'
  };

  ngEpoch.controller('epochController', function ($scope, $compile) {
    $scope.me;
    $scope.filterOptions = function () {
      var results = {};
      angular.forEach($scope, function (v, k) {
        if ( (k.indexOf('chart') === 0 || k.indexOf('gauge') === 0) &&
             (k !== 'chartClass' && k !== 'gaugeDialSize') ) {
          if (v) {
            var key = k.substring(5);
            var newKey = key.charAt(0).toLowerCase() + key.slice(1);
            this[newKey] = v;
          }
        }
      }, results);
      return results;
    };
    $scope.renderEpoch = function ($element, options) {
      $scope.me = $element.epoch(options);
      $compile($scope.me)($scope);
      return $scope.me;
    };
    $scope.$watch('chartStream', function (newVal) {
      if (newVal) { $scope.me.push($scope.chartStream); }
    }, true);
    $scope.$watch('gaugeStream', function (newVal) {
      if (newVal) { $scope.me.update($scope.gaugeStream); }
    }, true);
  });

  ngEpoch.directive('epochArea', function ($compile) {
    var areaFunction = function (scope, elem, attr) {
      if (scope.chartClass) { elem.addClass(scope.chartClass); }
      var options = scope.filterOptions();
      options.type = 'area';
      elem.epoch(options);
      $compile(elem)(scope);
    };
    return angular.extend(angular.copy(baseDirective), {link: areaFunction});
  });

  ngEpoch.directive('epochLiveArea', function () {
    var liveAreaFunction = function (scope, elem, attr) {
      if (scope.chartClass) { elem.addClass(scope.chartClass); }
      var options = scope.filterOptions();
      options.type = 'time.area';
      var liveArea = scope.renderEpoch(elem, options);
    };
    return angular.extend(angular.copy(baseDirective), {link: liveAreaFunction});
  });

  ngEpoch.directive('epochBar', function ($compile) {
    var barFunction = function (scope, elem, attr) {
      if (scope.chartClass) { elem.addClass(scope.chartClass); }
      var options = scope.filterOptions();
      options.type = 'bar';
      elem.epoch(options);
      $compile(elem)(scope);
    };
    return angular.extend(angular.copy(baseDirective), {link: barFunction});
  });

  ngEpoch.directive('epochLiveBar', function () {
    var liveBarFunction = function (scope, elem, attr) {
      if (scope.chartClass) { elem.addClass(scope.chartClass); }
      var options = scope.filterOptions();
      options.type = 'time.bar';
      var liveBar = scope.renderEpoch(elem, options);
    };
    return angular.extend(angular.copy(baseDirective), {link: liveBarFunction});
  });

  ngEpoch.directive('epochLine', function ($compile) {
    var lineFunction = function (scope, elem, attr) {
      if (scope.chartClass) { elem.addClass(scope.chartClass); }
      var options = scope.filterOptions();
      options.type = 'line';
      elem.epoch(options);
      $compile(elem)(scope);
    };
    return angular.extend(angular.copy(baseDirective), {link: lineFunction});
  });

  ngEpoch.directive('epochLiveLine', function () {
    var liveLineFunction = function (scope, elem, attr) {
      if (scope.chartClass) { elem.addClass(scope.chartClass); }
      var options = scope.filterOptions();
      options.type = 'time.line';
      var liveLine = scope.renderEpoch(elem, options);
    };
    return angular.extend(angular.copy(baseDirective), {link: liveLineFunction});
  });

  ngEpoch.directive('epochPie', function ($compile) {
    var pieFunction = function (scope, elem, attr) {
      if (scope.chartClass) { elem.addClass(scope.chartClass); }
      var options = scope.filterOptions();
      options.type = 'pie';
      elem.epoch(options);
      $compile(elem)(scope);
    };
    return angular.extend(angular.copy(baseDirective), {link: pieFunction});
  });

  ngEpoch.directive('epochScatter', function ($compile) {
    var linkFunction = function (scope, elem, attr) {
      if (scope.chartClass) { elem.addClass(scope.chartClass); }
      var options = scope.filterOptions();
      options.type = 'scatter';
      elem.epoch(options);
      $compile(elem)(scope);
    };
    return angular.extend(angular.copy(baseDirective), {link: linkFunction});
  });

  ngEpoch.directive('epochGauge', function () {
    var gaugeFunction = function (scope, elem, attr) {
      if (scope.chartClass) { elem.addClass(scope.chartClass); }
      var gClass = (scope.gaugeDialSize) ? scope.gaugeDialSize : 'gauge-small';
      elem.addClass(gClass);
      var options = scope.filterOptions();
      options.type = 'time.gauge';
      var gauge = scope.renderEpoch(elem, options);
    };
    return angular.extend(angular.copy(baseDirective), {link: gaugeFunction});
  });

  ngEpoch.directive('epochHeatmap', function () {
    var heatmapFunction = function (scope, elem, attr) {
      if (scope.chartClass) { elem.addClass(scope.chartClass); }
      var options = scope.filterOptions();
      options.type = 'time.heatmap';
      var heatmap = scope.renderEpoch(elem, options);
    };
    return angular.extend(angular.copy(baseDirective), {link: heatmapFunction});
  });

})(angular);
