var Canvas = require("canvas");
var extend = require("xtend");
var async = require("async");
var redis = require("redis");
var settings = require("./settings");

var redisClient = redis.createClient(settings.redis.port, settings.redis.host, settings.redis.options);

Canvas.DATA = {}; // Where we store all of the canvases

Canvas.defaultLineWidth = settings.canvas.defaultLineWidth;
Canvas.defaultStrokeStyle = settings.canvas.defaultStrokeStyle;
Canvas.defaultFillStyle = settings.canvas.defaultFillStyle;

/**
 * Returns a canvas given a room string
 */
Canvas.getForRoom = function (room, cb) {
	// If the canvas is already in memory just return it
	if (room in Canvas.DATA) {
		cb(Canvas.DATA[room]);
	}
	// Otherwise, create a new canvas and load it
	else {
		var c = new Canvas(settings.canvas.width, settings.canvas.height);
		c.init(room);
		c.load(function () {
			cb(c);
		});
	}
}

/**
 * Sets the room and inserts the canvas to the hash of canvses
 */
Canvas.prototype.init = function (room) {
	this.room = room;
	Canvas.DATA[room] = this;
};

/**
 * Loads a canvas from redis or creates it if it doesn't exist
 */
Canvas.prototype.load = function (cb) {
	var canvas = this; // preserve context
	
	// Try to get the canvas from redis. Reply is either null or a data URL
	redisClient.get(canvas.room + ":canvas", function (err, reply) {
		var img;
		
		var g = canvas.getContext("2d");
		
		// It doesn't exist in redis, fill it then save it
		if (reply === null) {
			g.fillStyle = "white";
			g.fillRect(0, 0, settings.canvas.width, settings.canvas.height);
			
			canvas.save(function () {
				if (cb) cb();
			});
		}
		else {
			img = new Canvas.Image();
			img.onload = function () {
				g.drawImage(img, 0, 0);
			
				// This is to handle the case of a canvas not saved before the server exits
				redisClient.llen(canvas.room + ":buffer", function (err, length) {
					if (length > 0) {
						// Someone is trying to load the canvas at the same time!
						// I couldn't think of a better solution. It will try to load again in 100ms.
						// Maybe emit an event "flushed"? Hmm... Will investigate.
						if (canvas.flushing) {
							setTimeout(function () {
								canvas.load();
							}, 100);
						}
						else {
							canvas.flush(function () {
								cb();
							});
						}
					}
					else if (cb){
						cb();
					}
				});
			};
			
			img.src = reply; // !! This is async in browsers but doesn't appear to be here??? wtf
		}
	});
};

/**
 * Saves a canvas to redis. Quite expensive, so try not to call it a lot.
 */
Canvas.prototype.save = function (cb) {
	console.log("Saving canvas: " + this.room + "...");
	var time = Date.now();
	redisClient.set(this.room + ":canvas", this.toDataURL(), function (err, reply) {
		console.log("Saved! Took " + (Date.now() - time) + "ms");
		if (cb) cb(err, reply);
	});
};

/**
 * Used to make sure that you can't flush more than once at a time
 * This was happening when you sent data to draw after flushing began
 * and before the buffer was cleared.
 */
Canvas.prototype.flushing = false;
	
Canvas.prototype.flush = function (cb) {
	var canvas = this; // preserve context

	canvas.flushing = true;
	
	// Lol asynchronous coding
	async.series([
		function (callback) {
			redisClient.llen(canvas.room + ":buffer", function (err, length) {
				// If there is data in the redis buffer and canvas.buffer is 0, then the
				// server was started with data not saved to the canvas in redis.
				// Redraw the data.
				if (length > 0 && canvas.buffer === 0) {
					redisClient.lrange(canvas.room + ":buffer", 0, length, function (err, data) {
						
						for (var i = 0; i < data.length; i++) {
							try {
							data[i] = JSON.parse(data[i]);
							}catch(e) {"Error: " + err + " Data: " + console.log(data[i]);}
						}
						
						canvas.draw(data);
						
						callback();
					});
				}
				else {
					callback();
				}
			});
		},
		function (callback) {
			async.parallel([
				function (callback) {
					canvas.save(function () {
						callback();
					});
				},
				function (callback) {
					redisClient.ltrim(canvas.room + ":buffer", 0, 0, function () {
						callback();
					});
				}
			], function (err, results) {
				callback();
			});
		}
	], function (err, results) {
		canvas.buffer = 0;
		canvas.flushing = false;
		if (cb) cb();
	});
};

/**
 * Changes since the last flush
 */
Canvas.prototype.buffer = 0;

/**
 * The drawing function.
 * This is pretty much the same on the client.
 */
Canvas.prototype.draw = function (actions) {
	var canvas = this; // preserve context
	//console.log("Drawing " + actions.length + " objects...");
	//var time = Date.now();
	
	actions.forEach(function (data) {
		if (data) {
			var g = canvas.getContext("2d");
			g.fillStyle = Canvas.defaultFillStyle;
			g.strokeStyle = Canvas.defaultStrokeStyle;
			g.lineWidth = Canvas.defaultLineWidth;
			g.lineCap = "round";
			
			switch (data.type) {
				case "path":
					g.beginPath();
					g.save();
					if (data.path[0].length === 3) {
						if (data.path[0][2].ss) g.strokeStyle = data.path[0][2].ss;
						if (data.path[0][2].fs) g.fillStyle = data.path[0][2].fs;
						if (data.path[0][2].lw) g.lineWidth = data.path[0][2].lw;
					}
					
					g.moveTo(data.path[0][0], data.path[0][1]);
					g.restore();
					
					for (var i = 1; i < data.path.length; i++) {
						g.save();
						if (data.path[i].length === 3) {
							if (data.path[0][2].ss) g.strokeStyle = data.path[0][2].ss;
							if (data.path[0][2].fs) g.fillStyle = data.path[0][2].fs;
							if (data.path[0][2].lw) g.lineWidth = data.path[0][2].lw;
						}
					
						g.lineTo(data.path[i][0], data.path[i][1]);
						
						g.restore();
					}
					
					g.stroke();
					
					break;
				
				case "line":
					g.beginPath();
					g.save();
					if (data.p.length === 5) {
						if (data.p[4].ss) g.strokeStyle = data.p[4].ss;
						if (data.p[4].fs) g.fillStyle = data.p[4].fs;
						if (data.p[4].lw) g.lineWidth = data.p[4].lw;
					}
					g.moveTo(data.p[0], data.p[1]);
					g.lineTo(data.p[2], data.p[3]);
					g.stroke();
					g.restore();
					break;
					
				case "image":
					g.save();
					
					var img = new Canvas.Image();
					
					img.onload = function () {
						g.drawImage(img, data.i[1], data.i[2]);
					}
					
					img.onerror = function (err) {
						console.log("Error loading image");
					}
					
					img.src = data.i[0];
					
					g.restore();
					break;
			}
		}
	});
	//console.log("Drawn! Took " + (Date.now() - time) + "ms");
	
	canvas.buffer++;
}

module.exports = Canvas;
