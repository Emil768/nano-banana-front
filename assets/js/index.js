function bindSmoothScroll() {
  document.querySelectorAll('a[href^="#"]').forEach((anchor) => {
    anchor.addEventListener("click", (event) => {
      event.preventDefault();
      const target = document.querySelector(anchor.getAttribute("href"));
      target?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  });
}

function bindSectionsRevealAnimation() {
  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        entry.target.style.opacity = "1";
        entry.target.style.transform = "translateY(0)";
      });
    },
    { threshold: 0.1, rootMargin: "0px 0px -50px 0px" }
  );

  document.querySelectorAll("section").forEach((section) => {
    section.style.opacity = "0";
    section.style.transform = "translateY(20px)";
    section.style.transition = "opacity 0.6s ease, transform 0.6s ease";
    observer.observe(section);
  });
}

function bindPricingTabs() {
  const pricingTabsContainer = document.querySelector(".pricing-tabs");
  if (!pricingTabsContainer) return;

  pricingTabsContainer.addEventListener("click", (event) => {
    const clickedTab = event.target.closest(".pricing-tab");
    if (!clickedTab) return;

    event.preventDefault();
    const targetTab = clickedTab.getAttribute("data-tab");
    const targetContent = document.getElementById(`${targetTab}-tab`);
    if (!targetContent) return;

    document
      .querySelectorAll(".pricing-tab")
      .forEach((el) => el.classList.remove("active"));
    document
      .querySelectorAll(".pricing-tab-content")
      .forEach((el) => el.classList.remove("active"));

    clickedTab.classList.add("active");
    targetContent.classList.add("active");
  });
}

document.addEventListener("DOMContentLoaded", () => {
  bindSmoothScroll();
  bindSectionsRevealAnimation();
  bindPricingTabs();
});
