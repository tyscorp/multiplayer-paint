var io = require("socket.io");
var express = require("express");
var path = require("path");
var http = require("http");
var redis = require("redis");
var async = require("async");
var moment = require("moment");
var fs = require("fs");

var settings = require("./settings");
var Canvas = require("./canvas");
var redisClient = redis.createClient(settings.redis.port, settings.redis.host, settings.redis.options);
var app = express();
var server = http.createServer(app);
var io = require("socket.io").listen(server, { log: false });
var Image = Canvas.Image;

/**
 * Express configuration
 */
app.configure(function () {
	app.set("port", settings.server.port);
	app.set("views", __dirname + "/views");
	app.set("view engine", "ejs");
	app.use(express.favicon());
	app.use(express.logger("dev"));
	app.use(express.bodyParser());
	app.use(express.methodOverride());
	app.use(express.cookieParser(settings.secret));
	app.use(express.session());
	app.use(app.router);
	app.use(require("less-middleware")({ src: __dirname + "/public", compress: true, optimization: 2 }));
	app.use(express.static(path.join(__dirname, "public")));
});

app.configure("development", function () {
	app.use(express.errorHandler());
});

/**
 * Index
 */
app.get("/", function (req, res) {
	var latest = [];
	
	redisClient.zrevrange(["latest", 0, 9, "WITHSCORES"], function (err, reply) {
		for (var i = 0; i < reply.length; i += 2) {
			latest.push([
				reply[i],
				moment(Number(reply[i+1])).fromNow()
			]);
		}
		
		res.render("index", {latest: latest});
	});
});

/**
 * Paint
 */
app.get("/:id", function (req, res) {
	res.render("paint");
});

/**
 * Returns the last n updated cavases
 * Append ?limit=n for a limit other than 10
 */
app.get("/api/latest.json", function (req, res) {
	res.writeHead(200, {"Content-Type": "text/html" });

	redisClient.zrevrange(["latest", 0, req.query["limit"] || 10, "WITHSCORES"], function (err, reply) {
		res.end(JSON.stringify(reply), "utf-8");
	});
});

/**
 * Gets a canvas given a room name
 */
app.get("/api/canvas/:id", function (req, res) {
	res.writeHead(200, {"Content-Type": "image/png" });

	Canvas.getForRoom(req.params.id, function(canvas) {
		canvas.toBuffer(function (err, buf) {
			res.end(buf, "binary");	
		});
	});
});

/**
 * Clears a canvas given a room name
 */
app.get("/api/clear/:id", function (req, res) {
	var canvas = new Canvas(settings.canvas.width, settings.canvas.height);
	canvas.init(req.params.id);
	var g = canvas.getContext("2d");
	g.fillStyle = "#FFF";
	g.fillRect(0, 0, settings.canvas.width, settings.canvas.height);

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
		console.log("Cleared " + req.params.id);
		res.redirect("/" + req.params.id);
	});
});

app.get("/api/test/:id", function (req, res) {
	Canvas.getForRoom(req.params.id, function(canvas) {
		fs.readFile(__dirname + "/public/images/coloris.png", function (err, data) {
			var g = canvas.getContext("2d");
		
			var img = new Canvas.Image();
				
			img.onload = function () {
				g.drawImage(img, 0, 0);
				
				canvas.save(function (err, buf) {
					res.redirect("/" + req.params.id);	
				});
			};
					
			img.onerror = function (err) {
				console.log(err);
			};
					
			img.src = data;
		});
	});
});

/**
 *	DEBUG
 */
 app.get("/api/debug/clearmice", function (req, res) {
	res.redirect("/");
 
	redisClient.zrevrange(["latest", 0, -1], function (err, data) {

		for (var i = 0; i < data.length; i++) {
			redisClient.del(data[i] + ":mice");
		};
	});
});

server.listen(app.get("port"), function () {
	console.log("Express server listening on port " + app.get("port"));
});

redisClient.on("error", function (err) {
	console.log("RedisError: " + err);
});

/**
 * Socket.IO
 */
io.sockets.on("connection", function (socket) {

	/**
	 * Request to join a room
	 */
	socket.on("join", function (data) {
		if (data && data.room && String(data.room) === data.room) {
			var room = data.room;

			socket.room = data.room;
			socket.join(socket.room);
		}
	});
	
	/**
	 * Sets the name of the client
	 */
	socket.on("name", function (name) {
		if (socket.room) {
			socket.name = name;
		}
	});

	/**
	 * Mouse data
	 *
	 * Redis structure for mice:
	 * {
	 *	'roomname:mice': {
	 *		'user1': "[x,y,thickness,style]",
	 *		'user2': "[x,y,thickness,style]"
	 *	}
	 * }
	 */
	socket.on("mouse", function (data) {
		if (socket.room) {
			redisClient.hset(socket.room + ":mice", socket.name, JSON.stringify(data));
			redisClient.sadd("dirtymice", socket.room);
		}
	});

	/**
	 * Data to draw/etc
	 */
	socket.on("bufferdata", function (data) {
	
		if (socket.room) {
			// sanitize the data so the server doesn't crash
			data = sanitize([data]);

			// send the data to all users
			socket.broadcast.to(socket.room).emit("newdata", data);
			
			// add the data to the buffer (only used on server restart)
			redisClient.rpush(socket.room + ":buffer", JSON.stringify(data[0]), function (err) {
				if (err) console.log(err);
			});

			Canvas.getForRoom(socket.room, function(canvas) {
				canvas.draw(data);

				// if the buffer is full, flush the canvas (save to redis/clear buffer)
				redisClient.llen(socket.room + ":buffer", function (err, length) {
					if (length >= settings.buffer_length && !canvas.flushing) {
						canvas.flush();
					}
				});
			});

			// to keep track of new rooms
			redisClient.zadd("latest", Date.now(), socket.room);
		}
	});
	
	socket.on("disconnect", function () {
		redisClient.hdel(socket.room + ":mice", socket.name, function () {});
    });
});

/**
 * Every mouse_update_ms ms, get the rooms for which the mice have been updated
 * since the last interval then push that data to everyone in the relative room
 */
setInterval(function () {
	// Get all the dirty mice
	redisClient.smembers("dirtymice", function (err, members) {
		members.forEach(function (member) {
			redisClient.hgetall(member + ":mice", function (err, obj) {
				io.sockets.in(member).emit("mouse", obj);
			});
			
			redisClient.srem("dirtymice", member);
		});
	});

}, settings.mouse_update_ms);

/**
 * Sanitize drawing data
 */
function sanitize (d) {
	var sanitized = [];
	
	for (var i = 0; i < d.length; i++) {
		var data = d[i];
		
		// Make sure the bit of data has a type
		if ("type" in data) {
			switch (data.type) {
				case "path":
					break;

				case "line":
				
					// Make sure it has x1, y1, x2, y2
					if (data.p.length > 3) {
						var p = [];

						// Make sure the points are numbers
						p[0] = Number(data.p[0]);
						p[1] = Number(data.p[1]);
						p[2] = Number(data.p[2]);
						p[3] = Number(data.p[3]);

						if (data.p.length === 5) {
							var ss = String(data.p[4].ss);
							var fs = String(data.p[4].fs);
							var lw = String(data.p[4].lw);

							// This is done this way to avoid sending empty strings
							// for properties we don't define.
							p[4] = {};

							if (ss !== "") p[4].ss = ss;
							if (fs !== "") p[4].fs = fs;
							if (lw !== "") p[4].lw = lw;
						}
						
						// If it all checks out, let us draw it!
						sanitized.push({ type: data.type, p: p });
					}
					break;
			}
		}
	}
	
	return sanitized;
};
