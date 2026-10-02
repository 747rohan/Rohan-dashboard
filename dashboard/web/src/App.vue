<script setup>
import TickerBanner from './widgets/TickerBanner.vue';
import BtcPhaseChart from './widgets/BtcPhaseChart.vue';
import BtcPhaseDetector from './widgets/BtcPhaseDetector.vue';
import PnLMiniChart from './widgets/PnLMiniChart.vue';
import TradingMetrics from './widgets/TradingMetrics.vue';
import GexZones from './widgets/GexZones.vue';
import ArchitectureGraph from './widgets/ArchitectureGraph.vue';
import WmFeed from './widgets/WmFeed.vue';
import WmNews from './widgets/WmNews.vue';
</script>

<template>
  <main class="dashboard">
    <TickerBanner />
    <PnLMiniChart />
    <TradingMetrics />
    <BtcPhaseChart />
    <BtcPhaseDetector />
    <WmFeed />
    <WmNews />
    <ArchitectureGraph />
    <GexZones />
  </main>
</template>
