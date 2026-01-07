import{a}from"./chunk-5QOQCG4B.js";import{Z as u,e as s}from"./chunk-M5WQ34XW.js";var p=(()=>{class i{constructor(){this.API_URL="https://models.inference.ai.azure.com/chat/completions",this.MODEL="gpt-4o-mini"}isConfigured(){return!!a.githubToken&&a.githubToken!=="GHAI_TOKEN"&&(a.githubToken.startsWith("github_pat_")||a.githubToken.startsWith("ghp_"))}suggestRecipes(n,e){return s(this,null,function*(){let r=`${e?e+`

`:""}Generate 3 recipe suggestions based on: ${n}

Please respond with a JSON array of recipes in this exact format:
[
  {
    "name": "Recipe Name",
    "description": "Brief description",
    "prepTime": 15,
    "cookTime": 30,
    "servings": 4,
    "ingredients": ["ingredient 1", "ingredient 2"],
    "instructions": ["step 1", "step 2"],
    "tags": ["tag1", "tag2"]
  }
]

Only return valid JSON, no additional text.`,o=yield this.generateContent(r);if(!o.success)throw new Error(o.error||"Failed to generate recipe suggestions");try{let t=o.text.match(/\[[\s\S]*\]/);if(!t)throw new Error("No valid JSON found in response");return JSON.parse(t[0])}catch(t){throw console.error("Error parsing recipe suggestions:",t),new Error("Failed to parse recipe suggestions")}})}suggestGroceries(n,e){return s(this,null,function*(){let r=e?.length?`

Existing items (don't duplicate): ${e.join(", ")}`:"",o=`Based on these planned recipes: ${n.join(", ")}${r}

Generate a comprehensive grocery list. Return only a JSON array of strings, no additional text:
["item 1", "item 2", "item 3"]`,t=yield this.generateContent(o);if(!t.success)throw new Error(t.error||"Failed to generate grocery suggestions");try{let c=t.text.match(/\[[\s\S]*\]/);if(!c)throw new Error("No valid JSON found in response");return JSON.parse(c[0])}catch(c){throw console.error("Error parsing grocery suggestions:",c),new Error("Failed to parse grocery suggestions")}})}suggestMealPlan(n,e=7){return s(this,null,function*(){let r=`Create a ${e}-day meal plan based on: ${n}

Return only a JSON array in this format, no additional text:
[
  {
    "day": "Monday",
    "breakfast": "meal name",
    "lunch": "meal name",
    "dinner": "meal name",
    "snacks": ["snack 1", "snack 2"]
  }
]`,o=yield this.generateContent(r);if(!o.success)throw new Error(o.error||"Failed to generate meal plan");try{let t=o.text.match(/\[[\s\S]*\]/);if(!t)throw new Error("No valid JSON found in response");return JSON.parse(t[0])}catch(t){throw console.error("Error parsing meal plan:",t),new Error("Failed to parse meal plan")}})}suggestRestaurants(n,e){return s(this,null,function*(){let r=`Suggest 3-5 ${n} restaurants or food delivery options. ${e?`Preferences: ${e}`:""}
    
Provide brief descriptions and what makes each one special. Format as a simple text list.`,o=yield this.generateContent(r);if(!o.success)throw new Error(o.error||"Failed to generate restaurant suggestions");return o.text})}generateContent(n){return s(this,null,function*(){if(!this.isConfigured())return{success:!1,text:"",error:"GitHub Personal Access Token not configured. Please add your token to the environment file."};try{let e=yield fetch(this.API_URL,{method:"POST",headers:{"Content-Type":"application/json",Authorization:`Bearer ${a.githubToken}`},body:JSON.stringify({messages:[{role:"user",content:n}],model:this.MODEL,temperature:.7,max_tokens:4096})});if(!e.ok){let t=yield e.json().catch(()=>({}));throw console.error("GitHub Models API Error Details:",{status:e.status,statusText:e.statusText,error:t}),new Error(t.error?.message||`API request failed: ${e.status} - ${e.statusText}`)}let r=yield e.json();if(!r.choices||!r.choices[0]?.message?.content)throw new Error("Invalid response format from GitHub Models API");let o=r.choices[0].message.content;return this.incrementApiCounter(),{success:!0,text:o}}catch(e){return console.error("GitHub Models API error:",e),{success:!1,text:"",error:e.message||"Unknown error occurred"}}})}incrementApiCounter(){let e=parseInt(localStorage.getItem("githubApiCallCount")||"0",10)+1;localStorage.setItem("githubApiCallCount",e.toString()),window.dispatchEvent(new StorageEvent("storage",{key:"githubApiCallCount",newValue:e.toString()}))}getCookingHelp(n){return s(this,null,function*(){let e=`You are a helpful cooking assistant. Answer this question briefly and practically: ${n}`,r=yield this.generateContent(e);if(!r.success)throw new Error(r.error||"Failed to get cooking help");return r.text})}static{this.\u0275fac=function(e){return new(e||i)}}static{this.\u0275prov=u({token:i,factory:i.\u0275fac,providedIn:"root"})}}return i})();export{p as a};
