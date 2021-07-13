var clippy = {};

/******
 *
 *
 * @constructor
 */
clippy.Agent = function (path, data, sounds) {
    this.path = path;

    this._queue = new clippy.Queue($.proxy(this._onQueueEmpty, this));

    this._el = $('<div class="clippy"></div>').hide();

    $(document.body).append(this._el);

    this._animator = new clippy.Animator(this._el, path, data, sounds);

    this._balloon = new clippy.Balloon(this._el);

    this.shortJokes = clippy.shortJokes;

    this._setupEvents();
};

clippy.Agent.prototype = {

    /**************************** API ************************************/

    /***
     *
     * @param {Number} x
     * @param {Number} y
     */
    gestureAt:function (x, y) {
        var d = this._getDirection(x, y);
        var gAnim = 'Gesture' + d;
        var lookAnim = 'Look' + d;

        var animation = this.hasAnimation(gAnim) ? gAnim : lookAnim;
        return this.play(animation);
    },

    /***
     *
     * @param {Boolean=} fast
     *
     */
    hide:function (fast, callback) {
        this._hidden = true;
        var el = this._el;
        this.stop();
        if (fast) {
            this._el.hide();
            this.stop();
            this.pause();
            if (callback) callback();
            return;
        }

        return this._playInternal('Hide', function () {
            el.hide();
            this.pause();
            if (callback) callback();
        })
    },


    moveTo:function (x, y, duration) {
        var dir = this._getDirection(x, y);
        var anim = 'Move' + dir;
        if (duration === undefined) duration = 1000;

        this._addToQueue(function (complete) {
            // the simple case
            if (duration === 0) {
                this._el.css({top:y, left:x});
                this.reposition();
                complete();
                return;
            }

            // no animations
            if (!this.hasAnimation(anim)) {
                this._el.animate({top:y, left:x}, duration, complete);
                return;
            }

            var callback = $.proxy(function (name, state) {
                // when exited, complete
                if (state === clippy.Animator.States.EXITED) {
                    complete();
                }
                // if waiting,
                if (state === clippy.Animator.States.WAITING) {
                    this._el.animate({top:y, left:x}, duration, $.proxy(function () {
                        // after we're done with the movement, do the exit animation
                        this._animator.exitAnimation();
                    }, this));
                }

            }, this);

            this._playInternal(anim, callback);
        }, this);
    },

    _playInternal:function (animation, callback) {

        // if we're inside an idle animation,
        if (this._isIdleAnimation() && this._idleDfd && this._idleDfd.state() === 'pending') {
            this._idleDfd.done($.proxy(function () {
                this._playInternal(animation, callback);
            }, this))
        }

        this._animator.showAnimation(animation, callback);
    },

    play:function (animation, timeout, cb) {
        if (!this.hasAnimation(animation)) return false;

        if (timeout === undefined) timeout = 5000;


        this._addToQueue(function (complete) {
            var completed = false;
            // handle callback
            var callback = function (name, state) {
                if (state === clippy.Animator.States.EXITED) {
                    completed = true;
                    if (cb) cb();
                    complete();
                }
            };

            // if has timeout, register a timeout function
            if (timeout) {
                window.setTimeout($.proxy(function () {
                    if (completed) return;
                    // exit after timeout
                    this._animator.exitAnimation();
                }, this), timeout)
            }

            this._playInternal(animation, callback);
        }, this);

        return true;
    },

    /**
     *
     * @param fast
     * @param top
     * @param left
     */
    show:function (fast, top, left) {

        this._hidden = false;
        if (fast) {
            this._el.show();
            this.resume();
            this._onQueueEmpty();
            return;
        }

        if (top === undefined && this._el.css('top') === 'auto') {
            top = ($(window).height() + $(document).scrollTop()) * 0.8;
            this._el.css({top:top});
        } else if (top !== undefined) {
            this._el.css({top:top});
        }
        if (left === undefined && this._el.css('left') === 'auto') {
            left = $(window).width() * 0.8;
            this._el.css({left:left});
        } else if (left !== undefined) {
            this._el.css({left:left});
        }

        this.resume();
        return this.play('Show');
    },

    /***
     *
     * @param {String} text
     */
    speak:function (text, hold) {
        this._addToQueue(function (complete) {
            this._balloon.speak(complete, text, hold);
        }, this);
    },


    /***
     * Close the current balloon
     */
    closeBalloon:function () {
        this._balloon.hide();
    },

    delay:function (time) {
        time = time || 250;

        this._addToQueue(function (complete) {
            this._onQueueEmpty();
            window.setTimeout(complete, time);
        });
    },

    /***
     * Skips the current animation
     */
    stopCurrent:function () {
        this._animator.exitAnimation();
        this._balloon.close();
    },


    stop:function () {
        // clear the queue
        this._queue.clear();
        this._animator.exitAnimation();
        this._balloon.hide();
    },

    /***
     *
     * @param {String} name
     * @returns {Boolean}
     */
    hasAnimation:function (name) {
        return this._animator.hasAnimation(name);
    },

    /***
     * Gets a list of animation names
     *
     * @return {Array.<string>}
     */
    animations:function () {
        return this._animator.animations();
    },

    /***
     * Play a random animation
     * @return {jQuery.Deferred}
     */
    animate:function () {
        var animations = this.animations();
        var anim = animations[Math.floor(Math.random() * animations.length)];
        // skip idle animations
        if (anim.indexOf('Idle') === 0) {
            return this.animate();
        }
        return this.play(anim);
    },

    /**************************** Utils ************************************/

    /***
     *
     * @param {Number} x
     * @param {Number} y
     * @return {String}
     * @private
     */
    _getDirection:function (x, y) {
        var offset = this._el.offset();
        var h = this._el.height();
        var w = this._el.width();

        var centerX = (offset.left + w / 2);
        var centerY = (offset.top + h / 2);


        var a = centerY - y;
        var b = centerX - x;

        var r = Math.round((180 * Math.atan2(a, b)) / Math.PI);

        // Left and Right are for the character, not the screen :-/
        if (-45 <= r && r < 45) return 'Right';
        if (45 <= r && r < 135) return 'Up';
        if (135 <= r && r <= 180 || -180 <= r && r < -135) return 'Left';
        if (-135 <= r && r < -45) return 'Down';

        // sanity check
        return 'Top';
    },

    /**************************** Queue and Idle handling ************************************/

    /***
     * Handle empty queue.
     * We need to transition the animation to an idle state
     * @private
     */
    _onQueueEmpty:function () {
        if (this._hidden || this._isIdleAnimation()) return;
        var idleAnim = this._getIdleAnimation();
        this._idleDfd = $.Deferred();

        this._animator.showAnimation(idleAnim, $.proxy(this._onIdleComplete, this));
    },

    _onIdleComplete:function (name, state) {
        if (state === clippy.Animator.States.EXITED) {
            this._idleDfd.resolve();
        }
    },


    /***
     * Is the current animation is Idle?
     * @return {Boolean}
     * @private
     */
    _isIdleAnimation:function () {
        var c = this._animator.currentAnimationName;
        return c && c.indexOf('Idle') === 0;
    },


    /**
     * Gets a random Idle animation
     * @return {String}
     * @private
     */
    _getIdleAnimation:function () {
        var animations = this.animations();
        var r = [];
        for (var i = 0; i < animations.length; i++) {
            var a = animations[i];
            if (a.indexOf('Idle') === 0) {
                r.push(a);
            }
        }

        // pick one
        var idx = Math.floor(Math.random() * r.length);
        return r[idx];
    },

    /**************************** Events ************************************/

    _setupEvents:function () {
        $(window).on('resize', $.proxy(this.reposition, this));

        this._el.on('mousedown', $.proxy(this._onMouseDown, this));

        this._el.on('dblclick', $.proxy(this._onDoubleClick, this));
    },

    _onDoubleClick:function () {
        if (!this.play('ClickedOn')) {
            if (this.shortJokes) {
                this.speak(this.shortJokes[Math.floor(Math.random() * this.shortJokes.length)]);
            } else {
                this.animate();
            }
        }
    },

    reposition:function () {
        if (!this._el.is(':visible')) return;
        var o = this._el.offset();
        var bH = this._el.outerHeight();
        var bW = this._el.outerWidth();

        var wW = $(window).width();
        var wH = $(window).height();
        var sT = $(window).scrollTop();
        var sL = $(window).scrollLeft();

        var top = o.top - sT;
        var left = o.left - sL;
        var m = 5;
        if (top - m < 0) {
            top = m;
        } else if ((top + bH + m) > wH) {
            top = wH - bH - m;
        }

        if (left - m < 0) {
            left = m;
        } else if (left + bW + m > wW) {
            left = wW - bW - m;
        }

        this._el.css({left:left, top:top});
        // reposition balloon
        this._balloon.reposition();
    },

    _onMouseDown:function (e) {
        e.preventDefault();
        this._startDrag(e);
    },


    /**************************** Drag ************************************/

    _startDrag:function (e) {
        // pause animations
        this.pause();
        this._balloon.hide(true);
        this._offset = this._calculateClickOffset(e);

        this._moveHandle = $.proxy(this._dragMove, this);
        this._upHandle = $.proxy(this._finishDrag, this);

        $(window).on('mousemove', this._moveHandle);
        $(window).on('mouseup', this._upHandle);

        this._dragUpdateLoop = window.setTimeout($.proxy(this._updateLocation, this), 10);
    },

    _calculateClickOffset:function (e) {
        var mouseX = e.pageX;
        var mouseY = e.pageY;
        var o = this._el.offset();
        return {
            top:mouseY - o.top,
            left:mouseX - o.left
        }

    },

    _updateLocation:function () {
        this._el.css({top:this._targetY, left:this._targetX});
        this._dragUpdateLoop = window.setTimeout($.proxy(this._updateLocation, this), 10);
    },

    _dragMove:function (e) {
        e.preventDefault();
        var x = e.clientX - this._offset.left;
        var y = e.clientY - this._offset.top;
        this._targetX = x;
        this._targetY = y;
    },

    _finishDrag:function () {
        window.clearTimeout(this._dragUpdateLoop);
        // remove handles
        $(window).off('mousemove', this._moveHandle);
        $(window).off('mouseup', this._upHandle);
        // resume animations
        this._balloon.show();
        this.reposition();
        this.resume();

    },

    _addToQueue:function (func, scope) {
        if (scope) func = $.proxy(func, scope);
        this._queue.queue(func);
    },

    /**************************** Pause and Resume ************************************/

    pause:function () {
        this._animator.pause();
        this._balloon.pause();

    },

    resume:function () {
        this._animator.resume();
        this._balloon.resume();
    }

};

/******
 *
 *
 * @constructor
 */
clippy.Animator = function (el, path, data, sounds) {
    this._el = el;
    this._data = data;
    this._path = path;
    this._currentFrameIndex = 0;
    this._currentFrame = undefined;
    this._exiting = false;
    this._currentAnimation = undefined;
    this._endCallback = undefined;
    this._started = false;
    this._sounds = {};
    this.currentAnimationName = undefined;
    this.preloadSounds(sounds);
    this._overlays = [this._el];
    var curr = this._el;

    this._setupElement(this._el);
    for (var i = 1; i < this._data.overlayCount; i++) {
        var inner = this._setupElement($('<div></div>'));

        curr.append(inner);
        this._overlays.push(inner);
        curr = inner;
    }
};

clippy.Animator.prototype = {
    _setupElement:function (el) {
        var frameSize = this._data.framesize;
        el.css('display', "none");
        el.css({width:frameSize[0], height:frameSize[1]});
        el.css('background', "url('" + this._path + "/map.png') no-repeat");

        return el;
    },

    animations:function () {
        var r = [];
        var d = this._data.animations;
        for (var n in d) {
            r.push(n);
        }
        return r;
    },

    preloadSounds:function (sounds) {

        for (var i = 0; i < this._data.sounds.length; i++) {
            var snd = this._data.sounds[i];
            var uri = sounds[snd];
            if (!uri) continue;
            this._sounds[snd] = new Audio(uri);

        }
    },
    hasAnimation:function (name) {
        return !!this._data.animations[name];
    },

    exitAnimation:function () {
        this._exiting = true;
    },


    showAnimation:function (animationName, stateChangeCallback) {
        this._exiting = false;

        if (!this.hasAnimation(animationName)) {
            return false;
        }

        this._currentAnimation = this._data.animations[animationName];
        this.currentAnimationName = animationName;


        if (!this._started) {
            this._step();
            this._started = true;
        }

        this._currentFrameIndex = 0;
        this._currentFrame = undefined;
        this._endCallback = stateChangeCallback;

        return true;
    },


    _draw:function () {
        var images = [];
        if (this._currentFrame) images = this._currentFrame.images || [];

        for (var i = 0; i < this._overlays.length; i++) {
            if (i < images.length) {
                var xy = images[i];
                var bg = -xy[0] + 'px ' + -xy[1] + 'px';
                this._overlays[i].css({'background-position':bg, 'display':'block'});
            }
            else {
                this._overlays[i].css('display', 'none');
            }

        }
    },

    _getNextAnimationFrame:function () {
        if (!this._currentAnimation) return undefined;
        // No current frame. start animation.
        if (!this._currentFrame) return 0;
        var currentFrame = this._currentFrame;
        var branching = this._currentFrame.branching;


        if (this._exiting && currentFrame.exitBranch !== undefined) {
            return currentFrame.exitBranch;
        }
        else if (branching) {
            var rnd = Math.random() * 100;
            for (var i = 0; i < branching.branches.length; i++) {
                var branch = branching.branches[i];
                if (rnd <= branch.weight) {
                    return branch.frameIndex;
                }

                rnd -= branch.weight;
            }
        }

        return this._currentFrameIndex + 1;
    },

    _playSound:function () {
        var s = this._currentFrame.sound;
        if (!s) return;
        var audio = this._sounds[s];
        if (audio) audio.play();
    },

    _atLastFrame:function () {
        return this._currentFrameIndex >= this._currentAnimation.frames.length - 1;
    },

    _step:function () {
        if (!this._currentAnimation) return;
        var newFrameIndex = Math.min(this._getNextAnimationFrame(), this._currentAnimation.frames.length - 1);
        var frameChanged = !this._currentFrame || this._currentFrameIndex !== newFrameIndex;
        this._currentFrameIndex = newFrameIndex;

        // always switch frame data, unless we're at the last frame of an animation with a useExitBranching flag.
        if (!(this._atLastFrame() && this._currentAnimation.useExitBranching)) {
            this._currentFrame = this._currentAnimation.frames[this._currentFrameIndex];
        }

        this._draw();
        this._playSound();

        this._loop = window.setTimeout($.proxy(this._step, this), this._currentFrame.duration);


        // fire events if the frames changed and we reached an end
        if (this._endCallback && frameChanged && this._atLastFrame()) {
            if (this._currentAnimation.useExitBranching && !this._exiting) {
                this._endCallback(this.currentAnimationName, clippy.Animator.States.WAITING);
            }
            else {
                this._endCallback(this.currentAnimationName, clippy.Animator.States.EXITED);
            }
        }
    },

    /***
     * Pause animation execution
     */
    pause:function () {
        window.clearTimeout(this._loop);
    },

    /***
     * Resume animation
     */
    resume:function () {
        this._step();
    }
};

clippy.Animator.States = { WAITING:1, EXITED:0 };

/******
 *
 *
 * @constructor
 */
clippy.Balloon = function (targetEl) {
    this._targetEl = targetEl;

    this._hidden = true;
    this._setup();
};

clippy.Balloon.prototype = {

    WORD_SPEAK_TIME:200,
    CLOSE_BALLOON_DELAY:2000,

    _setup:function () {

        this._balloon = $('<div class="clippy-balloon"><div class="clippy-tip"></div><div class="clippy-content"></div></div> ').hide();
        this._content = this._balloon.find('.clippy-content');

        $(document.body).append(this._balloon);
    },

    reposition:function () {
        var sides = ['top-left', 'top-right', 'bottom-left', 'bottom-right'];

        for (var i = 0; i < sides.length; i++) {
            var s = sides[i];
            this._position(s);
            if (!this._isOut()) break;
        }
    },

    _BALLOON_MARGIN:15,

    /***
     *
     * @param side
     * @private
     */
    _position:function (side) {
        var o = this._targetEl.offset();
        var h = this._targetEl.height();
        var w = this._targetEl.width();
        o.top -= $(window).scrollTop();
        o.left -= $(window).scrollLeft();

        var bH = this._balloon.outerHeight();
        var bW = this._balloon.outerWidth();

        this._balloon.removeClass('clippy-top-left');
        this._balloon.removeClass('clippy-top-right');
        this._balloon.removeClass('clippy-bottom-right');
        this._balloon.removeClass('clippy-bottom-left');

        var left, top;
        switch (side) {
            case 'top-left':
                // right side of the balloon next to the right side of the agent
                left = o.left + w - bW;
                top = o.top - bH - this._BALLOON_MARGIN;
                break;
            case 'top-right':
                // left side of the balloon next to the left side of the agent
                left = o.left;
                top = o.top - bH - this._BALLOON_MARGIN;
                break;
            case 'bottom-right':
                // right side of the balloon next to the right side of the agent
                left = o.left;
                top = o.top + h + this._BALLOON_MARGIN;
                break;
            case 'bottom-left':
                // left side of the balloon next to the left side of the agent
                left = o.left + w - bW;
                top = o.top + h + this._BALLOON_MARGIN;
                break;
        }

        this._balloon.css({top:top, left:left});
        this._balloon.addClass('clippy-' + side);
    },

    _isOut:function () {
        var o = this._balloon.offset();
        var bH = this._balloon.outerHeight();
        var bW = this._balloon.outerWidth();

        var wW = $(window).width();
        var wH = $(window).height();
        var sT = $(document).scrollTop();
        var sL = $(document).scrollLeft();

        var top = o.top - sT;
        var left = o.left - sL;
        var m = 5;
        if (top - m < 0 || left - m < 0) return true;
        if ((top + bH + m) > wH || (left + bW + m) > wW) return true;

        return false;
    },

    speak:function (complete, text, hold) {
        this._hidden = false;
        this.show();
        var c = this._content;
        // set height to auto
        c.height('auto');
        c.width('auto');
        // add the text
        c.text(text);
        // set height
        c.height(c.height());
        c.width(c.width());
        c.text('');
        this.reposition();

        this._complete = complete;
        this._sayWords(text, hold, complete);
    },

    show:function () {
        if (this._hidden) return;
        this._balloon.show();
    },

    hide:function (fast) {
        if (fast) {
            this._balloon.hide();
            return;
        }

        this._hiding = window.setTimeout($.proxy(this._finishHideBalloon, this), this.CLOSE_BALLOON_DELAY);
    },

    _finishHideBalloon:function () {
        if (this._active) return;
        this._balloon.hide();
        this._hidden = true;
        this._hiding = null;
    },

    _sayWords:function (text, hold, complete) {
        this._active = true;
        this._hold = hold;
        var words = text.split(/[^\S-]/);
        var time = this.WORD_SPEAK_TIME;
        var el = this._content;
        var idx = 1;


        this._addWord = $.proxy(function () {
            if (!this._active) return;
            if (idx > words.length) {
                delete this._addWord;
                this._active = false;
                if (!this._hold) {
                    complete();
                    this.hide();
                }
            } else {
                el.text(words.slice(0, idx).join(' '));
                idx++;
                this._loop = window.setTimeout($.proxy(this._addWord, this), time);
            }
        }, this);

        this._addWord();

    },

    close:function () {
        if (this._active) {
            this._hold = false;
        } else if (this._hold) {
            this._complete();
        }
    },

    pause:function () {
        window.clearTimeout(this._loop);
        if (this._hiding) {
            window.clearTimeout(this._hiding);
            this._hiding = null;
        }
    },

    resume:function () {
        if (this._addWord) {
            this._addWord();
        } else if (!this._hold && !this._hidden) {
            this._hiding = window.setTimeout($.proxy(this._finishHideBalloon, this), this.CLOSE_BALLOON_DELAY);
        }
    }


};


clippy.BASE_PATH = 'agents/';

clippy.load = function (name, successCb, failCb) {
    var path = clippy.BASE_PATH + name;

    var mapDfd = clippy.load._loadMap(path);
    var agentDfd = clippy.load._loadAgent(name, path);
    var soundsDfd = clippy.load._loadSounds(name, path);
    var shortJokesDfd = clippy.load._loadShortJokes(name);

    var data;
    agentDfd.done(function (d) {
        data = d;
    });

    var sounds;

    soundsDfd.done(function (d) {
        sounds = d;
    });

    var shortJokes;

    shortJokesDfd.done(function (d) {
        shortJokes = d;
    });

    // wrapper to the success callback
    var cb = function () {
        var a = new clippy.Agent(path, data,sounds);
        successCb(a);
    };

    $.when(mapDfd, agentDfd, soundsDfd).done(cb).fail(failCb);
};

clippy.load._maps = {};
clippy.load._loadMap = function (path) {
    var dfd = clippy.load._maps[path];
    if (dfd) return dfd;

    // set dfd if not defined
    dfd = clippy.load._maps[path] = $.Deferred();

    var src = path + '/map.png';
    var img = new Image();

    img.onload = dfd.resolve;
    img.onerror = dfd.reject;

    // start loading the map;
    img.setAttribute('src', src);

    return dfd.promise();
};

clippy.load._sounds = {};

clippy.load._loadSounds = function (name, path) {
    var dfd = clippy.load._sounds[name];
    if (dfd) return dfd;

    // set dfd if not defined
    dfd = clippy.load._sounds[name] = $.Deferred();

    var audio = document.createElement('audio');
    var canPlayMp3 = !!audio.canPlayType && "" != audio.canPlayType('audio/mpeg');
    var canPlayOgg = !!audio.canPlayType && "" != audio.canPlayType('audio/ogg; codecs="vorbis"');

    if (!canPlayMp3 && !canPlayOgg) {
        dfd.resolve({});
    } else {
        var src = path + (canPlayMp3 ? '/sounds-mp3.js' : '/sounds-ogg.js');
        // load
        clippy.load._loadScript(src);
    }

    return dfd.promise()
};


clippy.load._data = {};
clippy.load._loadAgent = function (name, path) {
    var dfd = clippy.load._data[name];
    if (dfd) return dfd;

    dfd = clippy.load._getAgentDfd(name);

    var src = path + '/agent.js';

    clippy.load._loadScript(src);

    return dfd.promise();
};

clippy.load._shortJokes = {};
clippy.load._loadShortJokes = function (name) {
    var dfd = clippy.load._shortJokes[name];
    if (dfd) return dfd;

    // set dfd if not defined
    dfd = clippy.load._shortJokes[name] = $.Deferred();

    clippy.load._loadScript(clippy.BASE_PATH + 'short_jokes.js');

    return dfd.promise();
};

clippy.load._loadScript = function (src) {
    var script = document.createElement('script');
    script.setAttribute('src', src);
    script.setAttribute('async', 'async');
    script.setAttribute('type', 'text/javascript');

    document.head.appendChild(script);
};

clippy.load._getAgentDfd = function (name) {
    var dfd = clippy.load._data[name];
    if (!dfd) {
        dfd = clippy.load._data[name] = $.Deferred();
    }
    return dfd;
};

clippy.ready = function (name, data) {
    var dfd = clippy.load._getAgentDfd(name);
    dfd.resolve(data);
};

clippy.soundsReady = function (name, data) {
    var dfd = clippy.load._sounds[name];
    if (!dfd) {
        dfd = clippy.load._sounds[name] = $.Deferred();
    }

    dfd.resolve(data);
};

/******
 * Tiny Queue
 *
 * @constructor
 */
clippy.Queue = function (onEmptyCallback) {
    this._queue = [];
    this._onEmptyCallback = onEmptyCallback;
};

clippy.Queue.prototype = {
    /***
     *
     * @param {function(Function)} func
     * @returns {jQuery.Deferred}
     */
    queue:function (func) {
        this._queue.push(func);

        if (this._queue.length === 1 && !this._active) {
            this._progressQueue();
        }
    },

    _progressQueue:function () {

        // stop if nothing left in queue
        if (!this._queue.length) {
            this._onEmptyCallback();
            return;
        }

        var f = this._queue.shift();
        this._active = true;

        // execute function
        var completeFunction = $.proxy(this.next, this);
        f(completeFunction);
    },

    clear:function () {
        this._queue = [];
    },

    next:function () {
        this._active = false;
        this._progressQueue();
    }
};


clippy.shortJokes = [
    "What did the bartender say to the jumper cables? You better not try to start anything.",
    "Don't you hate jokes about German sausage? They're the wurst!",
    "Two artists had an art contest... It ended in a draw",
    "Why did the chicken cross the playground? To get to the other slide.",
    "What gun do you use to hunt a moose? A moosecut!",
    "If life gives you melons, you might have dyslexia.",
    "Broken pencils... ...are pointless.",
    "What did one snowman say to the other snowman? 'Do you smell carrots?'",
    "How many hipsters does it take to change a lightbulb? It's a really obscure number. You've probably never heard of it.",
    "Where do sick boats go? The dock!",
    "I like my slaves like I like my coffee: Free.",
    "My girlfriend told me she was leaving me because I keep pretending to be a Transformer... I said, No, wait! I can change!",
    "Old Chinese proverb: Man who not shower in 7 days makes one reek.",
    "What did the owner of a brownie factory say when his factory caught fire? 'I'm getting the fudge outta here!'",
    "What form of radiation bakes you cookies? A gramma ray",
    "Bee jokes, courtesy of my niece (age 8). What did the bee use to dry off after swimming? A *bee*ch towel. What did the bee use to get out the tangles? A honeycomb.",
    "What's the loudest economic system? CAPITALISM",
    "I went for a job interview today... The interviewer said to me, What would you say your greatest weakness is? I said, I think Id have to say my listening skills are my greatest strength.",
    "Who was the knight that invented the round table? Sir Cumference. (via friend who got this from a street performance group in the England area of Epcot)",
    "What did the German air force eat for breakfast during WW2? Luftwaffles",
    "I the shell off a snail yesterday... you'd think it would move faster, but it was really kinda sluggish.",
    "What did the number zero say to the number eight? 'Nice belt.'",
    "What's worse than a centipede with sore feet? A giraffe with a sore throat",
    "What's red and bad for your teeth? A brick.",
    "Why did the Chicken cross the playground? To get to the other slide",
    "Did you hear about the French chef who committed suicide? He lost the huile d'olive",
    "Wanna hear a joke about unemployed people? Nevermind, they don't work.",
    "Knock Knock Who's there Boo!! Boo who? Don't cry, it's only a joke",
    "How much did the skeleton charge for his excellent legal services? An arm and a leg.",
    "Why do gorillas have such big nostrils? Cos they got big fingers.",
    "What is the difference between a Siberian husky and an Alaskan husky? About 1500 miles.",
    "What do vegan zombies eat? GRAAAIIINSSS!",
    "What's the difference between a Thai man and a Thai woman? Pls help.",
    "What do you call a car that eats other cars? A carnivore.",
    "Why did the golfer wear two pairs of pants In case he gets a hole in one",
    "An Olympic gymnast walked into a bar... She didnt get a medal...",
    "What does a mexican magician make for breakfast? Toast-tah-dahs!",
    "Why don't Bond villains feel cold in the winter? Because they dress in lairs.",
    "What did the figurine say when the boot flew past her protective dome? 'That was a cloche call!'",
    "What was Carl Sagan's favorite drink? Cosmos.",
    "What is the medical term for owning too many dogs? [A Roverdose](http://i.imgur.com/BtyF5ys.jpg)",
    "Knock knock... Who's there? I did up. I did up-who?",
    "I like my jokes they way I like my robots. Killer.",
    "What type of school did Sherlock Holmes go to? Elementary :)",
    "My friend told an out of place joke about police searches. But I don't think it was warranted.",
    "The Dalai Lama walks into a pizza store... and says, 'Can you make me one with everything?'",
    "Why did the vampire use mouthwash? Because he had bat breath",
    "What did the corn say when it was complemented? Aww, shucks!",
    "What did the green grape say to the purple grape? - 'Breathe, stupid!'",
    "Why did the Fall break off from all the other seasons? Because it wanted autumnomy",
    "If I ever fire someone who is a Taylor Swift fan I'll say 'I knew you were trouble when you clocked in.'",
    "What do you do if a cow is in the middle of the road you're driving on? steer clear",
    "What do you call a blind, legless buck? No eye-deer. EDIT: I totally messed this joke up. Please give me another chance with another joke?",
    "What do you get for the women who has everything? A divorce, then she'll only have half of everything.",
    "There was a depressed sausage... he thought his life was THE WURST.",
    "What's a dog's favorite mode of transportation? A waggin'",
    "Why did the sand dune blush? Because the sea weed",
    "What happened to the tyrannical peach? He got impeached!",
    "Why do elephants paint their toenails red? So they can hide in cherry trees. You ever seen an elephant in a cherry tree? *Then it's working*.",
    "what did the mexican firecheif name his kids... Hose A and Hose B",
    "What did the German physicist use to drink his beer? Ein stein. - From Big Nate, as told by my kid.",
    "What did earth say to the other planets? You guys have no life!",
    "One time we ran out of soap- -so we had to use hand sanitizer!!!",
    "Wanna hear a dirty joke? Two white stallions fell in the mud.",
    "What did one frog say to the other frog? Time's fun when you're having flies.",
    "Why did the boy take a pencil and paper to bed? He was told to draw the curtains before going to sleep.",
    "Clean joke about sorority girls Why do sorority girls only travel in odd numbered groups? Because they *can't even*!",
    "What did the 8 say to the 0? Hey, fatty",
    "KNOCK KNOCK! WHO'S THERE! ***sombrero **** ^sombrero who,,,? *****SOMBRERO-VER THE RAINBOW****",
    "I'm reading a book about anti-gravity... ... It's impossible to put down",
    "What name is given to the most chickens ? pEGGy",
    "Why is Dr. Frankenstein never lonely? He's good at making friends.",
    "What do you call a pig that does karate? *A pork chop.*",
    "What was the car doing in the dressing room? Changing attire.",
    "What do you call a pile of dogs? A ruff terrain.",
    "How do you prepare for a party in space? You Planet Thanks u/BostonCentrist",
    "What do you get when you cross an octopus with a cow? A stern rebuke from the Ethics Committee, and an immediate cessation of funding.",
    "Why did the bicycle fall over? Because it was two-tired",
    "Two bookworms were having a dispute... ...across an open book until one bookworm moves closer to the other and says, 'well then, I'm glad we're on the same page.'",
    "Which kitchen appliance tells the best jokes? The beater - he cracks everybody up!",
    "Why did the jellyroll? He saw the apple turnover.",
    "Why did the chicken? Q: Why did the chicken cross the road naked? A: Because chickens don't wear clothes.",
    "What do you call Protestants who want to save a dime? Econoclasts.",
    "What do dwarves use to cut their pizza? Little Caesars",
    "What did the fish say when it hit the wall? Dam.",
    "What's that coffee drink with icecream? I used to know it, but... Affogato.",
    "Where did Napoleon keep his armies? In his sleevies!",
    "makeup beauty Omg = oh my girl so cute next morning without makeup Omg = ohh My God omg/omg = life without wife",
    "Time flies like the wind. Fruit flies like... bananas!",
    "What did Vincent van Gogh call himself when he joined the Justice League? The Starry Knight",
    "Why did the boy take a ladder to school? He wanted to go to high school.",
    "What's the best thing to put into a pie Your teeth.",
    "What kind of house does a stoned loaf of bread live in? A high rise",
    "What do you get when you cross a firecracker and a duck? A firequacker.",
    "What's a baker's biggest fear? Something going a-rye while they're raisin' bread.",
    "What's the best way to get a hold of Vin Diesel? IM Groot. : D Source: https://www.youtube.com/watch?v=Lvlj1u9S258",
    "Why did everyone trust the marsupial? Everything he said was troo",
    "This dermatologist waits a month to diagnose a skin disorder... She's reluctant to make a rash decision.",
    "Why are manhole covers round? Because manholes are round.",
    "What did one casket say to the other? 'Is that you coffin?'",
    "How does a hamburger introduce his girlfriend? Meat patty! Thought of you guys!",
    "How does a mathematician get Tan? Sin/Cos",
    "What is a martian's favourite chocolate? A mars bar",
    "Where did Sally go after the explosion? Everywhere.",
    "What did the cow say when it saw the farmer twice in one day? Deja Moo!",
    "Congratulation on the new baby, from your family... except from me because I don't really care.",
    "What is agitated buy joyful? A washing machine",
    "What do you call a sleeping dinosaur? A dino-snore.",
    "Breaking news! Energizer Bunny arrested... ...charged with battery.",
    "It's an emergency! I need underwear jokes. My baby sister needs underwear jokes for some mysterious reason. I need your guys help!",
    "What did the butcher say when he handed his customer an empty pack of hotdogs on halloween? Happy halloweenie",
    "Can February March? No, but April May.",
    "What's the internal temperature of a Taun-Taun? Lukewarm",
    "What's it called when a planet orbits its sun 8 times? An orbyte",
    "Why are there only two hundred and thirty nine beans in a bowl of bean soup? Because just one more and it would be two-farty",
    "What does a nosey pepper do? It gets jalapeno business.",
    "Why don't blind people like to go skydiving? It scares their seeing-eye dog.",
    "what does clark kent have for breakfast? alter-eggos",
    "I met Phil Spector's brother Crispin the other day. He's head of quality control at Lays.",
    "Who is William Shatner's mythical nemesis? The Lepre-khaaaaannnnn!!!!!",
    "Two drums and a cymbal fall off a cliff... ba-dum tss",
    "Why does Mario hate Punchbug? Because he bruises like-a Peach!",
    "Where do pots go on vacation? JaPAN! From my 9 year old.",
    "When German children play a game involving touching each other with bread... it's called gluten tag. I'll show myself out.",
    "My laptop is so dumb. Every time it says 'Your password is incorrect', I type in: 'incorrect' and the silly thing still tells me the same thing.",
    "Did you hear about the scarecrow who won the Nobel Prize? He was outstanding in his field. From: http://www.dadlaughs.com",
    "A man was caught stealing in a supermarket today... ...while balanced on the shoulders of a couple of vampires. He was charged with shoplifting on two counts.",
    "why didn't the bicycle cross the road? because it was two-tired.",
    "Every morning I run around the block 5 times... ...Then I slide the block back under the bed and go back to sleep",
    "Says she: 'Say something soft and sweet' Says he: 'Marshmallow.'",
    "Why do cicadas stay up all night chirping irregularly, unable to sleep? Their cicadan rhythm is off",
    "What do you call a monk that operates a door unlocking service? A monkey. (p.s. I have a wonderful, terrible love for bad jokes)",
    "What do you call people who pretend to be Irish on St. Patrick's Day? Counterfitz",
    "What did the 0 say to the 8? Nice belt.",
    "I love when I have dramatic realizations over my morning cereal... ... I call 'em 'breakfast epiphanies'",
    "Definitions Bigamist - An Italian fog. Myfunsalow - 'I am broke' in Italian. Innuendo - Italian for suppository.",
    "Have you heard what I think of windmills? Big Fan.",
    "Max wondered why the ball was slowly growing larger... and then it hit him.",
    "I saw a documentary on how they make jeans... It was riveting.",
    "What goes 'Hahahahaha...*thud*'? Someone laughing their head off",
    "Did you hear about the homemade poison ivy remedy? You can make it from scratch.",
    "What did the apple say to the pear? [Man, go] away!",
    "When do elephants have eight feet? When there are two of them.",
    "I bought a duckdoo yesterday! 'What's a duckdoo?' 'quack, quack'",
    "What do you call Batman skipping church? Christian Bail.",
    "A man started to throw words beginning with 'th' at me I dodge this, then and there but I didn't see that coming - Tim Vine",
    "Why did the mobster buy a planner? So he could organize his crime",
    "James Bond went to get a haircut. The barber asked him if he wanted to dye his hair as well. Bond replied 'Dye another day.'",
    "I named my cat 'Curiosity'. He killed himself ... Nine times.",
    "Why do they make Raisin Bran commercials? For raisin bran awareness.",
    "What do you call a bald porcupine? Pointless!",
    "Where does the thumb meet its type? At the SPACE BAR! reddit is fun! I'm staring at the keyboard tryin' to think up a joke and voila'!",
    "What's Beethoven's favorite fruit? A ba-na-na-naaaaa",
    "I'm getting mighty fed up with these sheep-human hybrids! What is with ewe people!?",
    "What the plate say to the other plate? Dinners on me",
    "My finger became really swollen after I jammed it Friday. And thats how I found out Im allergic to jam.",
    "Sports: So how's the shoestring game goin'? Right now, it's ***ALL TIED-UP!*** Oh my-oh-my! I couldn't find a cornylamejokes subreddit, so... ~Skip",
    "I wanted to put a pizza joke here ...but it was too saucy.",
    "What do you call a cow that just gave birth? Decaffeinated",
    "Why did the bee go to the doctor? Because he had hives.",
    "How many ears does Captain Picard have? A right ear. A left ear. And a final front ear.",
    "What type of doctor prescribes Coke and 7-up for a living? A Poptometrist!",
    "What's grey? A melted penguin!",
    "Why was the healthy potato not allowed on the plane? He was on the 'No Fry' list.",
    "I saw an all frog production of Frozen yesterday... It was toad-aly cool!",
    "Just found this sub the other day and I've come to this realization... Currently, this subreddit seems to be in quite the pickle.",
    "If you ever get cold, just stand in the corner of a room for a while. *They're normally around 90 degrees.*",
    "A farmer in (x-town) who rolled over a cart of horse manure... Is reported in 'stable condition.'",
    "What does a can of tuna say? Premium flaked tuna Best before dd/mm/yy",
    "How many magazines did the racquetball footwear company make before going out of business? Tennis shoes (Also: can anyone think of a more succinct buildup? It seems kinda unwieldy to me)",
    "Why was the actor detained by airport security? He said he was in town to shoot a pilot.",
    "What did the llama say when asked to a picnic? Alpaca lunch!",
    "What do kids eat for breakfast? Yogoat!",
    "Did you hear about the casting for the new Batman movie? People have really Ben Affleckted by it.",
    "What electronic device leaves behind a lot of broken glass? A PC, seeing how they typically run on Windows!",
    "Why did the orange move to veggieland? So he could live in peas and hominy.",
    "A blind man walks into a bar. And a table. And a door. And a staircase. I don't think hes alright now.",
    "What do you call beef that's been burned? A mis-steak.",
    "How do cows get their gossip? They herd it through the bovine.",
    "[ This one from the great /u/KingOfRibbles ] 'My sink was a bit dirty-' '-but all it needed was a little ...wiping!!!'",
    "Why doesn't the Sun go to college? Because he has a million of degrees.",
    "What do you call a sheep with no legs? A cloud.",
    "JKLMNOPQRST That's all that stands between U and I :)",
    "Original physics joke. I'm very proud. I was organizing my desk the other day and the Entropy Police gave me a ticket for disturbing the chaos.",
    "There were two snowmen standing in a field, one says to the other... Can you smell Carrots?",
    "What kind of jackets do Audiophiles wear? FLAC jackets",
    "Shall I tell you the joke about the body snatchers? Best not, you might get carried away.",
    "Gravity makes a terrible friend. It's always holding you down.",
    "What do Catholics and guitar players have in common? Neither of them practice.",
    "Do you know why the bike couldnt stand by itself? It was TWO TIRED!!!",
    "Just heard this on a PBS kids show... What did one wolf say to the other wolf? Howls it going?",
    "A man enters a store and asks for a color printer, the cashier asks 'What color?'",
    "An oldie but goldie! *How do you stop a charging bull?* ***Take away its credit card!*** wa-waa-waaaa! ~Skip",
    "Two antennas met on a roof . . . Two antennas met on a roof, they fell in love and got married, the ceremony was awful but the reception was brilliant.",
    "Is it just me... ...or are circles pointless?",
    "Why do cows wear bells? Because their horns don't work.",
    "What's brown and rhymes with Snoop? Dr. Dre",
    "What's the difference between a bird and a fly? A bird can fly, but a fly can't bird.",
    "I've won the war! My pants fit! **Congratulations, have you lost weight?** _Even better... I've bought new pants!!!_",
    "Two drums and a cymbal fall off a cliff. Buh dum tss!",
    "What is Mozart doing right now? *Decomposing*",
    "Whatever you do, always give 100%... Unless of course, you're donating blood.",
    "What did papa butter say to troublesome son butter? You had *butter* behave now, alright son? I sure know you don't want to get *whipped*!",
    "Why does the dog go to the gym? He wants to get ruff",
    "What kind of beer does a cow brew? Heifer-weizen.",
    "How do you make a squid laugh? Ten tickles.",
    "What cars do wolves drive? Auuuuuuuuuuuuudis!",
    "What do you call a cow that doesn't give milk? A Milk Dud.",
    "What did the American call Karl Marx when a shrine was dedicated to him in Japan? A Kami.",
    "Why are locomotive drivers so good at driving locomotives? Because they were trained.",
    "What do you call a number that cant keep still? A roamin numeral.",
    "Why did the redditor go to /r/zelda? To boost his link karma! (X-post from /r/Jokes)",
    "What did the Tin Man say when he got run over by a steamroller? Curses! Foil again!",
    "How can you tell that a straight pin is confused? Just look at it. It's headed in one direction and pointed in the other.",
    "What is an astronaut's favorite meal? Launch",
    "What do you do to dead chemists? You barium.",
    "Why did the tomato turned red? Because it saw the salad dressing",
    "Why are contortionists always angry? Their work usually has them pretty bent out of shape.",
    "I never buy Velcro It's such a rip off.",
    "How do you unlock a monastery door? With a monk key.",
    "What is the ardent task of searching for a new wallpaper called? Running a Backgroud Check.",
    "When does one play a corny game? You play it by ear.",
    "The Great Yarn Race **Joe:** Did you hear about the great yarn race? **Jane:** No. Who won? **Joe:** Well, they had to weave their selves through the obstacles and in the end, it was a tie.",
    "a red ship and a blue ship crashed on an island together the survivors were marooned.",
    "Three tomatoes are walking down the street... A papa tomato, a mama tomato, and a baby tomato. The baby tomato starts falling behind so the papa tomato squishes him and says, Ketchup!",
    "What happens at night in Bangladesh? It gets Dhaka",
    "Why didn't the baby oyster share her little pearl? She was a little shellfish.",
    "Why did Humpty Dumpty have a great fall? To make up for a lousy summer.",
    "What kind of boats do smart people ride on? Scholar ships!",
    "How do you turn soup into gold? You add 24 carats!",
    "A photon checks into a hotel... The bellhop asks him if he has any luggage and the photon replies 'No. I'm travelling light.'",
    "I farted on an elevator, it was wrong on so many levels. From /r/PeterL",
    "What language do they speak in Holland? Hollandaise.",
    "Last night, I had a dream that I was walking on a white sandy beach... At least that explains the footprints I found in the cat litter box this morning...",
    "Why should you always bring 2 pair of trousers when golfing? In case you get a hole in one.",
    "Today I'm 45. But with the wind chill I feel like 32.",
    "/r/pickle welcomes it's newest ally. It's always good to have clean jokes. I due urge the mods to add us to your sidebar, due to the fact that you are on ours.",
    "Why are cats bad storytellers? Because they only have one *tale*",
    "Balloon's What's a balloon's favorite genre of music? Pop.",
    "Why was the dolphin happy and the shark depressed? The sharks life lacked porpoise.",
    "What Johnny Mercer song does December 21st remind you of? Autumn Leaves.",
    "What's a comedian's favorite candy? Laffy Taffy.",
    "There's a guy at the office today wearing full camo. At least I think so... I haven't seen him in a while.",
    "Why do ghosts like to ride elevators? It lifts their spirits.",
    "How do you call for a bath? With a Teletubbie.",
    "Who was the chicken's favorite musician? BAAAACH BACH BACH BACH",
    "X-post from r/jokes: Mommy! I found a $10 bill today, but I threw it away, cus it was fake. 'Oh, how did you know it was fake?' 'It had two zeroes instead of one.'",
    "How much does it cost a pirate to get his ear pierced? A buccaneer!",
    "What do you call the ghost of a chicken? A poultrygeist!",
    "What's invisible and smells like carrots? Bunny farts.",
    "What did fish say when she hit the wall ? Dam(n) !!!",
    "Why are colds such bad robbers? Because they're so easy to catch!",
    "A man walks into an apple store and...... farts every one is really angry and there all shouting so he says it's not my fault you don't have windows",
    "Why are pirates so mean? I dont know, they just arrrrrrrrr!",
    "As I watched the dog chasing his tail, I thought, Dogs sure are easily amused!... ...then I realized I was watching the dog chasing his tail.",
    "What happened to the ghost who couldn't scare? He had to join a support group since he couldn't handle his boos.",
    "Did you hear about the butcher who backed into the meat grinder? He got a little behind in his work.",
    "What do vegetarian zombies eat? Graaaaaaiiiins......",
    "Why did the lion spit out the clown? Because he tasted funny.",
    "What was Marie Curie's fitness program on the airwaves called? Radio-Activity",
    "I went to the dermatologist about something on my neck- -and they said I just needed to scrub it!!!",
    "Why was the math book sad? It had a lot of problems",
    "What is the swamp-dwellers favorite form of extraterrestrial life? the Martians",
    "Why do good farmers only excel when they are actually farming? (X-post from /r/jokes) Because they are out standing in their field.",
    "The cheesiest joke ever. 'I don't feel grate.' -- Block of Cheese before it got shredded.",
    "Every single morning I get hit by the same bike... It's a vicious cycle.",
    "What do get when you cross 50 female pigs with 50 male deer? One hundred sows and bucks?",
    "You know youre getting old when Santa starts looking younger.",
    "I hate when you're trying to be cheesy but everyone is laughtose intolerant.",
    "What is irony? Irony is when something has the chemical symbol Fe.",
    "What do you call a cow with no legs? Ground beef!",
    "was going to make a joke about science but I know for I wont get a reaction...",
    "The other day, I sent my girlfriend a huge pile of snow... I called her up and asked, ''Did you get my drift?''",
    "What do you call... What do you call an Italian romance novel model who's let himself go? Flabio.",
    "How many tickles does it take to make an octopus laugh? Ten tickles.",
    "How did the geologist develop a career as an expert in sinkholes? He fell into it.",
    "A bear and a rabbit are pooping in the woods The bear asks the rabbit - 'do you have a problem with poop sticking to your fur?' 'Nope' So the bear wipes his butt with the rabbit.",
    "Overheated some milk in a lab experiment today... ...and asked the teacher if it would affect the result. Her response? 'To a degree.'",
    "What's brown and sticky? A stick",
    "I was gonna make a joke on Reddit.. .. but I guess you've already Reddit somewhere.",
    "Did you hear about the Antennas that got married? The wedding was lame, but the reception was great!",
    "What is the most religious unit in electrical engineering? Ohm.",
    "I was walking in the desert and saw a redwood tree. I knew this must be a mirage, so I ran into it. To my dismay, the tree and I collided. I guess it must have been an obstacle illusion.",
    "A Bagpiper, a Kangeroo, an Irish poet, and Mother Theresa walk into a bar . . . . . . . the barman, who was drying a glass, lifted his head and asked, 'Is this some kind of joke?'",
    "How many catholics does it take to change a lightbulb? CHANGE?!",
    "Why don't you want a turkey at your thanksgiving dinner? Because it'll gobble up everything.",
    "What fruit do Romeo and Juliet eat? Cantelope",
    "Why was 9 afraid of 20? 28 29's",
    "What did one snowman say to the other? Do you smell carrots?",
    "What do you call a race run by baristas? A **decaf**alon",
    "What do you call a stegosaurus with carrots in its ears? Anything you want to - it can't here you!",
    "What bird can write underwater? A ball-point Penguin!",
    "What did the horse order at the bar? Chardaneiiiiiiggghhhhh",
    "What was Beethoven's favorite fruit? BA-NA-NA-NA!",
    "Why did the tissue get up and dance? It had a little boogy in it.",
    "Today a man knocked on my door and asked for a small donation towards the local swimming pool. I gave him a glass of water.",
    "What do sea monsters eat? Fish and ships.",
    "What did Virginia get when she walked into the pet shop? (state joke) A New Hampshire",
    "The other day, I was looking through my socks, when I found one had a hole in it... 'darn it...' I muttered.",
    "What do you call the James Brown songs no one listens to? Defunct funk.",
    "Did you see the guy at Walmart hiding from ugly people?",
    "You know what I hate about fashion designers? They are so clothes-minded.",
    "What do you call a spider with no legs? A raisin",
    "A man walks into a bar... He says 'Ow'",
    "Which is the most silky planet? Satin!",
    "What does a train full of grain's whistle sound like? 'COUS, COUS!!!'",
    "What do you say to someone who is making a cardboard belt? 'That's a waist of paper!'",
    "Why didn't the skeleton go to the party? He had no *body* to go with",
    "What do you call a race ran by female horses? A mare-a-thon.",
    "If April showers bring May flowers, what do May flowers bring? Pilgrims",
    "What do you call a Moroccan candy distributor? Fez dispenser.",
    "Did you hear about the production delays at that company that makes scales using lengthy pipes? They had really long weights.",
    "We don't allow faster-than-light neutrinos in here, says the bartender. A neutrino walks into a bar.",
    "Almonds on the tree; Amonds off the tree cause to get them off the tree you hafta shake the 'L' out of them!",
    "Did you hear the one about the constipated mathematician? He worked his problem out with a pencil.",
    "How do crazy people go through the forest? They take the psycho-path.",
    "What did the mama pig give her baby pig for its rash? ***OINKMENT!*** &gt; (This exchange that I found on /r/tumblr makes this joke even funnier to me: &gt; http://i.imgur.com/EzT0Bkd.jpg)",
    "What do you call a one-eyed dinosaur? Doyouthinkhesarus (Credit goes to whoever submitted that to the Coffee News)",
    "Why do bears hate shoes so much? They like to run around in their bear feet.",
    "What do you call a cow with no legs? Ground beef.",
    "How do you think the unthinkable? With an itheburg.",
    "What do you call a bug that can't talk? A hoarse fly.",
    "Always put sunglasses on your tree. Then, you'll get the proper shade.",
    "Today I brought a computer back from the dead. I've decided that this makes me a techromancer.",
    "What is tuba plus tuba? Fourba!",
    "Two dogs are going on a walk down the street They walk past a few parking meters and one dog says to the other, 'Hey, check it out! Pay toilets!'",
    "Why couldn't Elsa hold on to a balloon? She would always let it go.",
    "How can you tell if a hamburger was grilled in space? It's a little meteor.",
    "What did the amazed Kazakhstani say? That's Astana-shing",
    "Why don't blind people skydive? Because it scares their dogs too much!",
    "When is a door not a door? When it's a jar",
    "What's Medusa's favorite kind of cheese? Gorgonzola.",
    "Why Does Snoop Dogg need an umbrella? For drizzle, my nizzle. :D",
    "My dental hygienist retired after working 55 years... All she got was a lousy plaque...",
    "I've just made a meeting site for retired chemists It's called Carbon Dating",
    "What do you call a parade of rabbits hopping backwards? A receding hare-line.",
    "Two wrongs don't make a right... but three lefts make a right. And two Wrights make a plane 6 lefts make a plane.",
    "Why did the library book go to the doctor? It needed to be checked out; it had a bloated appendix.",
    "A frog decided to trace his genealogy one day... He discovered he was a tad Polish.",
    "Two artists had an art contest... It ended in a draw",
    "What did the fish say before he hit the wall? Oh, Dam.",
    "What's the smartest dinosaur? Thesaurus Rex! omg, I crack myself up! ~Skip",
    "I like camping but... it's so in tents",
    "If the house is in the kitchen, and Diana's in the kitchen, what's in Diana? A state (Indiana)",
    "A sentence and a phrase is arguing, what did the sentence say? I know where you're coming from this phrase, but I can't see your point.",
    "What's brown and sounds like a bell? Dung.",
    "What's a balloon's favorite genre of music? Pop.",
    "Did you hear about what happened with the elk? It was really amoosing.",
    "I got hit hard in the head with a can of 7up today... I'm alright though, it was a soft drink.",
    "What's so great about living in Switzerland? Well, the flag is a big plus.",
    "Why did the girl quit her job at the donut factory? She was fed up with the hole business.",
    "What colour T-shirt would win a race? Red, because it runs the most.",
    "Why was the Egyptian kid confused? Because his daddy was a mummy",
    "After watching a strongman competition... it amazed me to see how much the human body can lift without pooing itself.",
    "What did the O say to the 8? Nice belt.",
    "Why was the burrito embarrassed? It saw the salad dressing.",
    "How many tickles does it take to make an octopus laugh? Ten tickles",
    "What do you call a bunch of Asian bears roaring? Panda-monium.",
    "What does a rock do all day? Nothing. (this joke was made by daughter when she was 5)",
    "The joke of 2016 Trump",
    "How does Han Solo like to get around Endor? Ewoks",
    "I don't have the faintest idea why I passed out Just a short pun",
    "What do you call a vegetarian? A hopeless romaine-tic",
    "I want to die peacefully in my sleep, like my grandfather... Unlike the passengers in his car who were screaming and yelling! http://www.thedailyenglishshow.com/friday-joke/98-how-to-die/",
    "What do you call a chicken crossed with a cow? Cock-a-doodle-moo!",
    "Kind of a kid joke What kind of cereal do zombies like? Kellog's All Brain",
    "What did the farmer say when he lost his tractor? Where's my tractor?",
    "What do you call a blind deer? No-eye deer. What do you call a blind deer with no legs? *Still* no-eye deer.",
    "Why are proteins so cranky? Because they're made of a mean ol' acids.",
    "What do you call a pachyderm that doesn't matter? Irrelephant.",
    "What are caterpillars afraid of? DOGerpillars!",
    "Why should you never invite a boxer to a party? He always throws the punch.",
    "How much does it cost for a pirate to get his ear pierced? A buccaneer.",
    "I was addicted to the hokey pokey but I turned myself around.",
    "Why didn't the bicycle cross the road? ...he was two-tired...",
    "Why did the Russians use peanuts for torture in the Cold War? Because in Soviet Russia, Nut Cracks You!",
    "How do trees get online? They just log in...",
    "Apparently vegetables can hear when they're being eaten. So I always drown mine in salad dressing first. Because it's the Romaine thing to do.",
    "Why were Wrigley, Doublemint, and Orbit watching CNN? To find out the latest on gum control legislation.",
    "I wanna make a joke about sodium. But Na.",
    "Why couldn't the melons be together? Everyone knows melons cantaloupe.",
    "Why couldn't the alligator satisfy his lover? He had a reptile dysfunction.",
    "What's a blind person's favorite fast food joint? Taco Braille",
    "The preacher today used Star Wars as a sermon illustration. I felt it was a little forced.",
    "What did the grape say when it got stepped on? Nothing, it just gave a little wine",
    "Why are giraffes' necks so long? Because their heads are so far away from their bodies.",
    "what's orange and sounds like a parrot? a carrot.",
    "Why was the panda crying? He had a bambooboo. Aonther one from my 9 year old.",
    "Why does Thor have insomnia? He's up all night to get Loki.",
    "Did you hear the one about the three eggs? Too Bad.",
    "/r/askreddit thread 'What's the best clean joke you know' with thousands of replies http://www.reddit.com/r/AskReddit/comments/zrotp/whats_the_best_clean_joke_you_know/",
    "Chemistry Student I'm a science teacher and once I asked one of my lazy students if he knew the chemical symbol for sodium. He replied, 'Na, I don't'. Lucky sod, he's only ever right periodically.",
    "What do you call a smart pig? Swinestein.",
    "So, I have this new knock knock joke You start... (when you get it)",
    "Captain Ahab's crew were highly efficient sailors In fact, they were running like a whale oiled machine.",
    "What kind of fish would be good to tune a piano? Oh, you guessed it right ... the tuna fish!",
    "Bulls from all over India sent a petition to SC asking it to classify them as 'Jallikatu Bulls'.",
    "Did you hear about NASA finding bones on the moon? Yeah,the cow didn't make it.",
    "Some people have trouble sleeping... ...but I can do it with my eyes closed...",
    "I think I want a job cleaning mirrors... ...it's just something I can see myself doing.",
    "What did the eye say to the other eye? Something smells between us.",
    "Did you hear about the kidnapping in Delaware? Don't worry, he eventually woke up.",
    "What animal is best at hitting a baseball? A bat!",
    "Why did the octopus beat the shark in a fight? Because the octopus was well armed.",
    "I'll always remember what my uncle said before he passed on up... 'Flying houses? Talking dogs? That movie looks dumb.'",
    "Whats Red and Smells Like Blue Paint? Red Paint",
    "Why did Little Miss Muffet have GPS on her Tuffet? To keep her from losing her whey.",
    "What do you call an obese psychic that works at a bank? A four chin teller",
    "A man walked into a doctor's office . . . He said to the doctor: 'I've hurt my arm in several places.' The doctor said: 'Well don't go there any more.'",
    "Why did the chicken lay an egg? (Quoted from daughter at age 3) To get food for her babies!",
    "Why do Gastroenterologists have such a passion for their job? Because they find the components of one's stomach very intestine.",
    "Science joke The bartender says 'we don't serve your kind here' He orders a drink A Tachyon walks into a bar Who wants to hear a Tachyon joke?",
    "How much does it cost a pirate to pierce his ears? A buccaneer!",
    "There's a TV channel where you can buy all the Pope's speeches It's called 'Papal View'.",
    "So today is Earth day on what grounds are we celebrating?",
    "What did one slice of bread say to the other at the end of a game of chess? 'It's stale, mate.'",
    "I heard it's a good night to see the Perseid meteor shower . . . . . . but I haven't heard how it got dirty.",
    "Why shouldn't you have coffee while on the clock? Because that would be 'grounds' for termination!",
    "What is green, has four legs and if it fell out of a tree and landed on you it would kill you? A pool table!",
    "What do you call a Frenchman in sandals? Philippe Philoppe.",
    "What do you call a truthful piece of paper? Fax.",
    "What type of melon would Romeo and Juliet have been? Cantaloupe.",
    "What kind of turns do letters take? U-turns! *From my 9 year old son yesterday. Fixed typo.",
    "What did one computer CPU say to the other after getting hit? Ow! That megahertz!",
    "Knock knock. Who's there? A cow. A cow who? Not a cow 'who'! A cow moos. An owl says 'who'.",
    "Did you take a shower today? Why, is one missing?",
    "What did the Hungarian say to the annoying kid? 'You're nothing budapest!'",
    "I was thinking of ways to become transgender... So I figured I'd fly to Paris. Because then I'd be abroad.",
    "How does the Mummy plan to destroy Superman? He's gonna lure him in to the crypt tonight.",
    "What do you call a cow with one leg? Steak.",
    "What concert tickets should cost $0.45? 50 cent feat. Nickelback :P",
    "A woman files for divorce from her husband... citing that he makes too many Star Wars puns. When asked if this is true the husband says, 'Divorce is strong with this one.'",
    "Why can't you run in a camp ground? You can only 'ran'; it's past tents.",
    "What kind of soda do dogs drink? Barq's Root Beer.",
    "I saw a middle aged man staring at a picture of his very first steps. With tears in his eyes, he told me he regrets ever replacing the steps with an elevator.",
    "[OC] Why couldn't the dragon breathe fire? He had a cold",
    "What do fish smoke? Seaweed!",
    "Why is it a bad idea to get in a relationship with a statue? Because it's not going anywhere.",
    "Where do you go to weigh a pie? Somewhere over the rainbow weigh a pie. (sounds like way up high)",
    "I forgot where I threw my boomerang. Oh wait.. It's coming back to me now.",
    "What did the Estonian student say in language class? I'll never Finnish. *dodges tomato*",
    "What do you call the delivery boy at an Indian restaurant? Curry-er.",
    "I had to clean out my spice rack and found everything was too old and had to be thrown out. What a waste of thyme.",
    "Why were the breakfast potatoes running around hitting each other? HashTag!",
    "What's the difference between Bird flu and swine flu? For one you get tweetment and the other you get oinkment...",
    "Where do dogs go when they lose their tails? To a retail store.",
    "I have the opposite of a photographic memory i have a potatographic memory.",
    "Why did the vegetable band break up? They couldn't keep a beet.",
    "Why did the Spy cross the road? 'Cause he wasn't really on your side.",
    "What's orange and sounds like a parrot? A carrot",
    "I invented a time machine... ...next week.",
    "Who was the only novelist with both direction and magnitude? Vector Hugo.",
    "My plumber finally quit on me... He couldn't take any more of my crap. Sorry that this isn't a CLEAN joke. Heh",
    "I went to the store and asked for a one handed sailor... he said sorry, 'I'm a wholesaler.'",
    "what do you call an effeminate dwarf? A metro-gnome....",
    "I told my girlfriend she drew her eyebrows on too high she looked surprised.",
    "What do you call a Jihadist that loves turkey? A Tryptophanatic.",
    "What did the Tin Man say when he got run over by a steamroller? Curses! Foil again!",
    "Why there should be a February 30th So dentists can have a day to celebrate",
    "What do you call a big pile of kittens? A meowtain.",
    "What do you call an arcade in eastern europe? czech-e-cheese",
    "My relationship is like Monopoly. She gives me too many Chances.",
    "How do you call a deer with no eyes? No idea.",
    "Why did the bicycle fall over? Because it was two tired.",
    "What happened when the man couldn't afford the mortgage on his haunted house? ...it was repossessed!",
    "My uncle wanted to give all his sheep a sex change... But it entailed too many ramifications!",
    "How many dancers does it take to change a lightbulb? 5,6,7,8",
    "What was wrong with the wooden car? It wooden go.",
    "What do caves have? Echosystems. From my 9 year-old.",
    "One fifth of people... ...are just too tense!",
    "What do you call a fish with no eye? fsh",
    "Where do rabbits like to eat breakfast? IHOP!",
    "What did the wall ask the picture? (All together now!) ***'How's it hangin'?'*** ~Skip",
    "Me have great grammar... Me learnt everything I know from Sesame Street!",
    "If I don't eat all of my food, it goes to waste. If I do eat all of my food, it goes to *waist*.",
    "What did the green light say to the red light? I love you, but I'm sick of yellow light always breaking us up.",
    "What do you call the Hamburglar's accomplice? hamburglar helpler",
    "Did you hear about the fight in the candy store? Two suckers got licked",
    "Did I tell you I'm joining a gym in Gainesborough? Because I'm all about those gains bro",
    "I have a lot of jokes about the unemployed... ...but none of them work.",
    "What is the last thing to go through a fly's mind when it hits a windshield? Its butt.",
    "Which fairground ride is made of iron? The ferrous wheel",
    "What do you call a bulimic tree? Sycamore.",
    "Why was the lobster upset? Because he found out his friends thought he was a little crabby!",
    "Did you hear about the ointment... Did you hear about the ointment that couldn't stop talking about politics? When confronted, he said he was just trying to be topical.",
    "What's the first rule of bug ownership? Watch your step!",
    "Three drums and a cymbal rolled down a hill ba dum dum ching",
    "What is invisible and smells like carrots? Bunny Farts.",
    "What did the number zero say to the number eight? Nice Belt",
    "When I grow old, I am sure I will look back at my life and say 'aaaah! my neck hurts'",
    "The pollen count  that's a difficult job! [Credit to Milton Jones]",
    "Why did the cowgirl name her pony ink? Because it kept running out of the pen!! My favorite joke when young :).",
    "Did you know yesterday was National Middle Child Day? Don't worry, no one else remembered either.",
    "Have you heard about the 2 Spanish firemen? Jose and hose B",
    "There are two types of people in this world 1. Those who can extrapolate from incomplete data",
    "What did the flat iron say to the follicle? Now let me get this straight . . .",
    "6:30 is the best time on a clock... ...hands down.",
    "I love graphs! I used to be obsessed with them... I've calmed down now though, you've gotta draw the line somewhere",
    "What kind of car did the German cowboy purchase? Audi *tips hat*",
    "Garbage men have Hefty contracts.",
    "Dolphins don't do anything by accident.. Always on porpoise.",
    "What do you call a fish with no eyes? A fsh",
    "What goes oh oh oh? Santa walking backwards.",
    "Why does a milking stool have only three legs? Because the cow has the udder!",
    "A skeleton walks into a bar orders a beer and a mop.",
    "First original joke! Why did the rapper visit the urologist? Because his flows were so sick.",
    "What's gray and all around? Everything. I'm a dog.",
    "~tips fedora at mosquito~ Mlaria",
    "Need help While scratching my ear with key few hours ago, audio on my brand new TV went off. Does anyone know good TV Service. Sh... I think my Laptop sound died too.",
    "Who's the world's greatest underwater spy? Pond. James Pond.",
    "Why was the belt locked up? Because it held a pair of pants.",
    "How many apples grow on a tree? All of them.",
    "Alrighty Kids always remember: you are what you eat So eat loads of sweets and pass on those vegetables",
    "How did the desk lamp store manager feel when thieves stole all his lightbulbs? He was delighted.",
    "Did you hear about Scrooge's drinking problem? He had a dickens of a time with spirits.",
    "Cogito Ergo Spud. I think, therefore I yam.",
    "What's the best part about twenty two year old wheels of cheese? There are twenty of them.",
    "My brother said he's incontinent. Yeah, he said he's wet his pants in nearly every nation in the world.",
    "What do you call an elephant with a poor memory? A bold and innovative departure from the hackneyed stereotypes that all too often dominate the joke-telling industry.",
    "What do you call a nose without a body? Nobody knows...",
    "How do you know ancient Egyptians loved books so much? Because they built their stuff with reads!",
    "Old game show bloopers...I miss this kind of humor today Found this video randomly http://www.youtube.com/watch?v=xv3gK2bmkAk&amp;feature=related",
    "Where do weirdos ride their bicycles? Psycho-paths. (as told by one of my coworkers)",
    "Why do sailors give their wives a bouqet of ropes instead of flowers?? It's a bouqet of forget-me-knots.",
    "What's the difference between a hippo and a zippo? One is really heavy, and the other is a little lighter.",
    "Where did the cat go when it lost it's tail? To the retail store!",
    "What do you call an Italian romance novel model who's let himself go? Flabio",
    "What do you call a lion in the circus. A Carny-vore",
    "Actually, there are but two types of people Those who can extrapolate from limited data ...",
    "Why'd the chicken cross the Mobius strip? To get to the same side.",
    "X-post from r/jokes: 'Hey! The dog you sold me yesterday just fell over and died today!' 'Huh, strange. He's never done that before.'",
    "What is the longest word in the English language? SMILES because there is a mile between the first and last letters!",
    "I had a joke about time travel but you guys didn't like it.",
    "How does the farmer count up his cows? ...with a cowculator.",
    "I would make a sparrow joke... But they don't fly very well.",
    "Why did the golfer need to buy a new pair of socks? Because he got a hole in one!",
    "Why don't you want to hang out with a dude from Chicago? Because 'Illinois you!",
    "What did the fish say when it hit the wall? Dam",
    "What does Colonel Mustard's Mexican maid call him? *(Phonetically-ish)* Mis'ser Dijon.",
    "Did you hear about the man who was accidentally buried alive? It was a grave mistake. Woohoo! I'm making these up!!",
    "What do you call a happy penguin? A pengrin!",
    "What did the green grape say to the purple grape? 'Breathe you idiot! Breathe!'",
    "Did you hear about the two monocles at the party? They made spectacles out of themselves.",
    "What do you get when you drop a piano in a coal mine? A flat minor. Night... Don't forget to tip your waitress",
    "Wanna hear a dirty joke? A white horse fell in the mud.",
    "A skeleton walks into a bar The bartender says, what will you have? Skeleton says, a beer... and a mop",
    "My daughter hit me with this one while preparing for dinner Why did the table love playing volleyball? Because it was always getting set! I think she gets it from her mother.",
    "How did the aquarium win the battle? Giant Fish Tanks.",
    "What do you call an alligator in a vest? An investigator",
    "What does a duck call a tractor? A quacktor",
    "What did daddy fish do when mommy fish got herself lost? ...He flounder",
    "There are three types of people in this world. Those who can count and those who can't.",
    "Why did the chicken kill itself? To get to the other side.",
    "Why can't you hear a pterodactyl use the restroom? Because the *p* is silent",
    "I thought about starting a business selling halos... ...but the cost of overheads was too high.",
    "Where did the team get there uniforms? New Jersey",
    "Programmers tend to byte their food",
    "What do you call a group of security guards in front of a Samsung store? Guardians of the Galaxy.",
    "I heard the best time travel joke tomorrow.",
    "What do you call a woman on a cruise ship in Mexico using the diving board at the pool? A broad abroad on a board aboard.",
    "What did the topic sentence say to the evidence? Why aren't you supporting me?",
    "What do you get when you mix Michael Jordan with Donald Trump? A Dunkin' Donut.",
    "Two horses are standing in a field. 'I'm so hungry I could eat a horse' Says the first. 'Moo!' says the second",
    "What do you call a pile of kittens? A meowtin",
    "What happens to a frog's car when it breaks down? It gets toad away.",
    "Two peanuts were walking down the street.... And one of them was assaulted",
    "If you walk into the bathroom an American and walk out an American, what are you in the bathroom? European.",
    "An ion walked up to Lost and Found and reported that he had lost an electron. The clerk asked:are you sure? The ion replied :Yes, I am positive.VCN",
    "What do you say to your sister when she's crying? Are you having a crisis?",
    "What do you call a cross between a gorilla and a monkey? A cross.",
    "What do you call it when Google Glass connects to the internet? Eye-fi.",
    "Why did the Kurd bury his music collection? His tribesman said 'ISIL is approaching, and they're coming for Yazidis.'",
    "This mallard waddled into a bar... Should've ducked.",
    "We now have TWO Wawa's by the interstate. The one on the east side of I4 is not so bad. But the other one, whoa. It's the Wawa West over there.",
    "What' the difference between roast beef and pea soup? Anyone can roast beef, but not everyone can pea soup. (As told by my 8yo, who made me laugh with a joke for the first time. Proud dad moment.)",
    "the only one of its kind on this sub Want to hear a dirty joke? horse fell in the mud!",
    "What do you call it when Batman skips church? Christian Bale.",
    "What do you call a social media platform designed for religious people who also have speech impediments? Faithbook",
    "I'm so sad because my friend is moving to Shanghai. More like Shang-bye.",
    "What do you call a alligator in a vest? Investigator.",
    "How to create a clean joke Step 1. Find a dirty joke Step 2. Clean it",
    "A skelleton goes to the bar and says 'Can I have a pint and a mop...'",
    "Did you hear about the fortune teller that... Had bad breath, calluses all over his body and couldn't win a fight? He was a Super Callused Fragile Mystic Hexed with halitosis.",
    "Why was the scarecrow promoted? Because he was outstanding in his field!",
    "My friend gave me a balloon and told me not to pop it.. but I blew it!",
    "My old roommate's bathroom was so dirty- -I had to clean the soap before using it. (Seriously.)",
    "Why did the paper follow the pencil? Because it LED THE WAY! I'm on a roll here! this is fun! ~Skip",
    "Why does a chicken coupe only have two doors? If it had four it'd be a chicken sedan!",
    "What do you call a cow with only two legs? Lean Beef!",
    "Why was the school grey? Because it was a Greyed School. I woke up with this joke in my head this morning. I think my brain is trying to kill me with horrible puns.",
    "Want to hear a clean Joke? Johnny took a bath with bubbles. Want to hear a dirty one? Bubbles is a man",
    "Why do sharks swim in salt water? Because pepper would make them sneeze!",
    "A Siri joke!: Two iPhones walk into a bar... ...Carrying a set of iPod shuffles. The bartender says: &gt; Let those iPods sing, man! He was an iSurfer on iPad mini.",
    "I used to work at an orange juice factory... I ended up getting fired because I couldn't concentrate.",
    "Just wrote a book on reverse psychology... Don't read it!",
    "Why did the melon get married in a church? Because he was in love with a cantaloupe.",
    "Why do fish live in salt water? Because *pepper* makes them sneeze!",
    "Why was the apricot late to the party? He got stuck in a jam.",
    "Passwords 123456 abcdef Password",
    "I knew I was old when I opened internet explorer.",
    "What does a storm cloud have on beneath its clothes? Thunderwear!",
    "Where does the little king keep his little armies? Up his little sleevies.",
    "'What kind of house does cheese like to live in?' 'A cottage'",
    "Why did the bullet stay home? Because it got fired!",
    "What do vegan zombies eat? GRAAAAINS",
    "What do you call an economics lecturer? Prof. it",
    "/r/cleanjokes hits 10K subscribers **/r/cleanjokes metrics:** Total Subscribers: 10,000 Subreddit Rank: 2,246 Milestones &amp; Subreddit Growth: http://redditmetrics.com/r/cleanjokes",
    "Why did the rope get put in timeout? Because he was very knotty.",
    "What do mathematicians get if they stare at the roots of negative numbers for too long? Square eyes",
    "I'm going to stand outside... So if anyone asks, I am outstanding.",
    "What is Forrest Gump's favorite pasta? Penne",
    "Where did the universe attend college? At the university.",
    "How do you find Will Smith in the winter? You search for Fresh Prints.",
    "Why did the squirrel cross the road on the telephone wire? To be on the safe side!",
    "What is Paula Deen's favorite insect? The Butterfly",
    "What do you call an antelope that wants a big wedding? Cantelope",
    "Why did no one ever consider Tony Stark (the Iron Man) a protagonist? Because he was always cited as the Anthony hero.",
    "What's the difference between a firstborn prince and a baseball? A baseball is thrown to the air.",
    "What do you call an Autobot who works in an overpriced makeup store at the mall ? Ulta Magnus!",
    "I can't stand Russian Dolls... They're always so full of themselves!",
    "What do you call a cow with no legs? Ground beef.",
    "A teacher asked her students to use the word 'beans' in a sentence... 'My father grows beans,' said one girl. 'My mother cooks beans,' said a boy. A third student spoke up, 'We are all human beans.'",
    "What did the mailman say when his Mail truck caught fire? That he needed to address the situation",
    "Math problem: I had 10 chocolate bars and ate 9. What do I have now? 'Oh, I do not know, DIABETES MAYBE!'",
    "Why don't cannibals like clowns? they taste funny!",
    "What's the difference between pea soup and roast beef? Anyone can roast beef...",
    "Did you know that protons have mass? &gt;Yes Well I didn't even know they were Catholic!",
    "How do you find Will Smith in the snow? Look for the fresh prints.",
    "*THUD* 'What was that?' 'My pants fell down.' '...Why so loud?' 'I'm wearing them.'",
    "What do you call an Italian guy with a rubber toe? Roberto",
    "What does a ghost cow say? *wave arms around* MoooooOOOOOOoooooooo",
    "How much does wonton soup weigh? One ton, but I don't know anyone that'd wantonly order it.",
    "Saitama tried to change his Facebook password to Goku but Facebook said it was too weak...",
    "Why did the fly fly? Because the spider spied her.",
    "What do you call a boomerang that doesn't come back? pt 2 A boomer-WRONG!",
    "What do you call a Mexican with crazy intentions? A locomotive!",
    "How many nihilists does it take to screw in a lightbulb? #",
    "Where do snowmen dance? At the snowball!",
    "Why is a shooting star better than a hamburger? It's meteor.",
    "Why did the vegetables hop into the boiling pot of water? They were part of a stewicide pact.",
    "I find hanging around in coffee shops A great way to espresso yourself",
    "First post and an original How much does a Chinese elephant weigh? .................. Wonton",
    "Heard the one about the corduroy pillowcase? It's making headlines.",
    "What do you get when you drop a piano down a mineshaft? A flat miner.",
    "Why did the spider land on the keyboard? She wanted a new website.",
    "Why did the woman buy new wine glasses? Because the ones she was using made everything blurry.",
    "What did one dry erase marker say to the other? I'm bored! (As in board) Another one from my 9 year-old.",
    "What did the tailpipe say to the muffler? I'm exhausted. What did the muffler say back? ^mmmmbfmbm",
    "What do you cal a bear with extreme mood swings? A bi-polar bear.",
    "Why did the snail drink beer? To come out of its shell!",
    "If I bought a balloon for $0.99 ... How much should I sell it for when I adjust for inflation?",
    "I went out with anorexic twins last night... 2 birds, 1 stone",
    "Why should you never invest in bakeries? Because they have a high turnover rate.",
    "a disability, a curse word and a radical interpretation of scripture walk into a bar nothing happened welcome to /r/cleanjokes",
    "What do you call a bear with no teeth? *A gummy bear.*",
    "Barely amusing Japanese joke Why are snakes so difficult to pick up in Japan? Because in Japan, snakes are hebi.",
    "A priest, a minister, and a rabbit walk into a bar... ...and the bartender says, 'What is this, a joke?'",
    "No matter what anyone said, I was never going to take the stand. It's 1000 pages, for Pete's sake!",
    "Why couldn't the skeleton cross the street? Because he didn't have the guts!",
    "Why don't crabs give to charities? They are shellfish.",
    "Why did the mortgage broker go out of business? ...because he lost interest.",
    "My buddy the hacker took the quiz 'What Beatles song best describes your life.' The answer he got: 'My Way'.",
    "I hear that in Star Wars VIII they're going to introduce Han's perpetually depressed younger brother. His name is Y Solo.",
    "Did you hear about the skeleton who didn't go to prom? He had no body to go with.",
    "What do you call a group of people standing in the arctic circle? A Finnish line.",
    "Whats brown and rhymes with 'snoop'? Dr. Dre",
    "I came into this subreddit expecting jokes about soap. I am mildly disappointed.",
    "What game do you play with a wombat? Wom.",
    "Wash the alligator clips with rubbing alcohol during flu season Protect yourself from catching a terminal illness.",
    "What age were pigs discovered in? The Saus Age.",
    "You've got to really be careful when ingesting shoes... cause they're usually laced",
    "Did you hear about the guy who invented a knife that can cut four loaves of bread at once? He's calling it the 'Four Loaf Cleaver.'",
    "Armadillo The world needs more armed dillos.",
    "This is an X and Z conversation... Y are you in the middle?",
    "What did the fish say when it swam into the wall? Dam.",
    "Heart attack When is the worst possible time to have a heart attack? When you are playing Charades.",
    "The hole in the boat So two guys steal a boat and get drunk. Kane of them goes 'Hey, there is a hole in this boat'. The other says 'don't worry it's not ours'.",
    "What is a tuna's favorite city? Albacoreque.",
    "What kind of pants does Super Mario wear? [Denim, denim, denim.](http://www.youtube.com/watch?v=c0SuIMUoShI)",
    "Why did the cop wake up his son? To stop a kid napping.",
    "I hate people who talk about me behind my back... They discussed me.",
    "What did the Buddhist say to the hotdog vendor? Make me one with everything.",
    "I came up with a joke about my old cell phone Nevermind, it tends to get terrible reception",
    "What did music tell the pancakes? B flat.",
    "What's Anakin Skywalker's favorite animal? Well, it was cats, originally, but then he was turned to the dog side.",
    "Have you seen the movie - Constipated? No? Why? Cause it hasn't come out yet!",
    "Why did the people not like the restaurant on the moon? There was no atmosphere",
    "Why did the grocery delivery guy get fired? He drove people bananas!",
    "What does a thesaurus eat for breakfast? A synonym roll.",
    "What does Captain Kirk wear to the fitness center? Jim shorts.",
    "Did you hear about the lawyer for U2? He was Pro-Bono",
    "What do you call an old fruit-picker in Wisconsin? Cherry-atric",
    "I heard she accidentally spilled her chocolate milkshake on her white poodle- -knick knack paddy whack give the dog a... bath!!!",
    "An idea for a board game... BONOPOLY - Similar to Monopoly, but where the streets have no name.",
    "Mary had a little lamb. She's not a vegan anymore.",
    "What did 0 say to 8? Nice belt!",
    "Santa keeps his suits in the clauset.",
    "Why couldn't the woman date a German man? Because she was Klaustrophobic!",
    "Knock! Knock! Knock! Knock! Whos there? Control Freak. Con Okay, now you say, Control Freak who?",
    "How did the townspeople react when the mayor presented them with a cost efficient, vegan protein source? They chia'd.",
    "Did you hear that H.P. Lovecraft wrote a cookbook? It's called the Necronomnomnomicon.",
    "Why should you leery of stairs? Because they are always up to something.",
    "I'm calculating how much it would cost to install lights for a little league baseball field A ballpark estimate would be perfect",
    "What is the horror movie Quija rated? Quija-13",
    "So, a guy gave his friend 10 puns, hoping that one of them would make him laugh. Sadly, no pun in ten did.",
    "What was the allergic 2'X4''s terrifying hallucination? He sawdust.",
    "What's orange and sounds like a Parrot? A Carrot",
    "What's brown and sticky? A stick.",
    "What do you call a chef who's stingy with herbs? PARSLEYMONIOUS",
    "Which US state is the friendliest towards the Japanese? Ohio",
    "A classic: what do you call somebody with no body and no nose? Nobody knows.",
    "what do you call a fake noodle? An impasta! :D",
    "What do Engineers use as birth control? Their Personality.",
    "How much does a pirate earing cost? A buccaneer",
    "What do you call an alligator with a vest? An Investigator!",
    "Seven days without a joke makes one weak.",
    "I'm a social person. I'm friends with 25 letters of the alphabet. I don't know why.",
    "My grandpa started walking five miles a day when he was 60... Now hes 97 years old and we have no idea where he is...",
    "Where do toilets live? Porcel Lane.",
    "Why did the Country Bear Jamboree bear blush? Because he was a bear a-singing. ..... I am at Disney with the kids this week...",
    "What's a martini's favorite garnish? Olive 'em!",
    "Why did the chess master order a Russian bride? He needed a Chech mate!",
    "What's the difference between a bag of chips and a duck with the flu? One's a quick snack and the other's a sick quack!",
    "Why didn't the cargo ship want to leave the bay? Because it was a freight!",
    "What do you call someone who really loves breakfast? A cereal killer.",
    "What did Captain Ahab say when he harpooned a whale's tail fin on the first try? 'Well that was a fluke.'",
    "What do you call someone that steals shoes? A sneaker.",
    "What song can never be played on #throwback Thursday? Friday by Rebecca Black",
    "What did the neutrino say to the planet? Just passing through",
    "What do you do with epileptic lettuce? You make a seizure salad!",
    "Did you hear they're republishing that Simple Mathematics study guide? It's the revised edition. (Revise Addition)",
    "Do you have a hole in your sock? 'No ...' *(looks at sock)* . . How'd you get your foot in it?",
    "What does a baker wear on his feet? Loafers.",
    "What cars do cows drive? Cattleacs",
    "I was at Redbox, but I didn't know what to watch. I consulted my groceries, and my pizza said, 'Keep Frozen.'",
    "What do you get when you cross a pig and a spider? Bacon and scrambled leggs.",
    "Why didn't the fisherman go to Florida to fish for long jawed fish with rows of razor like teeth? He didn't have a Gar",
    "Why don't robots have any brothers anymore? Because they have trans-sisters.",
    "Whats blue and smells like red paint? Blue paint",
    "Darth Vader told me he knows what i'm getting for Christmas He said he felt my presents...",
    "Why did the hippie drown? He was too *far out*!",
    "What's the difference between a Jew and a pizza? The pizza can have ham and cheese together.",
    "Define 'Will' Isn't it obvious? It's a dead giveaway!",
    "There's a wreath hanging on my door with hundred dollar bills attached. I call it an Aretha Franklin. c:",
    "How many roads must a man walk? 42.",
    "What is a spectre's favorite theme park attraction? The Roller Ghoster",
    "What does a nosey pepper do? Gets jalapeno business!",
    "Did you know that in high school, Robert E. Lee was voted 'most likely to secede?'",
    "Did you hear the Offspring song about how to store mummies? 'You gotta keep 'em desiccated'",
    "This is 2 girls with 1 cup. [A.K.A. Friends At (a) Cafe Bar](http://www.gettyimages.com/detail/photo/friends-at-cafe-bar-high-res-stock-photography/156534295)",
    "Why were the treefrog's stories always so attention grabbing? Because he was absolutely ribbeting!",
    "What do you call a slice of bread from another country? An immigraint.",
    "You know what they say about men that have big feet? #They wear big shoes! *Come on guys, this is /r/cleanjokes! Get your minds out of the gutter!*",
    "Q: What do you call a deer with no eyes? A: No eye deer (No idea) Q: What do you call a quadriplegic deer with no eyes? A: Still, no eye deer. (Still no idea)",
    "How many golfers does it take to change a light bulb? FOUR!",
    "What did the famous musician say the moment he was born? *I'LL BE BACH*",
    "What did the pebble say to the rock? I wish I was a little boulder!",
    "What goes up and down but does not move? Stairs",
    "In what town lives the mathematician who can only multiply by two? Dublin.",
    "What did the buffalo say to his son when he left for college? Bison",
    "Why do Jamaican chickens make fun of all the other chickens? Because they're jerks.",
    "Did y'all hear the one about the professional jump-roper? Never mind. *Skip it*.",
    "The victim's body was found in the kitchen surrounded by eight empty boxes of cornflakes. Police suspect it was the work of a serial killer.",
    "'Stay strong!' I said to my wi-fi signal.",
    "Pick up line for a Shakespeare lover. How now brown chicken brown cow?",
    "Why did the snail draw an 'S' on the side of his car? So that when he drove by people could say, 'Look at that escargot!'",
    "When do you know you are getting a good deal on a boat? When there's a sail on it.",
    "What happens if socialism comes to the Sahara? Old Soviet-era joke told in Russia: What happens if socialism comes to the Sahara? Nothing at first, but then the sand shortages will start.",
    "How do sailors finish a corny joke on a boat? Ba dum ship.",
    "What's the best part of a baker's body? Their buns.",
    "What do you call coffee made from coal? Tarbucks.",
    "What did the three holes in the ground say? Well, well, well My grandpa's favorite joke. Took me five years to get it.",
    "When you ask a girl, Wanna go to the gym with me? https://www.youtube.com/watch?v=rQegAi6d-MM",
    "I once ate a watch. It was time consuming, I didn't go back for seconds.",
    "Why do zombies always kill at comedy clubs? Because their jokes are told post-humorously!",
    "What do you get when you cross a crocodile with a cartridge? A snapshot.",
    "Where do you learn to make ice cream? Sundae School",
    "What is a rocket's favorite meal? Launch! Another one from my 9 year old.",
    "What do lawyers wear to court? Lawsuits.",
    "What do they call a monastery key that opens all doors? Monk key",
    "I fell in the mud. And took a shower right after!",
    "Fart tutor wanted, must have references",
    "I do my best when my manager puts a gun to my head.",
    "What do you call someone who majors in geology and astronomy A rockstar",
    "I rang up a local builder and said, 'I want a skip outside my house.' He said, 'I'm not stopping you.' **Tim Vine**",
    "What kind of bird can write? A penguin.",
    "What did the bunny say to the frog? [My name is Rabbit, not ribbit!!](https://www.youtube.com/watch?v=CYkDxsaHlkg)",
    "What do you get when you cross an elephant and a rhino? 'ell if I know wot to call it!",
    "Why did the chef invest in chicken and cow bones? He wanted to buy stock options.",
    "What side of a leopard has the most spots? The outside",
    "How was the Roman Empire cut in two? With a pair of Caesars.",
    "What's faster hot or cold? Hot! Because anyone can catch a cold! buh duh tsst",
    "What did one octopus say to the other octopus? Will you hold my hand hand hand hand hand hand hand hand?",
    "Why do fish always sing off key? Because you can't tune a fish. Say it outloud if you don't get it. I made this one up in first grade IIRC.",
    "[PICKLE] Our first chance to help our new ally! http://www.reddit.com/r/pickle/comments/1a2xg8/next_attack_for_our_entire_army_march_12th_at_520/",
    "What type of cheese lives under your bed? Muenster.",
    "What did the 0 say to the 8? ... Hey, nice belt..",
    "How does a duck pay for lipstick? She puts it on her bill",
    "So I work in a Steak House and all the people there are really lazy So I must say after working there: That it's rare to see a job well done",
    "What is H.P. Lovecraft's cook book called? The Necronomnomnomicon.",
    "Why did the rabbit go to rehab? He was hopped up on easter eggs.",
    "Knock Knock... 1.Knock knock. Whos there? Yoda lady. Yoda lady who? Good job yodeling! 2.Knock knock. Whos there? Well, not your parents, because your parents never knock!",
    "What do you call cheese that isn't yours? Nacho cheese!",
    "Reinventing Yourself http://dryinginside.blogspot.com/2012/10/reinventing-yourself-doesnt-always-work.html",
    "What do you call a Macho Man Randy Savage that does not belong to you? &gt;Nacho Man Randy Savage!!!!! this is my original content!!!!",
    "What does the horse call the pigs on his farm? Neigh-boars.",
    "What's brown and sticky? A stick",
    "What is the world famous Chef Gordan's favorite football team? The Ramsays",
    "My shower had a bit of mildew- -but all it took was a little... scrubbing!!!",
    "Choose a major you love and you won't have to work for a day in your life Because that major probably has no jobs (not an original)",
    "When is booger not a booger? When it('s not).",
    "What's the longest word in the dictionary? 'Smiles' because there is a mile between each S!",
    "At the end of the Age of Dinosaurs what happened to the good ones? They got veloci-raptured.",
    "Which Pokemon got a cold? Pik-a-choo.",
    "What do you call someone who's studied Old Norse literature and become an expert. Well edda-cated.",
    "What instrument does God play? He plays the cello. As it says in scripture: 'Our God is a cellist God.'",
    "What do you call a fly with no wings? A walk.",
    "Want to hear a joke about a crappy restaurant? Nevermind, I'm afraid it may be in poor taste.",
    "Knock knock Who's there? Abby. Abby who. A bee has stolen my wallet. (I will show my self out)",
    "Which celebrity is great at creating probate documents? Will Smith",
    "Why couldn't Joe be friends with a double-amputee? Because he's lack-toes intolerant.",
    "What do you say when you find two banana peels together? Answer: A pair of slipper",
    "Why cant college students take exams at the zoo? Too many cheetahs",
    "I saw this man and woman wrapped in a barcode... I asked, Are you two an item?",
    "A photon walks into a hotel. The bellhop asks if he needs help with his bags. The photon says, 'no, I'm travelling light. '",
    "If you're not buying kraft mac and cheese you might be buying an impasta.",
    "How do you make a kleenex dance? You put a little Boogie in it!",
    "TV playback craziness [Through the eyes of Adrienne Hedger](https://www.facebook.com/HedgerHumor/photos/pb.630201143662377.-2207520000.1443863939./1179935295355623/?type=3&amp;theater). :)",
    "What do you call a very religious person who sleep walks? A Roman Catholic.",
    "I don't have a Facebook or Twitter account... ...so I just go around announcing out loud what I'm doing at random times. I've got 3 followers so far, but I think 2 are cops.",
    "Soap addiction I used to be addicted to soap. But I'm clean now!!",
    "Why is 6 afraid of 7? Because 7, 8, 9.",
    "What Did Delaware? A brand New Jersey!",
    "Why don't you see penguins in Britain? Because they're afraid of Wales",
    "New Internet acronym: RALSHMICOMN Rolling Around Laughing So Hard Milk Is Coming Out My Nose",
    "How do you kill a circus? You stab it in the juggler.",
    "More retailers should adopt the 'Leave A Penny / Take A Penny' system. It is literally, common cents.",
    "How much do pirates pay for earrings? about a buck an ear.",
    "Why did the boy throw a clock out the window? He wanted to see time fly.",
    "Which word is the longest in the English language? Smiles - because there is a mile between the first and last letters",
    "What do you call a person who farts in private? A private tutor",
    "Why did the raisin take the prune to the new year's ball? Because he couldn't find a date!",
    "Why did the chicken soup cross the road? Because it was down hill!",
    "What did one math book say to the other math book? We've got a lot of problems.",
    "Two competing podiatrists opened offices next door to each other... They were arch enemies. Edit: Spelling",
    "What do you call fake German currency? Question marks",
    "What do you call a fat psychic? A four chin teller.",
    "How does Harry Houdini tell people to steal stuff? Straight jack it.",
    "Why can't you hear a pterodactyl urinate? Because of the silent P.",
    "What do you call an Egyptian bone-setter? Cairo-practor.",
    "My first job... My first job out of college was a 'diesel fitter' at a pantyhose factory... As they came off the line, I would hold them up and say, 'Yep, deez'll fit her!'",
    "What did the closed can say to the half opened can? YOU'RE BEING UNCANNY!",
    "Whats the problem with tainted money? It taint yours and it taint mine :D (Puns for the win? :D)",
    "What do you call it when someone resuscitates a person who chokes on alcohol? La chaim-lich maneuver.",
    "How many minimalists does it take to screw in a light bulb? 1",
    "What do you call a loaf baked in a zoo? Bread in captivity.",
    "Where does a river keep it's money? At the bank.",
    "What side of a turkey has the most feathers? The outside.",
    "My teacher's nickname in school is Flush. He always has the same suit.",
    "What kind of dish does LeBron like? anything with curry in it.",
    "There are 10 types of people in the world. Those who understand binary code and those who do not.",
    "What do lawyers wear to court? Law suits!",
    "Why are the nordic countries the best countries to live in? Their flags are big plusses.",
    "When Captain Picard's sewing machine broke he brought it to the repairman and said... 'make it sew.'",
    "My brother... Likes driving black and white F1 race cars. They call him the F1 racist.",
    "What is green, fuzzy, and will kill you if it falls out of a tree? A pool table. [Thanks, Wagon Train camper!]",
    "How do you make a tissue dance? You put a boogie in it! (Not sure of the spelling, heard it from someone).",
    "Who makes the sweetest video games? Masahiro Saccharide",
    "Someone dropped their Scrabble in the middle of the road... ...that's the word on the street anyway.",
    "Harry Potter can't tell the difference between his cooking pot and his best friend. [X Post from r/Fantasy] They're both cauldron.",
    "My dog chewed up my laptop... I guess he wanted a byte to eat! ^imagine ^this ^in ^zoidberg's ^voice",
    "Why did the chicken cross the playground? To get to the other slide",
    "Why don't cats play poker in the jungle... ...theres too many cheet-ahs",
    "What did Ernie say to Bert when he asked for ice-cream? Sure, Bert!",
    "Ask your doctor if left is right for you.",
    "Why was the tank top more gangster than the tube top? The tube top was strapless.",
    "This boy said he was going to hit me with the neck of a guitar.... I said, Is that a fret?",
    "Apple just released a brand new programming language, *Swift*. Job recruiters everywhere immediately started posting ads for Swift programmers with 5 years of experience.",
    "Which way will it fall? If a rooster lays an egg on a pointed roof, which way will it land? Roosters don't lay eggs",
    "What do you call a cow with a twitch? Beef jerky",
    "I'm naming my TV remote Waldo... ...for obvious reasons.",
    "A platypus went into a hotel owned by a duck.. ..A platypus went into a hotel owned by a duck. Platypus ate food. Duck billed platypus",
    "Have you heard about the Black Magic book for orphans? It's called the necro**mom**icon",
    "What do you call a black and white bird that can't win, nor fly. A peng-lose.",
    "How do you catch a unique rabbit? *unique* up on it!",
    "what keeps the lions from leaving the savannah the ele-fence",
    "Will you tell you the story of the huge sad wall? I shouldn't, you'll never get over it.",
    "Where do you buy Pikmin from? The Oli-Mart",
    "Where do literal dogs live? On the roof.",
    "I just bought a Bonnie Tyler sat-nav. It keeps telling me to turn around, and every now and then it falls apart.",
    "Why was the Headless Horseman depressed? He could never seem to get ahead in life.",
    "everybody gets their 15 minutes of fame - so here's my first original joke! why is it impossible to surprise a snowman? .. he has ice in the back of his head",
    "What's the difference between me and a calendar? A calendar has dates. #foreveralone",
    "What time does Sean Connery arrive at Wimbledon? Tennish",
    "Knock-knock... 'Knock-knock' 'Who's there?' 'Control Freak - now you say 'Control Freak who?'' :)",
    "What did the picture say to the Judge? I WAS FRAMED! I just now made that up. I feel good about this one! ~Skip",
    "Have you heard the one about the agnostic with dyslexia and insomnia? He tossed and turned all night wondering if there was a dog",
    "Why did Woodrow Wilson take a long time to turn around? Because he could only make 14 point turns.",
    "totally original joke/first post: What do you get when you play a Frank Sinatra record at twice the speed? 'Shrank Sinatra'",
    "How did Hitler tie his shoelaces? In cute little knotsies!",
    "My first joke here and an original! Did you hear about the two lawyers who set up shop under the old oak tree? I heard it was a pretty shady business.",
    "What do you call a discounted Zuckerberg? Marked down!",
    "What did the floor say to the desk? I can see your drawers!",
    "There were two flies sitting on a toilet seat... one got pissed off.",
    "What's a difference between a teacher and a train? The teacher tells you to spit you gum out. The train says, 'Chew, chew, chew!'",
    "Why don't blind people like skydiving? It scares the crap out of the dog.",
    "The scientists a scientist went to a remote island with a dog in order to teach his speaking. Three years later, the scientist returns, and is asked about his experiment; he replied 'woof, woof, woof'",
    "What do you call a con-artist who minored in psychology? Sigmund Fraud",
    "What's a pigs favorite muscle? The hamstring.",
    "What do fish think about air? It's UN-B-REATHABLE!",
    "What did the hammer say to the drill? You're too boring.",
    "What did Sean Connery say when his books fell on his head? I blame my shelf",
    "Why did tomato blush? because it saw the salad dressing",
    "My biggest problem with passive smoking is having to follow the smoker around.",
    "What did the traffic light say to the car? Don't look at me I'm changing.",
    "What is green, sings and can be found in the fridge? Elvis Parsley",
    "What is Jackie Chan's favorite drink? Wata",
    "What did the Pelican say to the fish when he was running late for work? I'll catch you later!",
    "What do you call a camel in Alaska? Lost.",
    "All these people getting emails from the Prince of Nigeria, I got one from an Egyptian Pharaoh... But it turned out to just be a pyramid scheme.",
    "I love self deprecating humour. Shame I'm no good at it.",
    "Here's a funny joke I heard about pizza oh nevermind. It's too cheesy.",
    "What Time Do You Go To The Dentist? Tooth - Hurty! XD",
    "Knock knock. Who's there? Doorbell technician.",
    "If Mr. Bean lost one of his legs he'd be cannellini!",
    "When is the month when the most trees fall? Sep-timber",
    "What do you call a cow with three legs? Tri-tip.",
    "How was Rome split in half? With a pair of *Caesars*",
    "What do you call Washington State after a long rain storm? Washed a Ton State. I woke up with that joke in my head this morning. My brain is weird. Had to share it with someone.",
    "What did the one wall say to the other wall? 'Meet you at the corner'",
    "What do beef hearts smell like? Honey.",
    "How many Romans does it take to screw in a light bulb? V.",
    "Why do birds fly south for the winter? because its too far to walk!",
    "What is a traveler's favorite font? Times New Roamin'!",
    "What do you call a nosey pepper? Jalapeno Business",
    "Science Jokes Thread on AskReddit! For your amusement: http://en.reddit.com/r/AskReddit/comments/1auxsf/what_are_some_funny_scientific_jokes_that_you_know/",
    "Why was Cinderella thrown off the basketball team? *She ran away from the ball.*",
    "Why did the air freshener company go out of business? Because they lacked common scents...",
    "With a name like Freddy Mercury... shouldn't he have done heavy metal?",
    "What do you call someone who serves smelly drinks? a Fartender",
    "What do you call a group of Geometry classes? A geomeforest.",
    "What's red and is bad for your teeth? A brick",
    "How much did the pirate charge for corn? He sold them for a buccaneer.",
    "A penguin walks into a bar... He goes up to the barman and says, 'Have you seen my father in here today?' The barman says, 'I don't know, what does he look like?'",
    "I'm very keen I could tell he was bald at the drop of a hat.",
    "So I was feeling down the other day... My friend wanted to cheer me up, so he told me 10 jokes to make me feel better. Unfortunately, no pun in ten did.",
    "What do the French call artificial feet for cats? Faux Paws",
    "I just invented a new word! It's called 'plagiarism'.",
    "What did the host serve his guests for The Simpsons marathon night? Disco Stew!",
    "Why did the mechanic go to art school? Because he wanted to learn how to make a van go!",
    "What do you call a fish with no eyes? ....a fssshhh...",
    "What kind of dog can do magic tricks? A labracadabrador.",
    "WHAT is Bruce Lee's favorite drink? WAH TAHH!!!!",
    "What other body parts did Voldemort not have apart from his nose? His legs and arms.. because he was disarmed and defeated.",
    "A police officer bought a robot this robot was fueled by sodium and alkaline, but could only hold enough for 24 hours at a time. so every morning he had to charge it with a salt and battery.",
    "What kind of bee will not take credit for his contributions? A Humblebee.",
    "What does a Vulcan lawnmower need to function? A spock plug.",
    "Why did the chicken cross the road? To show the opossum it could be done.",
    "I would never exaggerate... ...in a million years.",
    "They told me I had type 'A' blood... turns out it was a typo.",
    "Why did the chicken cross the road? To get to the other side.",
    "Why do ducks have flat feet? To stomp out forest fires. Why do elephants have flat feet? To stomp out flaming ducks.",
    "What do you call a midget psychic that broke out of prison? A small medium at large!",
    "The hairdresser's oath First, harm no 'do...",
    "What kind of pants does Super Mario wear? Denim Denim Denim",
    "A man once thought he'd discovered a new primary color but it proved to be merely a pigment of his imagination.",
    "You'd think that people who kept their head warm would tend to be healthier... but as it turns out, people who wear turbans are actually more likely to be Sikh",
    "What do you call a man with his big toe above his shin? Tony",
    "what do you call a vampire that sucks mucus instead of blood? nose-feratu!",
    "What do you call someone who wears leather, likes bondage and likes getting inked? Moleskine",
    "What's the difference between a piano, a tuna and a jar of glue? You: You can tuna piano but you can't piano a tuna! Person getting told joke: What about the glue? You: I knew you'd get stuck there!",
    "Why arent koalas actual bears? They dont meet the koalafications.",
    "What was Dr Frankenstein's second job? He was a body-builder",
    "What do you call somebody with no body and no nose? Nobody knows.",
    "This summer I'm going to go to the beach and bury metal objects that say, 'Get a life' on them. Demetri Martin",
    "I had a conversation with a Mobius strip... It was one-sided.",
    "Coco The Clown took his car back to the garage this week. The door wouldn't fall off.",
    "What do you call a pachyderm that sings jazz? Elephants Gerald",
    "How much do drum shaped sofas cost? 5 dollars per-cushion.",
    "What do you call a cow jumping over a barbed wire fence? Utter destruction! !!!!",
    "Did someone say 'purple'? Sorry, it must have been a pigment of my imagination!",
    "What did the blue denims say to the black denims? I guess we have different genes! *knee slap* ... I'll see myself to the door",
    "I just found out I'm colorblind It came out of the yellow.",
    "Ever heard about that movie called Constipation? It never came out.",
    "How does a plant walk? It uses a plant stand.",
    "Did you hear about the two silk worms that got in a fight? It ended in a tie.",
    "What do you call a midget psychic who just escaped from prison? A small medium at large",
    "Why does Mr. Pencil hate Mr. Pen so much? Because he is an erascist.",
    "I made a model aircraft. I wanted it to be an unpainted smooth finish wooden aircraft. So I made a plain planed plane plane.",
    "What happened to the Denver Broncos in the Super Bowl? They had a MetLife crisis. (that's the name of the stadium)",
    "How do you pay for things in the Czech Republic? Cash or Czech Edit: a word",
    "What begins with E, ends with E, and has one letter? envelope",
    "Why did Beethoven get rid of his chickens? All they said was, Bach, Bach, Bach ...",
    "Why did the packaged green onion get into trouble? Because it was a wrapped scallion.",
    "What time do you go to the dentist? 2:30",
    "Did you hear about the kidnapping recently? The goatherd woke him up.",
    "What do you call two guys above a window? Curt 'n Rod",
    "Why did the lettuce get arrested? ...for disturbing the peas!",
    "What happened to the tyrannical fruit? He was impeached!",
    "Did you hear about the corduroy pillow? You didn't hear? It made headlines!",
    "Today, the doctor told me that the bottom of my heart has stopped functioning. My girlfriend will be disappointed; that's the part I loved her from.",
    "How do you make gold soup? You use 14 carrots.",
    "What's my New Year resolution? Well, I just got a Hi-Def TV, so it's 1920 X 1080i.",
    "How does a cactus do his math homework? He uses a cacti-lator!",
    "What's an oven's favorite comedy routine? Deadpan.",
    "Two balloons are floating across the desert One balloon says to the other, Look out for the cactussssssssssssssssssss!",
    "linuxmint 13 or 15 question why does 13 have lts and not newer versions?",
    "why was Pavlov's hair so soft? classical conditioning.",
    "What did the slab of meat say when it was covered in salt and left out to dry? 'I'm cured!'",
    "What do you call an animal that goes through your trash and tells great stories? A raccoonteur.",
    "I'm making a band! I started a band called 999 Megabytes...we havent gotten a gig yet.",
    "What do you call thrusting a hairy rod in and out of your mouth really fast then afterwards spitting out a white liquid? Brushing your teeth",
    "Why doesn't the sun need to go to University? He's too bright.",
    "Why did the turtle cross the road? To get to the nearest Shell Station!",
    "Do you know why one side of the the V formation of geese in flight is longer than the other side? Because It has more geese in it!",
    "What's a pirates favorite letter? You think it's the 'R' but it's really the 'C'. Happy talk like a pirate day!",
    "Did you hear about the Native American who went to a party and drank 37 cups of tea? They found him dead the next morning in his tea pee.",
    "What did the elephant say to the horn-less rhino? 'Rhino horn?'",
    "What do you call a cow with no legs? Ground beef!",
    "How do porcupines play leapfrog? Very carefully",
    "Where does the General keep his armies? In his sleevies.",
    "How many Super Saiyans does it take to change a lightbulb? Just 1 but it will take 3 episodes.",
    "What do you call 99 bunnies walking forward and they take one step backwards? A receding hare line.",
    "What kind of jeans do ghosts wear? Boo Jeans",
    "What should you do before criticizing Pac-Man? WAKA WAKA WAKA mile in his shoes",
    "What do you call a father who was kidnapped in Iraq? A Baghdad.",
    "What has six eyes but cannot see? Three men in a house with dirty dishes in the sink, laundry that needs to be folded and kids that need a bath",
    "What do Egyptians do when their mass transit breaks down? Get Anubis.",
    "What's the difference between unlawful and illegal? Unlawful is against the law and illegal is a sick bird.",
    "How long did it take for the police to catch the man running in his underwear? It was a brief chase...",
    "What do call a horse that lives near you? A neighbor (naybor for pessimist horses)",
    "A termite walks into a pub And asks 'where's the bar tender?'",
    "What kind of birds stick together? Vel-crows",
    "What happens when you get some vinegar in your ear? You suffer from pickled hearing!",
    "A sad can goes to get recycled. He was soda-pressed.",
    "What does Drew Carey have in his driveway? Cleveland Rocks!",
    "Why don't you want your nose to be 12 inches long? because then it would be a foot!",
    "Branson My wife and I went to Branson, Missouri. I think our hotel caters to senior citizens because it had a free incontinental breakfast.",
    "A long joke jooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooke",
    "What did one ocean say to the other ocean? Nothing, they just waved.",
    "Whats blue and smells like red paint? Blue paint",
    "ABCDEFGHIJKMNOPQRSTUVWXYZ Noel.",
    "Kids, I don't know if our ceiling is the best ceiling... ...but it's definitely up there.",
    "Why was the hula hoop a great boxer? It could go round for round.",
    "how do you make 7 even? remove the 's'",
    "What gets longer the more you cut it at both ends? A ditch.",
    "Where does dubious pasta come from? The spaghetto. I can't take all the credit, however: I heard the word from [this](http://www.reddit.com/r/funny/comments/xdp4k/the_gaydar/c5lnkep) guy",
    "What did the 0 say to the 8? Nice belt!",
    "Why was the chicken kicked out of class? For using *fowl* language.",
    "At least I now know why the lions leave the plains before the end of summer. Because the Pride goeth before the Fall.",
    "What do you call an economist at an amusement park who is just sitting around? A lazy fair goer!",
    "How did the prostitute get promoted? She slept her way to the top!",
    "What did the space between two tiles say? I AM GROUT",
    "What do you say to the Montana barista when they overfill your chamomile? Beautiful",
    "What's green and fuzzy and can kill you if it falls from a tree? A pool table.",
    "How do you make a tissue dance? You put a little boogie in it. :)",
    "Wanna hear a construction joke? I'm working on it.",
    "What do gamers plant in their garden? Skill trees! **Dances wildly with top hat and cane**",
    "What's an idealist vegetarian's favorite meal? Peas and hominy",
    "Who's bad at baseball but fun at parties? A pitcher filled with margaritas!",
    "What do you get when you mix two chains and a cow? Truuuuuuuuuuu-moooooooooooooooooo!!!",
    "Why do elephants hide behind trees? To trip ants.",
    "I can make a movie with my hand. All it takes is a FLICK of the wrist!",
    "I am not pro gay. I am not even amateur gay. But, I support their rights.",
    "why didn't the american leek want to talk to the japanese leek? because it was negi",
    "I hate girls with double standards unless they're pretty",
    "What did the lazy surgeon say to his patient? Suture self!",
    "I have found that there are three kinds of people; Those who can count and those who can't.",
    "I made half a cup of tea the other day... It was so nice I had two.",
    "Why did peanut butter flop at the talent show? He didn't have the right jam.",
    "How many tickles does it take to make a squid laugh? Tentacles.",
    "Where do Cows go for parties? The Moovies",
    "How many Saiyans does it take to change a lightbulb? Just one, but it takes 5 episodes.",
    "Did you hear about the schizophrenic accounts manager? He couldn't help but hear invoices inside his head.",
    "[My Joke] Why do galaxies put on boring shows while separated? Because their performance is lack-cluster.",
    "Knock Knock...",
    "There is a special species of bird that is really good at holding stuff together... They're called velcrows.",
    "Why are jokes about rotten eggs banned? Because they're infeggtious",
    "What side dish do frogs like to enjoy with their hamburgers? French Flies!",
    "What do cows do for fun? They go to the mooooo-vies.",
    "Why did the puppy get away with committing murder? ...He had paws-able deniability.",
    "There once was a jealous zombie... But he ate his heart out.",
    "What do you call a ubiquitous spud? A common-tater!",
    "Why was Cinderella banned from playing sports? Because she always ran away from the ball &lt;p&gt; My favorite joke since I was little",
    "Want to hear a joke about pizza? Never mind, it's probably too cheesy.",
    "What has a bottom at the top? Your legs.",
    "What type of grain uses profanity? Vulgar Wheat",
    "What do you call a penguin with a smoking problem? It's a puffin!",
    "What did they call the Pillsbury Doughboy after he hurt his leg? Limp Biscuit",
    "Better be named after what? If you had to choose, would you prefer having a disease named after you, or be named after your mother in law?",
    "I know a woman who owns a taser... Let me tell you, she's stunning!",
    "Did you hear about the neutron who was arrested? He was held without charge.",
    "Have you ever heard the one about the dust bunny and the mud pie? Well then sorry, I only tell clean jokes.",
    "Why was the tomato blushing? Because it saw the salad dressing.",
    "My buddy said he'd give his right arm to be ambidextrous I can only admire such dedication.",
    "Why did the skeleton not attend prom? He had no body to go with.",
    "Why was the owl afraid of Raidoactivity Because it was made of Hootonium",
    "How many US Congressmen does it take to change a lightbulb? Oh, please. Like they've ever changed anything that needed it.",
    "What do you call soup that you've found a hair in? Rabbit Soup :D",
    "What do you call a woman with one leg? Eileen",
    "Two birds are sitting on a perch. One bird says to the other, 'Do you smell fish?'",
    "A man wanted to name his son a very long name... ...so he named him Miles",
    "What killed the guy ordering at an Italian restaurant? He'd had trouble deciding to go with the appetizers or entrees, but eventually he went antipasto way.",
    "I'm tired of people calling America the dumbest country in the world Quite frankly, I think Europe is!",
    "What did Arnold Schwarzenegger say upon being asked to star in a Broadway production about the world's greatest composers? I'll be Bach. Sorry.",
    "What did the owner of the Indian restaurant say when he burned all of his bread? 'Don't worry, it's a naan issue.'",
    "Who was the most important Knight of the Round Table? Sir Cumference.",
    "Why did Beethoven kill off his chickens? They kept saying, 'Bach, Bach, Bach.'",
    "Why did the bigamist cross the road? To get to the other bride.",
    "Why did the fox cross the road? It was chassing after the chicken!",
    "Why did the man throw his watch out the window? He wanted to see time fly!",
    "Why is ok to leave the lid off a basket of socialist crabs? Because whenever one of them climbs to the top, the others drag it back down.",
    "Why did the banker leave his job? he lost interest",
    "What do you call a cashew in space? An astronut.",
    "Why are some chillies nosy? They're jalapeno business",
    "What did the digital clock say to the grandfather clock? 'Look grandpa, no hands!'",
    "What do you call it when you dip poultry and beef in chocolate?  Brown-chichen-Brown-cow",
    "What happens when your cousin eats all the Pumpkin pie on Thanksgiving? Plump kin!",
    "Why does the Pope only eat munchkins? Cause they're the holy part of the donut!",
    "Knock, Knock... Who's there? The K.G.B. The K.G.B. wh... **SLAP**! WE are K.G.B., WE will ask questions!!",
    "What is Mozart doing right now? Decomposing",
    "What is a vampire's favorite fruit? a Neck-tarine --From a great co-worker",
    "'So Sherlock...' asked Watson, 'I forget, what was your highest degree of education?' 'Elementary, my dear Watson.'",
    "What did Descartes say while shopping online? I think therefore I Amazon",
    "What does r/The_Donald call its rule list? The MAGA Carta",
    "A cow fell off a truck in Russia Apparently he hadn't been Put in properly.",
    "What do you call a flower in Florida? Orlando Bloom.",
    "What do you call an Egyptian doctor who works on peoples backs? A Cairopractor!",
    "Why did the dog go into the water? Because he didn't want to be a hot dog.",
    "Why'd the hipster burn his mouth on his coffee? Because he drank it before it was cool.",
    "Why couldn't the lifeguard save the hippie from drowning? He was *too far out, maaan*.",
    "If you have bladder problems. Urine trouble.",
    "Where did the general keep his armies? In his sleevies!",
    "What did Cholera say to Malaria? Are you gonna Jaundice on Saturday?",
    "Q)What will you call a person who sleeps next to a close relative? A) NapKin",
    "Scary Halloween Joke **Person 1:** Knock knock! **Person 2:** Who's there? **Person 1:** A GHOST!!!",
    "Who invented fractions? Henry the 1/8",
    "What's cold and scary?! I-scream!",
    "Why was the rooster happy after his trip to Vegas? He got clucky.",
    "What did the judge ask when he went to the dentist? Do you swear to pull the tooth, the whole tooth and nothing but the tooth?",
    "Why are horses never overweight? They're on a stable diet.",
    "Why does not a forth-grader ever take the bus home? Because he knew his parents will make him return it.",
    "Why was Farmer Bob so good at his job? Because he was outstanding in his field",
    "What do you call a fish who works for the government? An Official.",
    "Why didn't the Duke of Windsor let his French servant help him tie his tie? He never does it with a four-in (foreign)-hand.",
    "Why did the bald man draw rabbits all over his head? From a distance they look like hares!",
    "I went to a shredded cheese convention the other day... it was grate",
    "What is ISIL's favourite dessert? Terrormisu",
    "Wanna hear two short jokes and a long joke? Joke joke jooooke!",
    "What happened to the runny nose... it tripped and fell. Now it's all boogered up.",
    "Four years ago, I asked out the girl of my dreams. Today, I asked her to marry me. She said no both times. (not an original)",
    "What do you call a cavator that isnt a cavator anymore? an EXcavator",
    "Why did the strawberry cry? Because his mother was in a jam.",
    "People dont like having to bend over to get their drinks... We really need to raise the bar.",
    "I fear for the calendar... ...its days are numbered.",
    "why are there fences around graveyards? people are just dying to get in there these days.",
    "One Eskimo said to the other, 'Where is your mother from?' The second Eskimo says 'Alaska.'",
    "Why can't a Pirate make it through their ABC's? They always get lost at C.",
    "Jesus wrote a play about a tornado. It was an Act of God.",
    "What did the blonde do when she discovered that most accidents happen within a mile from home? She moved.",
    "Why did the girltree fall in love with the boy tree? He was sappy",
    "I went to a seafood disco last week... ...and pulled a mussel.",
    "Why did the pie go to the dentist? It needed a filling.",
    "(True story) So my friend saw me browsing this subreddit and he said... 'Is this a subreddit for really bad jokes?'",
    "Superman and Eyore had a baby. The baby's name? Supereyore",
    "What cheese do you use to get a bear out of a tree? Camembert!",
    "Did you know that it's traditional to serve Eggs Benedict on a hubcap? There's no plate like chrome for the Hollandaise.",
    "What do you call a deep-sea diving dog? Scuba - Doo!",
    "Where did the fish go when it needed an operation? To the sturgeon",
    "My English teacher got really angry about the format of my essay. It wasn't justified.",
    "Starcraft: Why did the marine vote for the dragoon? He was Protoss",
    "All these people getting emails from the Prince of Nigeria, I got one from an Egyptian Pharaoh... But it turned out to just be a pyramid scheme.",
    "What do you get if you cross an elephant with a fish? Swimming trunks",
    "Where is Engagement, Ohio? Between Dayton and Marion.",
    "Why is Ireland the richest country in the world? Because it's capital is always Dublin.",
    "Can you tell me what you call a person from Corsica? Course a can.",
    "How did the metal get the wrong idea? He was misled.",
    "So today is Star Wars day May the fourth be with you!",
    "what happens if you drink 3.14 liters of water? you will Pi ss",
    "A WWII Joke! What did the German Shepherd say at his Nuremberg trial? 'I was just following odors.'",
    "What do cows like to put on their hot dogs? moostard",
    "Why did the cow go to the psychologist? She had a fodder complex.",
    "Why did the knife quit? It couldn't CUT IT! woohoo! I made this one up while sitting at a buffet table. Enjoy! ~Skip",
    "What's George Washington's least favorite flower? Li[e]-lacs!",
    "Why should you avoid people dressed as celery? They could be stalking you!",
    "Wanna hear a joke about Nitric Oxide ? NO",
    "What's the strongest letter in the alphabet? ***P*** Even Superman can't hold it.",
    "What do you call it when your wife brings you rice porridge in prison? Congee-gal visit",
    "Why did the dinosaur cross the road? Because the chicken didn't exist.",
    "Why does a rapper need an umbrella? Fo' drizzle.",
    "What did Tennessee? What Arkansas.",
    "My son decided to help me clean the car today. After ten minutes of watching him, I told him to use some elbow grease. Two hours later, the idiot came back and told me that he couldn't find it.",
    "What do you call a group of Combi's? A Combi nation!",
    "How do you get down from an elephant? You don't, you get down from a duck",
    "You can pick your friends, and you can pick your nose... But you can't pick your friend's nose",
    "Which whiskey should you buy if you want to dance all night? Wild Twerky!",
    "Why couldn't the hunter cook breakfast? The game warden found out he poached his eggs!",
    "I went to an ATM... I was at an ATM this morning and this older lady asked me to help check her balance, so I pushed her over.",
    "How much does a truck full of bones weigh? A skeleTon",
    "Why don't cats play poker in the jungle? Too many cheetahs!",
    "A skeleton walks into a bar... Asks for a beer and a mop.",
    "What do you call an atheist bone? A blasfemur.",
    "How do you catch a one-of-a-kind rabbit? Unique up on it. How do you catch a very calm rabbit? The tame way.",
    "Will Smith's website isn't responding. What do you do? Refresh Prince of Bel Air.",
    "What the the electrician say to his buddy? Watts up?!",
    "How many South Americans does it take to change a lightbulb? A Brazilian.... I'll get my coat...",
    "How do you catch a bra? You set a booby trap.",
    "April showers bring May flowers, but what do May flowers bring? Pilgrims.",
    "Which cheese is the loneliest? Prov-alone!",
    "Did you hear the joke about the fast car? I would tell you but I think you're too slow to get it.",
    "Why did the twinkie go to the dentist? He lost his filling!",
    "How does a fish always know how much they weigh? Because they have their own scales!",
    "What does music have to do with safety? If you don't C sharp, you'll B flat.",
    "Why is there very little honey in Belgium? Because there is only one B in Belgium",
    "How many goals did Germany score? gerMANY",
    "Why did the elephant turn around in the airport and go home? He forgot to pack his trunk.",
    "Two fish are in a tank... Two fish are in a tank... First one says: I'll drive! Second one says: 'I'll man the guns!'",
    "How many hipsters does it take to change a light bulb? it's a pretty obscure number.... i'm sure you haven't heard of it.",
    "What celebrity never payed with a cheque or credit? Johnny Cash.",
    "What is a pair of sheep's favorite instrument? Two-Baaas.",
    "You know why ancient Greek children were always getting lost from their parents? 'Cause they kept Roman around!",
    "Have you heard about that hot Thai lounge singer? Yeah. They call him *Frank Sriracha.*",
    "...walks into a bar... A golfer, a priest and a lawyer walk into a bar. The bartender looks up and asks, 'What is this? Some kind of joke?'",
    "Other uses for chloroform 1) A great conversational piece when talking to the cops about using it 2) Make the day go by faster 3) And finally, as a reagent.",
    "Cars Why do lazy people only drive automatics? Because they're shiftless.",
    "Why is Yoda afraid of seven? Because six seven eight.",
    "Why couldn't the pirate learn the alphabet? Because he was always lost at C.",
    "College My son took Rock Climbing in college but he had to drop the class. He couldn't find any 'Cliff Notes.'",
    "What is the cheapest part of a boat? The part with the sail in it.",
    "Why was the egg kicked out of the comedy club? Because he was telling bad yolks!",
    "You know what's the problem with Mexican and black jokes? If you've heard Juan, you've heard Jamaal.",
    "The signature dish of a restaurant called the Twisted Rooster: Mobius Chicken Strips.",
    "What did one math book say to the other? Don't bother me; I've got my own *problems!*",
    "Why are giraffes slow to apologize? It takes them a long time to swallow their pride",
    "Velcro What a rip off. Joke by Tim Vine.",
    "Why don't melons ever run away and get married? Because they cantaloupe!",
    "Like most people my age... I'm 27.",
    "Two fish in a tank Fish 1:Uh, Greg? Fish 2:What Fish 1:How do we drive this thing",
    "Did you hear about the Italian chef that died? He pasta way.",
    "Why did the bacteria cross the microscope? To get to the other slide",
    "I read a story about a kid that ate 4 cans of alphabet soup in one sitting... It said that he later had a massive vowel movement. Maybe a dirty joke.",
    "Tasted the best Borscht ever! It'll be hard to beet.",
    "The Fine Bros. 'React' announcement was like a television with no antenna. Poor reception.",
    "What do call a horse that lives near you? A naybor",
    "What kind of bees make milk? Boobies.",
    "What does Mario use to get his hot dogs off the grill? He uses his Donkey Tongs.",
    "'We don`t serve time travelers here' A time traveler walks into a bar.",
    "How do you kill bread? Bake it for a little while, and it will be toast.",
    "What do you call an imaginary color? A pigment of your imagination.",
    "Did you hear about the mathematician who hated negative numbers? He'll stop at nothing to avoid them!",
    "What do you call security guards working outside Samsung shops? Guardians of the Galaxy",
    "What do you call cheese that is by itself? Provolone",
    "I just got a job helping a one arm typist do capital letters... Its shift work.",
    "Why does a Bicycle have a kickstand? Because it's two tired.",
    "Which side of a horse has the most hair? The OUTSIDE! oh-my-goodness, that's hilarious! ~Skip",
    "I went in to a pet shop and said, Can I buy a goldfish? The guy said, Do you want an aquarium? I said, I dont care what star sign it is.",
    "Noah wasn't much for civilized society . . . You could say he was an-arc-ist.",
    "Two silk worms had a race. They ended up in a tie.",
    "What do you call a sheep covered in chocolate? A candy baa",
    "What do you do if you see a spaceman? You park in it, man.",
    "Why did Trump insist on Hillary Clinton as Secretary of state? He doesn't believe women should get above secretary",
    "I was wondering why the frisbee was getting bigger. And then it hit me.",
    "What did the Buffalo say when his child left for college? Bison",
    "How do you keep an idiot in suspense? I'll tell you later.",
    "Batman doesn't have nightmares Nightmares have batman",
    "Charles Dickens walks into a bar... and orders a martini. The bartender asks 'olive 'er twist?'",
    "Nickelback walks into a bar.... So Nickelback walks into a bar, and there is no punchline, because ruining music isn't funny.",
    "So a polar bear walks into a bar... and says, 'I'll have a gin.....and tonic' The bartender says, 'What's with the big pause?' And the polar bear says, 'Oh, I've always had them.'",
    "Mom asked if I wanted to race toy cars with my neighbor Chucky. I responded, 'Nah, that's child's play.'",
    "What do you find in a cloud's shorts? Thunderpants!",
    "Why did the SSD burn a flag? Because it was a Patriot Blaze",
    "Difference between a dead squirrel and a dead drummer in the road? http://imgur.com/PKibj The squirrel might have been on his way to a gig.",
    "By shear coincidence... ...all these sheep look the same...",
    "Finally decided on my thesis paper. It's a LOTR themed essay in defense of Sauron Titled 'Getting away with Mordor'",
    "What do you call a bee from the wrong side of town? A bumblegee",
    "Why did Mrs. Grape leave Mr. Grape? She was tired of raisin kids.",
    "What does batman take in his whiskey? Just ice.",
    "What do you call a boomerang that doesn't come back? A Stick",
    "A guy walks into a bar Ouch",
    "Why did the scale decide that the scam artists were heavier than the novels? Because the cons outweighed the prose.",
    "Im trying to get into classical music... ...but I cant find any original recordings. All the music is performed by cover bands.",
    "What did aged mother cheddar say to her son the day of school photos? Looking sharp.",
    "Why does a chicken coop have two doors? Because if it had four it would be a chicken sedan!",
    "Note for Santa Dear Santa, Please give me a big fat bank account and a slim body. Please don't mix those two up like you did last year. Thanks.",
    "Why was Pavlov's hair so soft? He conditioned it.",
    "What's an atheist's favorite Christmas movie? Coincidence on 34th Street",
    "What do you call someone who makes a lot of money through deforestation of the Amazon? A Brazillionaire!",
    "Whats Marios favorite type of jeans? denim denim denim!",
    "What did the 0 say to the 8? Let's make a snowman!",
    "Have a very Joseph Christmas! We shouldn't discriminate by sex, you know.",
    "Never try to kill a termite with a napkin. It'll only get bigger.",
    "What did one nose say when the other nose said 'I love you'? 'Back achoo!'",
    "Hope you guys like clean humor videos https://www.youtube.com/watch?v=kNt-aTq0hxM",
    "Why don't blind people like to skydive? Because it scares the dog.",
    "Two guys walk into a bar... the third one ducks.",
    "What did the french butter say when it got stocked in the cooler? Beurre... I came up with this today while grocery shopping. I'm ridiculously pleased with myself.",
    "Why did the dog sleep on the chandelier? Because he was a light sleeper.",
    "What happens when a spoon and fork get into a fight? civilwar",
    "My grandma refused to be an organ donor. She was buried with all of her musical instruments.",
    "How do you count cows? With a cowculator.",
    "I dig, she dig, we dig, he dig, they dig, you dig ... Maybe not a funny joke but at least it is deep.",
    "What do you call a burial chamber full of Moose? Moosoleum.",
    "Mints I was eating mint chocolates and I felt sick after eight.",
    "A Polar Bear walks into a cafe He says, 'I'll have a burger and.... a coke.' The waitress says, 'Okay. But, why the long pause?' The bear says, 'I don't know. I was born with them.'",
    "What did the hot dogs name their child? Frank",
    "I may be middle-class, but I'm hard. *Al dente*, you might say. **Jimmy Carr**",
    "What do you say when you see three whales? Whale whale whale, what do we have here?",
    "What did Cinderella say while waiting for her photos? Someday my prints will come",
    "What did the fish say when it hit the concrete wall? Dam",
    "My Bucket List * ~~Five gallon bucket~~ * ~~Mop bucket~~ * Bucket hat",
    "What do you call an old soldier who has been sprinkled in salt and pepper? A seasoned veteran.",
    "The fast food restaurant for babies. 'Welcome to Gerber King, may I take your order?'",
    "What did one frog say to the other? Time's fun when you're having flies.",
    "What do you get when you cross the Atlantic with the Titanic? Halfway.",
    "Want to hear a dirty joke? This boy trips and falls into some mud.",
    "No matter how much you push the envelope... ...it's still stationery.",
    "My buddy went to a foreign country to get his sex change operation. Now he's a dude who's abroad.",
    "A vampire stopped coming to my nightly poker games. All I said was that he made too many mistakes...",
    "What's the most beautiful thing in Advanced Physics? A passing grade. :)",
    "I bought a vacuum cleaner six months ago... ...and so far, all it's been doing is gathering dust.",
    "Where do you drown a hipster? The Mainstream.",
    "What did the mama cow say to the baby cow? (x-post from /r/3amjokes) [It's pasture bedtime!](http://www.reddit.com/r/3amjokes/comments/1y8d67/what_did_the_mama_cow_say_to_the_baby_cow/)",
    "Why did the man with one hand cross the road? To get to the second hand shop!",
    "An invisible man marries an invisible woman... The kids were nothing to look at either.",
    "What did the creepy scientist say to his new creepy wife? Let's grow MOLD together!",
    "Never trust an atom They make up everything",
    "When you cook duck you should always add a little bit of goose It makes a game out of every bite.",
    "A pair of mittens says to a hat, 'I'll stay here, you go on a head'",
    "What is black, bitter and dont work worth a damn? Decaf coffee",
    "Knock, Knock... Who's there? Peas. Peas who? *Peas pass the butter*",
    "My 'go to' zoo joke I tell this to my wife and kids every time we go to a zoo... Q. What do you get when you cross an elephant with a rhino? A. Elephino",
    "Why did the chicken cross the road half-way? She wanted to lay it on the line.",
    "I knew this guy who was so dumb... he saw a road sign that said, 'Disney Land Left', so he turned around and went home.",
    "I'm not really sure I'm understanding this financial crisis in Greece... It's all Greek to me.",
    "What happened when porky pig fell asleep at his construction job? The foreman fired him, saying, 'We can't have bored boars boring boards.'",
    "Did you hear about that spicy knight? Sir Acha.",
    "What did the Buddhist say to the hot dog vendor? Make me one with everything.",
    "What do you call a cow with no legs? Ground beef.",
    "There once was a girl from Nantucket... Who carried her ice in a bucket. She walked down a hill. She had a great spill. And when she got up, she said, 'I'm going to watch my step next time!'",
    "Why are bears so hairy ? They don't have salons in the jungle !",
    "How many tickles does it take to make an octopus laugh? ten-tickles",
    "Which is faster, hot or cold? Hot is faster. Anyone can catch a cold.",
    "Do you think George Clooney has an iTunes playlist called Clooney Tunes?",
    "I was going to go to a clairvoyants meeting the other day but.... it was cancelled due to unforeseen events.",
    "Joke request Tell me your best joke that includes 'July' 'fourth' and 'fire' Let's see what you've got, Reddit!",
    "What is black, white, and red all over? A Communist Propaganda film from the 1930s.",
    "[OC c/o my 9 y.o.] What holds up a bowl's pants? Suspoonders!",
    "I don't like going to funerals early in the day. I'm not much of a mourning person.",
    "What happens when breed a shark and snowman? You get a frostbite!",
    "Which letter of the alphabet is the laziest? letter G (lethargy)",
    "whats brown and sticky? a stick!",
    "Which day do chickens fear most? Fryday.",
    "What did the knob say to the door? I LOCK you a lot! yep, its corny, indeed, but... I'm tryin'! ~Skip",
    "Shout out to... ...baseball players who have three strikes.",
    "why do they call them light bulbs? they don't weigh very much",
    "What's a reporter's favorite food? Ice cream because they always want a scoop!",
    "Why did the scarecrow win the Nobel prize? He was outstanding in his field.",
    "Is your refrigerator running? Well, you better get glasses, and stop doing drugs",
    "A stamp collector walks into a bar... He walks up to the hostess and says, 'You're more beautiful than any stamp in my collection' She replied, 'Philately will get you nowhere.'",
    "I personally don't believe in bros before hoes or hoes before hoes.. There needs to be a balance. A homie-hoe-stasis",
    "How do you fix a broken pumpkin? With a pumpkin patch!",
    "My dad's not an alcoholic... ...He just collects empty bottles, sounds so much better, doesn't it? ~ Stewart Francis",
    "I believe a lot of conflict in the Wild West could have been avoided completely... ...if cowboy architects had just made their towns big enough for everyone.",
    "Q) What do you call a group of 8 rabbits? A) Rabbyte!",
    "What is a bacteria's OTHER favorite dish? The PETRI dish!",
    "What do you call a productive Asian? China get something done.",
    "Why do ghosts carry tissues? Because they have BOOOOgers.",
    "Two pretzels.. Two pretzels went walking down the street, one was 'assaulted'",
    "What is the Sun's favorite candy? Starburst! Another one from my 9 year old. I don't know where he gets it.",
    "I just met someone who was a steam-roller operator. He was such a flatterer.",
    "Why did the chicken cross the road? To get away from Gordon ramsey",
    "What did the turkey say to the turkey hunter? 'Quack, quack, quack.'",
    "What is the difference between a man and a cat? One eats a lot, is lazy and doesnt care who brings the food. The other is a pet.",
    "How do you confuse a fish? You put it in a bowl and tell it go to a corner!",
    "Have you guys ever heard of the crazy Mexican Train Killer? He had...... Loco Motives",
    "Do you know why there's no casinos in Africa? Because there's too many CHEETAHS!",
    "what did the zero say to the eight? nice belt",
    "They laughed when I said I wanted to be a comedian. Well, no ones laughing now.",
    "I just heard because of the government shutdown government archeologists are working with a skeleton crew.",
    "Why do abcdefghijklmopqrstuvwxy &amp; z hate hanging out with the letter n? Because n always has to be the center of attention.",
    "Why couldn't Bach pay for his dinner? Because he was Baroque.",
    "What is the difference... What is the difference between unlawful and illegal? One is against the law and the other is a sick bird.",
    "What did one ocean say to the other? Nothing, they just waved.",
    "What's made of brass and sounds like Tom Jones? Trombones!",
    "Why did the Wise Man get 25 to life? Myrrhder",
    "What do you call a dinosaur FBI agent? A pteredacted.",
    "What did the fish say when it ran into the wall? Dam",
    "16 sodium atoms walk into a bar followed by Batman.",
    "What's the difference between a poorly dressed man on a tricycle and a well dessed man on a bicycle? Attire...!!",
    "What did the pilot say when his plane wasn't flying? 'Aw man, that's a drag.'",
    "I asked my soap who it voted for, it said... I'd lather not say! note: This one came to me in the shower just now, gotta go back in now. Oh, the irony! I think. ~Skip",
    "Why did the coffee file a police report? Because it was mugged.",
    "How does the man in the moon cut his hair? Eclipse it.",
    "How did the burglar get into the house? Intruder window",
    "Two chimps are in the bath One says 'ooh oooh eek eek' The other one says 'well put some cold water in then!'",
    "What do ducks do at Christmas time? They duckerate cookies.",
    "What do you call a dead fly? a flew",
    "Knock knock. Who's there? Interrupting cow. Interrup........ MOOOOOOOOOOOOOOOO!!!! [Works best IRL](/spoiler)",
    "What di you call a snowman in may? A puddle!",
    "What do you call a white supremacist who doesn't eat meat? A vegitaryan",
    "How is a rabbit similar to a plum? they are both purple, except for the rabbit.",
    "Why are there no midget accountants? They always come up short.",
    "What do you call a noisy Chinese dog? How-Ling (my dad wanted me to post this)",
    "Why can't you hear a pterodactyl in the bathroom ... because the 'p' is silent",
    "How did the Pillsbury Dough Boy Die? A Yeast Infection",
    "What do you call a native american cook a sioux chef",
    "I said bring your coffee maker whenever you want Them: great headphones on planes is heavier than flying over TEAs",
    "A poem for Valentine's day Roses are red Poppies are red The grass is red Oh no my yard is on fire",
    "What did the dad buffalo say when his offspring left for college? Bison",
    "How do you get Pikachu on the bus? Poke 'em on!",
    "Whats brown and sticky? a stick",
    "What do you call a fish that operates on brains? A brain sturgeon.",
    "The reason angels can fly... ...is that they take themselves lightly. **G. K. Chesterton**",
    "I'm in the terminator musical. I'll be Bach.",
    "I try not to spend too much time online... ...but Wi-Fight it?",
    "What does December have that other months dont have? The letter D.",
    "What's the best way to capitalize on an opportunity? ON AN OPPORTUNITY",
    "What's green, fuzzy, and if it falls out of a tree it'll kill you? A pool table.",
    "A termite walks into a bar... And asks the nearest person 'Hey, is the bar tender here?'",
    "I tired playing soccer But I couldn't get a kick out of it.",
    "What did the priest say when watering his garden? Let us spray.",
    "How did the musician catch his fish? He castanet",
    "What do you call a plastic sheep? Lambinated!",
    "I need this plant to grow. Well, water you waiting for?",
    "Book, you look so much thinner! I know! I had my appendix removed!",
    "Have you been injured in a car accident? call 555-bottom-feeders. We will do anything for money.",
    "Did you hear about the stallion and the mare? They had a stable relationship.",
    "What are two doctors with colds An ironic Paradox.",
    "What do you get when you cross Kansas with a vulture? Carrion my wayward son",
    "How do you know it's time to go to bed? Hitler is raping you!",
    "What do you call a Romanian grocery clerk? Scanthesku",
    "What do you call a fear of horned bovines? Aurochnophobia.",
    "What haircut did the Texan barber recommend when asked? He couldn't think of anything, and said 'I'll mullet over'",
    "[OC] How does Gandhi measure passive resistance? In oooooohms.",
    "Why is Kim Jong Un like todays music? They both ain't got the same Seoul.",
    "I knew this guy who would ask men at church, 'is your tie made out of bird cloth?' &lt;blank stare&gt; 'It's cheep, cheep, cheep.'",
    "What happened when the carrot died? There was a huge turnip at the funeral.",
    "Why can't you hear a pterodactyl go to the bathroom? Because the P is silent",
    "Why do librarians like the wind? It says, 'Shhh!' all day!",
    "One potato asks another: -'Are you sure we are related?' -'Yes I yam!'",
    "I like my slaves like I like my coffee Free.",
    "Who is the only superhuman Frozone can't deal with? Thor.",
    "Why don't bears wear boots? Cos they like to walk around in their bear feet.",
    "There's 10 kind of people in the world. Those who know binary and those who don't.",
    "What do you call the object Attila the Hun uses to brush his leg hair? A Hun knee comb.",
    "Words can't possibly describe how beautiful you are... But numbers can 4/10",
    "What are twins favorite fruits? Pears",
    "Did you hear about the guy who fell into an upholstery machine? Now he's fully recovered.",
    "Why did the chicken cross the road? To get to the moron's house. *knock knock* ^^Whose ^^there? *the chicken...*",
    "Why did the wave fail the driving test? It kept crashing on the beach.",
    "What did one earthquake say to the other? Hey, it's not my fault.",
    "I bought some shoes from a drug dealer, I don't know what he laced them with but I have been tripping all day. --My amazing girlfriend told me this one",
    "Request: Jokes for the sick? I have a good friend who was just hospitalized, hopefully nothing too serious. I'd love to send him a few short, clean jokes to cheer him up. Thanks!",
    "Why would no one listen to the percussion section? Because they couldn't drum up enough support.",
    "What kind of bee can never be understood? A mumble-bee.",
    "What's the difference between Botox and Borax? Two letters.",
    "A broom only likes one brand of comedy. Dustpan.",
    "If you bury someone in the wrong place then you have made a grave mistake.",
    "A man walks into a fancy dress party carrying a woman on his back... The host asks the man why this is so. 'Oh, I'm a tortoise and this is Michelle' says the man.",
    "There's only one problem with reading articles about space based technology It all goes waaaay over my head.",
    "Pac-Man What should you do before you criticize Pac-Man? WAKA WAKA WAKA mile in his shoes.",
    "What does a bag of rice and an onion do when they get into a fast car? They pilaf. I'll show my way out",
    "Want to hear a joke about pizza? Never mind it is too cheesy.",
    "What did the Triangle say to the Circle? 'Your life is pointless.'",
    "HELP! We need your best joke you have! We will choose the best joke and make a video of it, just for you!",
    "I heard a great joke about a boomerang earlier. I'm sure it will come back to me eventually.",
    "What did the pony say when he had a sore throat? Pardon me, I'm just a little hoarse.",
    "I'm good friends with 25 letters of the alphabet... I don't know why.",
    "What's pink and fluffy? Pink fluff. Whats blue and fluffy? Pink fluff holding its breath",
    "What's Sam Smith's favorite type of nut?  [It's an alllllllllmond](https://www.youtube.com/watch?v=fB63ztKnGvo&amp;feature=youtu.be&amp;t=37s)",
    "What did the koala bear say to the barber? You ca-lip this?",
    "What city loves to eat sandwiches? Koldcutta",
    "Why aren't sumos chummy with racecar drivers? They move in different circles.",
    "What do you call shaving a crazy sheep? Shear madness.",
    "Why don't tennis players get married? Because to them love means nothing.",
    "What do you call a fake noodle? An Impasta",
    "I thought I had a brain tumor but then I realized it was all in my head.",
    "Did you know that 1 in every doll, in every doll, in every doll, in every doll are Russian?",
    "Today's my cake day! And I'm going to eat it too!",
    "How do you kill a vampire from the South? With a chicken fried stake",
    "You can pick your friends, and you can pick your nose... But you can't pick your friend's nose",
    "Two atoms walk into a bar... One says, 'Oh no, I've lost an electron.' The other asks, 'Are you sure?' 'Yeah, I'm positive!'",
    "What is robot jazz called? Beep Boop Bop!",
    "My Girlfriend told me she didn't want anything for Birthday I didn't give her anything :O #ThugLife",
    "What have you got if your pet kangaroo gets into molasses and Indian curry? An Indian goo roo",
    "I would think you'd have to be open minded... ...to be a brain surgeon.",
    "I fell off a forty foot ladder today.... lucky I was on the bottom rung.",
    "Where did Napoleon Bonaparte keep his armies? In his sleevies.",
    "what did socrates learn from the T-rex? i dino",
    "Why do ducks have webbed feet? To stomp out fires. Why do elephants have flat feet? To stomp out the burning ducks.",
    "What do cows like on their hotdogs? MOOstard.",
    "Broom advocates for cleaner work environment.",
    "I was watching a TV program on various Religious orders and how the use stringed instruments. I was appalled by the amount of sects and violins!",
    "If you give a mouse a cookie.. If you give a mouse a cookie.. Why are you giving a mouse any food? That's unsanitary.",
    "What happens if you pass gas in church? You have to sit in your own pew.",
    "Whats the best thing to put into a pie? Your teeth!",
    "I have to find a new personal trainer. He didn't do squat(s).",
    "Wanna hear a dirty joke? A white horse fell in a mud puddle.",
    "A funny bird is the pelican His beak can hold more than his belly can He can hold in his beak Enough for a week And I don't know how the heck he can!",
    "Where do dinosaurs get their pickles from? Vlasic Park",
    "What's the difference between a fish and a guitar? You can't tuna fish!",
    "What do you call two crows? Attempted murder.",
    "What do you call a t-shirt with stalks of wheat on it? A crop top!",
    "What do you call a cow with 2 legs? Lean beef.",
    "What is the scientific name for a crippled tyrannosaurus rex ? Tywalkasoreus Rex",
    "What type pf culture is most peaceful and never gets angry? Nomads!",
    "I tried to change my password to 14days... The computer said it was two week.",
    "2 fish in a tank, one says to the other Do you know how to drive this thing?",
    "Knock knock - Who's there? - Impatient cow. - Impatient co- - He already left.",
    "Why were the Libyans eating money? They were having dinar.",
    "Why can't you hear it when a pteranodon goes to the bathroom? Because they're all dead.",
    "why was the rabbit promoted to brewmaster? All his beers had a lot of hops",
    "What is Captain Ahab's favorite reggae band? Bob Marley and The Whalers!",
    "Where did the mistletoe go to become rich and famous? Hollywood.",
    "bad scary film I was watching a really poorly done scary movie last night, it was horrorble.",
    "What did batman say to robin before robin got in the car? get in the car",
    "Why did the strawberry go out with the pineapple? Because he couldn't get a date!",
    "Why did the buddhist refuse novocaine when he went to get a tooth pulled? He wanted to transcend dental medication.",
    "What happens when you don't serve drinks at a party? There's no punch line.",
    "I just read this article about short term memory I don't remember what it was about",
    "Did you hear about the farmer that fell into the field machine and lost half his body? He's all right now! :-)",
    "Accidental Seafood I tried dolphin once...but not on porpoise.",
    "Did you hear about the wedding between the two antenna? The service was terrible, but the reception was great.",
    "What state do most people live in? Denial. Myself included.",
    "whats brown and rhymes with snoop? Dr Dre",
    "Why do space rocks taste better than earth rocks? Because they are a little meteor",
    "What does a hawk call a high ledge A *falcony!*",
    "What did the German policeman say to his nipples? You are under a vest!",
    "Someone talked to me today about having two X chromosomes. Typical woman.",
    "If you're American, when are you not American? When European. Or when you're Russian. Any more? :)",
    "A mathematician was constipated, how did he solve his problem? He worked it out with a pencil and paper.",
    "What do you call a barbarian you can't see? an Invisigoth.",
    "Where did the seaweed... Where did the seaweed find a job? In the 'Kelp Wanted' section of the want-ads.",
    "How many tickles does it take to make an octopus laugh? Ten tickles",
    "Who is the roundest knight at King Arthur's table? Sir Cumference.",
    "I know a guy who collects candy canes... ...they are all in mint condition.",
    "I'm reading a book about anti-gravity. I can't put it down.",
    "Why do the French like eating snails? Because they can't stand fast food!",
    "What does a Jedi say after a tragic loss of life? 'May my thoughts be with them'.",
    "What do you call an alien in a swamp? A MARSHian",
    "Will Smith joke How do you find Will Smith in the snow? You look for fresh prince...",
    "One time, a cow saved my life It was bovine intervention.",
    "Why should you always knock before opening the refrigerator? Because there might be an Italian dressing.",
    "What did the rubber band factory worker say when he was fired? Oh snap!",
    "Why did the rap battle champion get the most spacious and accessible seat on the bus? Because of his dis-ability.",
    "What lies at the bottom of the ocean and twitches? A nervous wreck.",
    "We always bought our cars used, this one was as black as the night- -that is, until we washed it!!!",
    "I feed my cat lemons. He's a real sour puss.",
    "I thought the dryer shrank my clothes.. turns out it was the refrigerator",
    "I was driving today... And saw a sign that said, 'Steamed Crabs'. I began to wonder: 'What made them so mad?'",
    "My dog used to chase people on a bike a lot. It got so bad, finally I had to take his bike away.",
    "What do you call someone who points out the obvious? Someone who points out the obvious.",
    "What do you call a Mexican with a rubber toe? Rubber-Toe! (Roberto)",
    "What do you call the ultimate fish doctor? The Sturgeon General",
    "How did the firefly feel when he flew into the fan? He was de-lighted",
    "Why couldn't the pony sing? He was a little horse.",
    "What did the horse say when he fell over? 'Help! I've fallen and I can't giddy up.'",
    "What happens when you steamroll Batman and Robin? They become flatman and ribbon.",
    "Why did the melon try so hard to get her father's approval? Because she cant-aloupe",
    "My girl asks why I love chocolate so much. Well, I have several Reisens...",
    "I finally finished baby proofing the house. Let's see those babies get in here now.",
    "My friend says she's doing good but she means well",
    "Why does Snoop Dogg use an umbrella? For Drizzle",
    "What do vegan zombies eat? Graaaaains!",
    "Schooner or later, sailors... ...engage in rudder nonsense.",
    "What's a pirate's favorite letter? The C.",
    "What happened to the butched after he backed into the meat grinder? he got a little 'behind' in his work",
    "I still remember what my grandpa said before he kicked the bucket... 'How far do you think I can kick this bucket?!'",
    "Knock knock -Who's there? Ash -Ash who? Bless you.. P.S. kids love it",
    "What do you call a singing laptop? A Dell",
    "If all of Ireland sank, what part of it wouldn't? County Cork",
    "Knock knock! **Who's there?** *Tank* **Tank who?** *You're welcome*",
    "This Post just says it all! It all.",
    "What kind of music does a printer make? A paper jam.",
    "My friend's bakery burned down last night. Now his business is toast.",
    "Why did the superhero make a lot of shredded cheese? It was for the grater good.",
    "What mysterious hair product does Lucifer use to keep himself looking good? Arcane-gel!",
    "Overheard: Augustus Caesar on New Year's Day: 'I keep writing 'B.C.' on all my checks.'",
    "What did the mom say to her son when he said he didn't want any of her flippin' pancakes? Fine. They will just be burnt on one side.",
    "What has more letters than the alphabet? The post office.",
    "You can tune a guitar... but you can't tuna fish!",
    "What has two arms and 14 legs? Guy who collects legs.",
    "How does a penguin build its house? Igloos it together!",
    "Why didn't Silento knock before coming inside? Because you already know who it's isss! My little sister told me this joke.",
    "[My Joke] Where do noodles get their nails done? At the spa-getti.",
    "What do you call a dog in a diving bell? A sub-woofer",
    "What do you get when you sit on a potato? A potato wedge! (I made this up when I was 9)",
    "Do you guys/gals like horse jokes? Yeah or neeiiigghh?",
    "What did one duck say to the other? Quack!",
    "How did the pilot like his hotdog? Plane.",
    "A horse walks into a bar, orders a beer. The bartender says, 'Why the long face?' And the horse answers, 'They've started a round of layoffs at the plant.'",
    "Why did the Buddhist monk refuse Novocain? Because he wanted to transcend dental medication.",
    "Wise man once say... He who runs in front of car will get tired, He who runs behind car will get exhausted.",
    "My buddy says he is the world's worst at self-deprecating humor. he worried once he was too modest. Then realized he was wrong.",
    "What do you call a dog with no legs? It doesn't matter what you call it, it won't come.",
    "I support farming and math... I'm pro-tractor.",
    "How do you make a computer your best friend? You buy it a nice bunch of software and get it loaded!",
    "What do you call a dog with no legs? Don't bother, he's not coming.",
    "Every journey has a beginning. -ahem- Just a small town girl Living in a lonely world...",
    "What's the difference between a cat and a complex sentence? A cat has claws at the end of its paws. A complex sentence has a pause at the end of its clause.",
    "Never play poker with a pieces of paper. They're bound to fold.",
    "Why do Hutus hate Dustin Hoffman? He impersonated a Tootsie.",
    "A Thanksgiving Joke What did the turkey say about the television program from the 1950s? There's a little bit too much grayvy.",
    "What's invisible and smells like carrots? Rabbit farts",
    "What did one wall say to the other wall? I`ll meet you at the corner.",
    "What's the most beautiful thing in mathematics? A cute angle",
    "A dog with only 3 legs walks into a saloon in the Old West He slides up to the bar and announces: ''I'm looking for the man who shot my paw.'",
    "I used to be addicted... to the hokey pokey but I turned myself around (x-post from /r/jokes)",
    "The three unwritten rules of /r/cleanjokes are: 1. 2. 3.",
    "Why did Beethoven get rid of his chickens? All they said was, Bach, Bach, Bach'",
    "Why does a chicken coup have 2 doors? Because if it had 4 doors, it would be a chicken Sedan.",
    "Someone sly sheared sleeping sheep. Talk about shear terror.",
    "Did ya hear about the magic tractor? It turned into a field",
    "Why do Java developers wear glasses? Because they don't C#",
    "Just went to an emotional wedding Even the cake was in tiers.",
    "Why does Snoop Dog carry and umbrella? Fo-Drizzle",
    "How do you know you put the right joke in the right thread? Don't worry, someone will tell you.",
    "What do you call a camel with 3 humps? Humphrey. (I was told this joke by an actual dad, it was his response to one of my jokes)",
    "Two fish in a tank. [x-post from r/Jokes] One asks: How do you drive this thing?",
    "'Stay strong!' I said to my wi-fi signal.",
    "Why was the tomato blushing? Because it saw the salad dressing!",
    "What is heavy forward but not backward? **ton**"
];
