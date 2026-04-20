# HTML Image Tags

既存の HTML `<img>` タグと SVG `<image>` タグに対して `width` の追加・更新が行われるか確認します。

<img src="./assets/square-grid.svg" alt="Square grid" width="220">

<img src="./assets/landscape-card.svg" alt="Landscape sample" width="320" height="180" class="hero-card" data-test="preserve-me">

<p>ドラッグ後に <code>height</code> は除去され、他属性は残る想定です。</p>

<img src="./assets/portrait-card.svg" alt="Portrait sample" data-layout="sidebar">

<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 360" width="320" aria-label="SVG image sample">
	<image href="./assets/landscape-card.svg" width="320" height="180" preserveAspectRatio="xMidYMid meet"></image>
</svg>

<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 360 540" width="220" aria-label="Legacy SVG image sample">
	<image xlink:href="./assets/portrait-card.svg" width="220" height="330" data-layout="legacy"></image>
</svg>

<p>SVG <code>&lt;image&gt;</code> でも、ドラッグ後は <code>height</code> が除去され、<code>href</code> / <code>xlink:href</code> 以外の属性は残る想定です。</p>