import test from 'node:test';
import assert from 'node:assert/strict';
import { tableLayout, fanOverlap, hasLiveDealFlight, initialSceneScale, fitScene } from '../public/table-layout.js';

const base={width:1408,height:928,northBottom:170,sideEdge:190,sideHeight:210,hudBottom:315,handHeight:338,handBottom:18,cardWidth:101,captionHeight:22.5};
test('played rows, captions and the entire hand hover area remain disjoint as preferences grow',()=>{
  for(const width of [1050,1408,1768])for(const cardWidth of [86,101,138])for(const handHeight of [300,338,410]){
    const layout=tableLayout({...base,width,cardWidth,handHeight});
    assert.ok(layout.northTop>=base.northBottom+18);
    assert.ok(layout.northTop+layout.pileHeight+18<=layout.southTop+.01);
    assert.ok(layout.southTop+layout.pileHeight+18<=layout.handTop+.01);
    assert.ok(layout.west-layout.maxFanWidth/2>=base.sideEdge+18-.01);
    assert.ok(layout.west+layout.maxFanWidth/2+18<=width/2-layout.maxFanWidth/2+.01);
    assert.ok(layout.sideSeatTop>=base.hudBottom+18);
    assert.ok(layout.sideSeatTop+base.sideHeight+18<=layout.handTop+.01);
    assert.ok(layout.height>=base.height);
  }
});
test('short narrow tables place side portraits above their plays and keep three piles apart',()=>{
  for(const width of [358,528,668]){
    const layout=tableLayout({...base,width,height:850,narrow:true,cardWidth:62,captionHeight:33,sideHeight:175,hudBottom:305});
    assert.ok(layout.sideSeatTop>=317);
    assert.ok(layout.sideSeatTop+175+12<=layout.sideTop+.01);
    assert.ok(layout.west+layout.maxFanWidth/2+12<=width/2-layout.maxFanWidth/2+.01);
    assert.ok(layout.sideTop+layout.pileHeight+12<=layout.handTop+.01);
  }
});
test('reducing card or control size can shrink the table again without retained layout state',()=>{
  const original=tableLayout(base),large=tableLayout({...base,handHeight:450,cardWidth:138});
  assert.ok(large.height>original.height);
  assert.deepEqual(tableLayout(base),original);
});
test('wide multi-card fans tighten their overlap without resizing individual faces',()=>{
  for(const count of [2,3,4]){
    const overlap=fanOverlap(134,count,250);
    assert.ok(count*134-(count-1)*overlap<=250+.01);
    assert.ok(overlap>=134*.25);
    assert.ok(134-overlap>=134*.25,'the left rank/suit index remains exposed');
  }
});

test('old flight DOM is inert after a restart clears the live deal clock',()=>{
  const game={dealing:'continuous',phase:'dealing',drawSeat:1},clock={lastDrawAt:1000};
  assert.equal(hasLiveDealFlight(game,clock,1100),true);
  assert.equal(hasLiveDealFlight(game,null,1100),false);
  assert.equal(hasLiveDealFlight(null,clock,1100),false);
  assert.equal(hasLiveDealFlight({...game,phase:'bury'},clock,1100),false);
  assert.equal(hasLiveDealFlight({...game,dealing:'ordered'},clock,1100),false);
  assert.equal(hasLiveDealFlight({...game,drawSeat:null},clock,1100),false);
  assert.equal(hasLiveDealFlight(game,clock,1400),false);
});


test('scene camera contains large-card scenes across viewport resolutions',()=>{
  for(const width of [374,544,768,992,1248,1888])for(const height of [568,688,868,1048]){
    const scale=initialSceneScale(width,height,1440),sceneWidth=width/scale;
    assert.ok(sceneWidth>=1440-0.01);
    const layout=tableLayout({...base,width:sceneWidth,height:height/scale,handHeight:410,cardWidth:138});
    const fit=fitScene(width,height,sceneWidth,layout.height);
    assert.ok(fit.left>=-0.01&&fit.top>=-0.01);
    assert.ok(fit.left+sceneWidth*fit.scale<=width+0.01);
    assert.ok(fit.top+layout.height*fit.scale<=height+0.01);
  }
});
