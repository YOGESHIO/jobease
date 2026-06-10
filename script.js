const backendBase = location.protocol === "file:" ? "http://localhost:3000" : "";
let catalog = {};
let activeCategory = "Popular";

async function loadCatalog() {
  try {
    const res = await fetch(`${backendBase}/api/services`);
    if (!res.ok) throw new Error('Failed to load services');
    const data = await res.json();
    catalog = data.catalog || {};
    if (!catalog[activeCategory]) activeCategory = Object.keys(catalog)[0] || activeCategory;
    renderServices();
  } catch (e) {
    console.error('Could not load services catalog', e);
    document.getElementById('service-grid').innerHTML = '<p>Unable to load services.</p>';
  }
}

function renderServices(){
  const search=document.getElementById("service-search").value.trim().toLowerCase();
  document.getElementById("service-tabs").innerHTML=Object.keys(catalog).map(category=>`<button class="${category===activeCategory?"active":""}" data-category="${category}" type="button">${category}</button>`).join("");
  document.querySelectorAll("#service-tabs button").forEach(button=>button.addEventListener("click",()=>{activeCategory=button.dataset.category;renderServices()}));
  const services=(search?Object.values(catalog).flat():catalog[activeCategory]||[]).filter(([name])=>name.toLowerCase().includes(search));
  document.getElementById("service-grid").innerHTML=services.map(([name,rate,icon])=>`<article class="service-card"><span class="service-icon">${icon}</span><h3>${name}</h3><p>Starting from <strong>₹${rate}</strong></p></article>`).join("")||"<p>No matching services found.</p>";
}

document.getElementById("service-search").addEventListener("input",renderServices);
loadCatalog();
