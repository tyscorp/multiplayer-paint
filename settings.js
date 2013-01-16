var s = {
	server: {
		host: "tyscorp.net",
		port: 3016
	},
	
	redis: {
		host: "127.0.0.1",
		port: 6379,
		options: {}
	},
	
	mouse_update_ms: 100,
	
	buffer_length: 2048,
	
	secret: "lol secret here",
	
	canvas: {
		width: 800,
		height: 600,
		defaultLineWidth: 2,
		defaultStrokeStyle: "#000",
		defaultFillStyle: "rgba(0,0,0,1)"
	}
};



module.exports = s;