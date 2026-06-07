<script setup>
import TickerBanner from './widgets/TickerBanner.vue';
import BtcPhaseChart from './widgets/BtcPhaseChart.vue';
import BtcPhaseDetector from './widgets/BtcPhaseDetector.vue';
import PnLMiniChart from './widgets/PnLMiniChart.vue';
import TradingMetrics from './widgets/TradingMetrics.vue';
import PhasesByInstrument from './widgets/PhasesByInstrument.vue';
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
    <PhasesByInstrument />
  </main>
</template>
