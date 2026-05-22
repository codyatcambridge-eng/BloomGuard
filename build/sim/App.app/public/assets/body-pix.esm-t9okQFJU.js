import{t as O,s as U,i as X,r as ht,p as De,a as Ce,T as We,c as K,g as pt,b as J,e as se,d as ze,m as Ve,f as de,h as ye,j as Se,k as we,l as vt,n as mt,o as wt,q as qe,u as gt,v as Ue,w as Ke,x as Qe,y as yt,z as St,A as bt,B as Ge}from"./index-kgUNtapN.js";/**
 * @license
 * Copyright 2023 Google LLC.
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 * =============================================================================
 *//*! *****************************************************************************
Copyright (c) Microsoft Corporation.

Permission to use, copy, modify, and/or distribute this software for any
purpose with or without fee is hereby granted.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES WITH
REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF MERCHANTABILITY
AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY SPECIAL, DIRECT,
INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES WHATSOEVER RESULTING FROM
LOSS OF USE, DATA OR PROFITS, WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR
OTHER TORTIOUS ACTION, ARISING OUT OF OR IN CONNECTION WITH THE USE OR
PERFORMANCE OF THIS SOFTWARE.
***************************************************************************** */var ge=function(e,r){return ge=Object.setPrototypeOf||{__proto__:[]}instanceof Array&&function(t,n){t.__proto__=n}||function(t,n){for(var i in n)n.hasOwnProperty(i)&&(t[i]=n[i])},ge(e,r)};function Ye(e,r){ge(e,r);function t(){this.constructor=e}e.prototype=r===null?Object.create(r):(t.prototype=r.prototype,new t)}var B=function(){return B=Object.assign||function(r){for(var t,n=1,i=arguments.length;n<i;n++){t=arguments[n];for(var a in t)Object.prototype.hasOwnProperty.call(t,a)&&(r[a]=t[a])}return r},B.apply(this,arguments)};function A(e,r,t,n){function i(a){return a instanceof t?a:new t(function(s){s(a)})}return new(t||(t=Promise))(function(a,s){function d(u){try{o(n.next(u))}catch(l){s(l)}}function f(u){try{o(n.throw(u))}catch(l){s(l)}}function o(u){u.done?a(u.value):i(u.value).then(d,f)}o((n=n.apply(e,[])).next())})}function H(e,r){var t={label:0,sent:function(){if(a[0]&1)throw a[1];return a[1]},trys:[],ops:[]},n,i,a,s;return s={next:d(0),throw:d(1),return:d(2)},typeof Symbol=="function"&&(s[Symbol.iterator]=function(){return this}),s;function d(o){return function(u){return f([o,u])}}function f(o){if(n)throw new TypeError("Generator is already executing.");for(;t;)try{if(n=1,i&&(a=o[0]&2?i.return:o[0]?i.throw||((a=i.return)&&a.call(i),0):i.next)&&!(a=a.call(i,o[1])).done)return a;switch(i=0,a&&(o=[o[0]&2,a.value]),o[0]){case 0:case 1:a=o;break;case 4:return t.label++,{value:o[1],done:!1};case 5:t.label++,i=o[1],o=[0];continue;case 7:o=t.ops.pop(),t.trys.pop();continue;default:if(a=t.trys,!(a=a.length>0&&a[a.length-1])&&(o[0]===6||o[0]===2)){t=0;continue}if(o[0]===3&&(!a||o[1]>a[0]&&o[1]<a[3])){t.label=o[1];break}if(o[0]===6&&t.label<a[1]){t.label=a[1],a=o;break}if(a&&t.label<a[2]){t.label=a[2],t.ops.push(o);break}a[2]&&t.ops.pop(),t.trys.pop();continue}o=r.call(e,t)}catch(u){o=[6,u],i=0}finally{n=a=0}if(o[0]&5)throw o[1];return{value:o[0]?o[1]:void 0,done:!0}}}/**
 * @license
 * Copyright 2019 Google LLC. All Rights Reserved.
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 * =============================================================================
 */function Xe(e){var r=e.shape[2],t=mt(e,2),n=de(t,[-1]);return wt(n,r)}function Mt(e,r){return qe(e,r)}function Z(e,r){return O(function(){return K(pt(e,J(r)),"int32")})}function _t(e,r){var t=r.shape,n=t[0],i=t[1],a=t[2];return O(function(){var s=Xe(r),d=se(ze(0,a,1,"int32"),1),f=K(Ve(s,d),"int32"),o=de(f,[n,i]),u=ye(o,J(1,"int32"));return Se(Mt(u,e),J(1,"int32"))})}function Et(e){var r=e.shape,t=r[0],n=r[1],i=r[2];return O(function(){var a=Xe(e),s=se(ze(0,i,1,"int32"),1),d=K(Ve(a,s),"int32");return de(d,[t,n])})}/**
 * @license
 * Copyright 2019 Google Inc. All Rights Reserved.
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 * =============================================================================
 */var Je=function(){function e(r,t){this.model=r,this.outputStride=t;var n=this.model.inputs[0].shape;we(n[1]===-1&&n[2]===-1,function(){return"Input shape [".concat(n[1],", ").concat(n[2],"] ")+"must both be equal to or -1"})}return e.prototype.predict=function(r){var t=this;return O(function(){var n=t.preprocessInput(K(r,"float32")),i=se(n,0),a=t.model.predict(i),s=a.map(function(f){return U(f,[0])}),d=t.nameOutputResults(s);return{heatmapScores:Ce(d.heatmap),offsets:d.offsets,displacementFwd:d.displacementFwd,displacementBwd:d.displacementBwd,segmentation:d.segmentation,partHeatmaps:d.partHeatmaps,longOffsets:d.longOffsets,partOffsets:d.partOffsets}})},e.prototype.dispose=function(){this.model.dispose()},e}();/**
 * @license
 * Copyright 2019 Google Inc. All Rights Reserved.
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 * =============================================================================
 */var xt=function(e){Ye(r,e);function r(){return e!==null&&e.apply(this,arguments)||this}return r.prototype.preprocessInput=function(t){return O(function(){return Se(gt(t,127.5),1)})},r.prototype.nameOutputResults=function(t){var n=t[0],i=t[1],a=t[2],s=t[3],d=t[4],f=t[5],o=t[6],u=t[7];return{offsets:n,segmentation:i,partHeatmaps:a,longOffsets:s,heatmap:d,displacementFwd:f,displacementBwd:o,partOffsets:u}},r}(Je);/**
 * @license
 * Copyright 2019 Google LLC. All Rights Reserved.
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 * =============================================================================
 */var fe=["nose","leftEye","rightEye","leftEar","rightEar","leftShoulder","rightShoulder","leftElbow","rightElbow","leftWrist","rightWrist","leftHip","rightHip","leftKnee","rightKnee","leftAnkle","rightAnkle"],P=fe.length,ie=fe.reduce(function(e,r,t){return e[r]=t,e},{}),Rt=[["leftHip","leftShoulder"],["leftElbow","leftShoulder"],["leftElbow","leftWrist"],["leftHip","leftKnee"],["leftKnee","leftAnkle"],["rightHip","rightShoulder"],["rightElbow","rightShoulder"],["rightElbow","rightWrist"],["rightHip","rightKnee"],["rightKnee","rightAnkle"],["leftShoulder","rightShoulder"],["leftHip","rightHip"]],Tt=[["nose","leftEye"],["leftEye","leftEar"],["nose","rightEye"],["rightEye","rightEar"],["nose","leftShoulder"],["leftShoulder","leftElbow"],["leftElbow","leftWrist"],["leftShoulder","leftHip"],["leftHip","leftKnee"],["leftKnee","leftAnkle"],["nose","rightShoulder"],["rightShoulder","rightElbow"],["rightElbow","rightWrist"],["rightShoulder","rightHip"],["rightHip","rightKnee"],["rightKnee","rightAnkle"]];Rt.map(function(e){var r=e[0],t=e[1];return[ie[r],ie[t]]});/**
 * @license
 * Copyright 2019 Google LLC. All Rights Reserved.
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 * =============================================================================
 */function be(e,r,t){var n=e[0],i=e[1],a=r[0],s=r[1],d=t.top,f=t.bottom,o=t.left,u=t.right,l=a/(d+f+n),c=s/(o+u+i);return[c,l]}function Ze(e,r,t,n){return{y:n.get(e,r,t),x:n.get(e,r,t+P)}}function $e(e,r,t){var n=e.heatmapY,i=e.heatmapX,a=e.id,s=Ze(n,i,a,t),d=s.y,f=s.x;return{x:e.heatmapX*r+f,y:e.heatmapY*r+d}}function _e(e,r,t){return e<r?r:e>t?t:e}function Ot(e,r,t,n){var i=t-e,a=n-r;return i*i+a*a}function Ee(e,r){return{x:e.x+r.x,y:e.y+r.y}}/**
 * @license
 * Copyright 2019 Google Inc. All Rights Reserved.
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 * =============================================================================
 */function Pt(e,r,t){t===void 0&&(t=.3);for(var n=0,i=0,a=0;a<e.length;a++)r.keypoints[a].score>t&&(i+=1,n+=Math.pow(e[a].x-r.keypoints[a].position.x,2)+Math.pow(e[a].y-r.keypoints[a].position.y,2));return i===0?n=1/0:n=n/i,n}function It(e,r,t,n){var i=r[0],a=r[1],s=t[0],d=t[1],f=Math.round(((i+e.y+1)*d-1)/n),o=Math.round(((a+e.x+1)*s-1)/n);return{x:o,y:f}}function Bt(e,r,t,n,i,a,s){for(var d=s[0],f=s[1],o=t(e),u=o.y*n+o.x,l=i[P*(2*u)+r],c=i[P*(2*u+1)+r],p=e.y+l,v=e.x+c,h=0;h<a;h++){p=Math.min(p,d-1),v=Math.min(v,f-1);var w=t({x:v,y:p}),b=w.y*n+w.x;l=i[P*(2*b)+r],c=i[P*(2*b+1)+r],p=p+l,v=v+c}return{x:v,y:p}}function je(e,r,t,n,i,a,s,d,f,o){for(var u=i[0],l=i[1],c=a[0],p=a[1],v=d[0],h=d[1],w=[],b=function(E){return It(E,[u,l],[c,p],f)},g=0;g<n;g++){var S=Bt(e,g,b,s,r,o,[v,h]);w.push(S)}for(var m=-1,y=1/0,M=0;M<t.length;M++){var _=Pt(w,t[M]);_<y&&(m=M,y=_)}return m}function et(e,r){var t=e[0],n=e[1],i=Math.round((n-1)/r+1),a=Math.round((t-1)/r+1);return[i,a]}function At(e,r,t,n,i,a,s,d,f,o){var u=s[0],l=s[1];o===void 0&&(o=5);for(var c=t.map(function(E){return new Uint8Array(n*i).fill(0)}),p=d.top,v=d.left,h=be([n,i],[u,l],d),w=h[0],b=h[1],g=et([u,l],a)[0],S=0;S<n;S+=1)for(var m=0;m<i;m+=1){var y=S*i+m,M=e[y];if(M===1){var _=je({x:m,y:S},r,t,o,[p,v],[w,b],g,[n,i],a,f);_>=0&&(c[_][y]=1)}}return c}function Ht(e,r,t,n,i,a,s,d,f,o,u){var l=d[0],c=d[1];u===void 0&&(u=5);for(var p=n.map(function(R){return new Int32Array(i*a).fill(-1)}),v=f.top,h=f.left,w=be([i,a],[l,c],f),b=w[0],g=w[1],S=et([l,c],s)[0],m=0;m<i;m+=1)for(var y=0;y<a;y+=1){var M=m*a+y,_=e[M];if(_===1){var E=je({x:y,y:m},r,n,u,[v,h],[b,g],S,[i,a],s,o);E>=0&&(p[E][M]=t[M])}}return p}/**
 * @license
 * Copyright 2019 Google Inc. All Rights Reserved.
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 * =============================================================================
 */function tt(e,r,t,n,i,a,s,d,f,o,u){for(var l=s[0],c=s[1],p=e.shape,v=p[0],h=p[1],w=r.shape.slice(0,2),b=w[0],g=w[1],S=de(r,[b,g,2,P]),m=new Float32Array(u*P*3).fill(0),y=0;y<t.length;y++)for(var M=y*P*3,_=t[y],E=0;E<P;E++){var R=_.keypoints[E],x=M+E*3;m[x]=R.score,m[x+1]=R.position.y,m[x+2]=R.position.x}var T=be([n,i],[l,c],d),L=T[0],N=T[1],k=St(m,[u,P,3]),D=d.top,C=d.left,G={variableNames:["segmentation","longOffsets","poses"],outputShape:[v,h],userCode:`
    int convertToPositionInOutput(int pos, int pad, float scale, int stride) {
      return round(((float(pos + pad) + 1.0) * scale - 1.0) / float(stride));
    }

    float convertToPositionInOutputFloat(
        int pos, int pad, float scale, int stride) {
      return ((float(pos + pad) + 1.0) * scale - 1.0) / float(stride);
    }

    float dist(float x1, float y1, float x2, float y2) {
      return pow(x1 - x2, 2.0) + pow(y1 - y2, 2.0);
    }

    float sampleLongOffsets(float h, float w, int d, int k) {
      float fh = fract(h);
      float fw = fract(w);
      int clH = int(ceil(h));
      int clW = int(ceil(w));
      int flH = int(floor(h));
      int flW = int(floor(w));
      float o11 = getLongOffsets(flH, flW, d, k);
      float o12 = getLongOffsets(flH, clW, d, k);
      float o21 = getLongOffsets(clH, flW, d, k);
      float o22 = getLongOffsets(clH, clW, d, k);
      float o1 = mix(o11, o12, fw);
      float o2 = mix(o21, o22, fw);
      return mix(o1, o2, fh);
    }

    int findNearestPose(int h, int w) {
      float prob = getSegmentation(h, w);
      if (prob < 1.0) {
        return -1;
      }

      // Done(Tyler): convert from output space h/w to strided space.
      float stridedH = convertToPositionInOutputFloat(
        h, `.concat(D,", ").concat(N,", ").concat(a,`);
      float stridedW = convertToPositionInOutputFloat(
        w, `).concat(C,", ").concat(L,", ").concat(a,`);

      float minDist = 1000000.0;
      int iMin = -1;
      for (int i = 0; i < `).concat(u,`; i++) {
        float curDistSum = 0.0;
        int numKpt = 0;
        for (int k = 0; k < `).concat(P,`; k++) {
          float dy = sampleLongOffsets(stridedH, stridedW, 0, k);
          float dx = sampleLongOffsets(stridedH, stridedW, 1, k);

          float y = float(h) + dy;
          float x = float(w) + dx;

          for (int s = 0; s < `).concat(f,`; s++) {
            int yRounded = round(min(y, float(`).concat(n-1,`)));
            int xRounded = round(min(x, float(`).concat(i-1,`)));

            float yStrided = convertToPositionInOutputFloat(
              yRounded, `).concat(D,", ").concat(N,", ").concat(a,`);
            float xStrided = convertToPositionInOutputFloat(
              xRounded, `).concat(C,", ").concat(L,", ").concat(a,`);

            float dy = sampleLongOffsets(yStrided, xStrided, 0, k);
            float dx = sampleLongOffsets(yStrided, xStrided, 1, k);

            y = y + dy;
            x = x + dx;
          }

          float poseScore = getPoses(i, k, 0);
          float poseY = getPoses(i, k, 1);
          float poseX = getPoses(i, k, 2);
          if (poseScore > `).concat(o,`) {
            numKpt = numKpt + 1;
            curDistSum = curDistSum + dist(x, y, poseX, poseY);
          }
        }
        if (numKpt > 0 && curDistSum / float(numKpt) < minDist) {
          minDist = curDistSum / float(numKpt);
          iMin = i;
        }
      }
      return iMin;
    }

    void main() {
        ivec2 coords = getOutputCoords();
        int nearestPose = findNearestPose(coords[0], coords[1]);
        setOutput(float(nearestPose));
      }
  `)},W=bt();return W.compileAndRun(G,[e,S,k])}/**
 * @license
 * Copyright 2019 Google Inc. All Rights Reserved.
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 * =============================================================================
 */function Ft(e,r){return O(function(){return K(Ge(e,J(r)),"int32")})}function Lt(e,r,t){return O(function(){return Se(qe(K(Ge(e,J(t)),"int32"),ye(r,1)),1)})}function rt(){return yt()==="webgl"}function Nt(e,r,t,n,i,a,s,d,f,o,u,l){var c=s[0],p=s[1];return f===void 0&&(f=.2),o===void 0&&(o=8),u===void 0&&(u=.3),l===void 0&&(l=10),A(this,void 0,void 0,function(){var v,h,w,b,g;return H(this,function(S){switch(S.label){case 0:return v=t.filter(function(m){return m.score>=f}),rt()?(w=O(function(){var m=tt(e,r,v,n,i,a,[c,p],d,o,u,l),y=Ue().makeTensorFromDataId(m.dataId,m.shape,m.dtype);return v.map(function(M,_){return Ft(y,_)})}),[4,Promise.all(w.map(function(m){return m.data()}))]):[3,2];case 1:return h=S.sent(),w.forEach(function(m){return m.dispose()}),[3,5];case 2:return[4,e.data()];case 3:return b=S.sent(),[4,r.data()];case 4:g=S.sent(),h=At(b,g,v,n,i,a,[c,p],d,o),S.label=5;case 5:return[2,h.map(function(m,y){return{data:m,pose:v[y],width:i,height:n}})]}})})}function kt(e,r,t,n,i,a,s,d,f,o,u,l,c){var p=d[0],v=d[1];return o===void 0&&(o=.2),u===void 0&&(u=8),l===void 0&&(l=.3),c===void 0&&(c=10),A(this,void 0,void 0,function(){var h,w,b,g,S,m;return H(this,function(y){switch(y.label){case 0:return h=n.filter(function(M){return M.score>=o}),rt()?(b=O(function(){var M=tt(e,r,h,i,a,s,[p,v],f,u,l,c),_=Ue().makeTensorFromDataId(M.dataId,M.shape,M.dtype);return h.map(function(E,R){return Lt(_,t,R)})}),[4,Promise.all(b.map(function(M){return M.data()}))]):[3,2];case 1:return w=y.sent(),b.forEach(function(M){return M.dispose()}),[3,6];case 2:return[4,e.data()];case 3:return g=y.sent(),[4,r.data()];case 4:return S=y.sent(),[4,t.data()];case 5:m=y.sent(),w=Ht(g,S,m,h,i,a,s,[p,v],f,u),y.label=6;case 6:return[2,w.map(function(M,_){return{pose:h[_],data:M,height:i,width:a}})]}})})}/**
 * @license
 * Copyright 2019 Google Inc. All Rights Reserved.
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 * =============================================================================
 */function he(e){return Math.floor(e/2)}var Dt=function(){function e(r,t){this.priorityQueue=new Array(r),this.numberOfElements=-1,this.getElementValue=t}return e.prototype.enqueue=function(r){this.priorityQueue[++this.numberOfElements]=r,this.swim(this.numberOfElements)},e.prototype.dequeue=function(){var r=this.priorityQueue[0];return this.exchange(0,this.numberOfElements--),this.sink(0),this.priorityQueue[this.numberOfElements+1]=null,r},e.prototype.empty=function(){return this.numberOfElements===-1},e.prototype.size=function(){return this.numberOfElements+1},e.prototype.all=function(){return this.priorityQueue.slice(0,this.numberOfElements+1)},e.prototype.max=function(){return this.priorityQueue[0]},e.prototype.swim=function(r){for(;r>0&&this.less(he(r),r);)this.exchange(r,he(r)),r=he(r)},e.prototype.sink=function(r){for(;2*r<=this.numberOfElements;){var t=2*r;if(t<this.numberOfElements&&this.less(t,t+1)&&t++,!this.less(r,t))break;this.exchange(r,t),r=t}},e.prototype.getValueAt=function(r){return this.getElementValue(this.priorityQueue[r])},e.prototype.less=function(r,t){return this.getValueAt(r)<this.getValueAt(t)},e.prototype.exchange=function(r,t){var n=this.priorityQueue[r];this.priorityQueue[r]=this.priorityQueue[t],this.priorityQueue[t]=n},e}();/**
 * @license
 * Copyright 2019 Google LLC. All Rights Reserved.
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 * =============================================================================
 */function Ct(e,r,t,n,i,a){for(var s=a.shape,d=s[0],f=s[1],o=!0,u=Math.max(t-i,0),l=Math.min(t+i+1,d),c=u;c<l;++c){for(var p=Math.max(n-i,0),v=Math.min(n+i+1,f),h=p;h<v;++h)if(a.get(c,h,e)>r){o=!1;break}if(!o)break}return o}function Wt(e,r,t){for(var n=t.shape,i=n[0],a=n[1],s=n[2],d=new Dt(i*a*s,function(c){var p=c.score;return p}),f=0;f<i;++f)for(var o=0;o<a;++o)for(var u=0;u<s;++u){var l=t.get(f,o,u);l<e||Ct(u,l,f,o,r,t)&&d.enqueue({score:l,part:{heatmapY:f,heatmapX:o,id:u}})}return d}/**
 * @license
 * Copyright 2019 Google LLC. All Rights Reserved.
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 * =============================================================================
 */var nt=Tt.map(function(e){var r=e[0],t=e[1];return[ie[r],ie[t]]}),pe=nt.map(function(e){var r=e[1];return r}),xe=nt.map(function(e){var r=e[0];return r});function zt(e,r,t){var n=t.shape[2]/2;return{y:t.get(r.y,r.x,e),x:t.get(r.y,r.x,n+e)}}function ve(e,r,t,n){return{y:_e(Math.round(e.y/r),0,t-1),x:_e(Math.round(e.x/r),0,n-1)}}function Re(e,r,t,n,i,a,s,d){d===void 0&&(d=2);for(var f=n.shape,o=f[0],u=f[1],l=ve(r.position,a,o,u),c=zt(e,l,s),p=Ee(r.position,c),v=p,h=0;h<d;h++){var w=ve(v,a,o,u),b=Ze(w.y,w.x,t,i);v=Ee({x:w.x*a,y:w.y*a},{x:b.x,y:b.y})}var g=ve(v,a,o,u),S=n.get(g.y,g.x,t);return{position:v,part:fe[t],score:S}}function Vt(e,r,t,n,i,a){var s=r.shape[2],d=pe.length,f=new Array(s),o=e.part,u=e.score,l=$e(o,n,t);f[o.id]={score:u,part:fe[o.id],position:l};for(var c=d-1;c>=0;--c){var p=pe[c],v=xe[c];f[p]&&!f[v]&&(f[v]=Re(c,f[p],v,r,t,n,a))}for(var c=0;c<d;++c){var p=xe[c],v=pe[c];f[p]&&!f[v]&&(f[v]=Re(c,f[p],v,r,t,n,i))}return f}/**
 * @license
 * Copyright 2019 Google Inc. All Rights Reserved.
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 * =============================================================================
 */function at(e,r,t,n){var i=t.x,a=t.y;return e.some(function(s){var d=s.keypoints,f=d[n].position;return Ot(a,i,f.y,f.x)<=r})}function qt(e,r,t){var n=t.reduce(function(i,a,s){var d=a.position,f=a.score;return at(e,r,d,s)||(i+=f),i},0);return n/=t.length}var Ut=1;function $(e,r,t,n,i,a,s,d){s===void 0&&(s=.5),d===void 0&&(d=20);for(var f=[],o=Wt(s,Ut,e),u=d*d;f.length<a&&!o.empty();){var l=o.dequeue(),c=$e(l.part,i,r);if(!at(f,u,c,l.part.id)){var p=Vt(l,e,r,i,t,n),v=qt(f,u,p);f.push({keypoints:p,score:v})}}return f}/**
 * @license
 * Copyright 2019 Google Inc. All Rights Reserved.
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * https://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 * =============================================================================
 */var Kt=[-123.15,-115.9,-103.06],Qt=function(e){Ye(r,e);function r(){return e!==null&&e.apply(this,arguments)||this}return r.prototype.preprocessInput=function(t){return ye(t,Kt)},r.prototype.nameOutputResults=function(t){var n=t[0],i=t[1],a=t[2],s=t[3],d=t[4],f=t[5],o=t[6],u=t[7];return{offsets:d,segmentation:o,partHeatmaps:f,longOffsets:s,heatmap:a,displacementFwd:i,displacementBwd:n,partOffsets:u}},r}(Je);/**
 * @license
 * Copyright 2019 Google Inc. All Rights Reserved.
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * https://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 * =============================================================================
 */var Te="https://storage.googleapis.com/tfjs-models/savedmodel/bodypix/resnet50/",Oe="https://storage.googleapis.com/tfjs-models/savedmodel/bodypix/mobilenet/";function Gt(e,r){var t="model-stride".concat(e,".json");return r===4?Te+"float/"+t:Te+"quant".concat(r,"/")+t}function Yt(e,r,t){var n={1:"100",.75:"075",.5:"050"},i="model-stride".concat(e,".json");return t===4?Oe+"float/".concat(n[r],"/")+i:Oe+"quant".concat(t,"/").concat(n[r],"/")+i}/**
 * @license
 * Copyright 2020 Google Inc. All Rights Reserved.
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 *
 * =============================================================================
 */var z;function Xt(e){if("offsetHeight"in e&&e.offsetHeight!==0&&"offsetWidth"in e&&e.offsetWidth!==0)return[e.offsetHeight,e.offsetWidth];if(e.height!=null&&e.width!=null)return[e.height,e.width];throw new Error("HTMLImageElement must have height and width attributes set.")}function Jt(e){return e.hasAttribute("height")&&e.hasAttribute("width")?[e.height,e.width]:[e.videoHeight,e.videoWidth]}function F(e){if(typeof HTMLCanvasElement<"u"&&e instanceof HTMLCanvasElement||typeof OffscreenCanvas<"u"&&e instanceof OffscreenCanvas||typeof HTMLImageElement<"u"&&e instanceof HTMLImageElement)return Xt(e);if(typeof ImageData<"u"&&e instanceof ImageData)return[e.height,e.width];if(typeof HTMLVideoElement<"u"&&e instanceof HTMLVideoElement)return Jt(e);if(e instanceof We)return[e.shape[0],e.shape[1]];throw new Error("error: Unknown input type: ".concat(e,"."))}function Zt(e,r){return(e-1)%r===0}function Pe(e,r){return Zt(e,r)?e:Math.floor(e/r)*r+1}var Y={low:"low",medium:"medium",high:"high",full:"full"},$t=(z={},z[Y.low]=.25,z[Y.medium]=.5,z[Y.high]=.75,z[Y.full]=1,z),Ie=.1,Be=2;function jt(e){if(typeof e=="string"){var r=$t[e];return we(typeof r=="number",function(){return"string value of inputResolution must be one of ".concat(Object.values(Y).join(",")," but was ").concat(e,".")}),r}else return we(typeof e=="number"&&e<=Be&&e>=Ie,function(){return"inputResolution must be a string or number between ".concat(Ie," and ").concat(Be,", but ")+"was ".concat(e)}),e}function j(e,r,t){var n=t[0],i=t[1],a=jt(e);return[Pe(n*a,r),Pe(i*a,r)]}function er(e){return e instanceof We?e:vt(e)}function wr(e,r,t){var n=r[0],i=r[1];t===void 0&&(t=!1);var a=e.shape,s=a[0],d=a[1],f=i/n,o=d/s,u,l,c,p,v,h;if(o>f){u=i,l=Math.ceil(u/o);var w=n-l;c=0,p=0,v=Math.floor(w/2),h=n-(l+v)}else{l=n,u=Math.ceil(n*o);var b=i-u;c=Math.floor(b/2),p=i-(u+c),v=0,h=0}var g=O(function(){var S;t?S=X.resizeBilinear(ht(e,1),[l,u]):S=X.resizeBilinear(e,[l,u]);var m=De(S,[[v,h],[c,p],[0,0]]);return m});return{resizedAndPadded:g,paddedBy:[[v,h],[c,p]]}}function V(e,r,t,n,i){var a=r[0],s=r[1],d=t[0],f=t[1],o=n[0],u=o[0],l=o[1],c=n[1],p=c[0],v=c[1];return i===void 0&&(i=!1),O(function(){var h=X.resizeBilinear(e,[d,f],!0);return i&&(h=Ce(h)),tr(h,[a,s],[[u,l],[p,v]])})}function tr(e,r,t){var n=r[0],i=r[1],a=t[0],s=a[0],d=a[1],f=t[1],o=f[0],u=f[1];return O(function(){var l=se(e);return U(X.cropAndResize(l,[[s/(n+s+d-1),o/(i+o+u-1),(s+n-1)/(n+s+d-1),(o+i-1)/(i+o+u-1)]],[0],[n,i]),[0])})}function ee(e,r){var t=r[0],n=r[1],i=F(e),a=i[0],s=i[1],d=n/t,f=s/a,o=[0,0,0,0],u=o[0],l=o[1],c=o[2],p=o[3];f<d?(u=0,l=0,c=Math.round(.5*(d*a-s)),p=Math.round(.5*(d*a-s))):(u=Math.round(.5*(1/d*s-a)),l=Math.round(.5*(1/d*s-a)),c=0,p=0);var v=O(function(){var h=er(e);return h=De(h,[[u,l],[c,p],[0,0]]),X.resizeBilinear(h,[t,n])});return{resized:v,padding:{top:u,left:c,right:p,bottom:l}}}function te(e){return A(this,void 0,void 0,function(){return H(this,function(r){return[2,Promise.all(e.map(function(t){return t.buffer()}))]})})}function rr(e,r,t,n,i){return n===void 0&&(n=0),i===void 0&&(i=0),{score:e.score,keypoints:e.keypoints.map(function(a){var s=a.score,d=a.part,f=a.position;return{score:s,part:d,position:{x:f.x*t+i,y:f.y*r+n}}})}}function nr(e,r,t,n,i){return n===void 0&&(n=0),i===void 0&&(i=0),t===1&&r===1&&n===0&&i===0?e:e.map(function(a){return rr(a,r,t,n,i)})}function gr(e,r){return{score:e.score,keypoints:e.keypoints.map(function(t){var n=t.score,i=t.part,a=t.position;return{score:n,part:i,position:{x:r-1-a.x,y:a.y}}})}}function re(e,r,t,n,i){var a=r[0],s=r[1],d=t[0],f=t[1],o=(a+n.top+n.bottom)/d,u=(s+n.left+n.right)/f,l=nr(e,o,u,-n.top,-n.left);return l}/**
 * @license
 * Copyright 2019 Google Inc. All Rights Reserved.
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 * =============================================================================
 */var q=!0,it={architecture:"MobileNetV1",outputStride:16,quantBytes:4,multiplier:.75},Ae=["MobileNetV1","ResNet50"],He={MobileNetV1:[8,16,32],ResNet50:[32,16]},Fe={MobileNetV1:[.5,.75,1],ResNet50:[1]},Le=[1,2,4];function ar(e){if(e=e||it,e.architecture==null&&(e.architecture="MobileNetV1"),Ae.indexOf(e.architecture)<0)throw new Error("Invalid architecture ".concat(e.architecture,". ")+"Should be one of ".concat(Ae));if(e.outputStride==null&&(e.outputStride=16),He[e.architecture].indexOf(e.outputStride)<0)throw new Error("Invalid outputStride ".concat(e.outputStride,". ")+"Should be one of ".concat(He[e.architecture]," ")+"for architecture ".concat(e.architecture,"."));if(e.multiplier==null&&(e.multiplier=1),Fe[e.architecture].indexOf(e.multiplier)<0)throw new Error("Invalid multiplier ".concat(e.multiplier,". ")+"Should be one of ".concat(Fe[e.architecture]," ")+"for architecture ".concat(e.architecture,"."));if(e.quantBytes==null&&(e.quantBytes=4),Le.indexOf(e.quantBytes)<0)throw new Error("Invalid quantBytes ".concat(e.quantBytes,". ")+"Should be one of ".concat(Le," ")+"for architecture ".concat(e.architecture,"."));return e}var ne={flipHorizontal:!1,internalResolution:"medium",segmentationThreshold:.7,maxDetections:10,scoreThreshold:.4,nmsRadius:20},ae={flipHorizontal:!1,internalResolution:"medium",segmentationThreshold:.7,maxDetections:10,scoreThreshold:.4,nmsRadius:20,minKeypointScore:.3,refineSteps:10};function Ne(e){var r=e.segmentationThreshold,t=e.maxDetections,n=e.scoreThreshold,i=e.nmsRadius;if(r<0||r>1)throw new Error("segmentationThreshold ".concat(r,". ")+"Should be in range [0.0, 1.0]");if(t<=0)throw new Error("Invalid maxDetections ".concat(t,". ")+"Should be > 0");if(n<0||n>1)throw new Error("Invalid scoreThreshold ".concat(n,". ")+"Should be in range [0.0, 1.0]");if(i<=0)throw new Error("Invalid nmsRadius ".concat(i,"."))}function ke(e){var r=e.segmentationThreshold,t=e.maxDetections,n=e.scoreThreshold,i=e.nmsRadius,a=e.minKeypointScore,s=e.refineSteps;if(r<0||r>1)throw new Error("segmentationThreshold ".concat(r,". ")+"Should be in range [0.0, 1.0]");if(t<=0)throw new Error("Invalid maxDetections ".concat(t,". ")+"Should be > 0");if(n<0||n>1)throw new Error("Invalid scoreThreshold ".concat(n,". ")+"Should be in range [0.0, 1.0]");if(i<=0)throw new Error("Invalid nmsRadius ".concat(i,"."));if(a<0||a>1)throw new Error("Invalid minKeypointScore ".concat(a,".")+"Should be in range [0.0, 1.0]");if(s<=0||s>20)throw new Error("Invalid refineSteps ".concat(s,".")+"Should be in range [1, 20]")}var ot=function(){function e(r){this.baseModel=r}return e.prototype.predictForPersonSegmentation=function(r){var t=this.baseModel.predict(r),n=t.segmentation,i=t.heatmapScores,a=t.offsets,s=t.displacementFwd,d=t.displacementBwd;return{segmentLogits:n,heatmapScores:i,offsets:a,displacementFwd:s,displacementBwd:d}},e.prototype.predictForPersonSegmentationAndPart=function(r){var t=this.baseModel.predict(r),n=t.segmentation,i=t.partHeatmaps,a=t.heatmapScores,s=t.offsets,d=t.displacementFwd,f=t.displacementBwd;return{segmentLogits:n,partHeatmapLogits:i,heatmapScores:a,offsets:s,displacementFwd:d,displacementBwd:f}},e.prototype.predictForMultiPersonInstanceSegmentationAndPart=function(r){var t=this.baseModel.predict(r),n=t.segmentation,i=t.longOffsets,a=t.heatmapScores,s=t.offsets,d=t.displacementFwd,f=t.displacementBwd,o=t.partHeatmaps;return{segmentLogits:n,longOffsets:i,heatmapScores:a,offsets:s,displacementFwd:d,displacementBwd:f,partHeatmaps:o}},e.prototype.segmentPersonActivation=function(r,t,n){var i=this;n===void 0&&(n=.5);var a=F(r),s=a[0],d=a[1],f=j(t,this.baseModel.outputStride,[s,d]),o=ee(r,f),u=o.resized,l=o.padding,c=O(function(){var g=i.predictForPersonSegmentation(u),S=g.segmentLogits,m=g.heatmapScores,y=g.offsets,M=g.displacementFwd,_=g.displacementBwd,E=u.shape,R=E[0],x=E[1],T=V(S,[s,d],[R,x],[[l.top,l.bottom],[l.left,l.right]],q);return{segmentation:Z(U(T),n),heatmapScores:m,offsets:y,displacementFwd:M,displacementBwd:_}}),p=c.segmentation,v=c.heatmapScores,h=c.offsets,w=c.displacementFwd,b=c.displacementBwd;return u.dispose(),{segmentation:p,heatmapScores:v,offsets:h,displacementFwd:w,displacementBwd:b,padding:l,internalResolutionHeightAndWidth:f}},e.prototype.segmentPerson=function(r,t){return t===void 0&&(t=ne),A(this,void 0,void 0,function(){var n,i,a,s,d,f,o,u,l,c,p,v,h,w,b,g,S,m;return H(this,function(y){switch(y.label){case 0:return t=B(B({},ne),t),Ne(t),n=this.segmentPersonActivation(r,t.internalResolution,t.segmentationThreshold),i=n.segmentation,a=n.heatmapScores,s=n.offsets,d=n.displacementFwd,f=n.displacementBwd,o=n.padding,u=n.internalResolutionHeightAndWidth,l=i.shape,c=l[0],p=l[1],[4,i.data()];case 1:return v=y.sent(),i.dispose(),[4,te([a,s,d,f])];case 2:return h=y.sent(),w=h[0],b=h[1],g=h[2],S=h[3],m=$(w,b,g,S,this.baseModel.outputStride,t.maxDetections,t.scoreThreshold,t.nmsRadius),m=re(m,[c,p],u,o),a.dispose(),s.dispose(),d.dispose(),f.dispose(),[2,{height:c,width:p,data:v,allPoses:m}]}})})},e.prototype.segmentMultiPerson=function(r,t){return t===void 0&&(t=ae),A(this,void 0,void 0,function(){var n,i,a,s,d,f,o,u,l,c,p,v,h,w,b,g,S,m,y,M,_,E=this;return H(this,function(R){switch(R.label){case 0:return t=B(B({},ae),t),ke(t),n=F(r),i=n[0],a=n[1],s=j(t.internalResolution,this.baseModel.outputStride,[i,a]),d=ee(r,s),f=d.resized,o=d.padding,u=O(function(){var x=E.predictForMultiPersonInstanceSegmentationAndPart(f),T=x.segmentLogits,L=x.longOffsets,N=x.heatmapScores,k=x.offsets,D=x.displacementFwd,C=x.displacementBwd,G=V(T,[i,a],s,[[o.top,o.bottom],[o.left,o.right]],q),W;W=L;var ce=Z(U(G),t.segmentationThreshold);return{segmentation:ce,longOffsets:W,heatmapScoresRaw:N,offsetsRaw:k,displacementFwdRaw:D,displacementBwdRaw:C}}),l=u.segmentation,c=u.longOffsets,p=u.heatmapScoresRaw,v=u.offsetsRaw,h=u.displacementFwdRaw,w=u.displacementBwdRaw,[4,te([p,v,h,w])];case 1:return b=R.sent(),g=b[0],S=b[1],m=b[2],y=b[3],M=$(g,S,m,y,this.baseModel.outputStride,t.maxDetections,t.scoreThreshold,t.nmsRadius),M=re(M,[i,a],s,o),[4,Nt(l,c,M,i,a,this.baseModel.outputStride,s,o,t.scoreThreshold,t.refineSteps,t.minKeypointScore,t.maxDetections)];case 2:return _=R.sent(),f.dispose(),l.dispose(),c.dispose(),p.dispose(),v.dispose(),h.dispose(),w.dispose(),[2,_]}})})},e.prototype.segmentPersonPartsActivation=function(r,t,n){var i=this;n===void 0&&(n=.5);var a=F(r),s=a[0],d=a[1],f=j(t,this.baseModel.outputStride,[s,d]),o=ee(r,f),u=o.resized,l=o.padding,c=O(function(){var g=i.predictForPersonSegmentationAndPart(u),S=g.segmentLogits,m=g.partHeatmapLogits,y=g.heatmapScores,M=g.offsets,_=g.displacementFwd,E=g.displacementBwd,R=u.shape,x=R[0],T=R[1],L=V(S,[s,d],[x,T],[[l.top,l.bottom],[l.left,l.right]],q),N=V(m,[s,d],[x,T],[[l.top,l.bottom],[l.left,l.right]],q),k=Z(U(L),n);return{partSegmentation:_t(k,N),heatmapScores:y,offsets:M,displacementFwd:_,displacementBwd:E}}),p=c.partSegmentation,v=c.heatmapScores,h=c.offsets,w=c.displacementFwd,b=c.displacementBwd;return u.dispose(),{partSegmentation:p,heatmapScores:v,offsets:h,displacementFwd:w,displacementBwd:b,padding:l,internalResolutionHeightAndWidth:f}},e.prototype.segmentPersonParts=function(r,t){return t===void 0&&(t=ne),A(this,void 0,void 0,function(){var n,i,a,s,d,f,o,u,l,c,p,v,h,w,b,g,S,m;return H(this,function(y){switch(y.label){case 0:return t=B(B({},ne),t),Ne(t),n=this.segmentPersonPartsActivation(r,t.internalResolution,t.segmentationThreshold),i=n.partSegmentation,a=n.heatmapScores,s=n.offsets,d=n.displacementFwd,f=n.displacementBwd,o=n.padding,u=n.internalResolutionHeightAndWidth,l=i.shape,c=l[0],p=l[1],[4,i.data()];case 1:return v=y.sent(),i.dispose(),[4,te([a,s,d,f])];case 2:return h=y.sent(),w=h[0],b=h[1],g=h[2],S=h[3],m=$(w,b,g,S,this.baseModel.outputStride,t.maxDetections,t.scoreThreshold,t.nmsRadius),m=re(m,[c,p],u,o),a.dispose(),s.dispose(),d.dispose(),f.dispose(),[2,{height:c,width:p,data:v,allPoses:m}]}})})},e.prototype.segmentMultiPersonParts=function(r,t){return t===void 0&&(t=ae),A(this,void 0,void 0,function(){var n,i,a,s,d,f,o,u,l,c,p,v,h,w,b,g,S,m,y,M,_,E,R=this;return H(this,function(x){switch(x.label){case 0:return t=B(B({},ae),t),ke(t),n=F(r),i=n[0],a=n[1],s=j(t.internalResolution,this.baseModel.outputStride,[i,a]),d=ee(r,s),f=d.resized,o=d.padding,u=O(function(){var T=R.predictForMultiPersonInstanceSegmentationAndPart(f),L=T.segmentLogits,N=T.longOffsets,k=T.heatmapScores,D=T.offsets,C=T.displacementFwd,G=T.displacementBwd,W=T.partHeatmaps,ce=V(L,[i,a],s,[[o.top,o.bottom],[o.left,o.right]],q),ft=V(W,[i,a],s,[[o.top,o.bottom],[o.left,o.right]],q),ut=N,lt=Z(U(ce),t.segmentationThreshold),ct=Et(ft);return{segmentation:lt,longOffsets:ut,heatmapScoresRaw:k,offsetsRaw:D,displacementFwdRaw:C,displacementBwdRaw:G,partSegmentation:ct}}),l=u.segmentation,c=u.longOffsets,p=u.heatmapScoresRaw,v=u.offsetsRaw,h=u.displacementFwdRaw,w=u.displacementBwdRaw,b=u.partSegmentation,[4,te([p,v,h,w])];case 1:return g=x.sent(),S=g[0],m=g[1],y=g[2],M=g[3],_=$(S,m,y,M,this.baseModel.outputStride,t.maxDetections,t.scoreThreshold,t.nmsRadius),_=re(_,[i,a],s,o),[4,kt(l,c,b,_,i,a,this.baseModel.outputStride,s,o,t.scoreThreshold,t.refineSteps,t.minKeypointScore,t.maxDetections)];case 2:return E=x.sent(),f.dispose(),l.dispose(),c.dispose(),p.dispose(),v.dispose(),h.dispose(),w.dispose(),b.dispose(),[2,E]}})})},e.prototype.dispose=function(){this.baseModel.dispose()},e}();function ir(e){return A(this,void 0,void 0,function(){var r,t,n,i,a,s;return H(this,function(d){switch(d.label){case 0:if(r=e.outputStride,t=e.quantBytes,n=e.multiplier,Ke==null)throw new Error(`Cannot find TensorFlow.js. If you are using a <script> tag, please also include @tensorflow/tfjs on the page before using this
        model.`);return i=Yt(r,n,t),[4,Qe(e.modelUrl||i)];case 1:return a=d.sent(),s=new xt(a,r),[2,new ot(s)]}})})}function or(e){return A(this,void 0,void 0,function(){var r,t,n,i,a;return H(this,function(s){switch(s.label){case 0:if(r=e.outputStride,t=e.quantBytes,Ke==null)throw new Error(`Cannot find TensorFlow.js. If you are using a <script> tag, please also include @tensorflow/tfjs on the page before using this
        model.`);return n=Gt(r,t),[4,Qe(e.modelUrl||n)];case 1:return i=s.sent(),a=new Qt(i,r),[2,new ot(a)]}})})}function yr(e){return e===void 0&&(e=it),A(this,void 0,void 0,function(){return H(this,function(r){return e=ar(e),e.architecture==="ResNet50"?[2,or(e)]:e.architecture==="MobileNetV1"?[2,ir(e)]:[2,null]})})}/**
 * @license
 * Copyright 2019 Google LLC. All Rights Reserved.
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 * =============================================================================
 */function sr(e,r,t){for(var n=e.getContext("2d"),i=0,a=5,s=1/(2*Math.PI*a*a),d=t<3?1:2,f=-t;f<=t;f+=d)for(var o=-t;o<=t;o+=d){var u=s*Math.exp(-(o*o+f*f)/(2*a*a));i+=u}for(var f=-t;f<=t;f+=d)for(var o=-t;o<=t;o+=d)n.globalAlpha=s*Math.exp(-(o*o+f*f)/(2*a*a))/i*t,n.drawImage(r,o,f);n.globalAlpha=1}/**
 * @license
 * Copyright 2019 Google LLC. All Rights Reserved.
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 * =============================================================================
 */var me={};function dr(){return/^((?!chrome|android).)*safari/i.test(navigator.userAgent)}function st(e,r,t,n){var i=e.width,a=e.height,s=r.width,d=r.height;if(i!==s||a!==d)throw new Error("error: dimensions must match. ".concat(t," has dimensions ").concat(i,"x").concat(a,", ").concat(n," has dimensions ").concat(s,"x").concat(d))}function ue(e){var r=e.getContext("2d");r.scale(-1,1),r.translate(-e.width,0)}function oe(e,r,t){e.globalCompositeOperation=t,e.drawImage(r,0,0)}function fr(){if(typeof document<"u")return document.createElement("canvas");if(typeof OffscreenCanvas<"u")return new OffscreenCanvas(0,0);throw new Error("Cannot create a canvas in this context")}function Me(e){return me[e]||(me[e]=fr()),me[e]}function ur(e,r,t){var n=e.height,i=e.width,a=t.getContext("2d");t.width=i,t.height=n,a.clearRect(0,0,i,n),a.save(),dr()?sr(t,e,r):(a.filter="blur(".concat(r,"px)"),a.drawImage(e,0,0,i,n)),a.restore()}function Q(e,r,t){var n=Me(t);return r===0?lr(e,n):ur(e,r,n),n}function lr(e,r){var t=e.width,n=e.height;r.width=t,r.height=n;var i=r.getContext("2d");i.drawImage(e,0,0,t,n)}function cr(e,r){r.width=e.width,r.height=e.height;var t=r.getContext("2d");t.putImageData(e,0,0)}function le(e,r){var t=Me(r);return cr(e,t),t}function dt(e,r,t,n,i){if(r===void 0&&(r={r:0,g:0,b:0,a:0}),t===void 0&&(t={r:0,g:0,b:0,a:255}),n===void 0&&(n=!1),i===void 0&&(i=[1]),Array.isArray(e)&&e.length===0)return null;var a;Array.isArray(e)?a=e:a=[e];var s=a[0],d=s.width,f=s.height,o=new Uint8ClampedArray(d*f*4);function u(h,w,b,g,S,m){m===void 0&&(m={r:0,g:255,b:255,a:255});for(var y=-S;y<=S;y++)for(var M=-S;M<=S;M++)if(y!==0&&M!==0){var _=(w+y)*g+(b+M);h[4*_+0]=m.r,h[4*_+1]=m.g,h[4*_+2]=m.b,h[4*_+3]=m.a}}function l(h,w,b,g,S,m){S===void 0&&(S=[1]),m===void 0&&(m=1);for(var y=0,M=-m;M<=m;M++)for(var _=function(R){if(M!==0&&R!==0){var x=(w+M)*g+(b+R);S.some(function(T){return T===h[x]})||(y+=1)}},E=-m;E<=m;E++)_(E);return y>0}for(var c=0;c<f;c+=1)for(var p=function(h){var w=c*d+h;o[4*w+0]=t.r,o[4*w+1]=t.g,o[4*w+2]=t.b,o[4*w+3]=t.a;for(var b=function(S){if(i.some(function(y){return y===a[S].data[w]})){o[4*w]=r.r,o[4*w+1]=r.g,o[4*w+2]=r.b,o[4*w+3]=r.a;var m=l(a[S].data,c,h,d,i);n&&c-1>=0&&c+1<f&&h-1>=0&&h+1<d&&m&&u(o,c,h,d,1)}},g=0;g<a.length;g++)b(g)},v=0;v<d;v+=1)p(v);return new ImageData(o,d,f)}var hr=[[110,64,170],[143,61,178],[178,60,178],[210,62,167],[238,67,149],[255,78,125],[255,94,99],[255,115,75],[255,140,56],[239,167,47],[217,194,49],[194,219,64],[175,240,91],[135,245,87],[96,247,96],[64,243,115],[40,234,141],[28,219,169],[26,199,194],[33,176,213],[47,150,224],[65,125,224],[84,101,214],[99,81,195]];function Sr(e,r){if(r===void 0&&(r=hr),Array.isArray(e)&&e.length===0)return null;var t;Array.isArray(e)?t=e:t=[e];for(var n=t[0],i=n.width,a=n.height,s=new Uint8ClampedArray(i*a*4),d=0;d<a*i;++d){var f=d*4;s[f+0]=255,s[f+1]=255,s[f+2]=255,s[f+3]=255;for(var o=0;o<t.length;o++){var u=t[o].data[d];if(u!==-1){var l=r[u];if(!l)throw new Error("No color could be found for part id ".concat(u));s[f+0]=l[0],s[f+1]=l[1],s[f+2]=l[2],s[f+3]=255}}}return new ImageData(s,i,a)}var I={blurred:"blurred",blurredMask:"blurred-mask",mask:"mask",lowresPartMask:"lowres-part-mask"};function br(e,r,t,n,i,a){n===void 0&&(n=.7),i===void 0&&(i=0),a===void 0&&(a=!1);var s=F(r),d=s[0],f=s[1];e.width=f,e.height=d;var o=e.getContext("2d");if(o.save(),a&&ue(e),o.drawImage(r,0,0),o.globalAlpha=n,t){st({width:f,height:d},t,"image","mask");var u=le(t,I.mask),l=Q(u,i,I.blurredMask);o.drawImage(l,0,0,f,d)}o.restore()}function Mr(e,r,t,n,i,a,s){n===void 0&&(n=.7),i===void 0&&(i=0),a===void 0&&(a=!1),s===void 0&&(s=10);var d=F(r),f=d[0],o=d[1];st({width:o,height:f},t,"image","mask");var u=le(t,I.mask),l=Q(u,i,I.blurredMask);e.width=l.width,e.height=l.height;var c=e.getContext("2d");c.save(),a&&ue(e);var p=Me(I.lowresPartMask),v=p.getContext("2d");p.width=l.width*(1/s),p.height=l.height*(1/s),v.drawImage(l,0,0,l.width,l.height,0,0,p.width,p.height),c.imageSmoothingEnabled=!1,c.drawImage(p,0,0,p.width,p.height,0,0,e.width,e.height);for(var h=0;h<p.width;h++)c.beginPath(),c.strokeStyle="#ffffff",c.moveTo(s*h,0),c.lineTo(s*h,e.height),c.stroke();for(var h=0;h<p.height;h++)c.beginPath(),c.strokeStyle="#ffffff",c.moveTo(0,s*h),c.lineTo(e.width,s*h),c.stroke();c.globalAlpha=1-n,c.drawImage(r,0,0,l.width,l.height),c.restore()}function pr(e,r){var t=dt(e,{r:0,g:0,b:0,a:255},{r:0,g:0,b:0,a:0}),n=le(t,I.mask);return r===0?n:Q(n,r,I.blurredMask)}function _r(e,r,t,n,i,a){n===void 0&&(n=3),i===void 0&&(i=3),a===void 0&&(a=!1);var s=Q(r,n,I.blurred);e.width=s.width,e.height=s.height;var d=e.getContext("2d");if(Array.isArray(t)&&t.length===0){d.drawImage(s,0,0);return}var f=pr(t,i);d.save(),a&&ue(e);var o=F(r),u=o[0],l=o[1];d.drawImage(r,0,0,l,u),oe(d,f,"destination-in"),oe(d,s,"destination-over"),d.restore()}function vr(e,r,t){var n=dt(e,{r:0,g:0,b:0,a:0},{r:0,g:0,b:0,a:255},!0,r),i=le(n,I.mask);return t===0?i:Q(i,t,I.blurredMask)}function Er(e,r,t,n,i,a,s){n===void 0&&(n=[0,1]),i===void 0&&(i=3),a===void 0&&(a=3),s===void 0&&(s=!1);var d=Q(r,i,I.blurred);e.width=d.width,e.height=d.height;var f=e.getContext("2d");if(Array.isArray(t)&&t.length===0){f.drawImage(d,0,0);return}var o=vr(t,n,a);f.save(),s&&ue(e);var u=F(r),l=u[0],c=u[1];f.drawImage(r,0,0,c,l),oe(f,o,"destination-in"),oe(f,d,"destination-over"),f.restore()}/**
 * @license
 * Copyright 2020 Google Inc. All Rights Reserved.
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 *
 * =============================================================================
 */var xr=["left_face","right_face","left_upper_arm_front","left_upper_arm_back","right_upper_arm_front","right_upper_arm_back","left_lower_arm_front","left_lower_arm_back","right_lower_arm_front","right_lower_arm_back","left_hand","right_hand","torso_front","torso_back","left_upper_leg_front","left_upper_leg_back","right_upper_leg_front","right_upper_leg_back","left_lower_leg_front","left_lower_leg_back","right_lower_leg_front","right_lower_leg_back","left_feet","right_feet"];/** @license See the LICENSE file. */var Rr="2.2.1";export{ot as BodyPix,xr as PART_CHANNELS,Er as blurBodyPart,_r as drawBokehEffect,br as drawMask,Mr as drawPixelatedMask,gr as flipPoseHorizontal,yr as load,wr as resizeAndPadTo,V as scaleAndCropToInputTensorShape,Sr as toColoredPartMask,dt as toMask,Rr as version};
//# sourceMappingURL=body-pix.esm-t9okQFJU.js.map
