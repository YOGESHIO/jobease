const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { pool, checkConnection } = require("./db");

const PORT = Number(process.env.PORT || 3000);
const ROOT = __dirname;
const sessions = new Map();
const mimeTypes = { ".html":"text/html; charset=utf-8",".css":"text/css; charset=utf-8",".js":"text/javascript; charset=utf-8",".svg":"image/svg+xml",".png":"image/png",".jpg":"image/jpeg",".jpeg":"image/jpeg",".webp":"image/webp" };

// Services catalog used by the frontend via /api/services
const servicesCatalog = {
  "Popular":      [["Electrician",399],["Plumber",399],["House Cleaning",699],["AC Repair",599],["Carpenter",499],["Painter",599]],
  "Cleaning":     [["Maid",299],["House Cleaning",699],["Deep Cleaning",1499],["Bathroom Cleaning",399],["Kitchen Cleaning",599],["Sofa Cleaning",499],["Carpet Cleaning",449],["Office Cleaning",999]],
  "Repairs":      [["Plumber",399],["Electrician",399],["Carpenter",499],["Painter",599],["Welder",599],["Mason",549],["Tile Worker",599],["POP Worker",649]],
  "Appliances":   [["AC Repair",599],["Refrigerator Repair",499],["Washing Machine Repair",499],["TV Repair",449],["Microwave Repair",449],["Water Purifier Repair",399],["Geyser Repair",449]],
  "Vehicles":     [["Bike Repair",349],["Bike Washing",199],["Puncture Repair",149],["Car Repair",699],["Car Washing",399],["Car Detailing",1499],["Towing Service",999],["Battery Jump Start",449]],
  "Health & Care":[["Home Nurse",999],["Caretaker",799],["Elder Care",799],["Babysitter",699],["Ambulance Booking",999]],
  "Professional": [["Website Developer",2999],["Graphic Designer",999],["Accountant",999],["Security Guard",799],["Resume Writing",499],["Locksmith",449],["Property Inspection",999]],
  "Technology":   [["CCTV Installation",999],["Smart Device Setup",699],["Home Automation",1999],["AI Assistant Setup",1499],["AI Content Creation",999]]
};

function hashPassword(password, salt = crypto.randomBytes(16).toString("hex")) {
  return `${salt}:${crypto.scryptSync(password, salt, 64).toString("hex")}`;
}
function verifyPassword(password, stored) {
  const [salt, storedHash] = stored.split(":");
  return crypto.timingSafeEqual(crypto.scryptSync(password, salt, 64), Buffer.from(storedHash, "hex"));
}
function id(prefix) { return `${prefix}-${crypto.randomUUID().slice(0, 8)}`; }
function setCors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Authorization,Content-Type");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS");
}
function json(res, status, body) {
  setCors(res);
  res.writeHead(status, { "Content-Type":"application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}
function error(res, status, message) { json(res, status, { error:message }); }
function body(req) {
  return new Promise((resolve, reject) => {
    let value = "";
    req.on("data", chunk => {
      value += chunk;
      if (value.length > 1_000_000) reject(new Error("Request body is too large."));
    });
    req.on("end", () => {
      const contentType = (req.headers["content-type"] || "").split(";")[0].trim();
      if (!value.trim()) return resolve({});
      if (contentType === "application/json" || !contentType) {
        try {
          resolve(JSON.parse(value));
          return;
        } catch {
          reject(new Error("Request body must be valid JSON."));
          return;
        }
      }
      if (contentType === "application/x-www-form-urlencoded") {
        resolve(Object.fromEntries(new URLSearchParams(value)));
        return;
      }
      reject(new Error(`Unsupported request content type: ${contentType || "unknown"}.`));
    });
    req.on("error", reject);
  });
}
function safeUser(user) { return { id:user.id, name:user.name, email:user.email, role:user.role, active:Boolean(user.active) }; }
async function auth(req, res, roles = []) {
  const token = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  const session = sessions.get(token);
  if (!session) { error(res, 401, "Please log in to continue."); return null; }
  const [rows] = await pool.execute("SELECT id,name,email,role,active FROM users WHERE id=? AND active=TRUE", [session.userId]);
  const user = rows[0];
  if (!user) { sessions.delete(token); error(res, 401, "Your session is no longer valid."); return null; }
  if (roles.length && !roles.includes(user.role)) { error(res, 403, "You do not have permission to perform this action."); return null; }
  return user;
}
async function findWorkerForBooking(service, location) {
  const svc = service.toLowerCase();
  const svcParam = `%${svc}%`;
  const loc = location.toLowerCase();
  const locParam = `%${loc}%`;
  const [rows] = await pool.execute(
    `SELECT wp.id,wp.user_id AS userId,wp.phone,wp.city,wp.service,wp.rating,wp.completed_jobs AS completedJobs,wp.verified,u.name,u.email
     FROM worker_profiles wp JOIN users u ON u.id=wp.user_id
     WHERE wp.verified=TRUE AND u.active=TRUE
       AND (LOWER(wp.service) LIKE ? OR ? LIKE CONCAT('%',LOWER(wp.service),'%'))
       AND (LOWER(wp.city) LIKE ? OR ? LIKE CONCAT('%',LOWER(wp.city),'%'))
       AND NOT EXISTS (SELECT 1 FROM jobs j WHERE j.worker_id=wp.id AND j.status IN ('Worker Accepted','Work Started','Worker assigned'))
       AND NOT EXISTS (SELECT 1 FROM quick_bookings qb WHERE qb.worker_id=wp.id AND qb.status IN ('Worker assigned','Work started'))
       AND NOT EXISTS (SELECT 1 FROM quick_booking_notifications qbn WHERE qbn.worker_id=wp.id AND qbn.status='Pending' AND qbn.expires_at>NOW())
     ORDER BY wp.verified DESC, wp.rating DESC LIMIT 1`,
    [svcParam, svc, locParam, loc]
  );
  return rows[0] || null;
}
async function ensureQuickBookingNotificationTable() {
  await pool.query(`CREATE TABLE IF NOT EXISTS quick_booking_notifications (
    id VARCHAR(50) PRIMARY KEY,
    booking_id VARCHAR(50) NOT NULL,
    worker_id VARCHAR(50) NOT NULL,
    status ENUM('Pending','Accepted','Rejected','Expired') DEFAULT 'Pending',
    expires_at TIMESTAMP NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    responded_at TIMESTAMP NULL,
    FOREIGN KEY (booking_id) REFERENCES quick_bookings(id) ON DELETE CASCADE,
    FOREIGN KEY (worker_id) REFERENCES worker_profiles(id) ON DELETE CASCADE
  )`);
}
async function notifyWorkerForBooking(bookingId, excludeWorkerIds = []) {
  await ensureQuickBookingNotificationTable();
  const [bRows] = await pool.execute("SELECT id,service,location FROM quick_bookings WHERE id=? LIMIT 1", [bookingId]);
  const booking = bRows[0];
  if (!booking) return null;
  const worker = await findWorkerForBooking(booking.service, booking.location);
  if (!worker || excludeWorkerIds.includes(worker.id)) {
    await pool.execute("UPDATE quick_bookings SET status='No Worker Available' WHERE id=?", [bookingId]);
    return null;
  }
  const notifId = id("QBN");
  await pool.execute(
    "INSERT INTO quick_booking_notifications (id,booking_id,worker_id,status,expires_at) VALUES (?,?,?,'Pending',DATE_ADD(NOW(),INTERVAL 60 SECOND))",
    [notifId, bookingId, worker.id]
  );
  await pool.execute("UPDATE quick_bookings SET status='Worker Notified' WHERE id=?", [bookingId]);
  return { notifId, worker };
}
async function seed() {
  await ensureAvailabilityColumn();
  await ensureJobNotificationTable();
  const demoUsers = [
    ["USR-ADMIN","JobEase Admin","admin@jobease.com","admin123","admin"],
    ["USR-CUSTOMER","Demo Customer","customer@jobease.com","customer123","customer"],
    ["USR-WORKER","Ravi Kumar","worker@jobease.com","worker123","worker"],
    ["USR-WORKER-2","Anita Sharma","anita@jobease.com","worker123","worker"],
    ["USR-WORKER-3","Mohit Verma","mohit@jobease.com","worker123","worker"]
  ];
  for (const [userId,name,email,password,role] of demoUsers) {
    await pool.execute(
      "INSERT INTO users (id,name,email,password_hash,role,active) VALUES (?,?,?,?,?,TRUE) ON DUPLICATE KEY UPDATE password_hash=VALUES(password_hash)",
      [userId,name,email,hashPassword(password),role]
    );
  }
  const profiles = [
    ["WRK-001","USR-WORKER","+91 98765 43210","Delhi","Electrician","5 years",4.8,42],
    ["WRK-002","USR-WORKER-2","+91 98111 22334","Noida","Cleaner","3 years",4.6,31],
    ["WRK-003","USR-WORKER-3","+91 98990 11223","Gurugram","Plumber","6 years",4.7,56]
  ];
  for (const row of profiles) await pool.execute("INSERT IGNORE INTO worker_profiles (id,user_id,phone,city,service,experience,rating,completed_jobs,verified) VALUES (?,?,?,?,?,?,?,?,TRUE)", row);
}
async function ensureSchema() {
  await pool.query(`CREATE TABLE IF NOT EXISTS users (
    id VARCHAR(50) PRIMARY KEY,
    name VARCHAR(120) NOT NULL,
    email VARCHAR(180) UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    role ENUM('customer','worker','admin') NOT NULL,
    active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )`);
  await pool.query(`CREATE TABLE IF NOT EXISTS worker_profiles (
    id VARCHAR(50) PRIMARY KEY,
    user_id VARCHAR(50) UNIQUE NOT NULL,
    phone VARCHAR(20) NOT NULL,
    city VARCHAR(100) NOT NULL,
    service VARCHAR(150) NOT NULL,
    experience VARCHAR(100),
    description TEXT,
    rating DECIMAL(2,1) DEFAULT 0,
    completed_jobs INT DEFAULT 0,
    available BOOLEAN DEFAULT TRUE,
    verified BOOLEAN DEFAULT FALSE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  )`);
  await pool.query(`CREATE TABLE IF NOT EXISTS jobs (
    id VARCHAR(50) PRIMARY KEY,
    customer_id VARCHAR(50) NOT NULL,
    worker_id VARCHAR(50),
    title VARCHAR(180) NOT NULL,
    category VARCHAR(150) NOT NULL,
    location TEXT NOT NULL,
    details TEXT,
    amount DECIMAL(12,2) NOT NULL,
    commission DECIMAL(12,2) DEFAULT 0,
    status VARCHAR(50) DEFAULT 'Finding a worker',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (customer_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (worker_id) REFERENCES worker_profiles(id) ON DELETE CASCADE
  )`);
  await pool.query(`CREATE TABLE IF NOT EXISTS quick_bookings (
    id VARCHAR(50) PRIMARY KEY,
    customer_id VARCHAR(50) NOT NULL,
    worker_id VARCHAR(50),
    service VARCHAR(150) NOT NULL,
    location TEXT NOT NULL,
    details TEXT,
    starting_charge DECIMAL(12,2) NOT NULL,
    otp VARCHAR(6) NOT NULL,
    eta_minutes INT,
    status VARCHAR(50) DEFAULT 'Finding a worker',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    started_at TIMESTAMP NULL,
    FOREIGN KEY (customer_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (worker_id) REFERENCES worker_profiles(id) ON DELETE CASCADE
  )`);
  await pool.query(`CREATE TABLE IF NOT EXISTS reviews (
    id VARCHAR(50) PRIMARY KEY,
    worker_id VARCHAR(50) NOT NULL,
    customer_id VARCHAR(50),
    rating DECIMAL(2,1) NOT NULL,
    comment TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CHECK (rating >= 1 AND rating <= 5),
    FOREIGN KEY (worker_id) REFERENCES worker_profiles(id) ON DELETE CASCADE,
    FOREIGN KEY (customer_id) REFERENCES users(id) ON DELETE SET NULL
  )`);
}

async function dropForeignKeyIfExists(table, column, referencedTable) {
  const [rows] = await pool.execute(
    `SELECT CONSTRAINT_NAME FROM information_schema.KEY_COLUMN_USAGE
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ? AND REFERENCED_TABLE_NAME = ?`,
    [table, column, referencedTable]
  );
  for (const row of rows) {
    try {
      await pool.query(`ALTER TABLE \`${table}\` DROP FOREIGN KEY \`${row.CONSTRAINT_NAME}\``);
    } catch (err) {
      // ignore missing or invalid constraint
    }
  }
}

async function migrateForeignKeys() {
  await dropForeignKeyIfExists("jobs", "customer_id", "users");
  await dropForeignKeyIfExists("jobs", "worker_id", "worker_profiles");
  await dropForeignKeyIfExists("quick_bookings", "customer_id", "users");
  await dropForeignKeyIfExists("quick_bookings", "worker_id", "worker_profiles");
  await dropForeignKeyIfExists("reviews", "customer_id", "users");

  try {
    await pool.query(`ALTER TABLE jobs ADD CONSTRAINT jobs_customer_fk FOREIGN KEY (customer_id) REFERENCES users(id) ON DELETE CASCADE`);
  } catch (err) {}
  try {
    await pool.query(`ALTER TABLE jobs ADD CONSTRAINT jobs_worker_fk FOREIGN KEY (worker_id) REFERENCES worker_profiles(id) ON DELETE CASCADE`);
  } catch (err) {}
  try {
    await pool.query(`ALTER TABLE quick_bookings ADD CONSTRAINT quick_customer_fk FOREIGN KEY (customer_id) REFERENCES users(id) ON DELETE CASCADE`);
  } catch (err) {}
  try {
    await pool.query(`ALTER TABLE quick_bookings ADD CONSTRAINT quick_worker_fk FOREIGN KEY (worker_id) REFERENCES worker_profiles(id) ON DELETE CASCADE`);
  } catch (err) {}
  try {
    await pool.query(`ALTER TABLE reviews ADD CONSTRAINT reviews_customer_fk FOREIGN KEY (customer_id) REFERENCES users(id) ON DELETE SET NULL`);
  } catch (err) {}
}

async function ensureAvailabilityColumn() {
  const [columns] = await pool.query("SHOW COLUMNS FROM worker_profiles LIKE 'available'");
  if (!columns.length) {
    await pool.query("ALTER TABLE worker_profiles ADD COLUMN available BOOLEAN DEFAULT TRUE");
  }
  await pool.query("UPDATE worker_profiles SET available=TRUE WHERE available IS NULL");
}
async function ensureJobColumns() {
  const [cols] = await pool.query("SHOW COLUMNS FROM jobs");
  const names = cols.map(c => c.Field);
  if (!names.includes("otp"))            await pool.query("ALTER TABLE jobs ADD COLUMN otp VARCHAR(6) NULL");
  if (!names.includes("work_started_at")) await pool.query("ALTER TABLE jobs ADD COLUMN work_started_at TIMESTAMP NULL");
  if (!names.includes("completed_at"))   await pool.query("ALTER TABLE jobs ADD COLUMN completed_at TIMESTAMP NULL");
  if (!names.includes("scheduled_at"))   await pool.query("ALTER TABLE jobs ADD COLUMN scheduled_at DATETIME NULL");
  // Add job_id to reviews so one review per job is enforced
  const [rCols] = await pool.query("SHOW COLUMNS FROM reviews");
  const rNames = rCols.map(c => c.Field);
  if (!rNames.includes("job_id")) await pool.query("ALTER TABLE reviews ADD COLUMN job_id VARCHAR(50) NULL UNIQUE");
}
async function ensureQuickBookingColumns() {
  const [cols] = await pool.query("SHOW COLUMNS FROM quick_bookings");
  const names = cols.map(c => c.Field);
  if (!names.includes("completed_at")) await pool.query("ALTER TABLE quick_bookings ADD COLUMN completed_at TIMESTAMP NULL");
  if (!names.includes("commission"))   await pool.query("ALTER TABLE quick_bookings ADD COLUMN commission DECIMAL(12,2) DEFAULT 0");
}
async function assignJobToWorker(req, res, jobIdFromUrl = null) {
  if(!await auth(req,res,["admin"]))return;
  const data=await body(req);
  const jobId=jobIdFromUrl||data.jobId||data.job_id||data.selectedJobId;
  const workerId=data.workerId||data.worker_id||data.selectedWorkerId;
  if(!jobId||!workerId)return error(res,400,"Please select both job and worker.");
  const [workers]=await pool.execute(`SELECT wp.id,wp.service,COALESCE(wp.available,TRUE) AS available,u.active FROM worker_profiles wp JOIN users u ON u.id=wp.user_id WHERE wp.id=? LIMIT 1`,[workerId]);
  const worker=workers[0];
  if(!worker||!worker.active)return error(res,404,"Selected worker was not found.");
  if(!Boolean(worker.available))return error(res,400,"Selected worker is not available for assignment.");
  const [jobs]=await pool.execute("SELECT id,category,status FROM jobs WHERE id=? LIMIT 1",[jobId]);
  const job=jobs[0];
  if(!job)return error(res,404,"Selected job was not found.");
  await pool.execute("UPDATE jobs SET worker_id=?,status='Worker assigned' WHERE id=?",[workerId,jobId]);
  return json(res,200,{message:"Worker assigned successfully.",job:{...job,workerId,status:"Worker assigned"}});
}
async function ensureJobNotificationTable() {
  await pool.query(`CREATE TABLE IF NOT EXISTS job_notifications (
    id VARCHAR(50) PRIMARY KEY,
    job_id VARCHAR(50) NOT NULL,
    worker_id VARCHAR(50) NOT NULL,
    status ENUM('Pending','Accepted','Rejected','Expired') DEFAULT 'Pending',
    expires_at TIMESTAMP NULL,
    response_time_seconds INT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    responded_at TIMESTAMP NULL,
    FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE CASCADE,
    FOREIGN KEY (worker_id) REFERENCES worker_profiles(id) ON DELETE CASCADE
  )`);
}
async function findEligibleWorkers(service, location = "", excludeWorkerIds = [], scheduledAt = null) {
  const svc = service.toLowerCase();
  const svcParam = `%${svc}%`;
  const loc = location.toLowerCase();
  const locParam = loc ? `%${loc}%` : null;

  const params = [svcParam, svc];
  if (locParam) params.push(locParam, loc);

  // Conflict check differs between ASAP and scheduled jobs
  let conflictClause;
  if (scheduledAt) {
    // Scheduled job: block worker if they have an active ASAP job OR
    // another scheduled job within ±4 hours of the requested time
    conflictClause = `AND NOT EXISTS (
      SELECT 1 FROM jobs cj
      WHERE cj.worker_id = wp.id
        AND cj.status IN ('Worker Accepted','Work Started','Worker assigned','Worker Notified')
        AND (
          (cj.scheduled_at IS NULL AND cj.status IN ('Worker Accepted','Work Started'))
          OR (cj.scheduled_at IS NOT NULL AND ABS(TIMESTAMPDIFF(HOUR, cj.scheduled_at, ?)) < 4)
        )
    )`;
    params.push(scheduledAt);
  } else {
    // ASAP job: block worker only if they currently have an active job
    conflictClause = `AND NOT EXISTS (
      SELECT 1 FROM jobs cj
      WHERE cj.worker_id = wp.id
        AND cj.status IN ('Worker Accepted','Work Started','Worker assigned')
    )`;
  }

  const [workers] = await pool.execute(
    `SELECT wp.id,wp.user_id AS userId,wp.phone,wp.city,wp.service,wp.experience,wp.description,wp.rating,wp.completed_jobs AS completedJobs,COALESCE(wp.available,TRUE) AS available,wp.verified,u.name,u.email
     FROM worker_profiles wp JOIN users u ON u.id=wp.user_id
     WHERE u.active=TRUE
       AND COALESCE(wp.available,TRUE)=TRUE
       AND (LOWER(wp.service) LIKE ? OR ? LIKE CONCAT('%',LOWER(wp.service),'%'))
       ${locParam ? `AND (LOWER(wp.city) LIKE ? OR ? LIKE CONCAT('%',LOWER(wp.city),'%'))` : ""}
       ${conflictClause}
       AND NOT EXISTS (
         SELECT 1 FROM job_notifications jn
         WHERE jn.worker_id = wp.id
           AND jn.status = 'Pending'
           AND jn.expires_at > NOW()
       )
     ORDER BY wp.verified DESC, wp.rating DESC, wp.completed_jobs DESC`,
    params
  );
  return workers.filter(w => !excludeWorkerIds.includes(w.id));
}
async function notifyNextWorker(jobId, excludeWorkerIds = []) {
  await ensureJobNotificationTable();
  const [jobs] = await pool.execute("SELECT id,category,location,scheduled_at FROM jobs WHERE id=? LIMIT 1", [jobId]);
  const job = jobs[0];
  if (!job) return null;
  const workers = await findEligibleWorkers(job.category, job.location, excludeWorkerIds, job.scheduled_at);
  const worker = workers[0];
  if (!worker) {
    await pool.execute("UPDATE jobs SET status='Pending Assignment' WHERE id=?", [jobId]);
    return null;
  }
  const notificationId = id("NTF");
  await pool.execute(
    "INSERT INTO job_notifications (id,job_id,worker_id,status,expires_at) VALUES (?,?,?,'Pending',DATE_ADD(NOW(), INTERVAL 30 SECOND))",
    [notificationId, jobId, worker.id]
  );
  await pool.execute("UPDATE jobs SET worker_id=NULL,status='Worker Notified' WHERE id=?", [jobId]);
  return { notificationId, worker };
}
async function handleApi(req, res, url) {
  if (req.method === "GET" && url.pathname === "/api/health") {
    return json(res, 200, {
      status: "ok",
      service: "JobEase API",
      database: "mysql",
      version: "assignment-route-v2",
      assignmentEndpoint: "/api/jobs/assign"
    });
  }
  if (req.method === "POST" && url.pathname === "/api/jobs/assign") {
    return assignJobToWorker(req, res);
  }
  if(req.method==="GET"&&url.pathname==="/api/worker/notifications"){
    const user=await auth(req,res,["worker"]);if(!user)return;await ensureJobNotificationTable();
    const [rows]=await pool.execute(
      `SELECT n.id,n.job_id AS jobId,n.status,n.expires_at AS expiresAt,n.created_at AS createdAt,
              j.title,j.category,j.location,j.details,j.amount,j.commission,j.status AS jobStatus,j.scheduled_at AS scheduledAt
       FROM job_notifications n
       JOIN jobs j ON j.id=n.job_id
       JOIN worker_profiles wp ON wp.id=n.worker_id
       WHERE wp.user_id=? AND n.status='Pending'
       ORDER BY n.created_at DESC`, [user.id]
    );
    return json(res,200,{notifications:rows});
  }
  if(req.method==="POST"&&/^\/api\/worker\/notifications\/[^/]+\/accept$/.test(url.pathname)){
    const user=await auth(req,res,["worker"]);if(!user)return;await ensureJobNotificationTable();
    const notificationId=url.pathname.split("/")[4];
    const [rows]=await pool.execute(
      `SELECT n.*,wp.user_id FROM job_notifications n JOIN worker_profiles wp ON wp.id=n.worker_id WHERE n.id=? LIMIT 1`,
      [notificationId]
    );
    const notification=rows[0];
    if(!notification||notification.user_id!==user.id)return error(res,404,"Job notification was not found.");
    if(notification.status!=="Pending")return error(res,400,"This job notification is no longer available.");
    const acceptOtp=String(crypto.randomInt(100000,999999));
    await pool.execute("UPDATE jobs SET worker_id=?,status='Worker Accepted',otp=? WHERE id=?",[notification.worker_id,acceptOtp,notification.job_id]);
    await pool.execute("UPDATE job_notifications SET status='Accepted',responded_at=NOW(),response_time_seconds=TIMESTAMPDIFF(SECOND,created_at,NOW()) WHERE id=?",[notificationId]);
    await pool.execute("UPDATE job_notifications SET status='Expired' WHERE job_id=? AND id<>? AND status='Pending'",[notification.job_id,notificationId]);
    return json(res,200,{message:"Job accepted. The customer will share an OTP with you when you arrive.",jobId:notification.job_id});
  }
  if(req.method==="POST"&&/^\/api\/worker\/notifications\/[^/]+\/reject$/.test(url.pathname)){
    const user=await auth(req,res,["worker"]);if(!user)return;await ensureJobNotificationTable();
    const notificationId=url.pathname.split("/")[4];
    const [rows]=await pool.execute(
      `SELECT n.*,wp.user_id FROM job_notifications n JOIN worker_profiles wp ON wp.id=n.worker_id WHERE n.id=? LIMIT 1`,
      [notificationId]
    );
    const notification=rows[0];
    if(!notification||notification.user_id!==user.id)return error(res,404,"Job notification was not found.");
    await pool.execute("UPDATE job_notifications SET status='Rejected',responded_at=NOW(),response_time_seconds=TIMESTAMPDIFF(SECOND,created_at,NOW()) WHERE id=?",[notificationId]);
    const [rejected]=await pool.execute("SELECT worker_id AS workerId FROM job_notifications WHERE job_id=? AND status IN ('Rejected','Expired')",[notification.job_id]);
    const next=await notifyNextWorker(notification.job_id,rejected.map(item=>item.workerId));
    return json(res,200,{message:next?"Job forwarded to next worker.":"No more matching workers found.",nextWorkerNotified:Boolean(next)});
  }
  if(req.method==="PATCH"&&/^\/api\/jobs\/[^/]+\/status$/.test(url.pathname)){
    const user=await auth(req,res,["worker","admin"]);if(!user)return;
    const jobId=url.pathname.split("/")[3],data=await body(req);
    const allowed=["Assigned","On The Way","Reached Location","Work Started","Work Completed","Payment Completed","Closed","Cancelled"];
    if(!allowed.includes(data.status))return error(res,400,"Invalid job status.");
    let sql="UPDATE jobs SET status=? WHERE id=?",params=[data.status,jobId];
    if(user.role==="worker"){sql="UPDATE jobs SET status=? WHERE id=? AND worker_id=(SELECT id FROM worker_profiles WHERE user_id=?)";params=[data.status,jobId,user.id];}
    const [result]=await pool.execute(sql,params);
    return result.affectedRows?json(res,200,{message:"Job status updated.",status:data.status}):error(res,404,"Job was not found or you do not have permission.");
  }
  if(req.method==="GET"&&url.pathname==="/api/admin/reports"){
    if(!await auth(req,res,["admin"]))return;
    const [summary]=await pool.query(`SELECT
      COUNT(*) AS totalJobs,
      SUM(status IN ('Pending Assignment','Worker Notified')) AS pendingJobs,
      SUM(status IN ('Assigned','On The Way','Reached Location','Work Started')) AS assignedJobs,
      SUM(status='Work Completed') AS completedJobs,
      SUM(status='Cancelled') AS cancelledJobs,
      COALESCE(SUM(amount),0) AS revenue,
      COALESCE(SUM(commission),0) AS commission
      FROM jobs`);
    const [workers]=await pool.query(`SELECT u.name,wp.service,wp.rating,wp.completed_jobs AS completedJobs,COUNT(j.id) AS assignedJobs
      FROM worker_profiles wp JOIN users u ON u.id=wp.user_id
      LEFT JOIN jobs j ON j.worker_id=wp.id
      GROUP BY wp.id,u.name,wp.service,wp.rating,wp.completed_jobs
      ORDER BY assignedJobs DESC, wp.rating DESC LIMIT 10`);
    return json(res,200,{summary:summary[0],workerPerformance:workers});
  }
  if(req.method==="DELETE"&&/^\/api\/jobs\/[^/]+$/.test(url.pathname)){
    const user=await auth(req,res,["customer","admin"]);if(!user)return;
    const jobId=url.pathname.split("/").pop();
    const sql=user.role==="admin"?"DELETE FROM jobs WHERE id=?":"DELETE FROM jobs WHERE id=? AND customer_id=?";
    const params=user.role==="admin"?[jobId]:[jobId,user.id];
    const [result]=await pool.execute(sql,params);
    return result.affectedRows?json(res,200,{message:"Job deleted successfully."}):error(res,404,"Job was not found or you do not have permission to delete it.");
  }
  if(req.method==="PATCH"&&/^\/api\/workers\/[^/]+\/verify$/.test(url.pathname)){
    if(!await auth(req,res,["admin"]))return;
    const workerId=url.pathname.split("/")[3];
    const [result]=await pool.execute("UPDATE worker_profiles SET verified=TRUE,available=TRUE WHERE id=?",[workerId]);
    return result.affectedRows?json(res,200,{message:"Worker verified and available for assignment."}):error(res,404,"Worker was not found.");
  }
  if(["POST","PUT","PATCH"].includes(req.method)&&/assign/i.test(url.pathname)){
    const jobIdFromUrl=url.pathname.match(/JOB-[A-Za-z0-9]+/)?.[0]||null;
    return assignJobToWorker(req,res,jobIdFromUrl);
  }
  if ((req.method === "GET" || req.method === "HEAD") && url.pathname === "/api/health") return json(res,200,{status:"ok",service:"JobEase API",database:"mysql"});
    // Public services catalog
    if (req.method === "GET" && url.pathname === "/api/services") {
      return json(res, 200, { catalog: servicesCatalog });
    }

    // Public workers (basic info) - no auth required for public listing
    if (req.method === "GET" && url.pathname === "/api/public/workers") {
      const [workers] = await pool.query(`SELECT wp.id, u.name, wp.service, wp.city, wp.rating, wp.completed_jobs AS completedJobs
        FROM worker_profiles wp JOIN users u ON u.id=wp.user_id WHERE wp.verified=TRUE AND u.active=TRUE ORDER BY wp.rating DESC`);
      return json(res, 200, { workers });
    }
  if (req.method==="POST" && url.pathname==="/api/auth/register") {
    const {name="",email="",password="",role="customer"}=await body(req);
    if(!name||!email||!password)return error(res,400,"Please provide name, email, and password.");
    const userId=id("USR");
    try{
      await pool.execute("INSERT INTO users (id,name,email,password_hash,role,active) VALUES (?,?,?,?,?,TRUE)",[userId,name.trim(),email.trim().toLowerCase(),hashPassword(password),role]);
      const token=crypto.randomBytes(32).toString("hex");
      sessions.set(token,{userId});
      return json(res,201,{message:"Registration successful.",token,user:{id:userId,name,email,role}});
    }catch(e){
      if(e.code==="ER_DUP_ENTRY")return error(res,409,"An account with this email already exists.");
      throw e;
    }
  }
  if (req.method==="POST" && url.pathname==="/api/auth/login") {
    const {email="",password=""}=await body(req);
    const [rows]=await pool.execute("SELECT * FROM users WHERE email=? AND active=TRUE LIMIT 1",[email.trim().toLowerCase()]);
    const user=rows[0];
    if(!user||!verifyPassword(password,user.password_hash))return error(res,401,"Incorrect email or password.");
    const token=crypto.randomBytes(32).toString("hex"); sessions.set(token,{userId:user.id});
    return json(res,200,{token,user:safeUser(user)});
  }
  if(req.method==="POST"&&url.pathname==="/api/auth/logout"){sessions.delete((req.headers.authorization||"").replace(/^Bearer\s+/i,""));return json(res,200,{message:"Logged out successfully."});}
  if(req.method==="GET"&&url.pathname==="/api/auth/me"){const user=await auth(req,res);if(user)return json(res,200,{user:safeUser(user)});return;}
  if(req.method==="GET"&&url.pathname==="/api/worker/profile"){
    const user=await auth(req,res,["worker"]);if(!user)return;
    const [rows]=await pool.execute("SELECT wp.id,wp.user_id AS userId,u.name,u.email,wp.phone,wp.city,wp.service,wp.experience,wp.description,wp.rating,wp.completed_jobs AS completedJobs,wp.verified FROM worker_profiles wp JOIN users u ON u.id=wp.user_id WHERE wp.user_id=?",[user.id]);
    const profile=rows[0];
    if(!profile)return error(res,404,"Worker profile not found.");
    return json(res,200,{profile});
  }
  if(req.method==="POST"&&url.pathname==="/api/workers/register"){
    const data=await body(req),required=["fullName","email","phone","password","category","experience","city"];
    if(required.some(field=>!data[field]))return error(res,400,"Please complete all required worker details.");
    const userId=id("USR"),workerId=id("WRK"),connection=await pool.getConnection();
    try{
      await connection.beginTransaction();
      await connection.execute("INSERT INTO users (id,name,email,password_hash,role,active) VALUES (?,?,?,?, 'worker',TRUE)",[userId,data.fullName.trim(),data.email.trim().toLowerCase(),hashPassword(data.password)]);
      await connection.execute("INSERT INTO worker_profiles (id,user_id,phone,city,service,experience,description,rating,completed_jobs,verified) VALUES (?,?,?,?,?,?,?,0,0,FALSE)",[workerId,userId,data.phone.trim(),data.city.trim(),data.category,data.experience,data.description||""]);
      await connection.commit();
      return json(res,201,{message:"Worker registration saved in MySQL and submitted for verification.",worker:{id:workerId,userId,name:data.fullName,email:data.email,phone:data.phone,city:data.city,service:data.category,verified:false}});
    }catch(e){await connection.rollback();if(e.code==="ER_DUP_ENTRY")return error(res,409,"An account with this email already exists.");throw e;}finally{connection.release();}
  }
  if(req.method==="GET"&&url.pathname==="/api/workers"){
    if(!await auth(req,res,["admin"]))return;
    const [workers]=await pool.query(`SELECT wp.id,wp.user_id AS userId,u.name,u.email,u.active,wp.phone,wp.city,wp.service,wp.experience,wp.description,wp.rating,wp.completed_jobs AS completedJobs,wp.verified,
      EXISTS(SELECT 1 FROM jobs j WHERE j.worker_id=wp.id AND j.status IN ('Worker assigned','Worker accepted','Work started')) AS busyJob,
      EXISTS(SELECT 1 FROM quick_bookings qb WHERE qb.worker_id=wp.id AND qb.status IN ('Worker assigned','Work started')) AS busyQuick
      FROM worker_profiles wp JOIN users u ON u.id=wp.user_id ORDER BY u.created_at DESC`);
    for(const worker of workers){
      const [reviews]=await pool.execute("SELECT id,rating,comment,created_at AS createdAt FROM reviews WHERE worker_id=? ORDER BY created_at DESC",[worker.id]);
      worker.reviews=reviews;
      worker.available = worker.active && !worker.busyJob && !worker.busyQuick;
    }
    return json(res,200,{workers});
  }
  if(req.method==="PATCH"&&/^\/api\/workers\/[^/]+\/status$/.test(url.pathname)){
    if(!await auth(req,res,["admin"]))return;
    const workerId=url.pathname.split("/")[3];
    const data=await body(req);
    if(typeof data.active!=="boolean")return error(res,400,"active field (boolean) is required.");
    const [result]=await pool.execute("UPDATE users u JOIN worker_profiles wp ON wp.user_id=u.id SET u.active=? WHERE wp.id=?",[data.active,workerId]);
    return result.affectedRows?json(res,200,{message:`Worker ${data.active?"activated":"deactivated"} successfully.`}):error(res,404,"Worker not found.");
  }
  if(req.method==="PATCH"&&/^\/api\/users\/[^/]+\/password$/.test(url.pathname)){
    if(!await auth(req,res,["admin"]))return;
    const userId=url.pathname.split("/")[3];
    const data=await body(req);
    if(!data.newPassword||String(data.newPassword).length<6)return error(res,400,"Password must be at least 6 characters.");
    const [result]=await pool.execute("UPDATE users SET password_hash=? WHERE id=?",[hashPassword(data.newPassword),userId]);
    return result.affectedRows?json(res,200,{message:"Password updated successfully."}):error(res,404,"User not found.");
  }
  // Admin: list customers (and basic info)
  if (req.method === "GET" && url.pathname === "/api/users") {
    if (!await auth(req, res, ["admin"])) return;
    const [users] = await pool.query(
      `SELECT u.id,u.name,u.email,u.role,u.active,u.created_at AS createdAt,
        (SELECT COUNT(1) FROM jobs j WHERE j.customer_id = u.id) AS jobsCount
       FROM users u WHERE u.role = 'customer' ORDER BY u.created_at DESC`
    );
    return json(res, 200, { users });
  }
  if(req.method==="DELETE"&&/^\/api\/workers\/[^/]+$/.test(url.pathname)){
    if(!await auth(req,res,["admin"]))return;
    const workerId=url.pathname.split("/").pop();
    const [result]=await pool.execute("UPDATE users u JOIN worker_profiles wp ON wp.user_id=u.id SET u.active=FALSE WHERE wp.id=?",[workerId]);
    if(!result.affectedRows) return error(res,404,"Worker was not found.");
    // Clear active assignments for jobs and quick bookings that reference this worker
    try{
      await pool.execute("UPDATE jobs SET worker_id=NULL,status='Finding a worker' WHERE worker_id=? AND status IN ('Worker assigned','Worker accepted','Work started')",[workerId]);
      await pool.execute("UPDATE quick_bookings SET worker_id=NULL,status='Finding a worker' WHERE worker_id=? AND status IN ('Worker assigned','Work started')",[workerId]);
    }catch(e){
      // non-fatal - continue
    }
    return json(res,200,{message:"Worker account deactivated and active assignments cleared."});
  }
  if(req.method==="PATCH"&&/^\/api\/jobs\/[^/]+\/assign$/.test(url.pathname)){
    if(!await auth(req,res,["admin"]))return;
    const jobId=url.pathname.split("/")[3];
    const {workerId=""}=await body(req);
    if(!workerId) return error(res,400,"Worker ID is required for assignment.");
    const [jobRows]=await pool.execute("SELECT * FROM jobs WHERE id=?",[jobId]);
    const job=jobRows[0];
    if(!job) return error(res,404,"Job not found.");
    if(job.status==="Completed") return error(res,400,"Cannot assign a completed job.");
    if(job.worker_id) return error(res,400,"This job already has a worker assigned.");
    const [workerRows]=await pool.execute(
      `SELECT wp.id,wp.service,wp.verified,u.active FROM worker_profiles wp JOIN users u ON u.id=wp.user_id WHERE wp.id=?`,
      [workerId]
    );
    const worker=workerRows[0];
    if(!worker||!worker.verified||!worker.active) return error(res,400,"Selected worker is not available for assignment.");
    const serviceMatch = worker.service.toLowerCase().includes(job.category.toLowerCase()) || job.category.toLowerCase().includes(worker.service.toLowerCase());
    if(!serviceMatch) return error(res,400,"Selected worker does not match the job service type.");
    const [busyJobRows]=await pool.execute("SELECT 1 FROM jobs WHERE worker_id=? AND status IN ('Worker assigned','Worker accepted','Work started') LIMIT 1",[worker.id]);
    if(busyJobRows.length) return error(res,400,"Selected worker is already assigned to another active job.");
    const [busyQuickRows]=await pool.execute("SELECT 1 FROM quick_bookings WHERE worker_id=? AND status IN ('Worker assigned','Work started') LIMIT 1",[worker.id]);
    if(busyQuickRows.length) return error(res,400,"Selected worker is already committed to a quick booking.");
    await pool.execute("UPDATE jobs SET worker_id=?,status='Worker assigned' WHERE id=?",[worker.id,jobId]);
    return json(res,200,{message:"Worker assigned manually.",job:{...job,worker_id:worker.id,status:"Worker assigned"}});
  }
  if(["POST","PUT","PATCH"].includes(req.method)&&(url.pathname==="/api/jobs/assign"||url.pathname==="/api/admin/assign-job"||url.pathname==="/api/assign-job")){
    if(!await auth(req,res,["admin"]))return;
    const data=await body(req),jobId=data.jobId,workerId=data.workerId;
    if(!jobId||!workerId)return error(res,400,"Please select both job and worker.");
    const [workers]=await pool.execute(`SELECT wp.id,wp.service,COALESCE(wp.available,TRUE) AS available,u.active FROM worker_profiles wp JOIN users u ON u.id=wp.user_id WHERE wp.id=? LIMIT 1`,[workerId]);
    const worker=workers[0];
    if(!worker||!worker.active)return error(res,404,"Selected worker was not found.");
    if(!Boolean(worker.available))return error(res,400,"Selected worker is not available for assignment.");
    const [jobs]=await pool.execute("SELECT id,category,status FROM jobs WHERE id=? LIMIT 1",[jobId]);
    const job=jobs[0];
    if(!job)return error(res,404,"Selected job was not found.");
    await pool.execute("UPDATE jobs SET worker_id=?,status='Worker assigned' WHERE id=?",[workerId,jobId]);
    return json(res,200,{message:"Worker assigned successfully.",job:{...job,workerId,status:"Worker assigned"}});
  }
  if(req.method==="POST"&&/^\/api\/jobs\/[^/]+\/assign$/.test(url.pathname)){
    if(!await auth(req,res,["admin"]))return;
    const jobId=url.pathname.split("/")[3],data=await body(req),workerId=data.workerId;
    if(!workerId)return error(res,400,"Please select a worker to assign.");
    const [workers]=await pool.execute(`SELECT wp.id,wp.service,wp.available,u.active FROM worker_profiles wp JOIN users u ON u.id=wp.user_id WHERE wp.id=? LIMIT 1`,[workerId]);
    const worker=workers[0];
    if(!worker||!worker.active)return error(res,404,"Selected worker was not found.");
    if(!worker.available)return error(res,400,"Selected worker is not available for assignment.");
    const [jobs]=await pool.execute("SELECT id,category,status FROM jobs WHERE id=? LIMIT 1",[jobId]);
    const job=jobs[0];
    if(!job)return error(res,404,"Selected job was not found.");
    await pool.execute("UPDATE jobs SET worker_id=?,status='Worker assigned' WHERE id=?",[workerId,jobId]);
    return json(res,200,{message:"Worker assigned successfully.",job:{...job,workerId,status:"Worker assigned"}});
  }
  if(req.method==="POST"&&url.pathname==="/api/jobs"){
    const customer=await auth(req,res,["customer"]);if(!customer)return;const data=await body(req);
    if(!data.title||!data.category||!data.location)return error(res,400,"Please fill in the job title, service, and location.");
    const allServices=Object.values(servicesCatalog).flat();
    const catalogMatch=allServices.find(([name])=>name.toLowerCase()===data.category.toLowerCase());
    const amount=Number(data.budget)||(catalogMatch?catalogMatch[1]:499);
    const jobId=id("JOB"),commission=Math.round(amount*.1);
    // Parse and validate scheduledAt
    let scheduledAt=null;
    if(data.scheduledAt){
      const dt=new Date(data.scheduledAt);
      if(isNaN(dt.getTime()))return error(res,400,"Invalid scheduled date/time.");
      if(dt<=new Date())return error(res,400,"Scheduled time must be in the future.");
      scheduledAt=dt;
    }
    await pool.execute("INSERT INTO jobs (id,customer_id,worker_id,title,category,location,details,amount,commission,status,scheduled_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)",[jobId,customer.id,null,data.title,data.category,data.location,data.details||"",amount,commission,"Pending Assignment",scheduledAt]);
    const notification=await notifyNextWorker(jobId);
    const nextStatus=notification?"Worker Notified":"Pending Assignment";
    const schedMsg=scheduledAt?` Scheduled for ${new Date(scheduledAt).toLocaleString("en-IN",{dateStyle:"medium",timeStyle:"short"})}.`:"";
    return json(res,201,{message:notification?`Job posted! A worker has been notified.${schedMsg}`:`Job posted.${schedMsg} No matching worker is currently available.`,job:{id:jobId,title:data.title,category:data.category,location:data.location,amount,commission,scheduledAt,status:nextStatus}});
  }
  if(req.method==="GET"&&url.pathname==="/api/jobs"){
    const user=await auth(req,res,["customer","worker","admin"]);if(!user)return;
    let jobs;
    if(user.role==="customer"){
      const [rows]=await pool.execute(
        `SELECT j.*,u.name AS workerName,wp.phone AS workerPhone,wp.service AS workerService,
                EXISTS(SELECT 1 FROM reviews r WHERE r.job_id=j.id) AS reviewed,
                j.scheduled_at AS scheduledAt
         FROM jobs j
         LEFT JOIN worker_profiles wp ON j.worker_id=wp.id
         LEFT JOIN users u ON wp.user_id=u.id
         WHERE j.customer_id=? ORDER BY COALESCE(j.scheduled_at, j.created_at) DESC`,
        [user.id]);
      jobs=rows;
    } else if(user.role==="worker"){
      const [rows]=await pool.execute(
        `SELECT j.*,cu.name AS customerName,cu.email AS customerEmail,j.scheduled_at AS scheduledAt
         FROM jobs j
         LEFT JOIN users cu ON j.customer_id=cu.id
         WHERE j.worker_id=(SELECT id FROM worker_profiles WHERE user_id=?)
         ORDER BY COALESCE(j.scheduled_at, j.created_at) DESC`,
        [user.id]);
      jobs=rows;
    } else {
      const [rows]=await pool.execute(
        `SELECT j.*,cu.name AS customerName,wu.name AS workerName
         FROM jobs j
         LEFT JOIN users cu ON j.customer_id=cu.id
         LEFT JOIN worker_profiles wp ON j.worker_id=wp.id
         LEFT JOIN users wu ON wp.user_id=wu.id
         ORDER BY j.created_at DESC`);
      jobs=rows;
    }
    return json(res,200,{jobs});
  }
  if(req.method==="POST"&&/^\/api\/jobs\/[^/]+\/verify-otp$/.test(url.pathname)){
    const user=await auth(req,res,["worker"]);if(!user)return;
    const jobId=url.pathname.split("/")[3],data=await body(req);
    const [jobRows]=await pool.execute("SELECT * FROM jobs WHERE id=? AND worker_id=(SELECT id FROM worker_profiles WHERE user_id=?)",[jobId,user.id]);
    const job=jobRows[0];
    if(!job)return error(res,404,"Job not found or not assigned to you.");
    if(!job.otp||String(job.otp)!==String(data.otp).trim())return error(res,400,"Incorrect OTP. Please ask the customer to share their OTP.");
    if(job.status==="Work Started")return error(res,400,"Work has already started for this job.");
    await pool.execute("UPDATE jobs SET status='Work Started',work_started_at=NOW() WHERE id=?",[jobId]);
    return json(res,200,{message:"OTP verified. Work timer started.",job:{...job,status:"Work Started"}});
  }
  if(req.method==="PATCH"&&/^\/api\/jobs\/[^\/]+\/complete$/.test(url.pathname)){
    const worker=await auth(req,res,["worker"]);if(!worker)return;
    const jobId=url.pathname.split("/")[3];
    const [jobRows]=await pool.execute("SELECT * FROM jobs WHERE id=? AND worker_id=(SELECT id FROM worker_profiles WHERE user_id=?)",[jobId,worker.id]);
    const job=jobRows[0];
    if(!job)return error(res,404,"Job not found or not assigned to you.");
    if(job.status!=="Work Started")return error(res,400,"OTP must be verified before completing the job.");
    await pool.execute("UPDATE jobs SET status='Work Completed',completed_at=NOW() WHERE id=?",[jobId]);
    return json(res,200,{message:"Job marked as completed.",job:{...job,status:"Work Completed",amount:job.amount,commission:job.commission}});
  }
  if(req.method==="POST"&&/^\/api\/jobs\/[^/]+\/payment$/.test(url.pathname)){
    const user=await auth(req,res,["customer","worker"]);if(!user)return;
    const jobId=url.pathname.split("/")[3],data=await body(req);
    if(!data.method||!["cash","upi"].includes(data.method))return error(res,400,"Payment method must be 'cash' or 'upi'.");
    const [jobRows]=await pool.execute("SELECT * FROM jobs WHERE id=?",[jobId]);
    const job=jobRows[0];
    if(!job)return error(res,404,"Job not found.");
    if(job.status!=="Work Completed")return error(res,400,"Job must be completed before recording payment.");
    await pool.execute("UPDATE jobs SET status=? WHERE id=?",["Payment "+data.method.toUpperCase(),jobId]);
    if(job.worker_id) await pool.execute("UPDATE worker_profiles SET completed_jobs=completed_jobs+1 WHERE id=?",[job.worker_id]);
    return json(res,200,{message:"Payment confirmed via "+data.method.toUpperCase()+".",job:{...job,status:"Payment "+data.method.toUpperCase(),paymentMethod:data.method,amount:job.amount}});
  }
  if(req.method==="POST"&&/^\/api\/jobs\/[^/]+\/review$/.test(url.pathname)){
    const customer=await auth(req,res,["customer"]);if(!customer)return;
    const jobId=url.pathname.split("/")[3],data=await body(req);
    const rating=Number(data.rating);
    if(!rating||rating<1||rating>5)return error(res,400,"Rating must be between 1 and 5.");
    const [jobRows]=await pool.execute("SELECT * FROM jobs WHERE id=? AND customer_id=?",[jobId,customer.id]);
    const job=jobRows[0];
    if(!job)return error(res,404,"Job not found.");
    if(!/^Payment/i.test(job.status))return error(res,400,"You can only rate a job after payment is completed.");
    if(!job.worker_id)return error(res,400,"No worker assigned to this job.");
    const [existing]=await pool.execute("SELECT id FROM reviews WHERE job_id=?",[jobId]);
    if(existing.length)return error(res,409,"You have already rated this job.");
    const reviewId=id("REV");
    await pool.execute("INSERT INTO reviews (id,job_id,worker_id,customer_id,rating,comment) VALUES (?,?,?,?,?,?)",[reviewId,jobId,job.worker_id,customer.id,rating,data.comment||""]);
    const [avgRows]=await pool.execute("SELECT AVG(rating) AS avg FROM reviews WHERE worker_id=?",[job.worker_id]);
    const avg=Number(Number(avgRows[0].avg||0).toFixed(1));
    await pool.execute("UPDATE worker_profiles SET rating=? WHERE id=?",[avg,job.worker_id]);
    return json(res,201,{message:"Thank you for your rating!",review:{id:reviewId,rating,comment:data.comment||""}});
  }
  if(req.method==="POST"&&url.pathname==="/api/quick-bookings"){
    const customer=await auth(req,res,["customer"]);if(!customer)return;const data=await body(req);
    if(!data.service||!data.location)return error(res,400,"Please choose a service and provide your location.");
    const bookingId=id("QB"),otp=String(crypto.randomInt(1000,10000));
    await pool.execute("INSERT INTO quick_bookings (id,customer_id,worker_id,service,location,details,starting_charge,otp,eta_minutes,status) VALUES (?,?,?,?,?,?,?,?,?,?)",[bookingId,customer.id,null,data.service,data.location,data.details||"",Number(data.startingCharge||499),otp,null,"Searching"]);
    const notification=await notifyWorkerForBooking(bookingId);
    const status=notification?"Worker Notified":"No Worker Available";
    await pool.execute("UPDATE quick_bookings SET status=? WHERE id=?",[status,bookingId]);
    return json(res,201,{message:notification?"Booking posted. Waiting for a worker to accept.":"No matching worker found in your area.",booking:{id:bookingId,service:data.service,location:data.location,status}});
  }
  if(req.method==="GET"&&url.pathname==="/api/worker/quick-booking-notifications"){
    const user=await auth(req,res,["worker"]);if(!user)return;
    await ensureQuickBookingNotificationTable();
    const [rows]=await pool.execute(
      `SELECT qbn.id,qbn.booking_id AS bookingId,qbn.status,qbn.expires_at AS expiresAt,qbn.created_at AS createdAt,
              qb.service,qb.location,qb.details,qb.starting_charge AS amount
       FROM quick_booking_notifications qbn
       JOIN quick_bookings qb ON qb.id=qbn.booking_id
       JOIN worker_profiles wp ON wp.id=qbn.worker_id
       WHERE wp.user_id=? AND qbn.status='Pending'
       ORDER BY qbn.created_at DESC`, [user.id]
    );
    return json(res,200,{notifications:rows});
  }
  if(req.method==="POST"&&/^\/api\/worker\/quick-booking-notifications\/[^/]+\/accept$/.test(url.pathname)){
    const user=await auth(req,res,["worker"]);if(!user)return;
    await ensureQuickBookingNotificationTable();
    const notifId=url.pathname.split("/")[4];
    const [rows]=await pool.execute(
      `SELECT qbn.*,wp.user_id FROM quick_booking_notifications qbn JOIN worker_profiles wp ON wp.id=qbn.worker_id WHERE qbn.id=? LIMIT 1`,
      [notifId]
    );
    const notif=rows[0];
    if(!notif||notif.user_id!==user.id)return error(res,404,"Notification not found.");
    if(notif.status!=="Pending")return error(res,400,"This notification is no longer available.");
    await pool.execute("UPDATE quick_bookings SET worker_id=?,status='Worker assigned',eta_minutes=45 WHERE id=?",[notif.worker_id,notif.booking_id]);
    await pool.execute("UPDATE quick_booking_notifications SET status='Accepted',responded_at=NOW() WHERE id=?",[notifId]);
    return json(res,200,{message:"Quick booking accepted. Head to the customer location.",bookingId:notif.booking_id});
  }
  if(req.method==="POST"&&/^\/api\/worker\/quick-booking-notifications\/[^/]+\/reject$/.test(url.pathname)){
    const user=await auth(req,res,["worker"]);if(!user)return;
    await ensureQuickBookingNotificationTable();
    const notifId=url.pathname.split("/")[4];
    const [rows]=await pool.execute(
      `SELECT qbn.*,wp.user_id FROM quick_booking_notifications qbn JOIN worker_profiles wp ON wp.id=qbn.worker_id WHERE qbn.id=? LIMIT 1`,
      [notifId]
    );
    const notif=rows[0];
    if(!notif||notif.user_id!==user.id)return error(res,404,"Notification not found.");
    await pool.execute("UPDATE quick_booking_notifications SET status='Rejected',responded_at=NOW() WHERE id=?",[notifId]);
    const [rejected]=await pool.execute("SELECT worker_id AS workerId FROM quick_booking_notifications WHERE booking_id=? AND status IN ('Rejected','Expired')",[notif.booking_id]);
    const next=await notifyWorkerForBooking(notif.booking_id,rejected.map(r=>r.workerId));
    return json(res,200,{message:next?"Booking forwarded to next worker.":"No more matching workers found.",nextWorkerNotified:Boolean(next)});
  }
  if(req.method==="GET"&&url.pathname==="/api/quick-bookings"){
    const user=await auth(req,res,["customer","worker","admin"]);if(!user)return;
    if(user.role==="customer"){
      const [bookings]=await pool.execute(
        `SELECT qb.*, wp.service AS workerService, u.name AS workerName, u.email AS workerEmail
         FROM quick_bookings qb
         LEFT JOIN worker_profiles wp ON qb.worker_id=wp.id
         LEFT JOIN users u ON wp.user_id=u.id
         WHERE qb.customer_id=? ORDER BY qb.created_at DESC`, [user.id]
      );
      return json(res,200,{bookings});
    }
    if(user.role==="worker"){
      const [bookings]=await pool.execute(
        `SELECT qb.*, u.name AS customerName, u.email AS customerEmail
         FROM quick_bookings qb
         JOIN users u ON qb.customer_id=u.id
         WHERE qb.worker_id=(SELECT id FROM worker_profiles WHERE user_id=?)
         ORDER BY qb.created_at DESC`, [user.id]
      );
      return json(res,200,{bookings});
    }
    const [bookings]=await pool.query(
      `SELECT qb.*, cu.name AS customerName, wu.name AS workerName, wp.service AS workerService
       FROM quick_bookings qb
       JOIN users cu ON qb.customer_id=cu.id
       LEFT JOIN worker_profiles wp ON qb.worker_id=wp.id
       LEFT JOIN users wu ON wp.user_id=wu.id
       ORDER BY qb.created_at DESC`
    );
    return json(res,200,{bookings});
  }
  if(req.method==="PATCH"&&/^\/api\/quick-bookings\/[^/]+\/cancel$/.test(url.pathname)){
    if(!await auth(req,res,["admin"]))return;
    const bookingId=url.pathname.split("/")[3];
    const [result]=await pool.execute("UPDATE quick_bookings SET worker_id=NULL,status='Cancelled' WHERE id=?",[bookingId]);
    return result.affectedRows?json(res,200,{message:"Booking cancelled."}):error(res,404,"Booking not found.");
  }
  if(req.method==="POST"&&/^\/api\/quick-bookings\/[^/]+\/verify-otp$/.test(url.pathname)){
    const user=await auth(req,res,["worker"]);if(!user)return;
    const bookingId=url.pathname.split("/")[3],data=await body(req);
    const [rows]=await pool.execute("SELECT * FROM quick_bookings WHERE id=? AND worker_id=(SELECT id FROM worker_profiles WHERE user_id=?)",[bookingId,user.id]);
    const booking=rows[0];
    if(!booking)return error(res,404,"Quick booking not found or not assigned to you.");
    if(booking.status!=="Worker assigned")return error(res,400,"Booking is not awaiting OTP verification.");
    if(booking.otp!==String(data.otp))return error(res,400,"Incorrect OTP. Please check with the customer.");
    await pool.execute("UPDATE quick_bookings SET status='Work started',started_at=NOW() WHERE id=?",[bookingId]);
    return json(res,200,{message:"OTP verified. Work has started."});
  }
  if(req.method==="PATCH"&&/^\/api\/quick-bookings\/[^/]+\/complete$/.test(url.pathname)){
    const user=await auth(req,res,["worker"]);if(!user)return;
    const bookingId=url.pathname.split("/")[3];
    const [rows]=await pool.execute("SELECT * FROM quick_bookings WHERE id=? AND worker_id=(SELECT id FROM worker_profiles WHERE user_id=?)",[bookingId,user.id]);
    const booking=rows[0];
    if(!booking)return error(res,404,"Quick booking not found.");
    if(booking.status!=="Work started")return error(res,400,"Work must be started before marking complete.");
    await pool.execute("UPDATE quick_bookings SET status='Work completed',completed_at=NOW() WHERE id=?",[bookingId]);
    return json(res,200,{message:"Quick booking marked as completed."});
  }
  if(req.method==="POST"&&/^\/api\/quick-bookings\/[^/]+\/payment$/.test(url.pathname)){
    const user=await auth(req,res,["worker"]);if(!user)return;
    const bookingId=url.pathname.split("/")[3],data=await body(req);
    const method=(data.method||"").toLowerCase();
    if(!["cash","upi"].includes(method))return error(res,400,"Payment method must be cash or upi.");
    const [rows]=await pool.execute("SELECT * FROM quick_bookings WHERE id=? AND worker_id=(SELECT id FROM worker_profiles WHERE user_id=?)",[bookingId,user.id]);
    const booking=rows[0];
    if(!booking)return error(res,404,"Quick booking not found.");
    if(booking.status!=="Work completed")return error(res,400,"Work must be completed before recording payment.");
    const commission=Number((Number(booking.starting_charge)*0.10).toFixed(2));
    await pool.execute("UPDATE quick_bookings SET status=?,commission=? WHERE id=?",["Payment "+method.toUpperCase(),commission,bookingId]);
    await pool.execute("UPDATE worker_profiles SET completed_jobs=completed_jobs+1 WHERE user_id=?",[user.id]);
    return json(res,200,{message:`Payment of ₹${Number(booking.starting_charge).toLocaleString("en-IN")} via ${method.toUpperCase()} recorded.`});
  }
  return error(res,404,"API endpoint was not found.");
}
function serve(req,res,url){
  const requested=url.pathname==="/"?"/index.html":url.pathname,filePath=path.resolve(ROOT,`.${decodeURIComponent(requested)}`),relative=path.relative(ROOT,filePath);
  if(relative.startsWith("..")||path.isAbsolute(relative)||relative.startsWith(".git")||relative.startsWith(".env")||relative.startsWith("database")||relative.startsWith("data"))return error(res,403,"Access denied.");
  fs.readFile(filePath,(err,file)=>{if(err)return error(res,err.code==="ENOENT"?404:500,"File was not found.");res.writeHead(200,{"Content-Type":mimeTypes[path.extname(filePath)]||"application/octet-stream"});res.end(file);});
}
const server=http.createServer(async(req,res)=>{const url=new URL(req.url,`http://${req.headers.host||"localhost"}`);try{if(url.pathname.startsWith("/api/")){
      if (req.method==="OPTIONS") { setCors(res); res.writeHead(204); return res.end(); }
      return await handleApi(req,res,url);
    }
    serve(req,res,url);
  }catch(e){
    console.error(e);
    error(res,400,e.message||"Unable to process your request.");
  }
});
async function cleanupStaleBookings(){
  // Reset quick bookings stuck in "Worker assigned" with no matching accepted notification (old auto-assign flow remnants)
  await pool.query(`UPDATE quick_bookings SET worker_id=NULL, status='Cancelled'
    WHERE status='Worker assigned'
    AND NOT EXISTS (
      SELECT 1 FROM quick_booking_notifications qbn
      WHERE qbn.booking_id=quick_bookings.id AND qbn.status='Accepted'
    )`);
}
async function start(){try{const db=await checkConnection();await ensureSchema();await migrateForeignKeys();await ensureJobColumns();await ensureQuickBookingColumns();await ensureQuickBookingNotificationTable();await cleanupStaleBookings();await seed();console.log(`Connected to MySQL database '${db.database_name}' on ${db.server_name}:${db.server_port}`);server.listen(PORT,()=>console.log(`JobEase running at http://localhost:${PORT}`));}catch(e){console.error("Unable to start JobEase backend.");console.error(e.message);process.exit(1);}}
start();
