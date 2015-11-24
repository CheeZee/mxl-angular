'use strict';

angular.module('mxl', [])
.constant("mxlModes", {
    expression: "expression",
    type: "type",
    parameteres: "parameters"
})
.directive('mxlExpression', function ($timeout, $q, mxlModes) {
    return {
        templateUrl: 'statics/mxl-template.html',
        require: ["^ngModel"],
        scope:
            {
                expression: '=ngModel',
                readOnly: '@mxlReadonly',
                debounce: '@mxlDebounce',
                additionalHints: '=mxlAutocompletionhints',
                runTest: '&mxlRuntest',
                mode: '@mxlMode',
                validateMxl: '&mxlValidate'
            },
        link: function ($scope, $element, $attrs, ctrl) {
            function newCodemirrorEditor($element, codemirrorOptions) {
                var codemirror;
                var editor = $element.find('editor');
                codemirror = new window.CodeMirror(function (cm_el) {
                    editor.append(cm_el);
                    if ($attrs.class) {
                        cm_el.classList.add($attrs.class);
                    }

                    if ($attrs.style) {
                        cm_el.style.cssText = $attrs.style;
                        console.log(cm_el.style.height);
                    }
                }, codemirrorOptions);
                return codemirror;
            }

            function normalizeScopeValues() {
                if ($scope.mode) {
                    if ($scope.mode.toLowerCase() == mxlModes.type) {
                        $scope.mode = mxlModes.type;
                    } else if ($scope.mode.toLowerCase() == mxlModes.parameteres) {
                        $scope.mode = mxlModes.parameteres;
                    } else {
                        $scope.mode = mxlModes.expression;
                    }
                } else {
                    $scope.mode = mxlModes.expression;
                }

                $scope.readOnly = $scope.$eval($scope.readOnly);
                if (!$attrs.mxlValidate) {
                    $scope.validateMxl = null;
                }

                if (!$attrs.mxlRuntest || $scope.readOnly || $scope.mode != mxlModes.expression) {
                    $scope.runTest = null;
                }
            }

            function updateLints(currentError) {
                if ($scope.codemirror.options.updateMxLLints) {
                    $scope.codemirror.options.updateMxLLints($scope.codemirror, currentError);
                }
            }

            function removeCurrentTestPanel() {
                if ($scope.testResultWidget) {
                    $scope.testResultWidget.clear();
                }
                updateLints(null);
                $scope.codemirror.focus();
            }

            function addTestResult(result) {

                var node = document.createElement("div");
                node.className = "mxl-result-panel";

                var close = node.appendChild(document.createElement("span"));
                close.className = "mxl-result-panel-close";

                var content = node.appendChild(document.createElement("span"));

                if (result.status >= 400) {
                    content.innerHTML = "<b>" + (result.data.cause ? result.data.cause : "Error") + "</b><br/>"
                    content.innerHTML += result.data.message;
                    node.className += " alert alert-" + (result.data.cause === "MxLEvaluationException" ? "warning" : "danger");
                    updateLints(result.data);
                } else {
                    node.className += " alert alert-success";
                    content.innerHTML = "<b>Test result:</b><br/>"
                    content.innerHTML += "" + JSON.stringify(result.data.value, null, 2);
                }

                if ($scope.testResultWidget) {
                    $scope.testResultWidget.clear();
                }

                $scope.testResultWidget = $scope.codemirror.addPanel(node, { position: 'bottom' });
                CodeMirror.on(close, "click", function () {
                    removeCurrentTestPanel();
                });
            }

            function configNgModelLink(codemirror, ctrl, $scope) {

                ctrl.$formatters.push(function (value) {
                    if (angular.isUndefined(value) || value === null) {
                        return '';
                    }
                    return value;
                });

                ctrl.$render = function () {
                    codemirror.setValue(ctrl.$viewValue || '');
                };

                ctrl.$asyncValidators.typeChecking = function (modelValue, viewValue) {
                    if (viewValue.trim() === "") {
                        return $q.when();
                    }

                    if (codemirror.options.validateMxl) {
                        return codemirror.options.validateMxl(modelValue, viewValue);
                    }
                    return $q.when();
                };

                codemirror.cancelDebouncedUpdate = function () {
                    if ($scope.debounceUpdate) {
                        $timeout.cancel($scope.debounceUpdate);
                        $scope.debounceUpdate = null;
                    }
                }

                codemirror.forcedModelUpdate = function () {
                    codemirror.cancelDebouncedUpdate();

                    var newValue = codemirror.getValue();
                    if (newValue !== ctrl.$viewValue) {
                        $scope.$evalAsync(function () {
                            ctrl.$setViewValue(newValue);
                        });
                    }
                }

                codemirror.on('change', function (instance) {
                    removeCurrentTestPanel();
                    var newValue = instance.getValue();
                    if (newValue !== ctrl.$viewValue) {
                        if (codemirror.options.debounce) {
                            codemirror.cancelDebouncedUpdate();
                            $scope.$evalAsync(function () {
                                $scope.debounceUpdate = $timeout(function () {
                                    ctrl.$setViewValue(instance.getValue());
                                }, codemirror.options.debounce);
                            });
                        }
                        else {
                            $scope.$evalAsync(function () {
                                ctrl.$setViewValue(newValue);
                            });
                        }
                    }
                });

                codemirror.on('blur', function (instance) {
                    codemirror.forcedModelUpdate();
                });
            }

            normalizeScopeValues();

            var codemirrorOptions = {
                lineWrapping: true,
                matchBrackets: true,
                autoCloseBrackets: true,
                highlightSelectionMatches: { showToken: /\w/ },
                viewportMargin: Infinity,
                readOnly: $scope.readOnly,
                mode: 'mxl',
                gutters: ["CodeMirror-lint-markers"],
                lint: true,
                onlyLimitedHints: $scope.mode !== mxlModes.expression,
                debounce: $scope.debounce ? $scope.debounce : 2000,
                theme: 'mxl',
                extraKeys: {
                    "Ctrl-Space": "autocomplete",
                    "Tab": false,
                    "Shift-Tab": false,
                    "F11": function (cm) {
                        cm.setOption("fullScreen", !cm.getOption("fullScreen"));
                    },
                    "'.'": function (cm) {
                        $timeout(function () { cm.execCommand("autocomplete"); }, 100, false);
                        return CodeMirror.Pass;
                    },
                    "Esc": function (cm) {
                        if (cm.getOption("fullScreen")) {
                            cm.setOption("fullScreen", false);
                        }
                        removeCurrentTestPanel();
                        return CodeMirror.Pass;
                    }
                }
            };

            if ($scope.validateMxl) {
                codemirrorOptions.validateMxl = function (modelValue, viewValue) {
                    var def = $q.defer();
                    $q.when($scope.validateMxl({ modelValue: modelValue, viewValue: viewValue }))
                        .then(function (response) {
                            updateLints(null);
                            def.resolve();
                        }, function (response) {
                            updateLints(response.data);
                            def.reject();
                        });
                    return def.promise;
                };
            }

            if ($scope.runTest) {
                codemirrorOptions.extraKeys["Ctrl-Enter"] = function (cm) {
                    removeCurrentTestPanel();

                    $scope.codemirror.forcedModelUpdate();
                    $q.when($scope.runTest({ value: cm.getValue() }))
                    .then(function (response) {
                        addTestResult(response);
                    }, function (response) {
                        addTestResult(response);
                    });
                }
            }


            $scope.codemirror = newCodemirrorEditor($element, codemirrorOptions);

            configNgModelLink($scope.codemirror, ctrl[0], $scope);

            CodeMirror.commands.autocomplete = function (cmeditor) {
                var autoCompletionOptions = { completeSingle: false };

                if ($scope.additionalHints) {
                    cmeditor.options.additionalAutoCompletionHints = $scope.additionalHints;
                }

                CodeMirror.showHint(cmeditor, CodeMirror.hint.mxl, autoCompletionOptions);
            };
        }
    }
});