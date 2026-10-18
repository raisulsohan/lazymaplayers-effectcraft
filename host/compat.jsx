/*
 * LazyMapLayers for EffectCraft: fills gaps in EffectCraft's After Effects-style scripting and
 * expression API, so the unchanged LazyMapLayers host script runs on top. Loaded before the host
 * script; does nothing outside EffectCraft. Script fixes call EffectCraft's own engine commands
 * (undoable, saved in the .ecproj), never private data.
 *
 * Expression fixes apply only to expressions LazyMapLayers itself writes (compat-post.jsx wraps the
 * host's LML.pins.setExpression); the user's own expressions are never rewritten.
 */
var LMLEC = (function () {
    var self = { active: false, fixes: [] };
    try {
        self.active = String(app.version).indexOf("EffectCraft") >= 0;
    } catch (e) {
        self.active = false;
    }
    if (!self.active) return self;

    function fix(name, fn) {
        try {
            fn();
            self.fixes.push(name);
        } catch (e) {
            self.fixes.push(name + " (failed: " + e.message + ")");
        }
    }

    /** Wraps or adds the setter of an accessor property on a prototype. */
    function setter(proto, name, make) {
        var d = Object.getOwnPropertyDescriptor(proto, name);
        if (!d) throw new Error(name + " not found");
        Object.defineProperty(proto, name, { configurable: true, enumerable: d.enumerable, get: d.get, set: make(d.set) });
    }

    // Layer.comment can be read but not written (EffectCraft 0.8.0): every LML tag lives there.
    // EffectCraft 0.9.2 has the setter (storytold/effectcraft#808), and then it is used as it is.
    fix("Layer.comment setter", function () {
        setter(Layer.prototype, "comment", function (original) {
            if (original) return original;
            return function (v) {
                __call("layer.setComment", this.__p1({ comment: String(v) }));
            };
        });
    });

    /*
     * In EffectCraft 0.8.0 expressions, layer.source, layer.transform and fromComp() throw, and a
     * failing expression silently keeps the property's own value. layer.width / layer.height (the
     * source's size for a precomp layer), layer.scale and toComp() work, so generated expressions are
     * rewritten to those, and fromComp becomes the inverse of this layer's toComp (exact for 2D layers,
     * which is what LazyMapLayers puts paths and texts on).
     */
    var FROM_COMP = "var lmlEcT = null;\n" +
        "function lmlEcFromComp(p) {\n" +
        "  if (!lmlEcT) {\n" +
        "    var o = toComp([0, 0]), x = toComp([1, 0]), y = toComp([0, 1]);\n" +
        "    var a = x[0] - o[0], b = x[1] - o[1], c = y[0] - o[0], d = y[1] - o[1];\n" +
        "    lmlEcT = [o[0], o[1], a, b, c, d, a * d - b * c];\n" +
        "  }\n" +
        "  var t = lmlEcT, u = p[0] - t[0], v = p[1] - t[1];\n" +
        "  return [(t[5] * u - t[4] * v) / t[6], (t[2] * v - t[3] * u) / t[6]];\n" +
        "}\n";

    self.rewriteExpression = function (code) {
        var out = String(code);
        out = out.replace(/\.source\.(width|height)\b/g, ".$1");
        out = out.replace(/\.transform\.scale\b/g, ".scale");
        var usesFromComp = false;
        out = out.replace(/(^|[^\w$.])fromComp\(/g, function (all, before) {
            usesFromComp = true;
            return before + "lmlEcFromComp(";
        });
        if (usesFromComp) {
            // After the first line, so a generated expression still starts with its marker comment.
            var nl = out.indexOf("\n");
            if (out.indexOf("//") === 0 && nl > 0) out = out.substring(0, nl + 1) + FROM_COMP + out.substring(nl + 1);
            else out = FROM_COMP + out;
        }
        return out;
    };

    /*
     * FootageItem in EffectCraft 0.8.0 has replace() but not the sequence and proxy methods the host
     * uses to swap a newer render in; EffectCraft's own File ▸ Replace Footage and Proxy commands do
     * the same.
     */
    /*
     * Undo groups nest in After Effects (the outer group is the one undo step); in EffectCraft 0.8.0 an
     * inner endUndoGroup closes the group, and what follows becomes separate undo steps. Only the
     * outermost begin and end reach EffectCraft.
     */
    fix("nested undo groups", function () {
        var begin = app.beginUndoGroup;
        var end = app.endUndoGroup;
        var depth = 0;
        app.beginUndoGroup = function (name) {
            depth++;
            if (depth === 1) return begin.call(app, name);
        };
        app.endUndoGroup = function () {
            if (depth === 0) return;
            depth--;
            if (depth === 0) return end.call(app);
        };
    });

    /*
     * app.executeCommand(number) takes EffectCraft's own command numbers, not After Effects' menu
     * command ids; the After Effects ids LazyMapLayers uses are translated to EffectCraft commands.
     * EffectCraft 0.9.2 makes 16 Undo itself (storytold/effectcraft#812); the translation does the same
     * there and stays for older builds.
     */
    fix("app.executeCommand with After Effects ids", function () {
        var AE_COMMANDS = { 16: "edit.undo" };
        var executeCommand = app.executeCommand;
        app.executeCommand = function (id) {
            if (typeof id === "number" && AE_COMMANDS[id]) return __call(AE_COMMANDS[id], {});
            return executeCommand.call(app, id);
        };
    });

    /*
     * Layer.sourcePointToComp and compPointToSource return the point unchanged in EffectCraft 0.8.0.
     * Here they apply the layer's 2D transform (anchor point, scale, rotation, position) and its
     * parents', at the comp's current time. EffectCraft 0.10.0 converts them itself
     * (storytold/effectcraft#808) with the same result for 2D layers; this stays for older builds.
     */
    fix("Layer.sourcePointToComp and compPointToSource", function () {
        function multiply(m, n) {
            return [m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1], m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3], m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5]];
        }
        function matrixOf(layer, time) {
            var t = layer.property("ADBE Transform Group");
            var anchor = t.property("ADBE Anchor Point").valueAtTime(time, false);
            var position = t.property("ADBE Position").valueAtTime(time, false);
            var scale = t.property("ADBE Scale").valueAtTime(time, false);
            var rotate = t.property("ADBE Rotate Z");
            var r = (rotate ? rotate.valueAtTime(time, false) : 0) * Math.PI / 180;
            var a = Math.cos(r) * scale[0] / 100, b = Math.sin(r) * scale[0] / 100;
            var c = -Math.sin(r) * scale[1] / 100, d = Math.cos(r) * scale[1] / 100;
            var m = [a, b, c, d, position[0] - (a * anchor[0] + c * anchor[1]), position[1] - (b * anchor[0] + d * anchor[1])];
            return layer.parent ? multiply(matrixOf(layer.parent, time), m) : m;
        }
        var targets = [Layer.prototype, AVLayer.prototype];
        for (var i = 0; i < targets.length; i++) {
            var proto = targets[i];
            if (!Object.prototype.hasOwnProperty.call(proto, "sourcePointToComp")) continue;
            proto.sourcePointToComp = function (p) {
                var m = matrixOf(this, this.containingComp.time);
                return [m[0] * p[0] + m[2] * p[1] + m[4], m[1] * p[0] + m[3] * p[1] + m[5]];
            };
            proto.compPointToSource = function (p) {
                var m = matrixOf(this, this.containingComp.time);
                var det = m[0] * m[3] - m[1] * m[2];
                var u = p[0] - m[4], v = p[1] - m[5];
                return [(m[3] * u - m[2] * v) / det, (m[0] * v - m[1] * u) / det];
            };
        }
    });

    /*
     * Marker parameters (MarkerValue.setParameters) reach EffectCraft only with a cue point name; After
     * Effects keeps them without one, and LazyMapLayers marks its shot markers that way. A marker with
     * parameters and no name goes in as a cue point with an empty name, which EffectCraft keeps.
     * EffectCraft 0.9.2 keeps them without a name too (storytold/effectcraft#808); this stays for
     * older builds.
     */
    fix("marker parameters without a cue point name", function () {
        var P = MarkerProperty.prototype;
        P.setValueAtTime = function (t, mv) {
            t = __num(t, "time");
            if (!(mv instanceof MarkerValue)) throw __err("value must be a MarkerValue");
            var p = this.__p({ time: t, duration: mv.duration || 0, comment: mv.comment, chapter: mv.chapter, url: mv.url, frameTarget: mv.frameTarget, protected: !!mv.protectedRegion, label: mv.label || 0 });
            var params = mv.__params || [];
            p.cuePoint = mv.cuePointName || params.length ? { name: mv.cuePointName || "", navigation: !mv.eventCuePoint, params: params } : null;
            var l = this.__list(), at = -1;
            for (var i = 0; i < l.length; i++) if (Math.abs(l[i].time - t) < 1e-6) at = i;
            if (at >= 0) p.index = at;
            else p["new"] = true;
            __call("markers.set", p);
        };
    });

    /*
     * CompItem.saveFrameToPng is missing in EffectCraft 0.8.0; its Composition ▸ Save Frame As ▸ File
     * command does the same for the active comp, so the comp is made active for it and the one that
     * was active before comes back.
     */
    fix("CompItem.saveFrameToPng", function () {
        if (typeof CompItem.prototype.saveFrameToPng === "function") return;
        CompItem.prototype.saveFrameToPng = function (time, file) {
            var before = app.project.activeItem;
            this.openInViewer();
            try {
                __call("comp.saveFrameAs", { path: pathOf(file), time: Number(time) });
            } finally {
                if (before instanceof CompItem && before.id !== this.id) before.openInViewer();
            }
        };
    });

    /*
     * Removing keys one by one takes about 38 ms each in EffectCraft 0.8.0 (a camera with a key per
     * frame took minutes). Its Delete Keyframes command takes a list of keys: a whole range goes in
     * one command. first and last are 1-based and inclusive.
     */
    fix("Property: remove a range of keys at once", function () {
        Property.prototype.__lmlecRemoveKeys = function (first, last) {
            var count = this.numKeys;
            if (!count) return 0;
            first = Math.max(1, first || 1);
            last = Math.min(count, last || count);
            if (first > last) return 0;
            var keys = [];
            for (var i = first; i <= last; i++) keys.push({ layer: this.__layer.__id, prop: this.__uid, index: i - 1 });
            __call("keys.delete", { comp: this.__layer.__comp, __keys: keys });
            return keys.length;
        };
    });

    /*
     * Some groups name their properties differently in EffectCraft 0.8.0. A stroke's Dashes always
     * hold one dash, gap and offset ("dash", "gap", "offset"), where After Effects adds "ADBE Vector
     * Stroke Dash 1"... on demand; a text layer's Path Options are "path", "perpendicular"... Asking
     * for, or adding, the After Effects name gives EffectCraft's property. EffectCraft 0.9.2 (Path
     * Options) and 0.10.0 (Dashes) use the After Effects names, so EffectCraft's own lookup goes first
     * and the old name is only the fallback for older builds.
     */
    fix("After Effects matchNames in groups that name them differently", function () {
        var ALIASES = {
            "ADBE Vector Stroke Dashes": { "ADBE Vector Stroke Dash 1": "dash", "ADBE Vector Stroke Gap 1": "gap", "ADBE Vector Stroke Offset": "offset" },
            "ADBE Text Path Options": {
                "ADBE Text Path": "path",
                "ADBE Text Reverse Path": "reversePath",
                "ADBE Text Perpendicular To Path": "perpendicular",
                "ADBE Text Force Align Path": "forceAlignment",
                "ADBE Text First Margin": "firstMargin",
                "ADBE Text Last Margin": "lastMargin"
            }
        };
        var P = PropertyGroup.prototype;
        var addProperty = P.addProperty;
        var property = P.property;
        function alias(group, name) {
            if (typeof name !== "string") return null;
            var table = ALIASES[group.matchName];
            return table && table[name] ? table[name] : null;
        }
        P.addProperty = function (name) {
            var other = alias(this, name);
            if (!other) return addProperty.apply(this, arguments);
            try {
                var added = addProperty.apply(this, arguments);
                if (added) return added;
            } catch (e) {
                // 0.8.0: Can not add a property to "Dashes".
            }
            return property.call(this, other);
        };
        P.property = function (name) {
            var other = alias(this, name);
            var found = property.apply(this, arguments);
            return found || !other ? found : property.call(this, other);
        };
    });

    /*
     * In After Effects the same comp, item or layer is the same object, so `a.containingComp ===
     * b.containingComp` and `other === layer` work; EffectCraft 0.8.0 makes a new object on every
     * access. Every item and layer object goes through one cache, keyed by its id (layers by comp and
     * id): the factories, the containingComp getter, and what the collections' and objects' methods
     * return. EffectCraft 0.9.2 keeps one object per item and layer itself (storytold/effectcraft#811);
     * the cache stays for older builds and also keeps the object replaceSource below hands back.
     */
    fix("one object per item and layer", function () {
        var cache = {};
        var makeLayer = __layer;
        function canonical(o) {
            if (!o || typeof o !== "object") return o;
            if (o instanceof Item && typeof o.__id === "number") {
                var ik = "i" + o.__id;
                return cache[ik] || (cache[ik] = o);
            }
            if (o instanceof Layer && o.__comp !== undefined && o.__id !== undefined) {
                var lk = "l" + o.__comp + ":" + o.__id;
                return cache[lk] || (cache[lk] = o);
            }
            if (o instanceof Array) {
                for (var i = 0; i < o.length; i++) o[i] = canonical(o[i]);
            }
            return o;
        }
        self.canonical = canonical;
        /** Makes `object` the one object for the layer with this comp and id (after replaceSource). */
        self.adoptLayer = function (object, compId, id) {
            cache["l" + compId + ":" + id] = object;
        };
        __layer = function (compId, id) {
            if (id === null || id === undefined) return null;
            var key = "l" + compId + ":" + id;
            return cache[key] || (cache[key] = makeLayer(compId, id));
        };
        // __item is wrapped again below (footage proxies); that wrapper calls this one.
        var makeItem = __item;
        __item = function (id) {
            if (id === null || id === undefined || id === 0) return makeItem(id);
            var key = "i" + id;
            return cache[key] || (cache[key] = makeItem(id));
        };
        Object.defineProperty(Layer.prototype, "containingComp", {
            configurable: true,
            get: function () {
                return __item(this.__comp);
            }
        });
        var owners = [ItemCollection.prototype, LayerCollection.prototype, Project.prototype, CompItem.prototype, Layer.prototype, AVLayer.prototype];
        for (var o = 0; o < owners.length; o++) {
            var proto = owners[o];
            var names = Object.getOwnPropertyNames(proto);
            for (var n = 0; n < names.length; n++) {
                var name = names[n];
                if (name === "constructor" || name.indexOf("__") === 0) continue;
                var d = Object.getOwnPropertyDescriptor(proto, name);
                if (!d || typeof d.value !== "function" || !d.writable) continue;
                (function (p, key, f) {
                    p[key] = function () {
                        return canonical(f.apply(this, arguments));
                    };
                })(proto, name, d.value);
            }
        }
    });

    /*
     * AVLayer.replaceSource throws "not supported yet" in EffectCraft 0.8.0, and no command changes a
     * layer's source. Here a new layer with the new source takes the old one's place: its index,
     * timing, transform, effects (values, keys with their easing, expressions), switches, name,
     * comment, parent and children; then the old layer goes, and the same layer object stands for the
     * new one, as it does after replaceSource in After Effects. A non-animated anchor point keeps its
     * place relative to the source, as when a layer's source is replaced in After Effects. Masks,
     * layer styles and track mattes are not carried over.
     */
    fix("AVLayer.replaceSource (a new layer in the old one's place)", function () {
        var proto = AVLayer.prototype;
        var original = proto.replaceSource;
        var supported = true;
        try {
            original.call(null);
        } catch (e) {
            supported = String(e && e.message).indexOf("not supported") < 0;
        }
        if (supported) return;

        function copyProperty(from, to) {
            if (!from || !to) return;
            if (from.propertyType === PropertyType.PROPERTY) {
                try {
                    if (from.numKeys > 0) {
                        var times = [], values = [];
                        for (var k = 1; k <= from.numKeys; k++) {
                            times.push(from.keyTime(k));
                            values.push(from.keyValue(k));
                        }
                        to.setValuesAtTimes(times, values);
                        for (var e = 1; e <= from.numKeys; e++) {
                            try {
                                to.setInterpolationTypeAtKey(e, from.keyInInterpolationType(e), from.keyOutInterpolationType(e));
                                to.setTemporalEaseAtKey(e, from.keyInTemporalEase(e), from.keyOutTemporalEase(e));
                            } catch (easeError) {
                                // Linear keys are a fine fallback.
                            }
                        }
                    } else if (from.propertyValueType !== PropertyValueType.NO_VALUE) {
                        to.setValue(from.value);
                    }
                } catch (valueError) {
                    // A property the new layer cannot take keeps its default.
                }
                try {
                    if (from.expression) {
                        to.expression = from.expression;
                        to.expressionEnabled = from.expressionEnabled;
                    }
                } catch (expressionError) {
                    // No expression on this property.
                }
                return;
            }
            for (var i = 1; i <= from.numProperties; i++) {
                var child = from.property(i);
                copyProperty(child, to.property(child.matchName) || to.property(i));
            }
        }

        proto.replaceSource = function (item, fixExpressions) {
            var old = this;
            var comp = old.containingComp;
            var wasLocked = old.locked;
            if (wasLocked) old.locked = false;
            var before = old.source;
            var fresh = comp.layers.add(item);
            fresh.moveBefore(old);
            fresh.startTime = old.startTime;
            if (old.stretch !== 100) fresh.stretch = old.stretch;
            fresh.inPoint = old.inPoint;
            fresh.outPoint = old.outPoint;
            if (old.threeDLayer) fresh.threeDLayer = true;
            copyProperty(old.property("ADBE Transform Group"), fresh.property("ADBE Transform Group"));
            var anchor = fresh.property("ADBE Transform Group").property("ADBE Anchor Point");
            if (before && anchor.numKeys === 0 && !anchor.expression && before.width && before.height) {
                var a = anchor.value;
                var moved = [a[0] * item.width / before.width, a[1] * item.height / before.height];
                if (a.length > 2) moved.push(a[2]);
                anchor.setValue(moved);
            }
            var effects = old.property("ADBE Effect Parade");
            var target = fresh.property("ADBE Effect Parade");
            for (var f = 1; effects && f <= effects.numProperties; f++) {
                var effect = effects.property(f);
                var made = target.addProperty(effect.matchName);
                made.name = effect.name;
                copyProperty(effect, made);
            }
            var flags = ["enabled", "audioEnabled", "shy", "solo", "motionBlur", "adjustmentLayer", "guideLayer", "blendingMode", "label", "quality"];
            for (var s = 0; s < flags.length; s++) {
                try {
                    if (fresh[flags[s]] !== old[flags[s]]) fresh[flags[s]] = old[flags[s]];
                } catch (flagError) {
                    // A switch this layer does not have.
                }
            }
            fresh.name = old.name;
            fresh.comment = old.comment;
            if (old.parent) fresh.parent = old.parent;
            for (var c = 1; c <= comp.numLayers; c++) {
                var other = comp.layer(c);
                if (other !== old && other !== fresh && other.parent === old) other.parent = fresh;
            }
            var newId = fresh.__id;
            old.remove();
            // The same object stands for the new layer from now on.
            old.__id = newId;
            if (fresh.__kind !== undefined) old.__kind = fresh.__kind;
            if (self.adoptLayer) self.adoptLayer(old, comp.id, newId);
            if (wasLocked) old.locked = true;
        };
    });

    /*
     * After Effects lets a layer's transform properties be read as attributes of the layer itself
     * (layer.anchorPoint, layer.position…); EffectCraft 0.8.0 has them on layer.transform only.
     */
    fix("transform properties as layer attributes", function () {
        var NAMES = ["anchorPoint", "position", "scale", "rotation", "opacity", "orientation", "xRotation", "yRotation", "zRotation"];
        for (var i = 0; i < NAMES.length; i++) {
            if (Object.getOwnPropertyDescriptor(Layer.prototype, NAMES[i])) continue;
            (function (name) {
                Object.defineProperty(Layer.prototype, name, {
                    configurable: true,
                    get: function () {
                        var t = this.transform;
                        return t ? t[name] : undefined;
                    }
                });
            })(NAMES[i]);
        }
    });

    /*
     * Fonts. After Effects names a font by its PostScript name (app.fonts, TextDocument.font);
     * EffectCraft 0.8.0 has no app.fonts and takes a family and a style, treating a PostScript name
     * as an unknown family (the text falls back to Inter). A PostScript name is matched to an
     * installed family and style from EffectCraft's font list: "Georgia-Italic" is Georgia Italic,
     * "Arial-BoldItalicMT" Arial Bold Italic, "NotoSansBengali-Regular" Noto Sans Bengali Regular.
     */
    var fontIndex = null;
    function squash(text) {
        return String(text).toLowerCase().replace(/[^a-z0-9]/g, "");
    }
    function resolveFont(postScriptName) {
        if (!postScriptName) return null;
        if (!fontIndex) {
            fontIndex = {};
            var list = __call("text.fonts", {});
            var families = (list && list.families) || [];
            for (var f = 0; f < families.length; f++) {
                var family = families[f].family;
                var styles = families[f].styles || ["Regular"];
                for (var s = 0; s < styles.length; s++) {
                    var style = styles[s];
                    var entry = { family: family, style: style };
                    var names = [family + style, family + style + "MT", family + style + "PS", family + "PS" + style + "MT", family + "PS" + style];
                    if (style === "Regular") names.push(family, family + "MT", family + "PS", family + "Roman");
                    if (style.indexOf("Italic") >= 0) names.push(family + style.replace("Italic", "Oblique"));
                    for (var n = 0; n < names.length; n++) {
                        var key = squash(names[n]);
                        if (!fontIndex[key]) fontIndex[key] = entry;
                    }
                }
            }
        }
        return fontIndex[squash(postScriptName)] || null;
    }
    self.resolveFont = resolveFont;

    fix("app.fonts by PostScript name", function () {
        if (app.fonts) return;
        var fonts = {
            getFontsByPostScriptName: function (name) {
                var found = resolveFont(name);
                return found ? [{ postScriptName: String(name), familyName: found.family, styleName: found.style, fontName: found.family + " " + found.style }] : [];
            }
        };
        Object.defineProperty(app, "fonts", { configurable: true, get: function () { return fonts; } });
    });

    // In EffectCraft a TextDocument's "font" is the family; its style is set apart.
    fix("TextDocument.font by PostScript name", function () {
        var P = TextDocument.prototype;
        var font = Object.getOwnPropertyDescriptor(P, "font");
        if (!font || !font.get || !font.set || typeof P.__set !== "function") throw new Error("TextDocument font accessor not found");
        Object.defineProperty(P, "font", {
            configurable: true,
            get: function () {
                if (this.__lmlecFont) return this.__lmlecFont;
                // A PostScript-style name, as After Effects gives: family, then style unless Regular.
                var familyName = String(font.get.call(this));
                var styleName = String(this.fontStyle || "Regular");
                var base = familyName.replace(/\s+/g, "");
                return styleName === "Regular" ? base : base + "-" + styleName.replace(/\s+/g, "");
            },
            set: function (v) {
                var found = resolveFont(v);
                if (!found) {
                    this.__lmlecFont = null;
                    return font.set.call(this, v);
                }
                this.__set("font", found.family);
                this.__set("style", found.style);
                this.__lmlecFont = String(v);
            }
        });
    });

    var PROXY_LINE = "LMLEC-PROXY:";
    var pathOf = function (file) {
        return file && file.fsName ? String(file.fsName) : String(file);
    };

    /** The descriptor of `name` on `object` or the first prototype that has one. */
    function descriptorOf(object, name) {
        for (var o = object; o; o = Object.getPrototypeOf(o)) {
            var d = Object.getOwnPropertyDescriptor(o, name);
            if (d) return d;
        }
        return null;
    }

    /*
     * EffectCraft 0.11.1 has proxies of its own: setProxyWithSequence, setProxyToNone, a useProxy
     * that can be set and a proxySource that reads the item's proxy. Then all of those stay
     * EffectCraft's (mixing them with the record below would lose the proxy); only the proxy's
     * conformFrameRate is added. Before, every one of them is this layer's.
     */
    var nativeProxy = (function () {
        var d = descriptorOf(FootageItem.prototype, "useProxy");
        return !!(d && d.set) && typeof FootageItem.prototype.setProxyWithSequence === "function" && typeof FootageItem.prototype.setProxyToNone === "function";
    })();

    /** The proxy this compatibility layer set on a footage item ({path, on, fps}), kept in its comment. */
    function proxyRecord(item) {
        var lines = String(item.comment || "").split("\n");
        for (var i = 0; i < lines.length; i++) {
            if (lines[i].indexOf(PROXY_LINE) !== 0) continue;
            try {
                return JSON.parse(lines[i].substring(PROXY_LINE.length));
            } catch (e) {
                return null;
            }
        }
        return null;
    }

    function writeProxyRecord(item, record) {
        var lines = String(item.comment || "").split("\n");
        var kept = [];
        for (var i = 0; i < lines.length; i++) if (lines[i].indexOf(PROXY_LINE) !== 0) kept.push(lines[i]);
        while (kept.length && kept[kept.length - 1] === "") kept.pop();
        if (record) kept.push(PROXY_LINE + JSON.stringify(record));
        item.comment = kept.join("\n");
    }

    fix("FootageItem sequence and proxy methods", function () {
        var proto = FootageItem.prototype;
        if (typeof proto.replaceWithSequence !== "function") {
            proto.replaceWithSequence = function (file, forceAlphabetical) {
                __call("file.replaceFootage", { item: this.__id, path: pathOf(file), sequence: true, alphabetical: !!forceAlphabetical });
            };
        }
        if (nativeProxy) return;
        var setProxy = function (file) {
            __call("file.setProxy", { item: this.__id, path: pathOf(file) });
            __call("file.useProxy", { item: this.__id, on: true });
            writeProxyRecord(this, { path: pathOf(file), on: true });
        };
        proto.setProxyWithSequence = setProxy;
        if (typeof proto.setProxy !== "function") proto.setProxy = setProxy;
        proto.setProxyToNone = function () {
            __call("file.setProxyNone", { item: this.__id });
            writeProxyRecord(this, null);
        };
    });

    /*
     * FootageItem.proxySource and .useProxy are fixed stubs in EffectCraft 0.8.0 (null and false, no
     * setter). Every item object comes from the global __item(), so each footage item gets its own
     * working pair, backed by the proxy record above and EffectCraft's Proxy commands.
     */
    fix("FootageItem.proxySource and useProxy, mainSource.conformFrameRate", function () {
        var makeItem = __item;
        var main = descriptorOf(FootageItem.prototype, "mainSource");
        var mainOf = main && main.get ? main.get : null;
        var proxy = descriptorOf(FootageItem.prototype, "proxySource");
        var proxyOf = proxy && proxy.get ? proxy.get : null;
        __item = function (id) {
            var item = makeItem(id);
            if (!(item instanceof FootageItem)) return item;
            // mainSource is a new plain object on every read, so setting its conformFrameRate did
            // nothing: it becomes EffectCraft's Interpret Footage command.
            if (mainOf) {
                Object.defineProperty(item, "mainSource", {
                    configurable: true,
                    get: function () {
                        var source = mainOf.call(item);
                        if (!source || typeof source !== "object") return source;
                        // EffectCraft 0.11.1: one FootageSource per item, whose conformFrameRate works.
                        var own = descriptorOf(source, "conformFrameRate");
                        if (own && own.set) return source;
                        var fps = source.conformFrameRate;
                        Object.defineProperty(source, "conformFrameRate", {
                            configurable: true,
                            get: function () {
                                return fps;
                            },
                            set: function (v) {
                                __call("file.interpretFootage", { items: [item.__id], frameRate: Number(v) });
                                fps = Number(v);
                            }
                        });
                        return source;
                    }
                });
            }
            if (nativeProxy) {
                if (proxyOf) {
                    Object.defineProperty(item, "proxySource", {
                        configurable: true,
                        get: function () {
                            var source = proxyOf.call(item);
                            if (!source || typeof source !== "object") return source;
                            var own = descriptorOf(source, "conformFrameRate");
                            if (own && own.set) return source;
                            Object.defineProperty(source, "conformFrameRate", {
                                configurable: true,
                                get: function () {
                                    return item.__lmlecProxyFps || 0;
                                },
                                set: function (v) {
                                    __call("file.interpretProxy", { item: item.__id, frameRate: Number(v) });
                                    item.__lmlecProxyFps = Number(v);
                                }
                            });
                            return source;
                        }
                    });
                }
                return item;
            }
            Object.defineProperty(item, "proxySource", {
                configurable: true,
                get: function () {
                    var record = proxyRecord(item);
                    if (!record) return null;
                    var source = { file: new File(record.path), isStill: false };
                    Object.defineProperty(source, "conformFrameRate", {
                        get: function () {
                            return record.fps || 0;
                        },
                        set: function (v) {
                            __call("file.interpretProxy", { item: item.__id, frameRate: Number(v) });
                            record.fps = Number(v);
                            writeProxyRecord(item, record);
                        }
                    });
                    return source;
                }
            });
            Object.defineProperty(item, "useProxy", {
                configurable: true,
                get: function () {
                    var record = proxyRecord(item);
                    return !!(record && record.on);
                },
                set: function (v) {
                    var record = proxyRecord(item);
                    if (!record) return;
                    __call("file.useProxy", { item: item.__id, on: !!v });
                    record.on = !!v;
                    writeProxyRecord(item, record);
                }
            });
            return item;
        };
    });

    return self;
})();
