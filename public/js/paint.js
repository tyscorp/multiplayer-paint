$(function () {
	
	var room = window.location.hash.substr(1);
	
	var URI = "http://tyscorp.net:3016";
	
	$(window).bind("hashchange", function(e) {
		location.reload();
	});
	
	if (room === "") {
		$("canvas").remove();
		$("#color").remove();
		var main = $("#main");
		
		$.getJSON("/api/latest.json", function (response) {
			if (response.length > 0) {
				var ul = $("<ul>");
			
					for (var i = 0; i < response.length; i+=2) {
					var span = $("<span>", {
						text: "Last updated: " + response[i+1]
					})
					$("<a>", {
						href: URI + '/#' + response[i],
						text: response[i]
					}).prependTo(span);
					
					span.appendTo($("<li>").appendTo(ul));
				}
				
				ul.appendTo(main);
			}
		});
	}
	else {

		var canvas = $("#drawing").get(0);
		var overlayCanvas = $("#overlay").get(0);
		
		var g = canvas.getContext("2d");
		var g2 = overlayCanvas.getContext("2d");
		
		g.lineCap = "round";
		
		var socket  = io.connect(URI);
		
		var img = new Image();
		img.src = URI + "/api/canvas/" + room;
		
		var liveBuffer = [];
		
		var mice;
		
		var defaultLineWidth = 2;
		var defaultStrokeStyle = "#000";
		var defaultFillStyle = "rgba(0,0,0,1)"
		var imgLoaded = false;
		
		var name = "";
		
		socket.on("connect", function () {
			socket.emit("join", { room: room });
			
			if (localStorage[room + ":name"] === undefined) {
				localStorage[room + ":name"] = prompt("Name desu ka?");
			}
			
			name = localStorage[room + ":name"];
		});
		
		img.onload = function () {
			g.drawImage(img, 0, 0);
			
			imgLoaded = true;
			
			if (liveBuffer.length > 0) {
				drawData(liveBuffer);
				liveBuffer = [];
			}
		}

		socket.on("newdata", function (data) {
			if (imgLoaded) {
				drawData(data);
			}
			else {
				liveBuffer = liveBuffer.concat(data);
			}
		});
		
		socket.on("mouse", function (data) {
			for (var key in data) {
				if (data.hasOwnProperty(key)) {
					data[key] = JSON.parse(data[key]);
					
					if (data[key].length < 3) {
						data[key].push(defaultLineWidth);
					}
					if (data[key].length < 4) {
						data[key].push(defaultStrokeStyle);
					}
					
				}
			};
			
			mice = data;
			
			updateOverlay();
		});
		
		function updateOverlay() {
			g2.clearRect(0, 0, $("#overlay").width(), $("#overlay").height());
			
			for (var key in mice) {
				if (mice.hasOwnProperty(key)) {
					if (key !== name) {
						g2.strokeStyle = mice[key][3];
						g2.beginPath();
						g2.arc(mice[key][0], mice[key][1], mice[key][2] * 0.5, 0, 2 * Math.PI, false);
						g2.stroke();
						g2.font = "10pt Verdana"
						g2.fillText(key, mice[key][0] + 5 + mice[key][2] * 0.5, mice[key][1] + 3);
					}
				}
			};
			
			g2.strokeStyle = strokeStyle;
			g2.beginPath();
			g2.arc(Mouse.x, Mouse.y, lineWidth * 0.5, 0, 2 * Math.PI, false);
			g2.stroke();
		}
		
		function drawData(alldata) {
			alldata.forEach(function (data) {
				g.fillStyle = defaultFillStyle;
				g.strokeStyle = defaultStrokeStyle;
				g.lineWidth = defaultLineWidth;
				g.lineCap = "round";
				
				switch (data.type) {
					case "path":					
						for (var i = 1; i < data.path.length; i++) {
							g.save();
							g.beginPath();
							
							if (data.path[i].length === 3) {
								if (data.path[i][2].ss) g.strokeStyle = data.path[i][2].ss;
								if (data.path[i][2].fs) g.fillStyle = data.path[i][2].fs;
								if (data.path[i][2].lw) g.lineWidth = data.path[i][2].lw;
							}
							g.moveTo(data.path[i-1][0], data.path[i-1][1]);
							g.lineTo(data.path[i][0], data.path[i][1]);
							
							g.stroke();
							g.restore();
						}
						break;
					
					case "line":
						g.save();
						g.beginPath();
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
			});
		}
		
		function sendLine (x1, y1, x2, y2, o) {
			var ss = defaultStrokeStyle;
				
			if (Mouse.LEFT) {
				ss = strokeStyle;
			}
			else if (Mouse.RIGHT) {
				ss = "#FFF";
			}
			
			var data = { type: "line", p: [x1, y1, x2, y2, $.extend({ ss: ss, lw: lineWidth }, o)] };
			socket.emit("bufferdata", data);
			drawData([data]);
		}
		
		var lastX = 0;
		var lastY = 0;
		var strokeStyle = defaultStrokeStyle;
		var fillStyle = defaultFillStyle;
		var lineWidth = defaultLineWidth;
		
		var r = 0;
		
		var Mouse = {
			LEFT: false,
			MIDDLE: false,
			RIGHT: false,
			x: 0,
			y: 0,
			isOver: false,
			hasMoved: false
		};

		$("canvas").mousedown(function (event) {
			var offset = $("#overlay").offset();
			Mouse.x = event.pageX - offset.left;
			Mouse.y = event.pageY - offset.top;
		
			if (event.which == 1) {
				Mouse.LEFT = true;
			}
			else if (event.which == 3) {
				Mouse.RIGHT = true;
			}
			
			lastX = Mouse.x;
			lastY = Mouse.y;
		});
		
		$("canvas").mouseover(function (event) {
			var offset = $("#overlay").offset();
			Mouse.x = event.pageX - offset.left;
			Mouse.y = event.pageY - offset.top;
			
			if (Mouse.LEFT || Mouse.RIGHT) {
				sendLine(lastX, lastY, Mouse.x, Mouse.y);
			}
	
			Mouse.isOver = true;
		});
		
		$("body").mousemove(function (event) {
			if (event.buttons) {
				Mouse.LEFT = ((event.buttons & 1) === 1);
				Mouse.RIGHT = ((event.buttons & 2) === 2);
			}
			
			var offset = $("#overlay").offset();
			Mouse.x = event.pageX - offset.left;
			Mouse.y = event.pageY - offset.top;
			
			Mouse.hasMoved = true;
			
			if (Mouse.LEFT || Mouse.RIGHT && Mouse.isOver) {
				sendLine(lastX, lastY, Mouse.x, Mouse.y);
			}
			
			lastX = Mouse.x;
			lastY = Mouse.y;
			
			updateOverlay();
		});
		
		$("canvas").mouseout(function (event) {
			lastX = Mouse.x;
			lastY = Mouse.y;
			var offset = $("#overlay").offset();
			Mouse.x = event.pageX - offset.left;
			Mouse.y = event.pageY - offset.top;
			
			if (Mouse.LEFT || Mouse.RIGHT) {
				sendLine(lastX, lastY, Mouse.x, Mouse.y);
			}
	
			Mouse.isOver = false;
		});
		
		$("body").mouseout(function (event) {
			
			Mouse.LEFT = false;
			Mouse.RIGHT = false;
		});
		
		$("body").mouseup(function (event) {
			if (Mouse.LEFT || Mouse.RIGHT && Mouse.isOver) {
				sendLine(lastX, lastY, lastX, lastY);
			}
			
			if (event.which == 1) {
				Mouse.LEFT = false;
			}
			else if (event.which == 3) {
				Mouse.RIGHT = false;
			}
		});
		
		setInterval(function () {
			if (Mouse.hasMoved) {
				var mouseData = {};
				mouseData[name] = [Mouse.x, Mouse.y, lineWidth, strokeStyle]
				socket.emit("mouse", mouseData);
				Mouse.hasMoved = false;
			}
		}, 50);
		
		$("body").keypress(function (event) {
			if (event.which >= 49 && event.which <= 57) {
				lineWidth = (event.which - 48) * 2;
			}
		});
		
		$("body").keydown(function (event) {
			if (event.which === 32) {
				strokeStyle = rainbow(100, r++);
			}
			if (event.which === 81) {
				strokeStyle = rainbow(30, r++);
			}
			if (event.which === 61 || event.which === 187) {
				if (lineWidth < 75) {
					lineWidth++;
					updateOverlay();
				}
			}
			if (event.which === 173 || event.which === 189) {
				 if (lineWidth > 1) {
					lineWidth--;
					updateOverlay();
				}
			}
		});
		
		$("canvas").bind("mousewheel", function(e, delta) {
			if(delta > 0) {
				if (lineWidth < 75) {
					lineWidth++;
					updateOverlay();
				}
			}
			else {
				 if (lineWidth > 1) {
					lineWidth--;
					updateOverlay();
				}
			}
		});
		
		
		$("#color").change(function (event) {
			var color = new RGBColor($(this).val());

			if (color.ok) {
				strokeStyle = $(this).val();
				$(this).css("color", "#000");
			}
			else {
				strokeStyle = "#000";
				$(this).css("color", "#F00");
			}
		});
		
		document.ontouchmove = function(e) {e.preventDefault()};
	}
});


function rainbow(numOfSteps, step) {
	// This function generates vibrant, "evenly spaced" colours (i.e. no clustering). This is ideal for creating easily distiguishable vibrant markers in Google Maps and other apps.
	// Adam Cole, 2011-Sept-14
	// HSV to RBG adapted from: http://mjijackson.com/2008/02/rgb-to-hsl-and-rgb-to-hsv-color-model-conversion-algorithms-in-javascript
	var r, g, b;
	var h = step / numOfSteps;
	var i = ~~(h * 6);
	var f = h * 6 - i;
	var q = 1 - f;
	switch(i % 6){
		case 0: r = 1, g = f, b = 0; break;
		case 1: r = q, g = 1, b = 0; break;
		case 2: r = 0, g = 1, b = f; break;
		case 3: r = 0, g = q, b = 1; break;
		case 4: r = f, g = 0, b = 1; break;
		case 5: r = 1, g = 0, b = q; break;
	}
	var c = "#" + ("00" + (~ ~(r * 255)).toString(16)).slice(-2) + ("00" + (~ ~(g * 255)).toString(16)).slice(-2) + ("00" + (~ ~(b * 255)).toString(16)).slice(-2);
	return (c);
}
