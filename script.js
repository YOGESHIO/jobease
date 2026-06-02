const catalog = {
  "Popular": [["Electrician",399,"ϟ"],["Plumber",399,"◒"],["House Cleaning",699,"✦"],["AC Repair",599,"❄"],["Personal Driver",799,"◉"],["Home Nurse",999,"✚"],["Home Tutor",499,"A+"],["Bike Repair",349,"⚙"]],
  "Cleaning": [["Maid",299,"⌂"],["House Cleaning",699,"✦"],["Deep Cleaning",1499,"✦"],["Bathroom Cleaning",399,"◫"],["Kitchen Cleaning",599,"◫"],["Sofa Cleaning",499,"▤"],["Carpet Cleaning",449,"▤"],["Office Cleaning",999,"⌂"]],
  "Repairs": [["Plumber",399,"◒"],["Electrician",399,"ϟ"],["Carpenter",499,"⚒"],["Painter",599,"◩"],["Welder",599,"⚒"],["Mason",549,"⚒"],["Tile Worker",599,"▣"],["POP Worker",649,"◩"]],
  "Appliances": [["AC Repair",599,"❄"],["Refrigerator Repair",499,"❄"],["Washing Machine Repair",499,"◒"],["TV Repair",449,"▣"],["Microwave Repair",449,"◫"],["Water Purifier Repair",399,"◒"],["Geyser Repair",449,"♨"]],
  "Automobile": [["Bike Repair",349,"⚙"],["Bike Washing",199,"◒"],["Puncture Repair",149,"⚙"],["Bike Pickup Service",299,"➜"],["Car Repair",699,"⚒"],["Car Washing",399,"✦"],["Car Detailing",1499,"✦"],["Driver on Demand",799,"◉"],["Towing Service",999,"➜"],["Battery Jump Start",449,"ϟ"],["Emergency Fuel Delivery",599,"◈"]],
  "Labour": [["Construction Labour",699,"⚒"],["Factory Labour",699,"⚙"],["Loading Unloading",599,"▣"],["Packers Movers Helper",599,"▣"],["Warehouse Worker",699,"⌂"],["Daily Wage Labour",699,"⚒"]],
  "Delivery": [["Food Delivery",499,"➜"],["Grocery Delivery",499,"➜"],["Parcel Delivery",499,"➜"],["Courier Delivery",499,"➜"],["Medicine Delivery",499,"✚"]],
  "Drivers": [["Personal Driver",799,"◉"],["Monthly Driver",14999,"◉"],["Truck Driver",999,"◉"],["Taxi Driver",799,"◉"],["School Van Driver",899,"◉"],["Delivery Driver",699,"➜"],["Female Driver",899,"◉"]],
  "Lifestyle": [["Beautician",599,"✦"],["Makeup Artist",999,"✦"],["Hair Stylist",599,"✦"],["Nail Artist",499,"✦"],["Bridal Makeup",4999,"✦"],["Massage Therapist",799,"◉"],["Yoga Trainer",499,"◉"],["Gym Trainer",599,"◉"]],
  "Education": [["Home Tutor",499,"A+"],["Online Tutor",399,"A+"],["Spoken English Teacher",499,"A+"],["Computer Teacher",599,"⌨"],["Music Teacher",599,"♫"],["Dance Teacher",599,"♫"],["Resume Writing",499,"▤"],["Career Counseling",799,"◉"],["Language Trainer",499,"A+"],["Computer Training",799,"⌨"]],
  "Digital": [["Data Entry",399,"⌨"],["Content Writing",699,"▤"],["Graphic Designer",999,"◩"],["Video Editor",1499,"▶"],["Website Developer",2999,"⌨"],["Mobile App Developer",4999,"⌨"],["Digital Marketing",1499,"➜"],["SEO Expert",1499,"⌕"],["AI Assistant Setup",1499,"✦"],["AI Content Creation",999,"✦"],["AI Training",1499,"A+"]],
  "Part-time": [["Store Helper",599,"⌂"],["Cashier",599,"▤"],["Receptionist",699,"☏"],["Promoter",699,"➜"],["Event Staff",699,"◉"],["Sales Executive",799,"➜"],["Telecaller",599,"☏"],["Packing Staff",599,"▣"],["Customer Support",599,"☏"],["Virtual Assistant",699,"⌨"],["Social Media Manager",999,"⌨"]],
  "Events": [["Photographer",1499,"◫"],["Videographer",1999,"▶"],["Drone Operator",2499,"◉"],["DJ",2999,"♫"],["Singer",2999,"♫"],["Event Host",1999,"◉"],["Decorator",1499,"◩"],["Catering Staff",699,"◉"],["Wedding Planner",4999,"✦"],["Pandit Booking",799,"✧"],["Pujan Services",999,"✧"],["Bhajan/Kirtan Group",2999,"♫"]],
  "Pet care": [["Dog Walker",299,"♧"],["Pet Grooming",599,"✦"],["Pet Sitting",499,"⌂"],["Pet Training",699,"A+"]],
  "Healthcare": [["Home Nurse",999,"✚"],["Caretaker",799,"✚"],["Elder Care",799,"✚"],["Patient Attendant",799,"✚"],["Physiotherapist Visit",999,"✚"],["Dietitian",799,"✚"],["Medical Attendant",799,"✚"],["Hospital Visit Assistance",699,"✚"],["Medicine Pickup",299,"✚"],["Daily Check-In Service",299,"☏"]],
  "Business": [["Office Boy",599,"⌂"],["Accountant",999,"▤"],["Data Operator",599,"⌨"],["Security Guard",799,"◈"],["Office Cleaner",699,"✦"],["Architect",1999,"⌂"],["Interior Designer",1999,"◩"],["Civil Engineer",1499,"⚒"],["Mechanical Technician",999,"⚙"]],
  "Security": [["Background Verification",999,"◈"],["Employee Verification",999,"◈"],["Tenant Verification",999,"◈"],["Matrimonial Verification",1499,"◈"],["Security Guard",799,"◈"],["Bouncer",999,"◈"],["Event Security",999,"◈"],["CCTV Monitoring",699,"◉"],["Security Supervisor",999,"◈"],["Personal Security Escort",1999,"◈"]],
  "Emergency": [["Ambulance Booking",999,"✚"],["Roadside Assistance",699,"➜"],["Emergency Electrician",599,"ϟ"],["Emergency Plumber",599,"◒"],["Locksmith",449,"⚒"],["Water Tanker Booking",799,"◒"]],
  "Property": [["Property Inspection",999,"⌂"],["Property Manager",1499,"⌂"],["Rent Collection Agent",999,"▤"],["Tenant Search",999,"⌕"],["Property Photography",1499,"◫"],["House Rent",999,"⌂"],["Room Rent",499,"⌂"]],
  "Agriculture": [["Farm Labour",699,"⚒"],["Tractor Rental",1499,"⚙"],["Harvester Rental",2999,"⚙"],["Irrigation Technician",799,"◒"],["Dairy Worker",699,"◉"],["Animal Care Worker",699,"♧"]],
  "Documentation": [["Passport Assistance",499,"▤"],["PAN Card Assistance",399,"▤"],["Aadhaar Update Assistance",399,"▤"],["Government Form Filling",299,"▤"],["GST Registration Support",999,"▤"],["Income Tax Filing",999,"▤"]],
  "Rental": [["Vehicle Rent",999,"◉"],["Equipment Rent",799,"⚙"],["Generator Rent",999,"ϟ"],["Camera Rent",799,"◫"],["Tools",299,"⚒"],["Equipment",799,"⚙"],["Materials",499,"▣"]],
  "Smart home": [["CCTV Installation",999,"◉"],["Smart Device Setup",699,"⌨"],["Home Automation",1999,"⌂"]],
  "Training": [["Worker Verification",499,"✓"],["Skill Training",999,"A+"],["Safety Certification",799,"✓"],["Professional Certification",1499,"✓"]]
};
let activeCategory = "Popular";
function renderServices(){
  const search=document.getElementById("service-search").value.trim().toLowerCase();
  document.getElementById("service-tabs").innerHTML=Object.keys(catalog).map(category=>`<button class="${category===activeCategory?"active":""}" data-category="${category}" type="button">${category}</button>`).join("");
  document.querySelectorAll("#service-tabs button").forEach(button=>button.addEventListener("click",()=>{activeCategory=button.dataset.category;renderServices()}));
  const services=(search?Object.values(catalog).flat():catalog[activeCategory]).filter(([name])=>name.toLowerCase().includes(search));
  document.getElementById("service-grid").innerHTML=services.map(([name,rate,icon])=>`<article class="service-card"><span class="service-icon">${icon}</span><h3>${name}</h3><p>Starting from <strong>₹${rate}</strong></p></article>`).join("")||"<p>No matching services found.</p>";
}
document.getElementById("service-search").addEventListener("input",renderServices);
renderServices();
