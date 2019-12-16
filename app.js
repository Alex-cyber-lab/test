var config = require("config").get("app");

var serve = require('koa-static');
var Koa = require("koa");
var Router = require("koa-router");
var mySQL = require("mysql2");
var mySQLPromise = require("mysql2/promise");

var fs = require("fs");
var util = require("util");

var fsExists = util.promisify(fs.exists);
var fsRenamePromise = util.promisify(fs.rename);
var fsUnlinkPromise = util.promisify(fs.unlink);

var validator = require("validator");

var server = new Koa();
var router = new Router();

var mySQLDBName = config.my_sql_connection.database;
var mySQLTableName = config.my_sql_connection.database;

const DATE_FORMAT_ISO8601 = "%Y-%m-%d";
const DATATABLE = mySQLDBName + "." + mySQLTableName;

var koaBody = require("koa-body")({
	urlencoded: true,
	multipart: true,
	formLimit: "5mb",
	formidable: {
		multiples: false,
		maxFileSize: 2 * 1024 * 1024,
		uploadDir: __dirname + "/public",
		keepExtensions: true
	}
});

server.use(koaBody);
server.use(serve(__dirname + "/public"));

var mySQLConnection = mySQL.createConnection(config.my_sql_connection);

mySQLConnection.connect(async err => {
	if (err) {
		if (err.errno === 1049) await importCsvToMySql();
		else console.error(err); 
	}
	else {
		console.info("MySQL connected...");
	}
});

server.use(async (ctx, next) => {

	ctx.set("Access-Control-Allow-Origin", "*");
	ctx.set("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept");
	ctx.set("Access-Control-Allow-Methods", "POST, GET, PUT");

	await next();

});

router.post("/books", async (ctx) => {

	let body = validateAndGetBooksBody(ctx);

	let mySQLPromisePool = mySQLPromise.createPool({
		host: config.my_sql_connection.host,
		user: config.my_sql_connection.user,
		password: config.my_sql_connection.password
	});

	let mySqlGetMaxId = "SELECT MAX(`id`) `id` FROM " + DATATABLE + ";"
	let mySQLAddData = "INSERT INTO " + DATATABLE + " (`title`, `date`, `author`, `description`, `image`) VALUES (?, ?, ?, ?, ?);";

	let [max] = await mySQLPromisePool.query(mySqlGetMaxId);
	let image = (max[0].id + 1) + ".png";
	let [resultQuery] = await mySQLPromisePool.query(mySQLAddData, [body.title, body.date, body.author, body.description, image]);

	await fsRenamePromise("public/" + getBooksBodyImageName(ctx), "public/" + resultQuery.insertId + ".png");
	ctx.status = 201; // Create new resource
	ctx.body = {id: resultQuery.insertId};

});

router.put('/books', async (ctx) => {

	let fields = [], body = validateAndGetBooksBody(ctx);

	for (field in body) {
		if (field !== "id") {
			let param = mySQLConnection.escape(body[field]);
			fields.push("`" + field + "` = " + param);
		}
	}
	
	fields = fields.join(", ");
	
	if (ctx.request.files.image) {
		fields += ", `image` = '" + body.id + ".png'";
	}

	let mySQLPromiseConnection = await mySQLPromise.createConnection(config.my_sql_connection);
	let mySQLUpdateData = "UPDATE " + DATATABLE + " SET " + fields + " WHERE `id` = " + body.id + ";";

	let [resultQuery] = await mySQLPromiseConnection.query(mySQLUpdateData);

	if (ctx.request.files.image) {

		let image = getBooksBodyImageName(ctx);

		if (resultQuery.changedRows > 0) {
			
			let path = "public/" + body.id + ".png";
			let isExist = await fsExists(path);
			
			if (isExist) {
				await fsUnlinkPromise(path);
			}
			
			await fsRenamePromise("public/" + image, path);

		}
		else {
			ctx.throw(400, "This `id` is undefined.");
		} // Image to trash if `id` is undefined

	}

	ctx.status = 204; // Success update resource

});

router.get('/books', async (ctx) => {

	const HOST_URL = "http://" + ctx.request.header.host + "/";

	let query = validateAndGetBooksQuery(ctx);

	let mySQLGetData = ["SELECT `id`, `title`, DATE_FORMAT(`date`, '" + DATE_FORMAT_ISO8601 + "') `date`, `author`, `description`, Concat('" + HOST_URL + "', `image`) `image` FROM " + DATATABLE];
	let mySQLGetDataFilteredCount = ["SELECT COUNT(*) `filtered` FROM " + DATATABLE], mySQLGetDataTotalCount = "SELECT COUNT(*) `total` FROM " + DATATABLE + ";";
	
	let offset = mySQLConnection.escape(Number(query.offset));
	let limit = mySQLConnection.escape(Number(query.limit));

	let mySQLGetDataAdditional = [];
	
	if (query.where) {
		let where = JSON.parse(query.where);
		let whereField = Object.keys(where)[0];
		let whereFieldParam = mySQLConnection.escape(where[whereField]);
		mySQLGetDataAdditional.push("WHERE `" + whereField + "` = " + whereFieldParam);
	}
	
	if (query.date) {
		let date = JSON.parse(query.date);
		let mySQLCombine = query.where ? "AND" : "WHERE";
		mySQLGetDataAdditional.push(mySQLCombine + " `date` >= '" + date.from + "' AND `date` <= '" + date.to + "'");
	}
	
	if (query.orderby) {
		let orderby = JSON.parse(query.orderby);
		let mySQLOrderBy = "ORDER BY";
		for (let key in orderby) {
			mySQLOrderBy += " `" + key + "` " + orderby[key] + ",";
		}
		mySQLGetDataAdditional.push(mySQLOrderBy.substring(0, mySQLOrderBy.length - 1));
	}
	
	mySQLGetData = mySQLGetData.concat(mySQLGetDataAdditional);
	mySQLGetDataFilteredCount = mySQLGetDataFilteredCount.concat(mySQLGetDataAdditional);
	
	mySQLGetData.push("LIMIT " + limit);
	mySQLGetData.push("OFFSET " + offset);
	
	mySQLGetData = mySQLGetData.join(" ") + ";";
	mySQLGetDataFilteredCount = mySQLGetDataFilteredCount.join(" ") + ";";

	let mySQLPromisePool = mySQLPromise.createPool(
		{
			host: config.my_sql_connection.host,
			user: config.my_sql_connection.user,
			password: config.my_sql_connection.password
		}
	);
	
	let [data, filtered, total] = await Promise.all(
		[
			mySQLPromisePool.query(mySQLGetData),
			mySQLPromisePool.query(mySQLGetDataFilteredCount),
			mySQLPromisePool.query(mySQLGetDataTotalCount)
		]
	);

	ctx.status = 200; // OK
	ctx.body = {data: data[0], filtered: filtered[0][0].filtered, total: total[0][0].total};

});

function getBooksBodyImageName(ctx) {
	let pathSplit = ctx.request.files.image.path.split("\\");
	return pathSplit[pathSplit.length - 1];
}

function validateAndGetBooksQuery(ctx) {

	let query = ctx.request.query;

	ctx.assert(query.limit, 400, "Field `limit` is required.");
	ctx.assert(query.offset, 400, "Field `offset` is required.");

	/* Filter validate */
	if (query.where && !validator.isJSON(query.where)) {
		ctx.throw(400, "Field `where` is not valid.");
	}
	else if (query.where) {
		if (query.where.date) {
			ctx.throw(400, "Field `date` is not correct used in `where`.");
		}
	}

	if (query.date && !validator.isJSON(query.date)) {
		ctx.throw(400, "Field `date` is not valid.");
	}
	else if (query.date) {

		let date = JSON.parse(query.date);

		ctx.assert(date.from, 400, "Field `from` in `date` is required.");
		ctx.assert(date.to, 400, "Field `to` in `date` is required.");

		if (!validator.isISO8601(date.from, {strict: true})) {
			ctx.throw(400, "Field `from` in `date` is not valid.");
		}
		if (!validator.isISO8601(date.to, {strict: true})) {
			ctx.throw(400, "Field `to` in `date` is not valid.");
		}

	}
	
	/* OrderBy validate */
	if (query.orderby && !validator.isJSON(query.orderby)) {
		ctx.throw(400, "Field `orderby` is not valid.");
	}
	else if (query.orderby) {

		let orderby = JSON.parse(query.orderby);

		for (let field in orderby) {
			let order = orderby[field].toUpperCase();
			if (!validator.isIn(order, ["ASC", "DESC"])) {
				ctx.throw(400, "Field `" + field + "` in `orderby` is not valid.");
				break;
			}
		}

	}
	
	if (!validator.isNumeric(query.limit, {no_symbols: true})) {
		ctx.throw(400, "Field `limit` is not valid.");
	}
	if (!validator.isNumeric(query.offset, {no_symbols: true})) {
		ctx.throw(400, "Field `offset` is not valid.");
	}

	return query;

}

function validateAndGetBooksBody(ctx) {

	let body = ctx.request.body;
	let files = ctx.request.files;

	/* Assert body params */
	if (ctx.request.method === "PUT") {
		ctx.assert(body.id, 400, "Field `id` is required.");
	}
	else {
		ctx.assert(body.title, 400, "Field `title` is required.");
		ctx.assert(body.date, 400, "Field `date` is required.");
		ctx.assert(body.author, 400, "Field `author` is required.");
		ctx.assert(body.description, 400, "Field `description` is required.");
		ctx.assert(files.image, 400, "Field `image` is required.");
	}

	/* Check body params */
	if (body.title && !validator.isLength(body.title, {min: 3, max: 128})) {
		ctx.throw(400, "Field `title` is not valid.");
	}
	if (body.date && !validator.isISO8601(body.date, {strict: true})) {
		ctx.throw(400, "Field `date` is not valid.");
	}
	if (body.author && !validator.isLength(body.author, {min: 3, max: 32})) {
		ctx.throw(400, "Field `author` is not valid.");
	}
	if (body.description && !validator.isLength(body.description, {min: 10, max: undefined})) {
		ctx.throw(400, "Field `description` is not valid.");
	}

	if (files.hasOwnProperty('image') && !validator.contains(files.image.type, "image/png")) {
		ctx.throw(400, "Field `image` is not valid.");
	}

	return body;

}

async function importCsvToMySql() {

	let mySQLDBImportPath = config.my_sql_import_path;

	let mySQLPromisePool = mySQLPromise.createPool({
		host: config.my_sql_connection.host,
		user: config.my_sql_connection.user,
		password: config.my_sql_connection.password
	});

	try {

		await mySQLPromisePool.query("CREATE DATABASE IF NOT EXISTS " + mySQLDBName + ";");
		await mySQLPromisePool.query("USE " + mySQLDBName + ";");
		await mySQLPromisePool.query("CREATE TABLE IF NOT EXISTS " + mySQLDBName + " (`id` INT AUTO_INCREMENT PRIMARY KEY, `title` varchar(128) NOT NULL, `date` DATE NOT NULL, `author` varchar(32) NOT NULL, `description` text NOT NULL, `image` varchar(128) NOT NULL);");
		await mySQLPromisePool.query("SET GLOBAL local_infile=true;");

		console.info("Load data please wait...");

		await mySQLPromisePool.query({
			sql: "LOAD DATA LOCAL INFILE \"" + mySQLDBImportPath + "\" INTO TABLE " + mySQLDBName + " COLUMNS TERMINATED BY ',' OPTIONALLY ENCLOSED BY '\"' ESCAPED BY '\"' LINES TERMINATED BY '\r\n' IGNORE 1 LINES (`title`, `date`, `author`, `description`, `image`);",
			infileStreamFactory: function(path) {
				let readStream = fs.createReadStream(path);
				return readStream;
			}
		}); // Import csv to MySQL table

		console.warn("Import " + config.my_sql_import_path + " to MySql database '" + mySQLDBName + "' is success. Please restart server.");

	}
	catch (err) {
		console.error("Import " + config.my_sql_import_path + " to MySql database '" + mySQLDBName + "'. " + err + ".");
	}
	finally {
		await mySQLPromisePool.query("SET GLOBAL local_infile=false;");
		await mySQLPromisePool.end();
	}

}

server.use(async (ctx, next) => {
	try {
		await next();
	} catch (err) {
	  ctx.status = err.statusCode || err.status || 500;
	  ctx.body = {message: err.message};
	  ctx.app.emit("error", err, ctx);
	}
});

server.on("error", (err, ctx) => {
	console.log('Server Error', err, ctx);
});


/* Start Node server */
server.use(router.routes())
	  .use(router.allowedMethods())
	  .listen(config.server_port);