var Canvas = require("canvas");
var extend = require("xtend");
var async = require("async");
var redis = require("redis");

var redisClient = redis.createClient();

Canvas.DATA = {};

Canvas.BUF_LEN = 2048;

Canvas.CANVAS_WIDTH = 800;
Canvas.CANVAS_HEIGHT = 600;

Canvas.defaultLineWidth = 2;
Canvas.defaultStrokeStyle = "#000";
Canvas.defaultFillStyle = "rgba(0,0,0,1)"

Canvas.getForRoom = function (room, cb) {
	if (room in Canvas.DATA) {
		cb(Canvas.DATA[room]);
	}
	else {
		var c = new Canvas(Canvas.CANVAS_WIDTH, Canvas.CANVAS_HEIGHT);
		c.init(room);
		c.load(function () {
			cb(c);
		});
	}
}

Canvas.prototype.init = function (room) {
	this.room = room;
	Canvas.DATA[room] = this;
};
	
Canvas.prototype.load = function (cb) {
	var canvas = this;

	redisClient.get(canvas.room + ":canvas", function (err, reply) {
		var img;
		
		var g = canvas.getContext("2d");
		
		if (reply === null) {
			g.fillStyle = "white";
			g.fillRect(0, 0, Canvas.CANVAS_WIDTH, Canvas.CANVAS_HEIGHT);
			
			canvas.save(function () {
				if (cb) cb();
			});
		}
		else {
			img = new Canvas.Image();
			img.src = reply;
			img.onload = function () {
				console.log("loaded!");
			};
			g.drawImage(img, 0, 0);
			
			redisClient.llen(canvas.room + ":buffer", function (err, length) {
				if (length > 0) {
					if (canvas.flushing) {
						setTimeout(function () {
							canvas.load(); //lol
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
		}
	});
};
	
Canvas.prototype.save = function (cb) {
	console.log("Saving canvas: " + this.room + "...");
	var time = Date.now();
	redisClient.set(this.room + ":canvas", this.toDataURL(), function (err, reply) {
		console.log("Saved! Took " + (Date.now() - time) + "ms");
		if (cb) cb(err, reply);
	});
};

Canvas.prototype.flushing = false;
	
Canvas.prototype.flush = function (cb) {
	var canvas = this;

	canvas.flushing = true;
	
	async.series([
		function (callback) {
			redisClient.llen(canvas.room + ":buffer", function (err, length) {
				if (length > 0 && canvas.buffer === 0) {
					redisClient.lrange(canvas.room + ":buffer", 0, -1, function (err, data) {
						
						for (var i = 0; i < data.length; i++) {
							data[i] = JSON.parse(data[i]);
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
		buffer = 0;
		canvas.flushing = false;
		if (cb) cb();
	});
};

Canvas.prototype.buffer = 0;

Canvas.prototype.draw = function (actions) {
	var canvas = this;
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
			}
		}
	});
	//console.log("Drawn! Took " + (Date.now() - time) + "ms");
	
	canvas.buffer++;
}

module.exports = Canvas;