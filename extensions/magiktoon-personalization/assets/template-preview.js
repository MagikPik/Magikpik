/**
 * MagikToon — Gelato template image block.
 *
 * Fetches the designs mapped to the current Shopify product and shows the
 * selected one at full size. No image URL is hardcoded: everything comes from
 * the mapping configured in the app.
 *
 * Kept deliberately separate from personalisation.js so a merchant can place
 * the image in one column and the customise form in another, and so a product
 * page that only wants the image does not download the whole form's logic.
 */
(function () {
  "use strict";

  /** Emitted by the personalisation block when the shopper picks a design. */
  var DESIGN_EVENT = "mtc:design-change";

  function queryAll(root, selector) {
    return Array.prototype.slice.call(root.querySelectorAll(selector));
  }

  function show(node) {
    if (node) node.hidden = false;
  }

  function hide(node) {
    if (node) node.hidden = true;
  }

  /** Whether focus arrived from the keyboard rather than a click or tap. */
  function isKeyboardFocus(node) {
    try {
      return node.matches(":focus-visible");
    } catch (unsupported) {
      // Browsers too old for :focus-visible: never pause on focus, so the
      // slider cannot get stuck. Hover still pauses it.
      return false;
    }
  }

  /**
   * The image URL for one design.
   *
   * Always the app-proxy path when there is one: Gelato's own preview URLs are
   * presigned and expire after 24 hours, which shows up as a broken image a day
   * after everything looked fine.
   */
  function designImage(base, option) {
    if (!option) return "";

    return option.previewPath ? base + option.previewPath : option.previewUrl || "";
  }

  /**
   * Every image Gelato has for one design, as stable proxy paths.
   *
   * A design built from a store product carries a mockup gallery; one created
   * from a template id alone has a single preview. Either way the list is
   * whatever Gelato reports, never a fixed number.
   */
  function designImages(base, option) {
    if (!option) return [];

    if (Array.isArray(option.imagePaths) && option.imagePaths.length) {
      return option.imagePaths.map(function (path) {
        return base + path;
      });
    }

    var single = designImage(base, option);

    return single ? [single] : [];
  }

  function Preview(root) {
    this.root = root;
    this.productId = root.dataset.productId || "";
    this.proxyBase = (root.dataset.proxyBase || "/apps/magiktoon").replace(/\/$/, "");
    this.showThumbnails = root.dataset.showThumbnails !== "false";
    this.sideBySide = root.dataset.sideBySide !== "false";
    this.autoplay = root.dataset.autoplay !== "false";
    this.autoplayMs = Math.max(2, Number(root.dataset.autoplaySeconds) || 4) * 1000;
    this.timer = null;
    // Reasons autoplay is held back right now; it runs only when this is empty.
    this.pausedBy = {};

    this.designMode =
      root.dataset.designMode === "true" ||
      Boolean(window.Shopify && window.Shopify.designMode);

    this.image = root.querySelector("[data-mtcv-image]");
    this.placeholder = root.querySelector("[data-mtcv-placeholder]");
    this.thumbs = root.querySelector("[data-mtcv-thumbs]");
    this.notice = root.querySelector("[data-mtcv-notice]");

    this.templates = [];
    this.selected = null;
    // Which image of the selected design is on screen; its thumbnail is hidden.
    this.currentIndex = 0;
  }

  Preview.prototype.setImage = function setImage(url, alt) {
    if (!this.image || !url) return;

    var self = this;

    this.image.onload = function () {
      show(self.image);
      hide(self.placeholder);

      // Restart the fade-in on every change, not only the first.
      self.image.classList.remove("mtcv__image--enter");
      void self.image.offsetWidth;
      self.image.classList.add("mtcv__image--enter");
    };

    this.image.onerror = function () {
      hide(self.image);
      show(self.placeholder);
    };

    if (alt) this.image.alt = alt;

    this.image.src = url;
  };

  Preview.prototype.select = function select(mappingId) {
    var chosen = null;

    this.templates.forEach(function (option) {
      if (option.mappingId === mappingId) chosen = option;
    });

    if (!chosen) return;

    this.selected = chosen;
    // A design always opens on its primary image.
    this.currentIndex = 0;

    this.setImage(
      designImage(this.proxyBase, chosen),
      chosen.designLabel || chosen.templateName || chosen.productTitle
    );

    if (!this.thumbs) return;

    this.syncThumbnails();
    this.markSelected(
      this.thumbs.querySelector(
        '.mtcv__thumb[data-mapping-id="' + chosen.mappingId + '"][data-image-index="0"]'
      )
    );
  };

  /**
   * The slides autoplay moves through: every image of the selected design,
   * then the product's own photos. Other designs are left out on purpose —
   * their thumbnails change what gets printed, which a timer must never do.
   */
  Preview.prototype.slides = function slides() {
    var self = this;

    if (!this.thumbs) return [];

    return queryAll(this.thumbs, ".mtcv__thumb").filter(function (button) {
      var mappingId = button.dataset.mappingId;

      return !mappingId || (self.selected && mappingId === self.selected.mappingId);
    });
  };

  /** Show one slide large: a view of the selected design, or a product photo. */
  Preview.prototype.showSlide = function showSlide(button) {
    if (!button) return;

    var alt = button.querySelector("img").alt;

    if (button.dataset.mappingId) {
      this.currentIndex = Number(button.dataset.imageIndex);
      this.setImage(button.dataset.imageUrl, alt);
    } else {
      this.setImage(button.dataset.mtcvPhoto, alt);
    }

    this.markSelected(button);
  };

  /** Advance to the next slide, wrapping round to the first. */
  Preview.prototype.next = function next() {
    var list = this.slides();

    if (list.length < 2) return;

    var current = this.thumbs.querySelector('.mtcv__thumb[aria-checked="true"]');
    var position = list.indexOf(current);

    this.showSlide(list[(position + 1) % list.length]);
  };

  /**
   * (Re)start the countdown to the next slide.
   *
   * The state is written to `data-mtcv-autoplay` on the block, so DevTools
   * shows at a glance whether the slider is running and, if not, why.
   */
  Preview.prototype.startAutoplay = function startAutoplay() {
    var self = this;

    this.stopAutoplay();

    if (!this.autoplay) return this.setState("off:setting");

    var count = this.slides().length;

    if (count < 2) return this.setState("off:" + count + "-slide");

    for (var reason in this.pausedBy) {
      if (this.pausedBy[reason]) return this.setState("paused:" + reason);
    }

    this.timer = window.setInterval(function () {
      self.next();
    }, this.autoplayMs);

    this.setState("running:" + count + "-slides:" + this.autoplayMs + "ms");
  };

  Preview.prototype.setState = function setState(state) {
    this.root.setAttribute("data-mtcv-autoplay", state);
  };

  Preview.prototype.stopAutoplay = function stopAutoplay() {
    if (this.timer) window.clearInterval(this.timer);
    this.timer = null;
  };

  /** Hold autoplay back for one reason, or release that reason. */
  Preview.prototype.pause = function pause(reason, paused) {
    this.pausedBy[reason] = paused;

    if (paused) {
      this.stopAutoplay();
    } else {
      this.startAutoplay();
    }
  };

  /**
   * Put the customer's own saved design at the front of the slider and show it.
   *
   * It used to replace the image and switch autoplay off for good — and since
   * the saved design is restored from the browser on every visit, anyone who
   * had customized the product once never saw the slider move again. As the
   * first slide it is what the customer sees on arrival, and the cycle keeps
   * coming back to it.
   */
  Preview.prototype.addSavedSlide = function addSavedSlide(url) {
    var self = this;

    if (!this.thumbs) {
      this.setImage(url, "Your saved design");
      return;
    }

    var button = this.thumbs.querySelector("[data-mtcv-saved]");

    if (!button) {
      button = document.createElement("button");
      button.type = "button";
      button.className = "mtcv__thumb";
      button.setAttribute("role", "radio");
      button.setAttribute("aria-checked", "false");
      button.dataset.mtcvSaved = "true";

      var image = document.createElement("img");
      image.className = "mtcv__thumb-image";
      image.alt = "Your saved design";
      image.width = 160;
      image.height = 160;

      // A preview minted against an old tunnel no longer resolves: drop the
      // slide rather than cycle onto a broken image.
      image.onerror = function () {
        var wasShowing = button.getAttribute("aria-checked") === "true";

        button.remove();
        self.syncThumbnails();
        if (wasShowing) self.showSlide(self.slides()[0]);
        self.startAutoplay();
      };

      button.appendChild(image);
      this.thumbs.insertBefore(button, this.thumbs.firstChild);
    }

    button.dataset.mtcvPhoto = url;
    button.querySelector("img").src = url;

    this.showSlide(button);
    this.syncThumbnails();
    this.startAutoplay();
  };

  /**
   * Wire up autoplay once the strip exists.
   *
   * It runs on its own, with no interaction needed. There is deliberately no
   * hover pause: the gallery fills half the page, the mouse naturally rests
   * on it while someone watches, and the slider looked broken. Clicking a
   * thumbnail restarts the countdown rather than stopping it. It holds only
   * while the tab is in the background and while a keyboard user is tabbing
   * through the thumbnails.
   */
  Preview.prototype.setupAutoplay = function setupAutoplay() {
    var self = this;

    if (!this.autoplay) return this.setState("off:setting");

    // Every slide fetched up front, so each change is instant rather than a
    // blank frame while the next photo downloads.
    this.slides().forEach(function (button) {
      var url = button.dataset.imageUrl || button.dataset.mtcvPhoto;

      if (url) new Image().src = url;
    });

    // Keyboard focus only. Clicking a thumbnail focuses the button too, and
    // that focus outlives the mouse leaving — it used to hold the slider still
    // until the shopper happened to click somewhere else on the page.
    this.root.addEventListener("focusin", function (event) {
      if (isKeyboardFocus(event.target)) self.pause("focus", true);
    });
    this.root.addEventListener("focusout", function (event) {
      if (!self.root.contains(event.relatedTarget)) self.pause("focus", false);
    });
    document.addEventListener("visibilitychange", function () {
      self.pause("hidden", document.hidden);
    });

    this.startAutoplay();
  };

  /**
   * Build the thumbnail strip: mapped designs first, product photos after.
   *
   * The product photos are already in the markup from Liquid, so the designs
   * are inserted before them rather than the whole strip being rebuilt.
   */
  Preview.prototype.renderThumbnails = function renderThumbnails() {
    var self = this;

    if (!this.thumbs || !this.showThumbnails) return;

    // Designs go after the customer's own design, if it arrived first, and
    // before the product photos.
    var first = this.thumbs.querySelector(".mtcv__thumb:not([data-mtcv-saved])");

    this.templates.forEach(function (option, index) {
      var label =
        option.designLabel || option.templateName || "Design " + (index + 1);

      // One thumbnail per image Gelato holds for this design, not one per
      // design: a mockup gallery of six shots should show six thumbnails.
      designImages(self.proxyBase, option).forEach(function (url, imageIndex) {
        var button = document.createElement("button");

        button.type = "button";
        button.className = "mtcv__thumb";
        button.setAttribute("role", "radio");
        button.setAttribute("aria-checked", "false");
        button.dataset.mappingId = option.mappingId;
        // Only the first image selects the design; the rest just change the view.
        button.dataset.imageIndex = String(imageIndex);
        button.dataset.imageUrl = url;

        var image = document.createElement("img");
        image.className = "mtcv__thumb-image";
        image.src = url;
        image.alt =
          imageIndex === 0 ? label : label + " view " + (imageIndex + 1);
        image.width = 160;
        image.height = 160;
        image.loading = "lazy";

        button.appendChild(image);
        self.thumbs.insertBefore(button, first);
      });
    });

    this.thumbs.addEventListener("click", function (event) {
      var button = event.target.closest(".mtcv__thumb");

      if (!button) return;

      if (button.dataset.mappingId) {
        var changingDesign =
          !self.selected || button.dataset.mappingId !== self.selected.mappingId;

        if (changingDesign) {
          // A different design: change what will be printed, and say so.
          self.select(button.dataset.mappingId);

          document.dispatchEvent(
            new CustomEvent(DESIGN_EVENT, {
              detail: {
                productId: self.productId,
                mappingId: button.dataset.mappingId
              }
            })
          );
        }

        self.showSlide(button);
        self.syncThumbnails();
        self.startAutoplay();

        return;
      }

      // A product photo: change the view only. The design being printed is
      // unaffected, so `this.selected` is deliberately left alone.
      self.showSlide(button);
      self.startAutoplay();
    });

    this.syncThumbnails();
  };

  /**
   * Drop product photos that repeat an image already in the strip.
   *
   * When Gelato publishes a product to Shopify it copies its mockups into the
   * product's photos, naming each file after its Gelato image id. With the
   * design's gallery and the product's photos both in the strip, every picture
   * appeared twice. A photo is dropped when its file name is the id of one of
   * the designs' images, or when it repeats an earlier photo. The designs'
   * own tiles always stay, since they also choose what gets printed; the order
   * of everything kept is unchanged.
   */
  Preview.prototype.removeDuplicatePhotos = function removeDuplicatePhotos() {
    var known = {};

    this.templates.forEach(function (option) {
      (Array.isArray(option.imageIds) ? option.imageIds : []).forEach(function (id) {
        if (id) known[String(id).toLowerCase()] = true;
      });
    });

    var seen = {};

    queryAll(this.thumbs, ".mtcv__thumb[data-mtcv-photo]").forEach(function (button) {
      if (button.dataset.mtcvSaved) return;

      var url = button.dataset.mtcvPhoto || "";
      var path = url.split("?")[0];
      var file = path.split("/").pop() || "";
      var id = (/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i.exec(file) || [""])[0].toLowerCase();

      if ((id && known[id]) || seen[path]) {
        button.remove();
        return;
      }

      seen[path] = true;
    });
  };

  /**
   * Show the thumbnails that are worth showing.
   *
   * The strip is a slider: every view of the selected design and every product
   * photo stays in it, and the one shown large is highlighted rather than
   * removed — removing it made the tiles shift each time the slide changed.
   *
   * Every other design keeps only its primary, acting as the button that
   * switches to it. A strip with a single tile is hidden: it would only repeat
   * the image above it.
   */
  Preview.prototype.syncThumbnails = function syncThumbnails() {
    var self = this;

    if (!this.thumbs) return;

    var visible = 0;

    queryAll(this.thumbs, ".mtcv__thumb").forEach(function (button) {
      var mappingId = button.dataset.mappingId;
      var index = Number(button.dataset.imageIndex);
      var isSelectedDesign =
        self.selected && mappingId === self.selected.mappingId;

      // A product photo has no mapping id; it is always available.
      var show = !mappingId || isSelectedDesign || index === 0;

      button.hidden = !show;

      if (show) visible += 1;
    });

    this.thumbs.hidden = visible < 2;
  };

  /** Highlight one thumbnail, clearing the rest, and keep it in view. */
  Preview.prototype.markSelected = function markSelected(active) {
    if (!this.thumbs) return;

    queryAll(this.thumbs, ".mtcv__thumb").forEach(function (button) {
      button.setAttribute("aria-checked", button === active ? "true" : "false");
    });

    // Scroll the strip itself, never the page: scrollIntoView would drag the
    // whole window to the gallery every time the slide changed.
    if (active && !this.thumbs.hidden) {
      var strip = this.thumbs;
      var left =
        active.getBoundingClientRect().left -
        strip.getBoundingClientRect().left +
        strip.scrollLeft;

      if (left < strip.scrollLeft || left + active.offsetWidth > strip.scrollLeft + strip.clientWidth) {
        strip.scrollTo({ left: Math.max(0, left - 8), behavior: "smooth" });
      }
    }
  };

  /**
   * Put the design image and the customize form side by side.
   *
   * Both are app blocks dropped into the same section slot, so the theme stacks
   * them in one column. Wrapping the pair in a grid is the only way to get the
   * approved two-column layout without asking the merchant to edit theme code.
   *
   * Only siblings are wrapped: if the merchant has already placed them in
   * separate columns, the theme's own layout is left alone.
   */
  Preview.prototype.pairWithForm = function pairWithForm() {
    if (!this.sideBySide) return;

    var form = document.querySelector("[data-mtc-root]");

    if (!form || form === this.root) return;
    if (this.root.closest(".mtcv-split")) return;

    // Two elements: the outer one measures the width the theme gives us, the
    // inner one is the grid. A container cannot query its own width.
    var wrapper = document.createElement("div");
    wrapper.className = "mtcv-split";

    var grid = document.createElement("div");
    grid.className = "mtcv-split__grid";
    wrapper.appendChild(grid);

    // Anchor the wrapper where the pair already begins, so it lands inside the
    // same theme container and inherits its width and alignment.
    var first =
      this.root.compareDocumentPosition(form) &
      Node.DOCUMENT_POSITION_FOLLOWING
        ? this.root
        : form;

    // Siblings are wrapped in place. When the theme has put the two blocks in
    // different containers they are moved together instead — without this, the
    // pair simply stacks and the approved two-column layout never appears.
    var anchor = first;

    if (this.root.parentElement !== form.parentElement) {
      // Climb to the highest ancestor that still contains only this block, so
      // the theme's own wrapper markup travels with it rather than being left
      // behind as an empty box.
      while (
        anchor.parentElement &&
        anchor.parentElement.children.length === 1 &&
        anchor.parentElement !== document.body
      ) {
        anchor = anchor.parentElement;
      }
    }

    anchor.parentElement.insertBefore(wrapper, anchor);

    // Image first, form second — left and right in the approved design.
    grid.appendChild(this.root);
    grid.appendChild(form);
  };

  /** In the theme editor, say why nothing is showing. */
  Preview.prototype.explain = function explain(message) {
    if (!this.designMode || !this.notice) return;

    this.notice.textContent = message;
    show(this.notice);
    show(this.root);
  };

  Preview.prototype.start = function start() {
    var self = this;

    if (!this.productId) return;

    fetch(
      this.proxyBase + "/mapping?product_id=" + encodeURIComponent(this.productId),
      { headers: { Accept: "application/json" } }
    )
      .then(function (response) {
        return response.json();
      })
      .then(function (payload) {
        if (!payload || !payload.ok || !payload.mapping) {
          self.explain(
            "This product has no active Gelato mapping yet. Add one under " +
              "Product mappings in the MagikToon app."
          );
          return;
        }

        self.templates = Array.isArray(payload.templates) && payload.templates.length
          ? payload.templates
          : [payload.mapping];

        self.selected = self.templates[0];

        // Build the strip first so the initial selection can highlight in it.
        self.renderThumbnails();
        if (self.thumbs) self.removeDuplicatePhotos();
        self.select(self.selected.mappingId);

        // The customer's design may have arrived while this request was out;
        // it stays the image shown first.
        var saved = self.thumbs && self.thumbs.querySelector("[data-mtcv-saved]");
        if (saved) self.showSlide(saved);

        self.pairWithForm();
        show(self.root);
        self.setupAutoplay();
      })
      .catch(function (error) {
        console.warn("[magiktoon] template image request failed", error);
        self.explain(
          "The MagikToon app could not be reached. Check the app proxy path " +
            "matches this block's setting."
        );
      });

    // Follow the personalisation block's own chooser.
    document.addEventListener(DESIGN_EVENT, function (event) {
      var detail = event.detail || {};

      if (detail.productId !== self.productId) return;
      if (self.selected && detail.mappingId === self.selected.mappingId) return;

      self.select(detail.mappingId);
      self.startAutoplay();
    });

    // A customer's own design is a truer preview than the blank template.
    document.addEventListener("mtc:design-saved", function (event) {
      var detail = event.detail || {};

      if (detail.productId !== self.productId || !detail.previewUrl) return;

      self.addSavedSlide(detail.previewUrl);
    });
  };

  function init() {
    queryAll(document, "[data-mtcv-root]").forEach(function (root) {
      if (root.dataset.mtcvReady === "true") return;

      root.dataset.mtcvReady = "true";
      new Preview(root).start();
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }

  document.addEventListener("shopify:section:load", init);
})();
