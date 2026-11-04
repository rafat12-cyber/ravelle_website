// Emergency password reset for an admin user, run on the server:
//   node server/reset-password.js you@ravellebd.com "new-password"
// Stop the store first (it keeps the database in memory), then start it again.
var fs = require("fs"), path = require("path"), crypto = require("crypto");
var ROOT = path.join(__dirname, "..");
var DB_FILE = path.join(path.resolve(ROOT, process.env.DATA_DIR || "data"), "db.json");
var email = String(process.argv[2] || "").toLowerCase(), pw = String(process.argv[3] || "");
if (!email || pw.length < 8) { console.log('Usage: node server/reset-password.js <email> "<new password, 8+ characters>"'); process.exit(1); }
var db = JSON.parse(fs.readFileSync(DB_FILE, "utf8"));
var u = db.users.filter(function (x) { return x.email === email; })[0];
if (!u) { console.log("No admin user with that email. Users: " + db.users.map(function (x) { return x.email; }).join(", ")); process.exit(1); }
u.salt = crypto.randomBytes(4).toString("hex");
u.passwordHash = "scrypt$" + crypto.scryptSync(pw, u.salt, 32).toString("hex");
delete u.resetHash; delete u.resetExpires;
db.sessions = (db.sessions || []).filter(function (s) { return s.userId !== u.id; });
fs.writeFileSync(DB_FILE + ".tmp", JSON.stringify(db));
fs.renameSync(DB_FILE + ".tmp", DB_FILE);
console.log("Password changed for " + u.email + ". Start the store again and sign in.");
