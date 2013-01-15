var io = require("socket.io");
var express = require("express");
var path = require("path");
var http = require("http");
var Canvas = require("./canvas");
var redis = require("redis");
var async = require("async");

var redisClient = redis.createClient();
var app = express();
var server = http.createServer(app);
var io = require("socket.io").listen(server, { log: false });
//var io = require("socket.io").listen(server);
var Image = Canvas.Image;

var MOUSE_UPDATE_MS = 100;

var CANVAS = {};

app.configure(function () {
	app.set("port", 3016);
	app.set("views", __dirname + "/views");
	app.set("view engine", "ejs");
	app.use(express.favicon());
	app.use(express.logger("dev"));
	app.use(express.bodyParser());
	app.use(express.methodOverride());
	app.use(express.cookieParser("your secret here"));
	app.use(express.session());
	app.use(app.router);
	app.use(require("less-middleware")({ src: __dirname + "/public" ,compress: true, optimization: 2 }));
	app.use(express.static(path.join(__dirname, "public")));
});

app.configure("development", function(){
  app.use(express.errorHandler());
});

app.get("/", function (req, res) {
	res.render("index");
});

app.get("/ajax/latest.json", function (req, res) {
	res.writeHead(200, {"Content-Type": "text/html" });
	
	redisClient.zrevrange(["latest", 0, 10, "WITHSCORES"], function (err, reply) {
		res.end(JSON.stringify(reply), "utf-8");
	});
});

app.get("/canvas/:id", function (req, res) {
	res.writeHead(200, {"Content-Type": "image/png" });
	
	Canvas.getForRoom(req.params.id, function(canvas) {
		canvas.toBuffer(function (err, buf) {
			res.end(buf, "binary");	
		});
	});
});

app.get("/clear/:id", function (req, res) {
	Canvas.getForRoom(req.params.id, function(canvas) {
		var g = canvas.getContext("2d");
		g.fillStyle = "#FFF";
		g.fillRect(0, 0, Canvas.CANVAS_WIDTH, Canvas.CANVAS_HEIGHT);
		canvas.flush();
		res.redirect("/#" + req.params.id);
	});
});


server.listen(app.get("port"), function () {
	console.log("Express server listening on port " + app.get("port"));
});

redisClient.on("error", function (err) {
    console.log("RedisError: " + err);
});

io.sockets.on("connection", function (socket) {
	socket.on("join", function (data) {
		if (data && data.room && String(data.room) === data.room) {
			var room = data.room;
			
			socket.room = data.room;
			socket.join(socket.room);
		}
	});
	
	socket.on("mouse", function (data) {
		if (socket.room) {
			var name = Object.keys(data)[0];
			redisClient.hset(socket.room + ":mice", name, JSON.stringify(data[name]));
			redisClient.sadd("dirtymice", socket.room);
		}
	});
	
	socket.on("bufferdata", function (data) {
		if (socket.room) {
			data = sanitize(data);
		
			socket.broadcast.to(socket.room).emit("newdata", [data]);

			redisClient.rpush(key, JSON.stringify(data));
			
			Canvas.getForRoom(socket.room, function(canvas) {
				canvas.draw([data]);
				
				redisClient.llen(socket.room + ":buffer", function (err, length) {
					if (length >= Canvas.BUF_LEN && !canvas.flushing) {
						canvas.flush();
					}
				});
			});
			
			redisClient.zadd("latest", Date.now(), socket.room);
		}
	});
});

setInterval(function () {
	
	redisClient.smembers("dirtymice", function (err, members) {
	
		members.forEach(function (member) {
			redisClient.hgetall(member + ":mice", function (err, obj) {
				io.sockets.in(member).emit("mouse", obj);
			});
			
			redisClient.srem("dirtymice", member);
		});
	});
	
}, MOUSE_UPDATE_MS);

var sanitize = function (d) {
	var sanitized = [];

	for (var i = 0; i < d.length; i++) {
		var data = d[i];
		
		if ("type" in data) {
			switch (data.type) {
				case "path":
					break;
					
				case "line":
					if (data.p.length > 3) {
						var p = [];
						
						p[0] = Number(data.p[0]);
						p[1] = Number(data.p[1]);
						p[2] = Number(data.p[2]);
						p[3] = Number(data.p[3]);
						
						if (data.p.length === 5) {
							var ss = String(data.p[4].ss);
							var fs = String(data.p[4].fs);
							var lw = String(data.p[4].lw);
							
							p[4] = {};
							
							if (ss !== "") p[4].ss = ss;
							if (fs !== "") p[4].fs = fs;
							if (lw !== "") p[4].lw = lw;
						}
						
						sanitized.push({ type: data.type, p: p });
					}
					break;
			}
		}
	}
	
	return sanitized;
};