

CodeMirror.defineMode("mxl", function (config, parserConfig) {
    var indentUnit = config.indentUnit;
    var statementIndent = parserConfig.statementIndent;
    // Tokenizer
    
    var keywords = function(){
        function kw(type){
            return {
                type: type,
                style: "keyword"
            };
        }
        var A = kw("keyword a"), B = kw("keyword b"), C = kw("keyword c");
        var operator = kw("operator"), atom = {
            type: "atom",
            style: "atom"
        };
        
        var mxlKeywords = {
            "if": kw("if"),
            "then": kw("then"),
            "else": kw("else"),
            "is": kw("is"),
            "as": kw("as"),
            "null": kw("null"),
            "true": kw("bool"),
            "false": kw("bool"),
            "this": kw("this"),
            "let": kw("let"),
            "in": kw("in"),
            "find": kw("find"),
            "not": kw("not"),
            "and": kw("and"),
            "or": kw("or"),
            "get": kw("get"),
            "whereis": kw("whereis")
        };
        
        return mxlKeywords;
    }();
    
    var old = /[-=:,.+*\/|]<>!^/;
    var isOperatorChar =  /[+\-*/=<>:^]/; 
	
    function chain(stream, state, f){
        state.tokenize = f;
        return f(stream, state);
    }
    
    function nextUntilUnescaped(stream, end){
        var escaped = false, next;
        while ((next = stream.next()) != null) {
            if (next == end && !escaped) 
                return false;
            escaped = !escaped && next == "\\";
        }
        return escaped;
    }
    
    // Used as scratch variables to communicate multiple values without
    // consing up tons of objects.
    var type, content;
    function ret(tp, style, cont){
        type = tp;
        content = cont;
        return style;
    }
    function mxlTokenBase(stream, state){
        var ch = stream.next();
        if (ch == '"') 
            return chain(stream, state, mxlTokenString());
        else 
            if (ch == "'") 
                return chain(stream, state, mxlTokenQuot());
            else 
                if (ch == "." && stream.match(/^\d+(?:[eE][+\-]?\d+)?/)) 
                    return ret("number", "number");
                else 
                    if (/[\[\]{}\(\),;\:\.]/.test(ch)) 
                        return ret(ch);
                    else 
                        if (ch == "0" && stream.eat(/x/i)) {
                            stream.eatWhile(/[\da-f]/i);
                            return ret("number", "number");
                        }
                        else 
                            if (/\d/.test(ch)) {
                                stream.match(/^\d*(?:\.\d*)?(?:[eE][+\-]?\d+)?/);
                                return ret("number", "number");
                            }
                            else 
                                if (ch == "/") {
                                    if (stream.eat("*")) {
                                        return chain(stream, state, mxlTokenComment);
                                    }
                                    else 
                                    
                                        if (state.lastType == "operator" || /^[\[{}\(,;:]$/.test(state.lastType)) {
                                            nextUntilUnescaped(stream, "/");
                                            stream.eatWhile(/[gimy]/); // 'y' is "sticky" option in Mozilla
                                            return ret("regexp", "string-2");
                                        }
                                        else {
                                            stream.eatWhile(isOperatorChar);
                                            return ret("operator", null, stream.current());
                                        }
                                }
                                else 
                                    if (ch == "#") {
                                        stream.skipToEnd();
                                        return ret("error", "error");
                                    }
                                    else 
                                        if (isOperatorChar.test(ch)) {
                                            stream.eatWhile(isOperatorChar);
											
                                            return ret("operator", "operator", stream.current());
                                        }
                                        else {
                                            stream.eatWhile(/[\w\$_]/);
                                            var word = stream.current(), known = keywords.propertyIsEnumerable(word) && keywords[word];
											
                                            return (known) ? ret(known.type, known.style, word) : ret("variable", "variable", word);
                                        }
    }
    
    function mxlTokenString(){
        return function(stream, state){
            if (!nextUntilUnescaped(stream, '"')) 
                state.tokenize = mxlTokenBase;
            return ret("string", "string");
        };
    }
    
    function mxlTokenQuot(){
        return function(stream, state){
            if (!nextUntilUnescaped(stream, "'")) 
                state.tokenize = mxlTokenBase;
            return ret("quoted", "quoted");
        };
    }
    
    function mxlTokenComment(stream, state){
        var maybeEnd = false, ch;
        while (ch = stream.next()) {
            if (ch == "/" && maybeEnd) {
                state.tokenize = mxlTokenBase;
                break;
            }
            maybeEnd = (ch == "*");
        }
        return ret("comment", "comment");
    }
    
    // Parser
    
    var atomicTypes = {
        "atom": true,
        "number": true,
        "variable": true,
		"operator": true,
        "string": true,
        "regexp": true,
        "this": true
    };
    
    function MXLLexical(indented, column, type, align, prev, info){
        this.indented = indented;
        this.column = column;
        this.type = type;
        this.prev = prev;
        this.info = info;
        if (align != null) 
            this.align = align;
    }
    
    function inScope(state, varname){
        for (var v = state.localVars; v; v = v.next) 
            if (v.name == varname) 
                return true;
    }
    
    function parseMXL(state, style, type, content, stream){
        var cc = state.cc;
        // Communicate our context to the combinators.
        // (Less wasteful than consing up a hundred closures on every call.)
        cx.state = state;
        cx.stream = stream;
        cx.marked = null, cx.cc = cc;
        
        if (!state.lexical.hasOwnProperty("align")) 
            state.lexical.align = true;
        
        while (true) {
            var combinator = cc.length ? cc.pop() : statement;
            if (combinator(type, content)) {
                while (cc.length && cc[cc.length - 1].lex) 
                    cc.pop()();
                if (cx.marked) 
                    return cx.marked;
                if (type == "variable" && inScope(state, content)) 
                    return "variable-2";
                return style;
            }
        }
    }
    
    // Combinator utils
    
    var cx = {
        state: null,
        column: null,
        marked: null,
        cc: null
    };
    function pass(){
        for (var i = arguments.length - 1; i >= 0; i--) 
            cx.cc.push(arguments[i]);
    }
    function cont(){
        pass.apply(null, arguments);
        return true;
    }
    function register(varname){
        function inList(list){
            for (var v = list; v; v = v.next) 
                if (v.name == varname) 
                    return true;
            return false;
        }
        var state = cx.state;
        if (state.context) {
            cx.marked = "def";
            if (inList(state.localVars)) 
                return;
            state.localVars = {
                name: varname,
                next: state.localVars
            };
        }
        else {
            if (inList(state.globalVars)) 
                return;
            state.globalVars = {
                name: varname,
                next: state.globalVars
            };
        }
    }
    
    // Combinators
    
    var defaultVars = {
        name: "this",
        next: {
            name: "arguments"
        }
    };
    function pushcontext(){
        cx.state.context = {
            prev: cx.state.context,
            vars: cx.state.localVars
        };
        cx.state.localVars = defaultVars;
    }
    function popcontext(){
        cx.state.localVars = cx.state.context.vars;
        cx.state.context = cx.state.context.prev;
    }
    function pushlex(type, info){
        var result = function(){
            var state = cx.state, indent = state.indented;
            if (state.lexical.type == "stat") 
                indent = state.lexical.indented;
            state.lexical = new MXLLexical(indent, cx.stream.column(), type, null, state.lexical, info);
        };
        result.lex = true;
        return result;
    }
    function poplex(){
        var state = cx.state;
        if (state.lexical.prev) {
            if (state.lexical.type == ")") 
                state.indented = state.lexical.indented;
            state.lexical = state.lexical.prev;
        }
    }
    poplex.lex = true;
    
    function expect(wanted){
        return function(type){
            if (type == wanted) 
                return cont();
            else 
                if (wanted == ";") 
                    return pass();
                else 
                    return cont(arguments.callee);
        };
    }
    
    function statement(type){
        if (type == "let") 
            return cont(pushlex("vardef"), vardef1, expect("in"), poplex);
        if (type == "keyword a") 
            return cont(pushlex("form"), expression, statement, poplex);
        if (type == "keyword b") 
            return cont(pushlex("form"), statement, poplex);
        if (type == "{") 
            return cont(pushlex("}"), block, poplex);
        if (type == "if") 
            return cont(pushlex("form"), expression, statement, statement, poplex);
        return pass(pushlex("stat"), expression, expect(";"), poplex);
    }
    function expression(type){
        return expressionInner(type, false);
    }
    function expressionNoComma(type){
        return expressionInner(type, true);
    }
    function expressionInner(type, noComma){
        var maybeop = noComma ? maybeoperatorNoComma : maybeoperatorComma;
        if (atomicTypes.hasOwnProperty(type)) 
            return cont(maybeop);
        
        if (type == "keyword c") 
            return cont(noComma ? maybeexpressionNoComma : maybeexpression);
        if (type == "(") 
            return cont(pushlex(")"), maybeexpression, expect(")"), poplex, maybeop);
        if (type == "operator") 
            return cont(noComma ? expressionNoComma : expression);
        if (type == "[") 
            return cont(pushlex("]"), commasep(expressionNoComma, "]"), poplex, maybeop);
        if (type == "{") 
            return cont(pushlex("}"), commasep(objprop, "}"), poplex, maybeop);
        return cont();
    }
    function maybeexpression(type){
        if (type.match(/[;\}\)\],]/)) 
            return pass();
        return pass(expression);
    }
    function maybeexpressionNoComma(type){
        if (type.match(/[;\}\)\],]/)) 
            return pass();
        return pass(expressionNoComma);
    }
    
    function maybeoperatorComma(type, value){
        if (type == ",") 
            return cont(expression);
        return maybeoperatorNoComma(type, value, false);
    }
    function maybeoperatorNoComma(type, value, noComma){
        var me = noComma == false ? maybeoperatorComma : maybeoperatorNoComma;
        var expr = noComma == false ? expression : expressionNoComma;
        if (type == "operator") {
            if (/\+\+|--/.test(value)) 
                return cont(me);
            if (value == "?") 
                return cont(expression, expect(":"), expr);
            return cont(expr);
        }
        if (type == ";") 
            return;
        if (type == "(") 
            return cont(pushlex(")", "call"), commasep(expressionNoComma, ")"), poplex, me);
        if (type == ".") 
            return cont(property, me);
        if (type == "[") 
            return cont(pushlex("]"), maybeexpression, expect("]"), poplex, me);
    }
    function maybelabel(type){
        if (type == ":") 
            return cont(poplex, statement);
        return pass(maybeoperatorComma, expect(";"), poplex);
    }
    function property(type){
        if (type == "variable") {
            cx.marked = "property";
            return cont();
        }
    }
    function objprop(type, value){
        if (type == "variable") {
            cx.marked = "property";
            if (value == "get" || value == "set") 
                return cont(getterSetter);
        }
        else 
            if (type == "number" || type == "string") {
                cx.marked = type + " property";
            }
        if (atomicTypes.hasOwnProperty(type)) 
            return cont(expect(":"), expressionNoComma);
    }
    function getterSetter(type){
        if (type == ":") 
            return cont(expression);
        if (type != "variable") 
            return cont(expect(":"), expression);
        cx.marked = "property";
        return cont(functiondef);
    }
    function commasep(what, end){
        function proceed(type){
            if (type == ",") {
                var lex = cx.state.lexical;
                if (lex.info == "call") 
                    lex.pos = (lex.pos || 0) + 1;
                return cont(what, proceed);
            }
            if (type == end) 
                return cont();
            return cont(expect(end));
        }
        return function(type){
            if (type == end) 
                return cont();
            else 
                return pass(what, proceed);
        };
    }
    function block(type){
        if (type == "}") 
            return cont();
        return pass(statement, block);
    }
    function maybetype(type){
        if (type == ":") 
            return cont(typedef);
        return pass();
    }
    function typedef(type){
        if (type == "variable") {
            cx.marked = "variable-3";
            return cont();
        }
        return pass();
    }
    function vardef1(type, value){
        if (type == "variable") {
            register(value);
            return cont(vardef2);
        }
        return pass();
    }
    function vardef2(type, value){
        if (value == "=") 
            return cont(expressionNoComma, vardef2);
        if (type == ",") 
            return cont(vardef1);
    }
    function maybeelse(type, value){
        if (type == "keyword b" && value == "else") 
            return cont(pushlex("form"), statement, poplex);
    }
    function forspec1(type){
        if (type == "var") 
            return cont(vardef1, expect(";"), forspec2);
        if (type == ";") 
            return cont(forspec2);
        if (type == "variable") 
            return cont(formaybein);
        return pass(expression, expect(";"), forspec2);
    }
    function formaybein(_type, value){
        if (value == "in") 
            return cont(expression);
        return cont(maybeoperatorComma, forspec2);
    }
    function forspec2(type, value){
        if (type == ";") 
            return cont(forspec3);
        if (value == "in") 
            return cont(expression);
        return pass(expression, expect(";"), forspec3);
    }
    function forspec3(type){
        if (type != ")") 
            cont(expression);
    }
    function functiondef(type, value){
        if (type == "variable") {
            register(value);
            return cont(functiondef);
        }
        if (type == "(") 
            return cont(pushlex(")"), pushcontext, commasep(funarg, ")"), poplex, statement, popcontext);
    }
    function funarg(type, value){
        if (type == "variable") {
            register(value);
            return cont();
        }
    }
    
    // Interface
    
    return {
        startState: function(basecolumn){
            return {
                tokenize: mxlTokenBase,
                lastType: null,
                cc: [],
                lexical: new MXLLexical((basecolumn || 0) - indentUnit, 0, "block", false),
                localVars: parserConfig.localVars,
                globalVars: parserConfig.globalVars,
                context: parserConfig.localVars &&
                {
                    vars: parserConfig.localVars
                },
                indented: 0
            };
        },
        
        token: function(stream, state){
            if (stream.sol()) {
                if (!state.lexical.hasOwnProperty("align")) 
                    state.lexical.align = false;
                state.indented = stream.indentation();
            }
            if (state.tokenize != mxlTokenComment && stream.eatSpace()) 
                return null;
            var style = state.tokenize(stream, state);
            if (type == "comment") 
                return style;
            state.lastType = type == "operator" && (content == "++" || content == "--") ? "incdec" : type;
            return parseMXL(state, style, type, content, stream);
        },
        
        indent: function(state, textAfter){
            if (state.tokenize == mxlTokenComment) 
                return CodeMirror.Pass;
            if (state.tokenize != mxlTokenBase) 
                return 0;
            var firstChar = textAfter && textAfter.charAt(0), lexical = state.lexical;
            // Kludge to prevent 'maybelse' from blocking lexical scope pops
            for (var i = state.cc.length - 1; i >= 0; --i) {
                var c = state.cc[i];
                if (c == poplex) 
                    lexical = lexical.prev;
                else 
                    if (c != maybeelse || /^else\b/.test(textAfter)) 
                        break;
            }
            if (lexical.type == "stat" && firstChar == "}") 
                lexical = lexical.prev;
            if (statementIndent && lexical.type == ")" && lexical.prev.type == "stat") 
                lexical = lexical.prev;
            var type = lexical.type, closing = firstChar == type;
            
            if (type == "vardef") 
                return lexical.indented + (state.lastType == "operator" || state.lastType == "," ? 4 : 0);
            else 
                if (type == "form" && firstChar == "{") 
                    return lexical.indented;
                else 
                    if (type == "form") 
                        return lexical.indented + indentUnit;
                    else 
                        if (type == "stat") 
                            return lexical.indented + (state.lastType == "operator" || state.lastType == "," ? statementIndent || indentUnit : 0);
                        else 
                            if (lexical.info == "switch" && !closing && parserConfig.doubleIndentSwitch != false) 
                                return lexical.indented + (/^(?:case|default)\b/.test(textAfter) ? indentUnit : 2 * indentUnit);
                            else 
                                if (lexical.align) 
                                    return lexical.column + (closing ? 0 : 1);
                                else 
                                    return lexical.indented + (closing ? 0 : indentUnit);
        },
        
        electricChars: ":{}",
        blockCommentStart:  "/*",
        blockCommentEnd:  "*/",
        fold: "brace",
        
        helperType:"mxl"
    };
});

CodeMirror.defineMIME("application/mxl", {
    name: "mxl"
});
